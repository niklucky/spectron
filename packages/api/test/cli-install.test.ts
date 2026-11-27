import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, lstat, readdir, stat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Readable, Writable } from "node:stream";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createCliRoutes, shellQuote } from "../src/cli-install";
import { run } from "../../../apps/cli/src/cli";

const cliDir = fileURLToPath(new URL("../../../apps/cli/", import.meta.url));

/** Runs a command; resolves with its exit code and output instead of throwing. */
function sh(script: string, env: Record<string, string>, stdin?: string, cwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile("sh", ["-c", script], { env, ...(cwd ? { cwd } : {}) }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    );
    child.stdin?.end(stdin ?? "");
  });
}

test("CLI installer: curl | sh installs, upgrades and refuses bad downloads", { skip: process.platform === "win32" }, async (t) => {
  // Physical, as the installer resolves it (macOS: /var is /private/var).
  const root = await realpath(await mkdtemp(join(tmpdir(), "spectron-cli-install-")));
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
    server.closeAllConnections();
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
  assert.match(missing.stderr, /isn't available on this server yet/);

  const gone = await fetch(`${origin}/cli/spectron.mjs`);
  assert.equal(gone.status, 404);
  assert.equal(gone.headers.get("cache-control"), "no-store");
  // The documented form for scripts fails when the download does.
  const scripted = await sh(`curl -fsSL ${origin}/cli/install.sh -o i.sh && sh i.sh`, env, undefined, root);
  assert.notEqual(scripted.code, 0);

  routes = new Hono().route("/cli", createCliRoutes({ appURL: origin, dist }));
  // Unknown paths under /cli/ never fall through to the app's HTML shell.
  for (const path of ["/cli/install.sh/", "/cli/other", "/cli"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
  }
  const served = await fetch(`${origin}/cli/install.sh`);
  assert.equal(served.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(served.headers.get("cache-control"), "no-cache");
  const script = await served.text();
  assert.match(script, new RegExp(`server='${origin}'`));
  assert.match(script, /checksum='[0-9a-f]{64}'/);
  assert.doesNotMatch(script, /__SPECTRON_/);

  // A script cut off before its last line runs nothing.
  const cut = script.slice(0, script.lastIndexOf('main "$@"'));
  assert.equal((await sh("sh", env, cut)).code, 0);
  await assert.rejects(lstat(bin));

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

  // A restrictive umask still leaves the CLI executable.
  const masked = await sh(`umask 177; ${install}`, env);
  assert.equal(masked.code, 0, masked.stderr);
  assert.match((await sh(`"${bin}" --version`, env)).stdout, /^\d+\.\d+\.\d+\n$/);
  // install.json stays readable for other users of a shared install.
  assert.equal((await stat(join(share, "install.json"))).mode & 0o777, 0o644);
  assert.equal((await stat(share)).mode & 0o777, 0o755);

  // Without HOME, it asks for explicit directories rather than failing obscurely.
  const { HOME: _home, ...homeless } = env;
  const noHome = await sh(install, homeless);
  assert.equal(noHome.code, 1);
  assert.match(noHome.stderr, /HOME isn't set\. Set SPECTRON_INSTALL_DIR and SPECTRON_BIN_DIR/);
  // …unless the locations come from elsewhere.
  const xdg = await sh(install, { ...homeless, XDG_DATA_HOME: join(root, "xdg"), SPECTRON_BIN_DIR: join(root, "xdg-bin") });
  assert.equal(xdg.code, 0, xdg.stderr);
  assert.ok((await lstat(join(root, "xdg-bin/spectron"))).isSymbolicLink());

  // A fresh install under a restrictive umask still works and is shared;
  // an existing private install directory stays private.
  const freshHome = join(root, "fresh-home");
  await mkdir(freshHome);
  const fresh = await sh(`umask 177; ${install}`, { ...env, HOME: freshHome });
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal((await stat(join(freshHome, ".local/share/spectron"))).mode & 0o777, 0o755);
  assert.equal((await stat(join(freshHome, ".local/bin"))).mode & 0o777, 0o755);
  const privateDir = join(root, "private");
  await mkdir(privateDir, { mode: 0o700 });
  const kept = await sh(install, { ...env, SPECTRON_INSTALL_DIR: privateDir, SPECTRON_BIN_DIR: join(root, "private-bin") });
  assert.equal(kept.code, 0, kept.stderr);
  assert.equal((await stat(privateDir)).mode & 0o777, 0o700);

  // A directory where a file goes is refused before anything moves.
  const occupied = join(root, "occupied");
  await mkdir(join(occupied, "spectron.mjs"), { recursive: true });
  const refusedDir = await sh(install, { ...env, SPECTRON_INSTALL_DIR: occupied, SPECTRON_BIN_DIR: join(root, "occupied-bin") });
  assert.equal(refusedDir.code, 1);
  assert.match(refusedDir.stderr, /spectron\.mjs is a directory/);

  // Staging directories never outlive a run.
  assert.deepEqual((await readdir(share)).sort(), ["install.json", "spectron.mjs"]);

  // Relative directories still produce a link that resolves.
  const relative = await sh(install, { ...env, SPECTRON_INSTALL_DIR: "tools/share", SPECTRON_BIN_DIR: "tools/bin" }, undefined, root);
  assert.equal(relative.code, 0, relative.stderr);
  assert.equal(await readlink(join(root, "tools/bin/spectron")), join(root, "tools/share/spectron.mjs"));
  assert.match((await sh("tools/bin/spectron --version", env, undefined, root)).stdout, /^\d+\.\d+\.\d+\n$/);

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
  // Nor is another program's link.
  const linkedBin = join(root, "linked-bin");
  await mkdir(linkedBin);
  await symlink("/bin/sh", join(linkedBin, "spectron"));
  const linked = await sh(install, { ...env, SPECTRON_BIN_DIR: linkedBin });
  assert.equal(linked.code, 1);
  assert.match(linked.stderr, /links to \/bin\/sh, not to/);
  assert.equal(await readlink(join(linkedBin, "spectron")), "/bin/sh");

  // A signal during a stalled download stops it at once and cleans up.
  const stalledShare = join(root, "stalled");
  routes = new Hono();
  routes.get("/cli/install.sh", () => new Response(script));
  routes.get("/cli/spectron.mjs", () => new Promise<Response>(() => {}));
  await writeFile(join(root, "install.sh"), script);
  const child = spawn("sh", [join(root, "install.sh")], { env: { ...env, SPECTRON_INSTALL_DIR: stalledShare, SPECTRON_BIN_DIR: join(root, "stalled-bin") } });
  const exited = once(child, "exit");
  // "Downloading…" is printed once the traps are set; an early exit fails the test.
  await Promise.race([once(child.stdout, "data"), exited.then(() => assert.fail("The installer exited before downloading."))]);
  const started = Date.now();
  child.kill("SIGTERM");
  const [code] = (await exited) as [number | null];
  assert.equal(code, 143);
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(await readdir(stalledShare), []);
});

test("shellQuote makes a POSIX shell literal", async () => {
  for (const value of ["https://a.example", "it's", "'", "$(x) `y` \\ \"z\""]) {
    const { stdout } = await sh(`printf %s ${shellQuote(value)}`, { PATH: "/usr/bin:/bin" });
    assert.equal(stdout, value);
  }
});

test("CLI login: --url, SPECTRON_URL, the saved server, then the install server", async (t) => {
  const config = await mkdtemp(join(tmpdir(), "spectron-cli-default-"));
  t.after(() => rm(config, { recursive: true, force: true }));
  const login = async (env: Record<string, string>, args: string[] = []) => {
    const requested: string[] = [];
    const sink = () => new Writable({ write: (_chunk, _encoding, done) => done() });
    await run(["auth", "login", "--with-token", ...args], {
      env: { SPECTRON_CONFIG_DIR: config, ...env },
      cwd: config,
      stdin: Readable.from(["spk_test\n"]),
      stdout: sink(),
      stderr: sink(),
      fetch: async (url) => {
        requested.push(new URL(url).origin);
        return Response.json({ error: { code: "unauthorized", message: "No." } }, { status: 401 });
      },
      defaultURL: "https://installed.example",
    });
    return requested;
  };
  assert.deepEqual(await login({}), ["https://installed.example"]);
  // An empty variable falls through rather than blocking the defaults.
  assert.deepEqual(await login({ SPECTRON_URL: "" }), ["https://installed.example"]);
  await writeFile(join(config, "config.json"), JSON.stringify({ url: "https://saved.example", token: "spk_saved" }));
  assert.deepEqual(await login({}), ["https://saved.example"]);
  assert.deepEqual(await login({ SPECTRON_URL: "https://env.example" }), ["https://env.example"]);
  assert.deepEqual(await login({ SPECTRON_URL: "https://env.example" }, ["--url", "https://flag.example"]), ["https://flag.example"]);
});
