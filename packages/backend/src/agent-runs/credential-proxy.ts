import { createServer } from "node:http";
import { request } from "node:https";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { AIProvider } from "@spectron/shared";
import { resolveHost } from "../network/dns";
import { isPublicAddress } from "../project-logo/safe-fetch";
export const providerBaseURLs: Record<AIProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  zai: "https://api.z.ai/api/paas/v4",
};
// Provider bodies may echo prompts or credentials. Only translate known codes
// and parameter names into messages we control; never forward their prose.
export function providerRequestError(status: number, body?: unknown): string {
  const error = (
    body as { error?: { code?: unknown; param?: unknown } } | undefined
  )?.error;
  if (error?.code === "insufficient_quota")
    return "The model provider's quota is exhausted. Check API billing and spending limits.";
  if (error?.code === "model_not_found" || status === 404)
    return "The configured model is unavailable to this API connection. Check the model ID and account access.";
  if (status === 401)
    return "The model provider rejected the API key. Update the AI connection.";
  if (status === 403)
    return "The API key does not have permission to run this model. Check model access and generation permissions.";
  if (status === 429)
    return "The model provider is rate limiting this connection or its quota is exhausted. Check API limits and try again later.";
  if (status === 400 || status === 422) {
    const parameter = [
      "temperature",
      "top_p",
      "reasoning.effort",
      "reasoning",
      "max_output_tokens",
      "max_tokens",
      "tools",
      "input",
      "messages",
      "store",
      "stream",
      "model",
      "text.verbosity",
    ].find((p) => p === error?.param);
    return parameter
      ? `The model provider rejected the ${parameter} parameter (HTTP ${status}). Check the agent's model settings and runtime compatibility.`
      : `The model provider rejected the request format (HTTP ${status}). Check the agent's model settings and runtime compatibility.`;
  }
  return `The model provider could not complete the request (HTTP ${status}). Try again later.`;
}
// Only a short-lived, single-model capability enters Docker. The creator's API
// key stays in this host process, outside both the model and its shell tools.
export async function createCredentialProxy(
  provider: AIProvider,
  model: string,
  key: string,
  dns: "system" | "cloudflare" = "system",
  transport = { request, resolveHost },
) {
  const token = randomBytes(32).toString("hex");
  let active = false;
  let lastError: string | undefined;
  const requests = new Set<AbortController>();
  const server = createServer(async (req, res) => {
    const provided =
      req.headers.authorization?.replace(/^Bearer /i, "") ??
      req.headers["x-api-key"];
    const allowed =
      typeof provided === "string" &&
      /^[a-f0-9]{64}$/.test(provided) &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(token));
    const route = req.url?.replace(/^\/v1\//, "");
    const paths =
      provider === "anthropic"
        ? ["messages"]
        : provider === "openai"
          ? ["responses", "chat/completions"]
          : ["chat/completions"];
    function fail(
      status: number,
      message = "The model gateway rejected this request.",
      remember = false,
    ) {
      if (remember) lastError ??= message;
      if (!res.headersSent) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message,
              type: "spectron_provider_error",
            },
          }),
        );
      } else res.destroy();
    }
    if (
      !active ||
      !allowed ||
      req.method !== "POST" ||
      !route ||
      !paths.includes(route)
    ) {
      fail(403);
      return;
    }
    if (requests.size >= 2) {
      fail(429);
      return;
    }
    const controller = new AbortController();
    requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 20 * 60_000);
    res.on("close", () => controller.abort());
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          fail(413);
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks),
        json = JSON.parse(body.toString());
      if (!active || json.model !== model) {
        fail(403);
        return;
      }
      const url = new URL(`${providerBaseURLs[provider]}/${route}`),
        hostname = url.hostname;
      const addresses = await transport.resolveHost(
        hostname,
        controller.signal,
        dns,
      );
      if (
        !addresses.length ||
        addresses.some((a) => !isPublicAddress(a.address))
      ) {
        fail(
          502,
          "The model provider's hostname could not be resolved to a public address. Check server DNS configuration.",
          true,
        );
        return;
      }
      const address = addresses.find((a) => a.family === 4) ?? addresses[0]!;
      await new Promise<void>((resolve, reject) => {
        const upstream = transport.request(
          {
            protocol: "https:",
            method: "POST",
            hostname: address.address,
            servername: isIP(hostname) ? "" : hostname,
            port: 443,
            path: url.pathname,
            signal: controller.signal,
            agent: false,
            headers: {
              Host: hostname,
              "content-type": "application/json",
              "content-length": body.length,
              ...(provider === "anthropic"
                ? {
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    ...(typeof req.headers["anthropic-beta"] === "string" &&
                    req.headers["anthropic-beta"].length < 2000
                      ? { "anthropic-beta": req.headers["anthropic-beta"] }
                      : {}),
                  }
                : { Authorization: `Bearer ${key}` }),
            },
          },
          (response) => {
            if (response.statusCode !== 200) {
              const status = response.statusCode ?? 502;
              const chunks: Buffer[] = [];
              let size = 0;
              response.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size <= 64_000) chunks.push(chunk);
                else
                  response.destroy(new Error("Provider error body too large."));
              });
              response.on("error", () => {
                fail(status, providerRequestError(status), true);
                resolve();
              });
              response.on("end", () => {
                let body: unknown;
                try {
                  body = JSON.parse(Buffer.concat(chunks).toString());
                } catch {
                  /* Non-JSON error. */
                }
                fail(status, providerRequestError(status, body), true);
                resolve();
              });
              return;
            }
            res.writeHead(200, {
              "content-type":
                response.headers["content-type"] ?? "application/json",
              "cache-control": "no-store",
            });
            let bytes = 0;
            response.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > 32 * 1024 * 1024) controller.abort();
            });
            response.on("error", reject);
            response.on("end", resolve);
            response.pipe(res);
          },
        );
        upstream.on("error", reject);
        upstream.end(body);
      });
    } catch {
      fail(
        502,
        "Could not reach the model provider. Check server network and DNS access.",
        true,
      );
    } finally {
      clearTimeout(timer);
      requests.delete(controller);
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start model credential proxy.");
  return {
    token,
    port: address.port,
    baseURL: `http://host.docker.internal:${address.port}/v1`,
    get lastError() {
      return lastError;
    },
    activate() {
      lastError = undefined;
      active = true;
    },
    deactivate() {
      active = false;
      for (const request of requests) request.abort();
    },
    async close() {
      active = false;
      for (const request of requests) request.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
