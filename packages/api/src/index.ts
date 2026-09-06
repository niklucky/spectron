import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { HttpBindings } from "@hono/node-server";
import type { Auth } from "@spectron/backend";

export function createAPI(auth: Auth, { trustProxy = false } = {}) {
  const api = new Hono<{ Bindings: HttpBindings }>();
  api.use("/api/*", bodyLimit({ maxSize: 16 * 1024 }));
  api.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
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
