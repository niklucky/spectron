import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createDatabase, getDatabaseURL } from "@spectron/db";
import {
  createAuth,
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
const stopScheduler = createJiraScheduler(
  db,
  createJiraService(
    db,
    createFileService(db, apiOptions.fileStorage),
    apiOptions.integrationSecret,
  ),
).start();
const stopExports = createExportService(db, createJiraService(db, createFileService(db, apiOptions.fileStorage), apiOptions.integrationSecret), createTrackerService(db)).start();
const server = serve(
  { fetch: api.fetch, port, hostname: process.env.API_HOST || "127.0.0.1" },
  () => {
    console.info(`Spectron API listening on port ${port}`);
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void Promise.all([stopScheduler(), stopExports()])
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
  });
}
