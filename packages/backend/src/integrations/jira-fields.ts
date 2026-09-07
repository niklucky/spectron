import { builtInIssueField, issueTimestamp } from "@spectron/shared";
import { IssueInputError } from "../issues";
import type { JiraField } from "./jira-client";
export function importBuiltIn(
  target: string,
  value: unknown,
): number | string | null {
  const field = builtInIssueField(target);
  if (!field) throw new IssueInputError("Unknown built-in field.");
  if (value == null) return null;
  if (field.key === "estimateTime") {
    if (typeof value === "object" && "originalEstimateSeconds" in value)
      value = value.originalEstimateSeconds;
    if (value == null) return null;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 2147483647
    )
      throw new IssueInputError(
        "Map a numeric Jira estimate (seconds) to Estimate time.",
      );
    return value;
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new IssueInputError(
      `Map a Jira date or date/time field to ${field.name}.`,
    );
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new IssueInputError("Jira returned an invalid calendar date.");
  return issueTimestamp(value);
}
export function exportBuiltIn(
  external: string,
  target: string,
  value: number | string | null,
  metadata?: JiraField,
): Record<string, unknown> {
  const field = builtInIssueField(target)!;
  if (
    field.key === "estimateTime" &&
    ["timeoriginalestimate", "timetracking"].includes(external)
  ) {
    if (value !== null && (typeof value !== "number" || value % 60 !== 0))
      throw new IssueInputError(
        "Jira original estimates require whole minutes. Adjust Estimate time before sending.",
      );
    return {
      timetracking: {
        originalEstimate: value === null ? null : `${Number(value) / 60}m`,
      },
    };
  }
  if (field.key !== "estimateTime" && value !== null) {
    const iso = issueTimestamp(String(value))!;
    return {
      [external]:
        external === "duedate" || metadata?.schema?.type === "date"
          ? iso.slice(0, 10)
          : iso,
    };
  }
  return { [external]: value };
}
