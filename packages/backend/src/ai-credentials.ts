import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { AIProvider } from "@spectron/shared";
import { IssueInputError } from "./issues";

function encryptionKey(secret?: string) {
  if (!secret || secret.length < 32)
    throw new IssueInputError(
      "AI connections are unavailable. Configure AI_CREDENTIAL_SECRET (at least 32 characters) on the API server.",
    );
  return createHash("sha256").update(`spectron:ai:v1:${secret}`).digest();
}
export function encryptAIKey(value: string, binding: string, secret?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(binding));
  return `v1:${Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64")}`;
}
export function decryptAIKey(value: string, binding: string, secret?: string) {
  const key = encryptionKey(secret);
  try {
    if (!value.startsWith("v1:")) throw new Error();
    const bytes = Buffer.from(value.slice(3), "base64");
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(binding));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      cipher.update(bytes.subarray(12, -16)),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new IssueInputError(
      "The saved AI key cannot be decrypted. Restore the server encryption secret or replace the connection key.",
    );
  }
}

export type AICredentialCheck = (
  provider: AIProvider,
  key: string,
) => Promise<void>;

// Fixed official endpoints; never forward a key to a user-supplied URL or redirect.
// Metadata checks do not establish generation/tool/effort compatibility.
export function createAICredentialCheck(
  request: typeof fetch = fetch,
): AICredentialCheck {
  return async (provider, key) => {
    const urls: Record<AIProvider, string> = {
      openai: "https://api.openai.com/v1/models",
      anthropic: "https://api.anthropic.com/v1/models?limit=100",
      deepseek: "https://api.deepseek.com/models",
      zai: "https://api.z.ai/api/paas/v4/chat/completions",
    };
    try {
      const response = await request(urls[provider], {
        method: provider === "zai" ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers:
          provider === "anthropic"
            ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
            : {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
        ...(provider === "zai"
          ? {
              body: JSON.stringify({
                model: "glm-5.3-flash",
                messages: [{ role: "user", content: "Reply OK." }],
                reasoning_effort: "low",
                max_tokens: 16,
                stream: false,
              }),
            }
          : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status))
          throw new IssueInputError(
            "The provider rejected this key or its permissions.",
          );
        if (response.status === 429)
          throw new IssueInputError(
            "The provider is rate limiting this connection or its quota is exhausted. Try again later.",
          );
        throw new IssueInputError(
          "The provider could not check this connection. Check account access and try again.",
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 512_000) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        data?: unknown[];
        choices?: unknown[];
      };
      const records = provider === "zai" ? body.choices : body.data;
      if (!Array.isArray(records) || records.length === 0) throw new Error();
    } catch (error) {
      if (error instanceof IssueInputError) throw error;
      // Provider responses and transport exceptions may echo request credentials.
      throw new IssueInputError(
        "The connection check could not complete. Check network access and try again.",
      );
    }
  };
}
