import { createGitWorkflow } from "@spectron/backend";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDatabase, getDatabaseURL } from "@spectron/db";
import {
  createAuth,
  createAgentWorker, createDockerAgentRuntime, createGitAdapterFactory, createGitTransport,
  createExportService,
  createTrackerService,
  createFileService,
  createJiraService,
  createJiraScheduler,
  createResetEmailSender,
  createInvitationEmailSender,
} from "@spectron/backend";
import { createAPI } from "./index";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const { BETTER_AUTH_SECRET, APP_URL, RESEND_API_KEY, EMAIL_FROM } = process.env;
if (!APP_URL || !BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
  throw new Error(
    "Set DATABASE_URL, APP_URL, and a BETTER_AUTH_SECRET of at least 32 characters in the root .env. See .env.example.",
  );
}
const url = new URL(APP_URL);
if (url.origin !== APP_URL || !["http:", "https:"].includes(url.protocol))
  throw new Error(
    "APP_URL must be an http(s) origin without a trailing slash.",
  );
if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  throw new Error("Production APP_URL must use HTTPS.");
const port = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid API_PORT.");
if (!RESEND_API_KEY || !EMAIL_FROM)
  console.warn(
    "Password reset email is unavailable until RESEND_API_KEY and EMAIL_FROM are configured.",
  );
const { db, pool } = createDatabase(getDatabaseURL());
await pool.query("SELECT 1");
const auth = createAuth(db, {
  appURL: APP_URL,
  secret: BETTER_AUTH_SECRET,
  sendResetEmail: createResetEmailSender(RESEND_API_KEY, EMAIL_FROM),
});
const apiOptions = {
  db,
  appURL: APP_URL,
  integrationSecret: process.env.INTEGRATION_SECRET || BETTER_AUTH_SECRET,
  gitProviderDNS: process.env.GIT_PROVIDER_DNS === "cloudflare" ? "cloudflare" as const : "system" as const,
  gitlabAllowedPrivateOrigins: (process.env.GITLAB_ALLOWED_PRIVATE_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean),
  ...(process.env.AI_CREDENTIAL_SECRET ? { aiSecret: process.env.AI_CREDENTIAL_SECRET } : {}),
  trustProxy: process.env.TRUST_PROXY === "true",
  fileStorage: {
    root:
      process.env.FILES_ROOT ||
      fileURLToPath(new URL("../../../data/files", import.meta.url)),
    ...(process.env.FILES_MAX_BYTES
      ? { maxBytes: Number(process.env.FILES_MAX_BYTES) }
      : {}),
    delivery:
      process.env.FILE_DELIVERY === "nginx"
        ? ("nginx" as const)
        : ("stream" as const),
  },
  sendInvitationEmail: createInvitationEmailSender(RESEND_API_KEY, EMAIL_FROM),
};
const api = createAPI(auth, apiOptions);
const stopAgents = process.env.AGENT_RUNNER_ENABLED === 'true'
  ? createAgentWorker(db, createFileService(db, apiOptions.fileStorage), createDockerAgentRuntime({
      root: process.env.AGENT_WORKSPACES_ROOT || fileURLToPath(new URL('../../../data/agent-workspaces', import.meta.url)),
      image: process.env.AGENT_RUNNER_IMAGE || 'spectron-agent:1.18.30', dns: apiOptions.gitProviderDNS,
      privateOrigins: apiOptions.gitlabAllowedPrivateOrigins,
    }), { ...apiOptions, gitFactory: createGitAdapterFactory(createGitTransport(apiOptions.gitlabAllowedPrivateOrigins, { dns: apiOptions.gitProviderDNS })), appURL: APP_URL, idleHours: Number(process.env.AGENT_IDLE_HOURS || 3) }).start()
  : async () => {};

const stopGitWorkflow = createGitWorkflow(db, apiOptions.integrationSecret, createGitAdapterFactory(createGitTransport(apiOptions.gitlabAllowedPrivateOrigins, { dns: apiOptions.gitProviderDNS }))).start();
const stopScheduler = createJiraScheduler(
  db,
  createJiraService(
    db,
    createFileService(db, apiOptions.fileStorage),
    apiOptions.integrationSecret,
  ),
).start();
const stopExports = createExportService(db, createJiraService(db, createFileService(db, apiOptions.fileStorage), apiOptions.integrationSecret), createTrackerService(db)).start();
// Serving the built SPA from this process is what keeps production to a
// single container: the same server answers /api and hands back index.html
// for every client-side route. STATIC_ROOT is unset in development, where
// Vite serves the app and proxies /api here.
//
// Registered after every /api route. Hono runs matching handlers in the order
// they were added and stops at the first that returns without calling next(),
// so an API route always wins; these only see what it did not answer. The
// explicit /api/ guard keeps an unknown API path a 404 rather than quietly
// returning the application shell, which would turn a typo in a fetch URL
// into an HTML body where JSON was expected.
const staticRoot = process.env.STATIC_ROOT;
if (staticRoot) {
  if (!existsSync(staticRoot))
    throw new Error(
      `STATIC_ROOT is ${staticRoot}, which does not exist. Build the app first.`,
    );
  // Vite fingerprints everything under /assets, so those are immutable. The
  // shell must not be, or a deploy is invisible until the cache expires.
  const cacheFor = (path: string, c: { header: (k: string, v: string) => void }) => {
    c.header(
      "Cache-Control",
      path.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    c.header("Referrer-Policy", "no-referrer");
  };
  const asset = serveStatic({ root: staticRoot, onFound: cacheFor });
  const shell = serveStatic({
    path: join(staticRoot, "index.html"),
    onFound: cacheFor,
  });
  const notAPI = (handler: typeof asset) => (c: Parameters<typeof asset>[0], next: Parameters<typeof asset>[1]) =>
    c.req.path.startsWith("/api/") ? next() : handler(c, next);
  api.use("*", notAPI(asset));
  api.get("*", notAPI(shell));
}

const server = serve(
  { fetch: api.fetch, port, hostname: process.env.API_HOST || "127.0.0.1" },
  () => {
    console.info(`Spectron API listening on port ${port}`);
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void Promise.all([stopScheduler(), stopExports(), stopAgents(), stopGitWorkflow()])
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
  });
}
