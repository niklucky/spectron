import type { AgentRunScope, GitPullRequest } from "./agent-runs";
export type GitPerson = { name: string; login: string };
export type GitNote = {
  id: string;
  author: GitPerson;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};
export type GitDiscussionData = {
  externalId: string;
  replyId: string;
  url: string;
  resolved: boolean;
  resolvable: boolean;
  path: string | null;
  line: number | null;
  notes: GitNote[];
};
export type GitActivity = {
  pull: GitPullRequest;
  title: string;
  providerId: string;
  checks: {
    name: string;
    state: "passed" | "failed" | "pending" | "unknown";
    url: string | null;
  }[];
  commits: { sha: string; message: string; author: string }[];
  participants: GitPerson[];
  reviewers: (GitPerson & { state: string })[];
  mergeable: boolean;
  mergeReason: string;
  mergeMethods: ("merge" | "squash" | "rebase")[];
};
export type GitDiscussion = GitDiscussionData & {
  id: string;
  workspaceId: string;
};
export type GitReplyDraft = {
  id: string;
  discussionId: string;
  body: string;
  revision: number;
  state: "draft" | "publishing" | "published" | "uncertain";
  authorId: string;
  runId: string | null;
  externalId: string | null;
  error: string | null;
};
export type GitOperationKind =
  | "reply"
  | "resolve"
  | "reopen"
  | "ready"
  | "merge"
  | "close";
export type GitOperation = {
  id: string;
  kind: GitOperationKind;
  state: "dispatching" | "completed" | "uncertain" | "failed";
  requesterId: string;
  requesterName: string;
  error: string | null;
  createdAt: string;
};
export type GitWorkspaceView = {
  id: string;
  repositoryId: string;
  repositoryName: string;
  provider: "github" | "gitlab";
  activity: GitActivity | null;
  pull: GitPullRequest;
  syncedAt: string | null;
  syncing: boolean;
  error: string | null;
  discussions: GitDiscussion[];
  replies: GitReplyDraft[];
  operations: GitOperation[];
  canManage: boolean;
  canMerge: boolean;
  writerRunId: string | null;
};
export type GitWorkspaceRef = AgentRunScope & { workspaceId: string };
export type GitActionInput = GitWorkspaceRef & {
  requestId: string;
  kind: Exclude<GitOperationKind, "reply">;
  expectedHead: string;
  discussionId?: string | undefined;
  mergeMethod?: "merge" | "squash" | "rebase" | undefined;
};
export type GitReplyInput = GitWorkspaceRef & {
  discussionId: string;
  body: string;
  id?: string | undefined;
  revision?: number | undefined;
};
export type FeedbackSelection = { discussionId: string; noteId: string };
export type FeedbackComment = FeedbackSelection & {
  workspaceId: string;
  repositoryId: string;
  body: string;
  author: string;
  url: string;
  path: string | null;
  line: number | null;
};
export type FeedbackResult = FeedbackSelection & {
  status: "addressed" | "unresolved";
  explanation: string;
  reply?: string;
};
export type GitWorkflowActions = {
  list: (scope: AgentRunScope) => Promise<GitWorkspaceView[]>;
  refresh: (ref: GitWorkspaceRef) => Promise<void>;
  saveReply: (input: GitReplyInput) => Promise<{ id: string }>;
  publishReply: (
    input: GitWorkspaceRef & {
      id: string;
      revision: number;
      requestId: string;
    },
  ) => Promise<void>;
  act: (input: GitActionInput) => Promise<void>;
  reconcile: (
    input: GitWorkspaceRef & { id: string; retry?: boolean },
  ) => Promise<void>;
  address: (
    input: AgentRunScope & {
      requestId: string;
      agentId: string;
      comments: FeedbackSelection[];
      message: string;
    },
  ) => Promise<{ id: string }>;
};
