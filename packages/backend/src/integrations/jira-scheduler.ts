import { and, eq, isNull, isNotNull, lt, or, sql } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import { createId, type JiraImportProgress } from "@spectron/shared";
import type { JiraService } from "./jira";

// Claims are durable across API processes; expired claims recover after a crash.
export function createJiraScheduler(db: Database, jira: JiraService) {
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const now = new Date();
      const table = s.jiraIntegration;
      const free = (column: typeof table.leaseUntil | typeof table.scheduleLeaseUntil) =>
        or(isNull(column), lt(column, now));
      const manualReady = and(isNotNull(table.fullImportUserId), free(table.scheduleLeaseUntil));
      const scheduledReady = and(
        isNull(table.fullImportUserId), lt(table.nextImportAt, now),
        or(and(isNull(table.importRunId), isNull(table.scheduleLeaseUntil)), lt(table.scheduleLeaseUntil, now)),
      );
      const candidates = await db.select().from(table)
        .where(and(free(table.leaseUntil), or(manualReady, scheduledReady))).limit(10);
      for (const candidate of candidates) {
        if (stopped) break;
        const manual = candidate.fullImportUserId !== null;
        const actor = manual ? candidate.fullImportUserId : candidate.scheduleUserId;
        if (!actor || (!manual && !candidate.scheduleMinutes)) continue;
        // Keep a queued run's ID for callers holding its Stop button. On lease
        // recovery a fresh ID fences off the previous worker and its heartbeat.
        const runId = manual && !candidate.scheduleLeaseUntil && candidate.importRunId
          ? candidate.importRunId : createId();
        const startedAt = new Date();
        const progress: JiraImportProgress = {
          id: runId, kind: manual ? "full" : "scheduled", status: "running",
          currentKey: null, imported: 0, failed: 0, errors: [],
        };
        const [c] = await db.update(table).set({
          importRunId: runId, importProgress: progress,
          scheduleLeaseUntil: new Date(Date.now() + 15 * 60_000),
          ...(!manual && {
            importCancelled: false,
            nextImportAt: new Date(Date.now() + candidate.scheduleMinutes! * 60_000),
            lastScheduledAt: startedAt, lastScheduleResult: "Running…",
          }),
        }).where(and(eq(table.id, candidate.id), free(table.leaseUntil), manual
          ? and(manualReady, eq(table.importRunId, candidate.importRunId!))
          : and(scheduledReady, eq(table.scheduleMinutes, candidate.scheduleMinutes!), eq(table.scheduleUserId, actor)),
        )).returning();
        if (!c) continue;
        const ownsRun = and(
          eq(s.jiraIntegration.id, c.id),
          eq(s.jiraIntegration.importRunId, runId),
        );
        const heartbeat = setInterval(() => {
          void db
            .update(s.jiraIntegration)
            .set({ scheduleLeaseUntil: new Date(Date.now() + 15 * 60_000) })
            .where(ownsRun)
            .catch(() => {});
        }, 60_000);
        heartbeat.unref();
        let completed = false;
        // Re-read a short overlap for delayed indexing and clock differences.
        // Keep this lower bound identical across every page in the run.
        const updatedAfter = !manual && c.scheduledImportWatermark
          ? new Date(c.scheduledImportWatermark.getTime() - 5 * 60_000)
          : undefined;
        try {
          // Every service operation rechecks project ownership and archived state.
          await jira.prepare(actor, c.projectId, runId);
          let token: string | undefined;
          do {
            const page = await jira.search(
              actor,
              c.projectId,
              token,
              runId,
              updatedAfter,
            );
            if (!page.nextPageToken) {
              progress.total = progress.imported + progress.failed + page.issues.length;
              progress.totalIsEstimate = false;
            } else if (page.estimatedTotal !== undefined) {
              progress.total = page.estimatedTotal;
              progress.totalIsEstimate = true;
            }
            for (const issue of page.issues) {
              if (stopped)
                throw new Error("Import interrupted by server shutdown.");
              progress.currentKey = issue.key;
              await db.update(table).set({ importProgress: progress }).where(ownsRun);
              try {
                await jira.import(
                  actor,
                  c.projectId,
                  issue.id,
                  false,
                  runId,
                );
                progress.imported++;
              } catch (error) {
                const [state] = await db
                  .select()
                  .from(s.jiraIntegration)
                  .where(ownsRun);
                if (!state || state.importCancelled)
                  throw new Error("Import stopped.");
                progress.failed++;
                progress.errors.push({
                  id: issue.id, key: issue.key, error: error instanceof Error ? error.message : "Import failed",
                });
              }
            }
            token = page.nextPageToken ?? undefined;
          } while (token);
          completed = progress.failed === 0 && !stopped;
        } catch (error) {
          progress.message = error instanceof Error ? error.message : "Import failed.";
        } finally {
          clearInterval(heartbeat);
          progress.currentKey = null;
          progress.status = completed ? "finished" : "failed";
          const details = progress.message ?? progress.errors.slice(0, 3)
            .map(issue => `${issue.key}: ${issue.error}`).join("; ");
          const result = `${progress.imported} imported, ${progress.failed} failed. ${details}`.trimEnd();
          await db
            .update(s.jiraIntegration)
            .set({
              fullImportUserId: null,
              importProgress: sql`CASE WHEN ${table.importCancelled} THEN jsonb_set(${JSON.stringify(progress)}::jsonb, '{status}', '"stopped"') ELSE ${JSON.stringify(progress)}::jsonb END`,
              importRunId: null,
              scheduleLeaseUntil: null,
              ...(!manual && { lastScheduleResult: result.slice(0, 4000) }),
              // A stop can arrive after the last page; check cancellation atomically.
              ...(completed && !manual
                ? {
                    scheduledImportWatermark: sql`CASE WHEN ${s.jiraIntegration.importCancelled} = false THEN ${startedAt.toISOString()}::timestamptz ELSE ${s.jiraIntegration.scheduledImportWatermark} END`,
                  }
                : {}),
            })
            .where(ownsRun);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    tick,
    start() {
      let active: Promise<void> = Promise.resolve();
      const poll = () => {
        if (running) return;
        active = tick().catch(() =>
          console.error("Jira scheduler poll failed."),
        );
      };
      const timer = setInterval(poll, 5_000);
      timer.unref();
      poll();
      return async () => {
        stopped = true;
        clearInterval(timer);
        await active;
      };
    },
  };
}
