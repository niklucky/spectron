export const ISSUE_TITLE_MAX_LENGTH = 255;
export const ISSUE_DESCRIPTION_MAX_LENGTH = 1_000_000;
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
export type ExternalIdentitySummary = {
  id: string;
  externalId: string;
  displayName: string;
  localUserId: string | null;
};
export type IssueSettings = {
  issueTypes?: IssuePriority[];
  tags?: IssuePriority[];
  externalIdentities?: ExternalIdentitySummary[];
  jiraConnected?: boolean;
  jiraBaseUrl?: string | null;
  fields?: ProjectField[];
  states: IssueState[];
  priorities: IssuePriority[];
};
export type FieldValues = Record<string, string | number | null>;
export type ProjectField = {
  id: string;
  name: string;
  type: "text" | "date" | "number" | "user";
  externalId: string | null;
};
export type IssueSummary = {
  issueTypeId?: string | null;
  tagIds?: string[];
  author?: { name: string; image: string | null } | null;
  assignee?: { name: string; image: string | null } | null;
  lastActivity?: {
    actorName: string;
    actorImage: string | null;
    preview: string;
    createdAt: string;
  } | null;
  estimateTime?: number | null;
  startAt?: string | null;
  finishAt?: string | null;
  externalId?: string | null;
  externalKey?: string | null;
  fieldValues?: FieldValues;
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
  | "issueTypeId"
  | "tagIds"
  | "title"
  | "description"
  | "parentId"
  | "assigneeId"
  | "stateId"
  | "priorityId"
  | "estimateTime"
  | "startAt"
  | "finishAt"
  | "fieldValues"
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
  entityType: "issue" | "attachment" | "comment" | "worklog";
  entityId: string | null;
  actorUserId: string;
  actorName: string;
  action: "created" | "updated" | "deleted" | "restored";
  changes: HistoryChanges;
  createdAt: string;
};
export type IssueOptionInput = {
  projectId: string;
  kind: "state" | "priority" | "type" | "tag";
  id?: string | undefined;
  name: string;
  position: number;
  color: string | null;
  trigger?: IssueTrigger | undefined;
  isDefault?: boolean | undefined;
};

export const builtInIssueFields = [
  {
    id: "issue:estimateTime",
    name: "Estimate time",
    type: "number",
    key: "estimateTime",
  },
  { id: "issue:startAt", name: "Start at", type: "date", key: "startAt" },
  {
    id: "issue:finishAt",
    name: "Finish at / deadline",
    type: "date",
    key: "finishAt",
  },
] as const;
export function builtInIssueField(id: string) {
  return builtInIssueFields.find((field) => field.id === id);
}
export function issueTimestamp(
  value: string | null | undefined,
): string | null {
  return value == null ? null : new Date(value).toISOString();
}
export function validateIssueTiming(input: {
  estimateTime?: number | null | undefined;
  startAt?: string | null | undefined;
  finishAt?: string | null | undefined;
}) {
  if (
    input.estimateTime != null &&
    (!Number.isInteger(input.estimateTime) ||
      input.estimateTime < 0 ||
      input.estimateTime > 2147483647)
  )
    throw new Error(
      "Estimate time must be a non-negative whole number of seconds.",
    );
  for (const key of ["startAt", "finishAt"] as const) {
    const value = input[key];
    if (
      value != null &&
      (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      throw new Error("Enter a valid start or finish date/time.");
  }
  if (
    input.startAt &&
    input.finishAt &&
    Date.parse(input.finishAt) < Date.parse(input.startAt)
  )
    throw new Error("Finish at must be on or after Start at.");
}
