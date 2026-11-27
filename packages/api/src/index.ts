import { createGitWorkflow } from "@spectron/backend";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { HttpBindings } from "@hono/node-server";
import {
  createProjectService,
  createAgentRunService,
  createAIService,
  createLocalHandoffService,
  createGitService,
  createGitAdapterFactory,
  createGitTransport,
  type GitAdapterFactory,
  type AICredentialCheck,
  createExportService,
  createTrackerService,
  createFieldService,
  createJiraService,
  createFileService,
  createCommentService,
  createWorklogService,
  createActivityService,
  type FileStorageConfig,
  createIssueService,
  createInvitationService,
  type InvitationConfig,
  type Auth,
  createApiTokenService,
  createPublicApiService,
  createOAuthAppService,
  createOAuthResume,
} from "@spectron/backend";
import type { Database } from "@spectron/db";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./trpc/router";
import { createFileRoutes } from "./files";
import { createContext } from "./trpc/context";
import { createV1Routes } from "./v1";
import { createOperations } from "./operations";
import { createMcpRoute, MCP_MAX_BODY_BYTES } from "./mcp";
import { createCliRoutes } from "./cli-install";

export function createAPI(
  auth: Auth,
  {
    db,
    appURL,
    trustProxy = false,
    fileStorage,
    integrationSecret,
    aiSecret,
    aiCredentialCheck,
    gitAdapterFactory,
    gitlabAllowedPrivateOrigins = [],
    gitProviderDNS = "system",
    cliDist,
    sendInvitationEmail = async () => {
      throw new Error("Invitation email is unavailable.");
    },
  }: {
    db: Database;
    appURL: string;
    trustProxy?: boolean;
    fileStorage?: FileStorageConfig;
    integrationSecret?: string;
    aiSecret?: string;
    aiCredentialCheck?: AICredentialCheck;
    gitAdapterFactory?: GitAdapterFactory;
    gitlabAllowedPrivateOrigins?: string[];
    gitProviderDNS?: "system" | "cloudflare";
    /** Built CLI (apps/cli/dist), served with its installer at /cli/. */
    cliDist?: string;
    sendInvitationEmail?: InvitationConfig["sendInvitationEmail"];
  },
) {

  const activity = createActivityService(db);
  const ai = createAIService(db, aiSecret, aiCredentialCheck);
  const factory = gitAdapterFactory ?? createGitAdapterFactory(
    createGitTransport(gitlabAllowedPrivateOrigins, { dns: gitProviderDNS }),
  );
  const git = createGitService(db, integrationSecret, factory);
  const worklogs = createWorklogService(db);
  const comments = createCommentService(db);
  const files = createFileService(db, fileStorage);
  const handoffs = createLocalHandoffService(db, files, appURL);
  const gitWorkflow = createGitWorkflow(db, integrationSecret, factory);
  const runs = createAgentRunService(db, files, { secret: integrationSecret, factory });
  const tracker = createTrackerService(db, undefined, undefined, files);
  const issues = createIssueService(db);
  const fields = createFieldService(db);
  const jira = createJiraService(db, files, integrationSecret);
  const exports = createExportService(db, jira, tracker);
  const projects = createProjectService(db);
  const invitations = createInvitationService(db, {
    appURL,
    sendInvitationEmail,
  });
  const apiTokens = createApiTokenService(db);
  const oauthApps = createOAuthAppService(db);
  const publicApi = createPublicApiService(db, appURL);
  const operations = createOperations({ publicApi, issues, comments, files, appURL });
  const api = new Hono<{ Bindings: HttpBindings }>();
  // File uploads stream to disk and enforce FILES_MAX_BYTES themselves. On
  // the issue attachments route only ?filename= requests carry file bytes; a
  // JSON {fileId} link request there stays size-limited.
  const isUpload = (path: string, filename: string | undefined) =>
    path === "/api/files/upload" ||
    /^\/api\/v1\/projects\/[^/]+\/files$/.test(path) ||
    (filename !== undefined && /^\/api\/v1\/issues\/[^/]+\/attachments$/.test(path));
  api.use("/api/*", (c, next) =>
    isUpload(c.req.path, c.req.query("filename"))
      ? next()
      : bodyLimit({
          maxSize:
            c.req.path === "/api/mcp"
              ? MCP_MAX_BODY_BYTES
              : c.req.path.startsWith("/api/trpc/") || c.req.path.startsWith("/api/v1/")
              ? 3 * 1024 * 1024
              : c.req.path.startsWith("/api/git/webhooks/") ? 1024 * 1024 : 16 * 1024,
          // Hono's default throws, which the error handler below would turn into a 500.
          onError: (c: Context) =>
            c.req.path.startsWith("/api/v1/")
              ? c.json({ error: { code: "body_too_large", message: "Request bodies are limited to 3 MB." } }, 413)
              : c.json({ error: "Request body is too large." }, 413),
        })(c, next),
  );
  api.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control"))
      c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  });
  api.route("/api/files", createFileRoutes(auth, files, appURL, handoffs));
  // OAuth discovery for MCP clients. Better Auth answers these root paths
  // itself (RFC 8414 / RFC 9728 path-inserted forms); only they are routed.
  api.get("/.well-known/*", async (c, next) => {
    if (!/^\/\.well-known\/(oauth-authorization-server|oauth-protected-resource|openid-configuration)(\/|$)/.test(c.req.path))
      return next();
    const response = await auth.handler(c.req.raw);
    const headers = new Headers(response.headers);
    // Public metadata; browser-based MCP clients read it cross-origin.
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, { status: response.status, headers });
  });
  // Login links land here to resume an MCP client's authorization.
  const resumeOAuth = createOAuthResume(auth);
  api.get("/api/oauth/resume", (c) => resumeOAuth(c.req.raw));
  const mcp = createMcpRoute({ auth, tokens: apiTokens, apps: oauthApps, files, operations, appURL });
  api.on(["GET", "POST", "DELETE"], "/api/mcp", (c) => mcp(c.req.raw));
  api.route(
    "/api/v1",
    createV1Routes({ tokens: apiTokens, operations, files }),
  );
  if (cliDist) api.route("/cli", createCliRoutes({ appURL, dist: cliDist }));
  api.post("/api/git/webhooks/:connectionId", async c => {
    try { await gitWorkflow.webhook(c.req.param("connectionId"), c.req.raw.headers, await c.req.text()); return c.json({ accepted: true }); }
    catch { return c.json({ error: "Webhook rejected" }, 403); }
  });
  api.get("/api/health", (c) => c.json({ status: "ok" }));
  api.on(["GET", "POST"], "/api/auth/*", (c) => {
    const headers = new Headers(c.req.raw.headers);
    // Trust X-Real-IP only when deployed behind our private Nginx proxy.
    const ip = trustProxy
      ? headers.get("x-real-ip")
      : c.env?.incoming
        ? getConnInfo(c).remote.address
        : "127.0.0.1";
    headers.set("x-spectron-client-ip", ip || "127.0.0.1");
    return auth.handler(new Request(c.req.raw, { headers }));
  });
  api.on(["GET", "POST"], "/api/trpc/*", async (c): Promise<Response> => {
    if (c.req.method === "POST" && c.req.header("origin") !== appURL) {
      return c.json({ error: "Invalid origin" }, 403);
    }
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () =>
        createContext(
          auth,
          projects,
          invitations,
          c.req.raw,
          issues,
          files,
          comments,
          worklogs,
          activity,
          fields,
          jira,
          tracker,
          exports,
          ai,
          git,
          runs,
          gitWorkflow,
          handoffs,
          apiTokens,
          oauthApps,
        ),
    });
  });
  api.get("/api/me", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ user: session.user });
  });
  api.onError((_error, c) => {
    console.error("API request failed.");
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  });
  return api;
}
