// Bundles the CLI into one file, dist/spectron.mjs, and copies install.sh
// beside it. The Spectron server serves both at /cli/ (see
// packages/api/src/cli-install.ts). `node build.mjs <dir>` writes elsewhere.
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "dist"));
// Only the default output is cleared; a directory passed in is left as is.
if (!process.argv[2]) await rm(out, { recursive: true, force: true });

await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(out, "spectron.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Readable on purpose: people can inspect what they install.
  minify: false,
  legalComments: "none",
  logLevel: "warning",
});
await copyFile(join(here, "install.sh"), join(out, "install.sh"));
