export const issueTriggers = [
  "opened",
  "in_progress",
  "blocked",
  "cancelled",
  "finished",
] as const;
export type IssueTrigger = (typeof issueTriggers)[number];
export type IssueState = {
  id: string;
  projectId: string;
  name: string;
  trigger: IssueTrigger;
  position: number;
  color: string | null;
  isDefault: boolean;
  deletedAt: string | null;
};
export type IssuePriority = Omit<IssueState, "trigger" | "isDefault">;
export type IssueSettings = {
  states: IssueState[];
  priorities: IssuePriority[];
};
export type IssueSummary = {
  id: string;
  projectId: string;
  parentId: string | null;
  number: number;
  key: string;
  title: string;
  description: string;
  authorId: string;
  assigneeId: string | null;
  stateId: string;
  priorityId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type IssueFields = Pick<
  IssueSummary,
  "title" | "description" | "parentId" | "assigneeId" | "stateId" | "priorityId"
>;
export type HistoryValue =
  | string
  | number
  | boolean
  | null
  | HistoryValue[]
  | { [key: string]: HistoryValue };
export type HistoryChanges = Record<
  string,
  { before: HistoryValue; after: HistoryValue }
>;
export type IssueHistoryEntry = {
  id: string;
  issueId: string;
  actorUserId: string;
  actorName: string;
  action: "created" | "updated" | "deleted" | "restored";
  changes: HistoryChanges;
  createdAt: string;
};
export type IssueOptionInput = {
  projectId: string;
  kind: "state" | "priority";
  id?: string | undefined;
  name: string;
  position: number;
  color: string | null;
  trigger?: IssueTrigger | undefined;
  isDefault?: boolean | undefined;
};
