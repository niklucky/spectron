import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { HttpBindings } from "@hono/node-server";
import {
  createProjectService,
  createAgentRunService,
  createAIService,
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
} from "@spectron/backend";
import type { Database } from "@spectron/db";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./trpc/router";
import { createFileRoutes } from "./files";
import { createContext } from "./trpc/context";

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
    sendInvitationEmail?: InvitationConfig["sendInvitationEmail"];
  },
) {

  const activity = createActivityService(db);
  const ai = createAIService(db, aiSecret, aiCredentialCheck);
  const git = createGitService(db, integrationSecret, gitAdapterFactory ?? createGitAdapterFactory(createGitTransport(gitlabAllowedPrivateOrigins, { dns: gitProviderDNS })));
  const worklogs = createWorklogService(db);
  const comments = createCommentService(db);
  const files = createFileService(db, fileStorage);
  const runs = createAgentRunService(db, files);
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
  const api = new Hono<{ Bindings: HttpBindings }>();
  api.use("/api/*", (c, next) =>
    c.req.path === "/api/files/upload"
      ? next()
      : bodyLimit({
          maxSize: c.req.path.startsWith("/api/trpc/")
            ? 3 * 1024 * 1024
            : 16 * 1024,
        })(c, next),
  );
  api.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control"))
      c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  });
  api.route("/api/files", createFileRoutes(auth, files, appURL));
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
