import type { IssueHistoryEntry } from "./issues";
import type { CommentSummary } from "./comments";
import type { ProjectFileSummary } from "./files";
export type IssueActivityEvent = {
  entry: IssueHistoryEntry;
  comment: CommentSummary | null;
  replyTo: {
    id: string;
    authorName: string;
    text: string;
    deleted: boolean;
  } | null;
  files: ProjectFileSummary[];
};
export type IssueActivityPage = {
  events: IssueActivityEvent[];
  nextCursor: string | null;
};
