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
  projectFileId: string;
  projectId: string;
  projectName: string;
};
export type IssueAttachmentSummary = ProjectFileSummary & {
  attachmentId: string;
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
