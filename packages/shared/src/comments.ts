import type { ProjectFileSummary } from "./files";
export type CommentNode =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string; label: string };
export type CommentBody = CommentNode[];
export type CommentFileRef = { projectId: string; projectFileId: string };
export type CommentSummary = {
  id: string;
  issueId: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: CommentBody;
  attachments: ProjectFileSummary[];
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
};
export type CommentCursor = { createdAt: string; id: string };
export type CommentPage = {
  comments: CommentSummary[];
  nextCursor: CommentCursor | null;
};
export type CommentScope = { projectId: string; issueId: string };
export type CommentDraft = { body: CommentBody; files: CommentFileRef[] };
export const commentText = (body: CommentBody) =>
  body.map((n) => (n.type === "text" ? n.text : `@${n.label}`)).join("");

export type MentionRange = {
  start: number;
  end: number;
  userId: string;
  label: string;
};
export function commentDraftText(body: CommentBody): {
  text: string;
  mentions: MentionRange[];
} {
  let text = "";
  const mentions: MentionRange[] = [];
  for (const node of body) {
    const start = text.length;
    text += node.type === "text" ? node.text : `@${node.label}`;
    if (node.type === "mention")
      mentions.push({
        start,
        end: text.length,
        userId: node.userId,
        label: node.label,
      });
  }
  return { text, mentions };
}
export function moveMentionRanges(
  before: string,
  after: string,
  mentions: MentionRange[],
): MentionRange[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let oldEnd = before.length,
    newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return mentions.flatMap((m) =>
    m.end <= start
      ? [m]
      : m.start >= oldEnd
        ? [{ ...m, start: m.start + delta, end: m.end + delta }]
        : [],
  );
}
export function commentBodyFromText(
  text: string,
  mentions: MentionRange[],
): CommentBody {
  const body: CommentBody = [];
  let position = 0;
  for (const m of [...mentions].sort((a, b) => a.start - b.start)) {
    if (m.start < position || text.slice(m.start, m.end) !== `@${m.label}`)
      continue;
    if (m.start > position)
      body.push({ type: "text", text: text.slice(position, m.start) });
    body.push({ type: "mention", userId: m.userId, label: m.label });
    position = m.end;
  }
  if (position < text.length)
    body.push({ type: "text", text: text.slice(position) });
  return body;
}
