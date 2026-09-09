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
export type JiraConnection = Omit<JiraConfigInput, "apiToken"> & {
  id: string;
  createdAt?: string;
  scheduleMinutes: number | null;
  nextImportAt: string | null;
  lastScheduledAt: string | null;
  lastScheduleResult: string | null;
  importRunId?: string | null;
  importCancelled?: boolean;
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
