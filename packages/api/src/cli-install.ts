import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";

/**
 * Serves the CLI and its installer, so any Spectron server installs a CLI
 * that matches its API:
 *
 *   curl -fsSL https://app.spectron.dev/cli/install.sh | sh
 *
 * `dist` holds spectron.mjs and install.sh from `pnpm --filter @spectron/cli
 * build`. The installer is filled in with this server's address, which the
 * CLI then signs in to by default, and with the bundle's SHA-256, so a
 * damaged download is refused. Both are read per request: a rebuild needs no
 * restart, and an installer never names a checksum of a bundle that is gone.
 */
export function createCliRoutes({ appURL, dist }: { appURL: string; dist: string }) {
  const routes = new Hono();
  const read = (name: string) => readFile(join(dist, name), "utf8").catch(() => null);
  const headers = (type: string) => ({ "Content-Type": type, "Cache-Control": "no-cache" });
  // Never cached, so a CLI built after a miss is served at once.
  const notFound = (body: string) =>
    new Response(body, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

  routes.get("/install.sh", async (c) => {
    const [script, bundle] = await Promise.all([read("install.sh"), read("spectron.mjs")]);
    if (script === null || bundle === null)
      // Still a valid script, for `curl … | sh` without -f.
      return notFound(`echo "The Spectron CLI isn't available on ${appURL} yet." >&2\nexit 1\n`);
    const checksum = createHash("sha256").update(bundle).digest("hex");
    return c.body(
      script.replaceAll("__SPECTRON_SERVER__", appURL).replaceAll("__SPECTRON_SHA256__", checksum),
      200,
      // text/plain so a browser shows the script for reading before running it.
      headers("text/plain; charset=utf-8"),
    );
  });

  routes.get("/spectron.mjs", async (c) => {
    const bundle = await read("spectron.mjs");
    if (bundle === null) return notFound("The Spectron CLI isn't available on this server yet.\n");
    return c.body(bundle, 200, headers("text/javascript; charset=utf-8"));
  });

  // Anything else under /cli/ is a 404 here rather than the app's HTML shell,
  // which `curl -f … | sh` would otherwise accept and run.
  routes.all("*", () => notFound("Not found. The installer is /cli/install.sh.\n"));

  return routes;
}
