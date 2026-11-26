export type JiraMappings = {
  issueTypes?: Record<string, string> | undefined;
  statuses: Record<string, string>;
  priorities: Record<string, string>;
  fields: Record<string, string | null>;
  users: Record<string, string>;
};
export type JiraConfigInput = {
  baseUrl: string;
  projectKey: string;
  email: string;
  apiToken?: string | undefined;
  issueTypeId: string;
};
export type JiraImportProgress = {
  id: string;
  kind: "full" | "scheduled";
  status: "queued" | "running" | "finished" | "stopped" | "failed";
  imported: number;
  failed: number;
  total?: number;
  totalIsEstimate?: boolean;
  currentKey: string | null;
  errors: { id: string; key: string; error: string }[];
  message?: string;
};

export function jiraImportActivity(c: JiraConnection) {
  if (!c.importRunId) return null;
  if (c.importCancelled) return "Stopping import…";
  const p = c.importProgress;
  if (!p || p.id !== c.importRunId) return "Importing…";
  if (p.status === "queued") return "Full import queued…";
  return `Importing${p.currentKey ? " " + p.currentKey : "…"} · ${p.imported} imported${p.failed ? ", " + p.failed + " failed" : ""}`;
}

export type JiraConnection = Omit<JiraConfigInput, "apiToken"> & {
  id: string;
  createdAt?: string;
  scheduleMinutes: number | null;
  nextImportAt: string | null;
  lastScheduledAt: string | null;
  lastScheduleResult: string | null;
  importRunId?: string | null;
  importCancelled?: boolean;
  importProgress?: JiraImportProgress | null;
  mappings: JiraMappings;
  lastImportedAt: string | null;
};
export type JiraMetadata = {
  statuses: { id: string; name: string }[];
  priorities: { id: string; name: string }[];
  fields: {
    id: string;
    name: string;
    schema?: { type?: string; custom?: string };
  }[];
  users: { accountId: string; displayName: string; emailAddress?: string }[];
  issueTypes: { id: string; name: string }[];
};

/** Pending field mapping, replaced by a project field ID during the next import. */
export const createJiraFieldOnImport = "jira:create-field";

export const createJiraJsonOnImport = "jira:create-json";
export function isPendingJiraField(value: unknown) {
  return value === createJiraFieldOnImport || value === createJiraJsonOnImport;
}

export function jiraProjectFieldType(field: JiraMetadata["fields"][number]): import("./issues").ProjectField["type"] {
  switch (field.schema?.type) {
    case "string": return "text";
    case "number":
    case "integer": return "number";
    case "date": return "date";
    case "datetime": return "datetime";
    case "user": return "user";
    default: return "json";
  }
}

/** Suggest only unambiguous, unused name matches; explicit mappings always win. */
export function matchJiraStatuses(
  remote: { id: string; name: string }[],
  local: { id: string; name: string; deletedAt?: string | Date | null }[],
  existing: Record<string, string>,
): Record<string, string> {
  const normalize = (name: string) => name.trim().toLowerCase();
  const statuses = [...new Map(remote.map((s) => [s.id, s])).values()];
  const active = local.filter((s) => !s.deletedAt);
  const result = { ...existing };
  const used = new Set(Object.values(existing));
  for (const status of statuses) {
    if (Object.hasOwn(existing, status.id)) continue;
    const name = normalize(status.name);
    if (
      !name ||
      statuses.filter((s) => normalize(s.name) === name).length !== 1
    )
      continue;
    const candidates = active.filter((s) => normalize(s.name) === name);
    if (candidates.length !== 1 || used.has(candidates[0]!.id)) continue;
    result[status.id] = candidates[0]!.id;
    used.add(candidates[0]!.id);
  }
  return result;
}
