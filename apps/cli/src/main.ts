#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { run } from "./cli.js";

// Node's fetch ignores HTTPS_PROXY and friends unless asked. Where Node can
// switch it on at runtime (24+), do so; on 22, NODE_USE_ENV_PROXY=1 does it.
const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
if (!process.env.NODE_USE_ENV_PROXY && PROXY_VARIABLES.some((name) => process.env[name]))
  (http as { setGlobalProxyFromEnv?: () => void }).setGlobalProxyFromEnv?.();

// `spectron issue list | head` closes stdout early; that is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

// install.sh records which server it came from beside the bundle, so
// `spectron auth login` signs in there without --url.
const installed = await readFile(new URL("install.json", import.meta.url), "utf8")
  .then((text) => (JSON.parse(text) as { url?: unknown }).url)
  .catch(() => undefined);

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: (url, init) => fetch(url, init),
  // Installed by install.sh or install.ps1: the server it came from, and the
  // file `spectron upgrade` replaces.
  ...(typeof installed === "string" ? { defaultURL: installed, bundle: fileURLToPath(import.meta.url) } : {}),
});
