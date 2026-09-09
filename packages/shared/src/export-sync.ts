export const exportActions = ["issue.create", "issue.update", "comment.create", "comment.update", "worklog.create", "worklog.delete"] as const;
export type ExportAction = typeof exportActions[number];
export type ExportProvider = "jira" | "tracker";
export type ExportConfig = {
  mode: "off" | "on_save" | "scheduled";
  intervalMinutes: 15 | 60 | 1440;
  actions: ExportAction[];
};
export type ExportStatus = {
  config: ExportConfig;
  nextRunAt: string | null;
  counts: Record<"pending" | "running" | "succeeded" | "failed" | "cancelled", number>;
  entries: { id: string; action: ExportAction; entityId: string; issueId: string; status: string; attempts: number; error: string | null; createdAt: string }[];
};
