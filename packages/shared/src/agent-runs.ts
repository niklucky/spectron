import type { AgentIdentity } from "./ai";
import type { GitRepository } from "./git";
import type { IssueFields } from "./issues";
export const agentCommands = [
  "discuss",
  "review-issue",
  "rewrite-issue",
  "create-plan",
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
  continuationId?: string | undefined;
};
export type AgentResult = {
  summary: string;
  details: string;
  question?: string;
  rewrite?: Partial<IssueFields>;
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
  command: AgentCommand;
  message: string;
  repositories: (GitRepository & { commit?: string })[];
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
