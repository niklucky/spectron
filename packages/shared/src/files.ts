export const defaultMaxFileBytes = 50 * 1024 * 1024;
export type StoredFile = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};
export type ProjectFileSummary = StoredFile & {
  inlineExternalId?: string;
  projectFileId: string;
  projectId: string;
  projectName: string;
};
export type IssueAttachmentSummary = ProjectFileSummary & {
  attachmentId: string;
  canUnlink?: boolean;
  inDescription?: boolean;
  commentIds?: string[];
  attachedAt?: string;
  position: number;
};
export type FilePage = {
  files: ProjectFileSummary[];
  nextOffset: number | null;
};
export function projectFileURL(
  projectId: string,
  projectFileId: string,
  download = false,
) {
  return `/api/files/${encodeURIComponent(projectId)}/${encodeURIComponent(projectFileId)}${download ? "?download=1" : ""}`;
}
export function filePreviewKind(
  contentType: string,
): "image" | "audio" | "video" | null {
  if (
    [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
    ].includes(contentType)
  )
    return "image";
  if (
    [
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/wav",
      "audio/flac",
      "audio/webm",
    ].includes(contentType)
  )
    return "audio";
  if (["video/mp4", "video/webm", "video/ogg"].includes(contentType))
    return "video";
  return null;
}

const textFormat = { family: "Plain text", extension: "TXT", mime: "text/plain" } as const;
const jsonFormat = { family: "JSON", extension: "JSON", mime: "application/json" } as const;

export function textFileFormat(filename: string, contentType = "") {
  const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
  if (mime === "application/json" || mime === "text/json") return jsonFormat;
  if (mime && mime !== "text/plain" && mime !== "application/octet-stream") return;
  if (/\.json$/i.test(filename)) return jsonFormat;
  if (mime === "text/plain" || /\.txt$/i.test(filename)) return textFormat;
}

export function hasBinaryTextControls(text: string) {
  return /[\x00-\x08\x0e-\x1f\x7f]/.test(text);
}
