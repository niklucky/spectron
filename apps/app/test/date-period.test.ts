import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesDatePeriod, resolveDatePeriod, refreshDateClock, matchesResolvedDatePeriod } from "../../../packages/frontend/src/components/feature/task/date-period";
import { dateLocale } from "../../../packages/frontend/src/lib/date-format";

test("UTC schedule dates and local activity dates agree with displayed days", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["America/New_York", "Asia/Tokyo"]) {
      process.env.TZ = timezone;
      const range = { dateFrom: "2026-03-01", dateTo: "2026-03-31" };
      for (const stamp of ["2026-03-01T00:00:00Z", "2026-03-31T23:00:00Z"]) {
        const issue = { createdAt: stamp, updatedAt: stamp, startAt: stamp, finishAt: stamp };
        assert.equal(matchesDatePeriod(issue, { ...range, dateField: "startAt" }), true);
        assert.equal(matchesDatePeriod(issue, { ...range, dateField: "finishAt" }), true);
        const local = new Date(stamp);
        const expected = local.getMonth() === 2;
        assert.equal(matchesDatePeriod(issue, { ...range, dateField: "createdAt" }), expected);
        assert.equal(matchesDatePeriod(issue, { ...range, dateField: "updatedAt" }), expected);
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("saved week and month presets roll forward while custom dates stay fixed", () => {
  const saved = { datePreset: "week" as const, dateFrom: "2026-09-07", dateTo: "2026-09-13" };
  assert.deepEqual(resolveDatePeriod(saved, new Date(2026, 8, 14, 12)), { ...saved, dateFrom: "2026-09-14", dateTo: "2026-09-20" });
  const issue = { updatedAt: new Date(2026, 8, 14, 12).toISOString(), createdAt: "2026-01-01T00:00:00Z" };
  assert.equal(matchesDatePeriod(issue, saved, new Date(2026, 8, 14, 12)), true);
  assert.deepEqual(resolveDatePeriod({ ...saved, datePreset: "month" }, new Date(2027, 0, 1, 12)), { datePreset: "month", dateFrom: "2027-01-01", dateTo: "2027-01-31" });
  assert.equal(matchesDatePeriod(issue, { ...saved, datePreset: "custom" }, new Date(2026, 8, 14, 12)), false);
});

test("locale uses first preference with the configured English fallback", () => {
  assert.equal(dateLocale(["en-US", "ru"]), "en-GB");
  assert.equal(dateLocale(["de-DE", "en-US"]), "de-DE");
  assert.equal(dateLocale(["ru", "en-US"]), "ru");
  assert.equal(dateLocale(["en-AU", "ru"]), "en-AU");
  assert.equal(dateLocale([]), "en-GB");
});

test("clock preserves state within the day and resolved ranges can be reused", () => {
  const previous = new Date(2026, 8, 13, 12);
  assert.equal(refreshDateClock(previous, new Date(2026, 8, 13, 23, 59)), previous);
  const next = new Date(2026, 8, 14, 0, 1);
  assert.equal(refreshDateClock(previous, next), next);
  const resolved = resolveDatePeriod({ datePreset: "week" as const }, next);
  const issue = { createdAt: next.toISOString(), updatedAt: next.toISOString() };
  assert.equal(matchesResolvedDatePeriod(issue, resolved), true);
  assert.equal(matchesResolvedDatePeriod({ ...issue, updatedAt: previous.toISOString() }, resolved), false);
});
