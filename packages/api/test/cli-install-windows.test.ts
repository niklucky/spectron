import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
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

function ps(shell: string, command: string, env: Record<string, string | undefined>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      shell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { env: { ...process.env, ...env } },
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
    assert.match(await readFile(launcher, "utf8"), /^@echo off\r\nnode "%~dp0\.\.\\spectron\.mjs" %\*\r\n$/);
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

    // On Windows: the bin folder is prepended to the user PATH in the
    // registry, which stays an expandable string with its entries unexpanded.
    if (windows) {
      const read = `(Get-Item -LiteralPath 'HKCU:\\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')`;
      const original = (await ps(shell, read, {})).stdout.trim();
      const kind = `(Get-Item -LiteralPath 'HKCU:\\Environment').GetValueKind('Path')`;
      const originalKind = (await ps(shell, kind, {})).stdout.trim();
      t.after(() =>
        ps(shell, `Set-ItemProperty -LiteralPath 'HKCU:\\Environment' -Name Path -Type ${originalKind || "ExpandString"} -Value ${powershellQuote(original)}`, {}),
      );
      await ps(shell, `Set-ItemProperty -LiteralPath 'HKCU:\\Environment' -Name Path -Type ExpandString -Value '%USERPROFILE%\\spectron-test-entry'`, {});
      const { SPECTRON_NO_MODIFY_PATH: _skip, ...modifying } = env;
      routes = new Hono().route("/cli", createCliRoutes({ appURL: origin, dist }));
      const withPath = await ps(shell, install, modifying);
      assert.equal(withPath.code, 0, withPath.stderr);
      assert.match(withPath.stdout, /Added .* to your user PATH/);
      assert.equal((await ps(shell, read, {})).stdout.trim(), `${join(dir, "bin")};%USERPROFILE%\\spectron-test-entry`);
      assert.equal((await ps(shell, kind, {})).stdout.trim(), "ExpandString");
      // Not added twice.
      const twice = await ps(shell, install, modifying);
      assert.doesNotMatch(twice.stdout, /Added .* to your user PATH/);
    }
  });

test("powershellQuote makes a PowerShell verbatim string", { skip: shells.length === 0 }, async () => {
  for (const value of ["https://a.example", "it's", "'", "‘’", "$(x) `y` \"z\""]) {
    const { stdout } = await ps(shells[0]!, `[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write(${powershellQuote(value)})`, {});
    assert.equal(stdout, value);
  }
});
