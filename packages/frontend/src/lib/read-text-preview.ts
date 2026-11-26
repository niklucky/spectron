import { hasBinaryTextControls } from "@spectron/shared";

const maxBytes = 64 * 1024;

export async function readTextPreview(url: string, signal: AbortSignal) {
  // Request one extra byte to distinguish a complete file from an excerpt.
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${maxBytes}` } });
  if (response.status === 416 && response.headers.get("Content-Range") === "bytes */0")
    return { kind: "source" as const, text: "", truncated: false };
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let remaining = maxBytes;
  let text = "";
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      const part = value.subarray(0, remaining);
      text += decoder.decode(part, { stream: true });
      remaining -= part.length;
      if (part.length < value.length) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel();
  }
  if (hasBinaryTextControls(text)) return null;
  return { kind: "source" as const, text, truncated };
}
