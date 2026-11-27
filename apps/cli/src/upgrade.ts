import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { ApiFailure, type Fetch } from "./client.js";

/** What the server says it serves at /cli/manifest.json. */
export type Manifest = { version: string; sha256: string };

type Options = { server: string; bundle: string; fetch: Fetch; userAgent: string };

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
/** A release version, as build.mjs accepts it. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The body, or a network_error if the connection drops or stalls while reading it. */
async function body<T>(read: () => Promise<T>, server: string): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new ApiFailure(
      0,
      "network_error",
      error instanceof Error && error.name === "TimeoutError"
        ? `${server} stopped answering, so nothing changed.`
        : `The download from ${server} broke off, so nothing changed. Run \`spectron upgrade\` again.`,
    );
  }
}

/** install.json's server, or null if it's missing or unreadable. */
async function installServerOf(bundle: string) {
  try {
    const { url } = JSON.parse(await readFile(join(dirname(bundle), "install.json"), "utf8")) as { url?: unknown };
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/** A GET on the install server: no token (these are public), no redirects. */
async function get({ server, fetch, userAgent }: Options, path: string) {
  const url = `${server}${path}`;
  let response: Response;
  try {
    // Bounds the whole exchange, body included: a stalled proxy can't hang it.
    response = await fetch(url, { headers: { "user-agent": userAgent }, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as (Error & { code?: string }) | undefined) : undefined;
    throw new ApiFailure(0, "network_error", `Couldn't reach ${server}: ${cause?.message || cause?.code || String(error)}`);
  }
  if (response.status !== 200)
    throw new ApiFailure(
      response.status,
      "upgrade_unavailable",
      response.status === 503
        ? `${server} is rebuilding its CLI. Try again in a moment.`
        : `${url} answered ${response.status}, so there is nothing to update from.`,
    );
  return response;
}

/** Compares the running bundle with the one the install server serves now. */
export async function checkForUpgrade(options: Options) {
  const response = await get(options, "/cli/manifest.json");
  const text = await body(() => response.text(), options.server);
  let manifest: Partial<Manifest> | null = null;
  try {
    manifest = JSON.parse(text) as Partial<Manifest>;
  } catch {
    // Not JSON: reported below.
  }
  if (!VERSION_PATTERN.test(manifest?.version ?? "") || !/^[0-9a-f]{64}$/.test(manifest?.sha256 ?? ""))
    throw new ApiFailure(0, "upgrade_unavailable", `${options.server} didn't answer with a CLI manifest.`);
  const current = sha256(await readFile(options.bundle));
  return { manifest: manifest as Manifest, current, upToDate: current === manifest?.sha256 };
}

/**
 * Replaces the running bundle with the server's: downloaded beside it,
 * checked against the manifest's SHA-256, run once, then renamed over it, so
 * a failure at any step leaves the current CLI as it was. install.json and
 * the launchers stay; they don't change between versions.
 */
export async function installUpgrade(options: Options & { checked: string; installServer: string }, manifest: Manifest) {
  const response = await get(options, "/cli/spectron.mjs");
  const bytes = Buffer.from(await body(() => response.arrayBuffer(), options.server));
  if (sha256(bytes) !== manifest.sha256)
    throw new ApiFailure(
      0,
      "checksum_mismatch",
      "The download doesn't match the server's checksum (it may have been redeployed just now), so nothing changed. Run `spectron upgrade` again.",
    );
  // .mjs, so node runs it as a module before it takes over.
  const staged = join(dirname(options.bundle), `.spectron-upgrade-${randomBytes(6).toString("hex")}.mjs`);
  try {
    // Private until it has been checked: nobody else can change what runs.
    await writeFile(staged, bytes, { flag: "wx", mode: 0o600 });
    const printed = await new Promise<string>((resolve, reject) =>
      execFile(process.execPath, [staged, "--version"], { timeout: 30_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))),
    ).catch(() => null);
    if (printed !== manifest.version)
      throw new ApiFailure(0, "upgrade_failed", `The new CLI doesn't run with this Node.js (${process.version}), so nothing changed.`);
    // Still the install that was checked? A reinstall meanwhile (perhaps from
    // another server) wins; this upgrade then changes nothing.
    const [installed, server] = await Promise.all([readFile(options.bundle).then(sha256, () => null), installServerOf(options.bundle)]);
    if (installed !== options.checked || server !== options.installServer)
      throw new ApiFailure(0, "upgrade_failed", "This CLI was reinstalled while updating, so the update was dropped. Run `spectron upgrade` again if needed.");
    await chmod(staged, 0o755);
    // Windows refuses to replace a file another process (an antivirus scan,
    // another spectron starting) has open for a moment; try a few times.
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(staged, options.bundle);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || attempt === 5 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw error;
        await sleep(200 * attempt);
      }
    }
  } catch (error) {
    // Best effort: the original failure is what matters.
    await rm(staged, { force: true }).catch(() => {});
    if (error instanceof ApiFailure) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new ApiFailure(
      0,
      "upgrade_failed",
      code === "EACCES" || code === "EPERM" || code === "EBUSY"
        ? process.platform === "win32"
          ? `Couldn't replace ${options.bundle}: it is in use or not writable. Close other spectron windows and try again, or run as the user who installed it.`
          : `Couldn't replace ${options.bundle}: permission denied. Run spectron upgrade as the user who installed it.`
        : `Couldn't replace ${options.bundle}: ${(error as Error).message}`,
    );
  }
}
