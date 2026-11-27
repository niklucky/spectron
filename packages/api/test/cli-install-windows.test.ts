import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createCliRoutes, powershellQuote } from "../src/cli-install";

const cliDir = fileURLToPath(new URL("../../../apps/cli/", import.meta.url));
const windows = process.platform === "win32";

/** PowerShell executables present here: Windows PowerShell 5.1 and/or PowerShell 7. */
const shells = (windows ? ["powershell", "pwsh"] : ["pwsh"]).filter((name) => {
  try {
    execFileSync(name, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

// CI names the shells it must test (SPECTRON_TEST_SHELLS="powershell pwsh"),
// so a missing one fails instead of quietly skipping.
test("required PowerShell versions are present", { skip: !process.env.SPECTRON_TEST_SHELLS }, () => {
  for (const name of process.env.SPECTRON_TEST_SHELLS!.split(" ").filter(Boolean)) assert.ok(shells.includes(name), `${name} is missing`);
});

function ps(shell: string, command: string, env: Record<string, string | undefined>, cwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      shell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { env: { ...process.env, ...env }, ...(cwd ? { cwd } : {}) },
      (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end();
  });
}

for (const shell of shells)
  test(`CLI installer for Windows: irm | iex with ${shell}`, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "spectron-cli-ps-")));
    const dist = join(root, "dist");
    execFileSync(process.execPath, [join(cliDir, "build.mjs"), dist]);

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

    const install = `irm ${origin}/cli/install.ps1 | iex`;
    const dir = join(root, "spectron");
    const env = {
      SPECTRON_INSTALL_DIR: dir,
      SPECTRON_NO_MODIFY_PATH: "1",
      SPECTRON_CONFIG_DIR: join(root, "config"),
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
    };

    // Not built: nothing to run, and the shell reports the failure.
    routes.route("/cli", createCliRoutes({ appURL: origin, dist: join(root, "missing") }));
    assert.notEqual((await ps(shell, install, env)).code, 0);

    routes = new Hono().route("/cli", createCliRoutes({ appURL: origin, dist }));
    const script = await (await fetch(`${origin}/cli/install.ps1`)).text();
    assert.match(script, new RegExp(`\\$server = '${origin}'`));
    assert.match(script, /\$checksum = '[0-9a-f]{64}'/);

    const first = await ps(shell, install, env);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Installed spectron \d+\.\d+\.\d+: /);
    assert.match(first.stdout, /Next: spectron auth login/);
    assert.deepEqual((await readdir(dir)).sort(), ["bin", "install.json", "spectron.mjs"]);
    // No byte-order mark: JSON.parse in the CLI must read it.
    assert.deepEqual(JSON.parse(await readFile(join(dir, "install.json"), "utf8")), { url: origin });
    const launcher = join(dir, "bin", "spectron.cmd");
    assert.equal(
      await readFile(launcher, "utf8"),
      '@echo off\r\nsetlocal\r\nset NoDefaultCurrentDirectoryInExePath=1\r\nnode "%~dp0..\\spectron.mjs" %*\r\n',
    );
    const version = windows
      ? execFileSync("cmd", ["/d", "/c", launcher, "--version"], { env: { ...process.env, ...env } }).toString()
      : execFileSync(process.execPath, [join(dir, "spectron.mjs"), "--version"]).toString();
    assert.match(version, /^\d+\.\d+\.\d+\r?\n$/);

    // Signing in defaults to the server it was installed from.
    const login = windows
      ? await ps(shell, `'not-a-token' | & '${launcher}' auth login --with-token; exit $LASTEXITCODE`, env)
      : await ps(shell, `'not-a-token' | node '${join(dir, "spectron.mjs")}' auth login --with-token; exit $LASTEXITCODE`, env);
    assert.equal(login.code, 2);
    assert.match(login.stdout + login.stderr, /doesn't look like a Spectron token/);

    // Running it again upgrades in place.
    const again = await ps(shell, install, env);
    assert.equal(again.code, 0, again.stderr);

    // Spaces and wildcard characters in the path are just characters.
    const odd = join(root, "with spaces [1]");
    const oddInstall = await ps(shell, install, { ...env, SPECTRON_INSTALL_DIR: odd });
    assert.equal(oddInstall.code, 0, oddInstall.stderr);
    assert.deepEqual((await readdir(odd)).sort(), ["bin", "install.json", "spectron.mjs"]);
    if (windows)
      assert.match(
        execFileSync("cmd", ["/d", "/c", join(odd, "bin", "spectron.cmd"), "--version"], { env: { ...process.env, ...env } }).toString(),
        /^\d+\.\d+\.\d+\r?\n$/,
      );

    // A redirected download is refused, and nothing changes.
    const installed = await readFile(join(dir, "spectron.mjs"), "utf8");
    const redirectScript = await (await fetch(`${origin}/cli/install.ps1`)).text();
    routes = new Hono();
    routes.get("/cli/install.ps1", () => new Response(redirectScript));
    routes.get("/cli/spectron.mjs", () => Response.redirect(`${origin}/elsewhere.mjs`, 302));
    routes.get("/elsewhere.mjs", async () => new Response(await readFile(join(dist, "spectron.mjs"))));
    const redirected = await ps(shell, install, env);
    assert.notEqual(redirected.code, 0);
    assert.match(redirected.stdout + redirected.stderr, /Couldn't download/);
    assert.equal(await readFile(join(dir, "spectron.mjs"), "utf8"), installed);
    routes = new Hono().route("/cli", createCliRoutes({ appURL: origin, dist }));

    // A relative SPECTRON_INSTALL_DIR is relative to the shell's location.
    const relative = await ps(shell, `Set-Location -LiteralPath '${root}'; ${install}`, { ...env, SPECTRON_INSTALL_DIR: "relative" });
    assert.equal(relative.code, 0, relative.stderr);
    assert.deepEqual((await readdir(join(root, "relative"))).sort(), ["bin", "install.json", "spectron.mjs"]);

    if (windows) {
      // The launcher never runs a node from the current folder.
      const project = join(root, "project");
      await mkdir(project);
      await writeFile(join(project, "node.cmd"), "@echo HIJACKED\r\n");
      const fromProject = execFileSync("cmd", ["/d", "/c", launcher, "--version"], { cwd: project, env: { ...process.env, ...env } }).toString();
      assert.match(fromProject, /^\d+\.\d+\.\d+\r?\n$/);

      // A CLI file in use can't be replaced: the previous install stays whole.
      const kept = await readFile(join(dir, "spectron.mjs"), "utf8");
      const keptMeta = await readFile(join(dir, "install.json"), "utf8");
      const locker = spawn(shell, ["-NoProfile", "-NonInteractive", "-Command",
        `$f = [IO.File]::Open('${join(dir, "install.json")}', 'Open', 'Read', 'None'); [Console]::Out.WriteLine('locked'); [Console]::In.ReadLine() | Out-Null; $f.Dispose()`]);
      await once(locker.stdout, "data");
      const locked = await ps(shell, install, env);
      locker.stdin.end("\n");
      await once(locker, "exit");
      assert.notEqual(locked.code, 0);
      assert.match(locked.stdout + locked.stderr, /previous version was kept/);
      assert.equal(await readFile(join(dir, "spectron.mjs"), "utf8"), kept);
      assert.equal(await readFile(join(dir, "install.json"), "utf8"), keptMeta);
      assert.deepEqual((await readdir(dir)).sort(), ["bin", "install.json", "spectron.mjs"]);
    }

    // A bundle that changed after the installer was served is refused, and the
    // installed CLI is left alone.
    const before = await readFile(join(dir, "spectron.mjs"), "utf8");
    const stale = await (await fetch(`${origin}/cli/install.ps1`)).text();
    await appendFile(join(dist, "spectron.mjs"), "\n// changed\n");
    routes = new Hono();
    routes.get("/cli/install.ps1", () => new Response(stale));
    routes.get("/cli/spectron.mjs", async () => new Response(await readFile(join(dist, "spectron.mjs"))));
    const refused = await ps(shell, install, env);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stdout + refused.stderr, /doesn't match its checksum/);
    assert.equal(await readFile(join(dir, "spectron.mjs"), "utf8"), before);
    // Staging folders never outlive a run.
    assert.deepEqual((await readdir(dir)).sort(), ["bin", "install.json", "spectron.mjs"]);

    // On Windows: the bin folder goes first in the user PATH in the registry,
    // moved there if it was further down, which stays an expandable string
    // with its entries unexpanded; and this window runs the new CLI by name.
    if (windows) {
      const registry = `(Get-Item -LiteralPath 'HKCU:\\Environment')`;
      const read = `$k = ${registry}; if ($k.GetValueNames() -contains 'Path') { $k.GetValueKind('Path').ToString() + '|' + $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames') } else { '<absent>' }`;
      const original = (await ps(shell, read, {})).stdout.trim();
      // Restored exactly (or removed if it was absent), then announced, so
      // Explorer doesn't keep handing out the test PATH.
      const broadcast = `[Environment]::SetEnvironmentVariable('SPECTRON_INSTALL_REFRESH', '1', 'User'); [Environment]::SetEnvironmentVariable('SPECTRON_INSTALL_REFRESH', [NullString]::Value, 'User')`;
      t.after(async () => {
        const [kind, ...value] = original.split("|");
        const restore =
          original === "<absent>"
            ? `Remove-ItemProperty -LiteralPath 'HKCU:\\Environment' -Name Path -ErrorAction SilentlyContinue`
            : `Set-ItemProperty -LiteralPath 'HKCU:\\Environment' -Name Path -Type ${kind} -Value ${powershellQuote(value.join("|"))}`;
        await ps(shell, `${restore}; ${broadcast}`, {});
        assert.equal((await ps(shell, read, {})).stdout.trim(), original);
      });
      const bin = join(dir, "bin");
      await ps(shell, `Set-ItemProperty -LiteralPath 'HKCU:\\Environment' -Name Path -Type ExpandString -Value '%USERPROFILE%\\spectron-test-entry;${bin}'`, {});
      const { SPECTRON_NO_MODIFY_PATH: _skip, ...modifying } = env;
      routes = new Hono().route("/cli", createCliRoutes({ appURL: origin, dist }));
      const withPath = await ps(shell, `${install}; spectron --version`, modifying);
      assert.equal(withPath.code, 0, withPath.stderr);
      assert.match(withPath.stdout, /Put .* first in your user PATH/);
      assert.match(withPath.stdout, /\n\d+\.\d+\.\d+\s*$/);
      assert.equal((await ps(shell, read, {})).stdout.trim(), `ExpandString|${bin};%USERPROFILE%\\spectron-test-entry`);
      // Already first: left alone, and nothing left behind by the broadcast.
      const twice = await ps(shell, install, modifying);
      assert.doesNotMatch(twice.stdout, /first in your user PATH/);
      assert.equal((await ps(shell, `${registry}.GetValueNames() -contains 'SPECTRON_INSTALL_REFRESH'`, {})).stdout.trim(), "False");
    }
  });

test("powershellQuote makes a PowerShell verbatim string", { skip: shells.length === 0 }, async () => {
  for (const value of ["https://a.example", "it's", "'", "‘’", "$(x) `y` \"z\""]) {
    const { stdout } = await ps(shells[0]!, `[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write(${powershellQuote(value)})`, {});
    assert.equal(stdout, value);
  }
});
