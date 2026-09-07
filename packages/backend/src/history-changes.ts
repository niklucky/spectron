import type { HistoryChanges } from "@spectron/shared";

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, part) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(
          Object.entries(part).sort(([a], [b]) => a.localeCompare(b)),
        )
      : part,
  );
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** `after` is a patch; omitted top-level fields remain unchanged. */
export function historyChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): HistoryChanges {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === "fieldValues") {
      const oldFields = object(before[key]),
        newFields = object(after[key]);
      for (const id of new Set([
        ...Object.keys(oldFields),
        ...Object.keys(newFields),
      ])) {
        if (canonical(oldFields[id]) !== canonical(newFields[id]))
          result[`fieldValues.${id}`] = {
            before: oldFields[id] ?? null,
            after: newFields[id] ?? null,
          };
      }
    } else if (canonical(before[key]) !== canonical(after[key])) {
      result[key] = { before: before[key] ?? null, after: after[key] ?? null };
    }
  }
  return JSON.parse(JSON.stringify(result)) as HistoryChanges;
}

/** Present legacy Jira snapshots and custom-field maps as individual changes. */
export function normalizeHistoryChanges(
  changes: HistoryChanges,
): HistoryChanges {
  const result = { ...changes };
  for (const key of ["jira", "fieldValues"]) {
    const change = result[key];
    if (!change) continue;
    delete result[key];
    Object.assign(
      result,
      key === "jira"
        ? historyChanges(object(change.before), object(change.after))
        : historyChanges(
            { fieldValues: change.before },
            { fieldValues: change.after },
          ),
    );
  }
  return result;
}
