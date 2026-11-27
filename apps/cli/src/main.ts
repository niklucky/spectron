#!/usr/bin/env node
import { run } from "./cli.js";

// `spectron issue list | head` closes stdout early; that is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: (url, init) => fetch(url, init),
});
