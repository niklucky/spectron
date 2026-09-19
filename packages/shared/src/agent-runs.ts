import type { AgentIdentity } from "./ai";
import type { GitRepository } from "./git";
import type { IssueFields } from "./issues";
export const agentCommands = [
  "discuss",
  "review-issue",
  "rewrite-issue",
  "create-plan",
  "implement",
  "review-code",
] as const;
export type AgentCommand = (typeof agentCommands)[number];
export const agentRunStates = [
  "queued",
  "preparing",
  "working",
  "needs_input",
  "completed",
  "failed",
  "stopped",
] as const;
export type AgentRunState = (typeof agentRunStates)[number];
export type AgentRunScope = { projectId: string; issueId: string };
export type AgentInvocation = AgentRunScope & {
  requestId: string;
  agentId: string;
  command: AgentCommand;
  repositoryIds: string[];
  message: string;
  fileIds: string[];
  takeoverFromId?: string | undefined;
  feedback?: import("./git-workflow").FeedbackSelection[] | undefined;
  reviewBranch?: string | undefined;
  reviewWorkspaceId?: string | undefined;
  continuationId?: string | undefined;
  publicationOnly?: boolean | undefined;
};
export type AgentResult = {
  summary: string;
  details: string;
  feedback?: import("./git-workflow").FeedbackResult[];
  question?: string;
  findings?: ReviewFindingInput[];
  rewrite?: Partial<IssueFields>;
  verification?: {
    command: string;
    outcome: "passed" | "failed" | "not_run";
    details: string;
  }[];
};
export type AgentRunInput = {
  id: string;
  userId: string;
  message: string;
  state: "queued" | "delivered";
  createdAt: string;
};
export type AgentRunView = AgentRunScope & {
  id: string;
  agent: AgentIdentity;
  requesterId: string;
  requesterName: string;
  handoffFromId?: string | null;
  command: AgentCommand;
  message: string;
  repositories: (GitRepository & { commit?: string })[];
  implementation?: ImplementationOutcome[];
  review?: ReviewTarget | null;
  branchReview?: Omit<BranchReview, "files"> | null;
  findings?: ReviewFinding[];
  publicationOnly?: boolean;
  canRetryPublication?: boolean;
  retryMessage?: string;
  state: AgentRunState;
  stopRequested: boolean;
  attachments: { id: string; name: string }[];
  result: AgentResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  containerRetained: boolean;
  inputs: AgentRunInput[];
  events: { id: string; message: string; createdAt: string }[];
  canControl: boolean;
  appliedAt: string | null;
};
export type AgentRewritePreview = {
  expectedUpdatedAt: string;
  stale: boolean;
  changes: {
    field: string;
    current: unknown;
    proposed: unknown;
    changedSinceInvocation: boolean;
  }[];
};
export function agentRunPollDelay(
  runs: Pick<AgentRunView, "state">[],
): number | null {
  if (runs.some((r) => ["queued", "preparing", "working"].includes(r.state)))
    return 2000;
  return runs.some((r) => r.state === "needs_input") ? 30000 : null;
}
export type AgentRunActions = {
  takeover: (
    input: AgentRunScope & {
      id: string;
      requestId: string;
      agentId: string;
      message: string;
    },
  ) => Promise<{ id: string }>;
  address: (
    input: AgentRunScope & {
      requestId: string;
      agentId: string;
      comments: import("./git-workflow").FeedbackSelection[];
      message: string;
    },
  ) => Promise<{ id: string }>;
  reviewTargets: (scope: AgentRunScope) => Promise<ReviewTarget[]>;
  editFinding: (input: FindingEdit) => Promise<void>;
  publishFindings: (
    input: AgentRunScope & { id: string; findingIds: string[] },
  ) => Promise<void>;
  available: (projectId: string) => Promise<AgentIdentity[]>;
  repositories: (projectId: string) => Promise<GitRepository[]>;
  list: (scope: AgentRunScope) => Promise<AgentRunView[]>;
  invoke: (input: AgentInvocation) => Promise<{ id: string }>;
  stop: (input: AgentRunScope & { id: string }) => Promise<void>;
  instruct: (
    input: AgentRunScope & { id: string; requestId: string; message: string },
  ) => Promise<void>;
  previewRewrite: (
    input: AgentRunScope & { id: string },
  ) => Promise<AgentRewritePreview>;
  apply: (
    input: AgentRunScope & { id: string; expectedUpdatedAt?: string },
  ) => Promise<void>;
};

export type GitPullRequest = {
  number: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  head: string;
};
export type ImplementationOutcome = {
  workspaceId: string;
  repositoryId: string;
  branch: string;
  targetBranch: string;
  status:
    | "preparing"
    | "saved"
    | "publishing"
    | "published"
    | "unchanged"
    | "failed";
  commit?: string;
  pull?: GitPullRequest;
  error?: string | undefined;
};

export type ReviewTarget = {
  workspaceId: string;
  repositoryId: string;
  repositoryName: string;
  pull: GitPullRequest;
};
export type ReviewFindingInput = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  explanation: string;
  suggestedFix?: string;
};
export type ReviewFinding = ReviewFindingInput & {
  id: string;
  revision: number;
  state:
    | "draft"
    | "dismissed"
    | "publishing"
    | "published"
    | "stale"
    | "uncertain";
  error: string | null;
  externalId: string | null;
  externalURL: string | null;
  publishedBy: string | null;
};
export type FindingEdit = AgentRunScope & {
  id: string;
  findingId: string;
  revision: number;
  explanation: string;
  suggestedFix: string;
  dismissed: boolean;
};

export type BranchReview = {
  repositoryId: string;
  repositoryName: string;
  sourceBranch: string;
  targetBranch: string;
  head: string;
  base: string;
  start: string;
  url: string;
  files: { oldPath: string; newPath: string; patch: string }[];
};
