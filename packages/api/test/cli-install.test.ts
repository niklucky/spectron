import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createCliRoutes } from "../src/cli-install";

const cliDir = fileURLToPath(new URL("../../../apps/cli/", import.meta.url));

/** Runs a command; resolves with its exit code and output instead of throwing. */
function sh(script: string, env: Record<string, string>, stdin?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile("sh", ["-c", script], { env }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    );
    child.stdin?.end(stdin ?? "");
  });
}

test("CLI installer: curl | sh installs, upgrades and refuses bad downloads", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "spectron-cli-install-"));
  const dist = join(root, "dist");
  const home = join(root, "home");
  await mkdir(home);
  await new Promise<void>((resolve, reject) =>
    execFile(process.execPath, [join(cliDir, "build.mjs"), dist], (error) => (error ? reject(error) : resolve())),
  );

  // The routes need the server's own address, known once it listens.
  let routes = new Hono();
  const app = new Hono();
  app.all("*", (c) => routes.fetch(c.req.raw));
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  // A clean environment: node on PATH, but not the directory the CLI goes to.
  const env = { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, SPECTRON_CONFIG_DIR: join(root, "config") };
  const install = `curl -fsSL ${origin}/cli/install.sh | sh`;
  const bin = join(home, ".local/bin/spectron");
  const share = join(home, ".local/share/spectron");

  // Not built: the 404 body is itself a script that explains and fails.
  routes.route("/cli", createCliRoutes({ appURL: origin, dist: join(root, "missing") }));
  const missing = await sh(`curl -sS ${origin}/cli/install.sh | sh`, env);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /isn't available on http:\/\/127\.0\.0\.1/);

  routes = new Hono().route("/cli", createCliRoutes({ appURL: origin, dist }));
  const served = await fetch(`${origin}/cli/install.sh`);
  assert.equal(served.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(served.headers.get("cache-control"), "no-cache");
  const script = await served.text();
  assert.match(script, new RegExp(`server='${origin}'`));
  assert.match(script, /checksum='[0-9a-f]{64}'/);
  assert.doesNotMatch(script, /__SPECTRON_/);

  const first = await sh(install, env);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /Installed spectron \d+\.\d+\.\d+: /);
  assert.match(first.stdout, /isn't on your PATH[\s\S]*export PATH=/);
  assert.match(first.stdout, /Next: spectron auth login/);
  assert.ok((await lstat(bin)).isSymbolicLink());
  assert.equal(await readlink(bin), join(share, "spectron.mjs"));
  assert.deepEqual(JSON.parse(await readFile(join(share, "install.json"), "utf8")), { url: origin });

  // The installed CLI signs in to the server it came from without --url: the
  // token check comes after the address is settled.
  const login = await sh(`"${bin}" auth login --with-token`, env, "not-a-token\n");
  assert.equal(login.code, 2);
  assert.match(login.stderr, /doesn't look like a Spectron token/);

  // Running it again upgrades in place, and needs no PATH hint once on PATH.
  const again = await sh(install, { ...env, PATH: `${join(home, ".local/bin")}:${env.PATH}` });
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /isn't on your PATH/);
  assert.match((await sh("spectron --version", { ...env, PATH: `${join(home, ".local/bin")}:${env.PATH}` })).stdout, /^\d+\.\d+\.\d+\n$/);

  // A bundle that changed after the installer was served is refused, and the
  // installed CLI is left alone.
  const before = await readFile(join(share, "spectron.mjs"), "utf8");
  const stale = await (await fetch(`${origin}/cli/install.sh`)).text();
  await appendFile(join(dist, "spectron.mjs"), "\n// changed\n");
  const refused = await sh("sh", env, stale);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /doesn't match its checksum/);
  assert.equal(await readFile(join(share, "spectron.mjs"), "utf8"), before);

  // Something else already called spectron is never overwritten.
  const otherBin = join(root, "other-bin");
  await mkdir(otherBin);
  await writeFile(join(otherBin, "spectron"), "#!/bin/sh\n");
  const blocked = await sh(install, { ...env, SPECTRON_BIN_DIR: otherBin });
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /already exists and isn't a link/);
  assert.equal(await readFile(join(otherBin, "spectron"), "utf8"), "#!/bin/sh\n");
});
