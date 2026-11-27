#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { run } from "./cli.js";

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
  ...(typeof installed === "string" ? { defaultURL: installed } : {}),
});
