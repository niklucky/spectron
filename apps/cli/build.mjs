// Bundles the CLI into one file, dist/spectron.mjs, copies install.sh and
// install.ps1 beside it, and writes manifest.json with the version. The
// Spectron server serves them at /cli/ (see packages/api/src/cli-install.ts).
// `node build.mjs <dir>` writes elsewhere.
//
// SPECTRON_VERSION is the release (from the vX.Y.Z tag, see release.yml and
// Dockerfile.api); without it the build is 0.0.0-dev.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "dist"));
// Only the default output is cleared; a directory passed in is left as is.
if (!process.argv[2]) await rm(out, { recursive: true, force: true });

const version = (process.env.SPECTRON_VERSION || "0.0.0-dev").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error(`SPECTRON_VERSION must look like 1.2.3 or v1.2.3, not "${process.env.SPECTRON_VERSION}".`);

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
  define: { __SPECTRON_VERSION__: JSON.stringify(version) },
});
// The bundle's SHA-256 too: the server serves the manifest only while the
// bundle on disk still matches it (not mid-rebuild).
const sha256 = createHash("sha256").update(await readFile(join(out, "spectron.mjs"))).digest("hex");
await writeFile(join(out, "manifest.json"), `${JSON.stringify({ version, sha256 })}\n`);
for (const script of ["install.sh", "install.ps1"]) await copyFile(join(here, script), join(out, script));
