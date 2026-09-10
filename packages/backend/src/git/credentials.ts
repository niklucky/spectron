import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { IssueInputError } from "../issues";
function key(secret?: string) {
  if (!secret || secret.length < 32) throw new IssueInputError("Git connections require INTEGRATION_SECRET (at least 32 characters) on the API server.");
  return createHash("sha256").update(`spectron:git:v1:${secret}`).digest();
}
export function encryptGitToken(token: string, binding: string, secret?: string) {
  if (!token || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) throw new IssueInputError("Enter a token without whitespace (up to 4096 characters).");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(binding));
  return `v1:${Buffer.concat([iv, cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64")}`;
}
export function decryptGitToken(value: string, binding: string, secret?: string) {
  const secretKey = key(secret);
  try {
    if (!value.startsWith("v1:")) throw new Error();
    const bytes = Buffer.from(value.slice(3), "base64");
    const cipher = createDecipheriv("aes-256-gcm", secretKey, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(binding)); cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString("utf8");
  } catch { throw new IssueInputError("The saved Git token cannot be decrypted. Restore the server secret or replace the token."); }
}
