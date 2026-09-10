export type DatePeriod = {
  dateField?: "updatedAt" | "createdAt" | "startAt" | "finishAt";
  dateFrom?: string;
  dateTo?: string;
  datePreset?: "week" | "month" | "custom";
};
const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Keep React state stable on same-day timer and focus events. */
export function refreshDateClock(previous: Date, now = new Date()) {
  return previous.toDateString() === now.toDateString() ? previous : now;
}

/** Presets stay relative, including when restored from older saved filters. */
export function resolveDatePeriod<T extends DatePeriod>(filter: T, now = new Date()): T {
  if (filter.datePreset !== "week" && filter.datePreset !== "month") return filter;
  const from = new Date(now), to = new Date(now);
  if (filter.datePreset === "week") {
    from.setDate(from.getDate() - (from.getDay() + 6) % 7);
    to.setFullYear(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  } else {
    from.setDate(1);
    to.setMonth(to.getMonth() + 1, 0);
  }
  return { ...filter, dateFrom: localDay(from), dateTo: localDay(to) };
}

export function matchesDatePeriod(issue: { updatedAt: string; createdAt: string; startAt?: string | null; finishAt?: string | null }, period: DatePeriod, now = new Date()) {
  return matchesResolvedDatePeriod(issue, resolveDatePeriod(period, now));
}

/** The caller resolves relative presets once for the entire issue list. */
export function matchesResolvedDatePeriod(issue: { updatedAt: string; createdAt: string; startAt?: string | null; finishAt?: string | null }, filter: DatePeriod) {
  if (!filter.dateFrom && !filter.dateTo) return true;
  const field = filter.dateField ?? "updatedAt";
  const raw = issue[field];
  if (!raw) return false;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;
  const day = field === "startAt" || field === "finishAt" ? date.toISOString().slice(0, 10) : localDay(date);
  return (!filter.dateFrom || day >= filter.dateFrom) && (!filter.dateTo || day <= filter.dateTo);
}
