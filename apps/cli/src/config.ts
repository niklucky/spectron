import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

/** Writes the token readable by the owner only. */
export async function writeConfig(env: Env, credentials: Credentials) {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  // writeFile keeps the mode of an existing file; tighten it either way.
  await chmod(path, 0o600);
  return path;
}

export async function deleteConfig(env: Env) {
  await rm(configPath(env), { force: true });
}

/**
 * SPECTRON_URL and SPECTRON_TOKEN override the saved login, so agents and CI
 * can run without touching the config file.
 */
export async function resolveCredentials(env: Env): Promise<Partial<Credentials> & { source: "env" | "config" }> {
  const saved = await readConfig(env);
  const url = env.SPECTRON_URL || saved.url;
  const token = env.SPECTRON_TOKEN || saved.token;
  return {
    ...(url ? { url: normalizeURL(url) } : {}),
    ...(token ? { token } : {}),
    source: env.SPECTRON_TOKEN ? "env" : "config",
  };
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
