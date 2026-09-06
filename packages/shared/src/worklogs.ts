export type WorklogScope = { projectId: string; issueId: string };
export type WorklogFields = {
  workerUserId: string;
  startedAt: string;
  durationSeconds: number;
  description: string;
};
export type WorklogSummary = WorklogScope &
  WorklogFields & {
    id: string;
    workerName: string;
    recordedBy: string;
    recorderName: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
export type WorklogPage = {
  entries: WorklogSummary[];
  nextCursor: { createdAt: string; id: string } | null;
};
export function formatWorklogDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    remainder = seconds % 60;
  return (
    [
      hours ? `${hours}h` : "",
      minutes ? `${minutes}m` : "",
      remainder ? `${remainder}s` : "",
    ]
      .filter(Boolean)
      .join(" ") || "0s"
  );
}

// Units/separators are hints only: the number of groups determines their meaning.
export function parseHumanWorklogDuration(input: string): number {
  const groups = input.match(/\d+/g) ?? [];
  if (groups.length < 1 || groups.length > 3 || /-\s*\d|\d[.,]\d/.test(input))
    throw new Error(
      "Use minutes, hours/minutes, or days/hours/minutes, such as 30, 1h 35m, or 1d 2h 30m.",
    );
  const weights = [1440, 60, 1].slice(3 - groups.length);
  const minutes = groups.reduce(
    (total, group, index) => total + Number(group) * weights[index]!,
    0,
  );
  const seconds = minutes * 60;
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 2147483647)
    throw new Error("Enter a positive duration within the supported range.");
  return seconds;
}
export function humanWorklogDurationInput(seconds: number): string {
  const minutes = Math.ceil(seconds / 60),
    hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
