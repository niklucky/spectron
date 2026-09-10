import { resolveHost } from "../network/dns";
import { request } from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "../project-logo/safe-fetch";
import { IssueInputError } from "../issues";
import type { GitProvider } from "@spectron/shared";

export function normalizeGitBaseURL(provider: GitProvider, input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname.includes("%") || /%|\\/.test(input)) throw new Error();
    if (provider === "github" && url.href !== "https://github.com/") throw new Error();
    if (url.pathname.split("/").some(p => p === "." || p === "..")) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch { throw new IssueInputError(provider === "github" ? "Use https://github.com for GitHub." : "Enter your GitLab HTTPS instance URL without credentials, query parameters, or fragments."); }
}
export type GitTransport = (url: URL, headers: Record<string, string>) => Promise<unknown>;
export function gitStatusError(status: number) {
  return new IssueInputError(status === 401 || status === 403
    ? "The provider rejected this token or its permissions. Check expiry, repository access, and organization approval."
    : status === 404 ? "Repository or branch not found, or this token cannot access it."
    : status === 429 ? "The provider is rate limiting this connection. Try again later."
    : status >= 300 && status < 400 ? "The provider redirected this request. Update the instance or repository location; redirects are not followed."
    : "The Git provider could not complete the request. Try again later.");
}
// Private self-hosted instances require a server-admin allowlist of exact HTTPS
// origins. Pin DNS for each request, keep TLS verification, and never redirect.
export function createGitTransport(
  privateOrigins: string[] = [],
  { dns = "system", resolve = resolveHost }: {
    dns?: "system" | "cloudflare";
    resolve?: typeof resolveHost;
  } = {},
): GitTransport {
  const allowed = new Set(privateOrigins);
  const resolveHostRequest = resolve;
  return async (url, headers) => {
    const signal = AbortSignal.timeout(20_000);
    try {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
        const abort = () => reject(new Error("timeout"));
        signal.addEventListener("abort", abort, { once: true });
        resolveHostRequest(hostname, signal, allowed.has(url.origin) ? "system" : dns).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      if (!addresses.length) throw new IssueInputError("The Git provider hostname could not be resolved. Check the instance URL and server DNS settings.");
      if (!allowed.has(url.origin) && addresses.some(a => !isPublicAddress(a.address))) {
        const provider = url.origin === "https://api.github.com" ? "GitHub" : "GitLab";
        throw new IssueInputError(`${provider} resolves to a non-public address. If a VPN replaces DNS answers, configure GIT_PROVIDER_DNS=cloudflare on the API server.${provider === "GitLab" ? ` For a private GitLab instance, add ${url.origin} to GITLAB_ALLOWED_PRIVATE_ORIGINS.` : ""}`);
      }
      const address = addresses.find(a => a.family === 4) ?? addresses[0]!;
      return await new Promise((resolve, reject) => {
        const req = request({ protocol: "https:", hostname: address.address, servername: isIP(hostname) ? "" : hostname, port: url.port || 443,
          path: url.pathname + url.search, agent: false, signal,
          headers: { ...headers, Host: url.host, "Accept-Encoding": "identity", "User-Agent": "Spectron" } }, res => {
          res.on("error", reject);
          if (res.statusCode !== 200) { res.destroy(); reject(gitStatusError(res.statusCode ?? 500)); return; }
          let size = 0; const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) res.destroy(new Error("size")); else chunks.push(chunk); });
          res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("json")); } });
        });
        req.on("error", reject); req.end();
      });
    } catch (error) {
      if (error instanceof IssueInputError) throw error;
      throw new IssueInputError("Could not reach the Git provider. Check the instance URL, network access, and trusted TLS certificate, then retry.");
    }
  };
}
