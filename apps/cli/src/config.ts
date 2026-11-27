import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Env = Record<string, string | undefined>;
export type Credentials = { url: string; token: string };

/** Where `spectron auth login` keeps the server URL and token. */
export function configPath(env: Env) {
  if (env.SPECTRON_CONFIG_DIR) return join(env.SPECTRON_CONFIG_DIR, "config.json");
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "spectron", "config.json");
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "spectron", "config.json");
  return join(homedir(), ".config", "spectron", "config.json");
}

export async function readConfig(env: Env): Promise<Partial<Credentials>> {
  try {
    const raw = JSON.parse(await readFile(configPath(env), "utf8")) as Record<string, unknown>;
    return {
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
      ...(typeof raw.token === "string" ? { token: raw.token } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Couldn't read ${configPath(env)}. Fix or delete it, then sign in again.`);
  }
}

/**
 * Replaces the saved login atomically: a private temporary file renamed over
 * the old one, so an interruption never leaves a truncated or readable file.
 * (On Windows the mode is advisory; the file lives in the user's profile.)
 */
export async function writeConfig(env: Env, credentials: Credentials) {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return path;
}

export async function deleteConfig(env: Env) {
  await rm(configPath(env), { force: true });
}

/**
 * SPECTRON_URL and SPECTRON_TOKEN override the saved login, so agents and CI
 * can run without touching the config file. A saved token is only ever sent
 * to the server it was saved for.
 */
export async function resolveCredentials(env: Env): Promise<{ url?: string; token?: string; problem?: string }> {
  const envURL = env.SPECTRON_URL ? normalizeURL(env.SPECTRON_URL) : undefined;
  if (envURL && env.SPECTRON_TOKEN) return { url: envURL, token: env.SPECTRON_TOKEN };
  const saved = await readConfig(env);
  const savedURL = saved.url ? normalizeURL(saved.url) : undefined;
  const url = envURL ?? savedURL;
  if (env.SPECTRON_TOKEN) return { ...(url ? { url } : {}), token: env.SPECTRON_TOKEN };
  if (envURL && savedURL !== envURL)
    return {
      url: envURL,
      problem: `SPECTRON_URL is ${envURL}, but the saved token belongs to ${savedURL ?? "no server"}. Set SPECTRON_TOKEN as well, or run \`spectron auth login --url ${envURL}\`.`,
    };
  return { ...(url ? { url } : {}), ...(saved.token ? { token: saved.token } : {}) };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The server's origin. Tokens travel in a header, so plain http is allowed
 * only for a server on this machine.
 */
export function normalizeURL(value: string) {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new UsageError(`"${value}" is not a valid server URL.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    throw new UsageError("Use an https:// server URL (http:// is only allowed for localhost).");
  return url.origin;
}

/** Bad arguments or setup: exits with status 2. */
export class UsageError extends Error {}
