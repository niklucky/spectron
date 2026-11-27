import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ApiFailure, type Fetch } from "./client.js";

/** What the server says it serves at /cli/manifest.json. */
export type Manifest = { version: string; sha256: string };

type Options = { server: string; bundle: string; fetch: Fetch; userAgent: string };

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A GET on the install server: no token (these are public), no redirects. */
async function get({ server, fetch, userAgent }: Options, path: string) {
  const url = `${server}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { "user-agent": userAgent }, redirect: "manual" });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as (Error & { code?: string }) | undefined) : undefined;
    throw new ApiFailure(0, "network_error", `Couldn't reach ${server}: ${cause?.message || cause?.code || String(error)}`);
  }
  if (response.status !== 200)
    throw new ApiFailure(response.status, "upgrade_unavailable", `${url} answered ${response.status}, so there is nothing to update from.`);
  return response;
}

/** Compares the running bundle with the one the install server serves now. */
export async function checkForUpgrade(options: Options) {
  const body: unknown = await (await get(options, "/cli/manifest.json")).json().catch(() => null);
  const manifest = body as Partial<Manifest> | null;
  if (typeof manifest?.version !== "string" || !/^[0-9a-f]{64}$/.test(manifest.sha256 ?? ""))
    throw new ApiFailure(0, "upgrade_unavailable", `${options.server} didn't answer with a CLI manifest.`);
  const current = sha256(await readFile(options.bundle));
  return { manifest: manifest as Manifest, upToDate: current === manifest.sha256 };
}

/**
 * Replaces the running bundle with the server's: downloaded beside it,
 * checked against the manifest's SHA-256, run once, then renamed over it, so
 * a failure at any step leaves the current CLI as it was. install.json and
 * the launchers stay; they don't change between versions.
 */
export async function installUpgrade(options: Options, manifest: Manifest) {
  const bytes = Buffer.from(await (await get(options, "/cli/spectron.mjs")).arrayBuffer());
  if (sha256(bytes) !== manifest.sha256)
    throw new ApiFailure(
      0,
      "checksum_mismatch",
      "The download doesn't match the server's checksum (it may have been redeployed just now), so nothing changed. Run `spectron upgrade` again.",
    );
  // .mjs, so node runs it as a module before it takes over.
  const staged = join(dirname(options.bundle), `.spectron-upgrade-${randomBytes(6).toString("hex")}.mjs`);
  try {
    await writeFile(staged, bytes, { flag: "wx" });
    await chmod(staged, 0o755);
    const printed = await new Promise<string>((resolve, reject) =>
      execFile(process.execPath, [staged, "--version"], (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))),
    ).catch(() => null);
    if (printed !== manifest.version)
      throw new ApiFailure(0, "upgrade_failed", `The new CLI doesn't run with this Node.js (${process.version}), so nothing changed.`);
    await rename(staged, options.bundle);
  } catch (error) {
    await rm(staged, { force: true });
    if (error instanceof ApiFailure) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new ApiFailure(
      0,
      "upgrade_failed",
      code === "EACCES" || code === "EPERM"
        ? `Couldn't replace ${options.bundle}: permission denied. Run spectron upgrade as the user who installed it.`
        : `Couldn't replace ${options.bundle}: ${(error as Error).message}`,
    );
  }
}
