import { ISSUE_TITLE_MAX_LENGTH } from "./issues";
/** Basic message Markdown; titles always remain plain text. */
export function messagePlainText(text: string): string {
  return text
    .replace(/^\s*(?:[-*+] |\d+[.)] |> )/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}
export function firstMessageFields(message: string) {
  const text = message.trim();
  const title =
    messagePlainText(text)
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, ISSUE_TITLE_MAX_LENGTH) ?? "";
  return { title, description: text === title ? "" : text };
}
