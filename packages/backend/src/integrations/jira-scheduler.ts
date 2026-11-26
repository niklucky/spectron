import { and, eq, isNull, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import { createId, type JiraImportProgress } from "@spectron/shared";
import type { JiraService } from "./jira";

// A vanished worker cannot acknowledge Stop. Fence it by clearing its run ID.
export async function releaseStoppedJiraRuns(db: Pick<Database, "update">, scope?: SQL) {
  const t = s.jiraIntegration;
  const expired = lt(t.scheduleLeaseUntil, new Date());
  await db.update(t).set({
    importRunId: null,
    scheduleLeaseUntil: null,
    lastScheduleResult: sql`CASE WHEN ${t.scheduleLeaseUntil} IS NOT NULL THEN 'Import stopped.' ELSE ${t.lastScheduleResult} END`,
    importProgress: sql`CASE WHEN ${t.importProgress}->>'id' = ${t.importRunId}
      THEN ${t.importProgress} || '{"status":"stopped","currentKey":null}'::jsonb ELSE ${t.importProgress} END`,
  }).where(and(
    scope, isNotNull(t.importRunId), isNull(t.fullImportUserId),
    or(
      and(eq(t.importCancelled, true), or(isNull(t.scheduleLeaseUntil), expired)),
      and(expired, isNull(t.scheduleMinutes)),
    ),
  ));
}

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
      await releaseStoppedJiraRuns(db);
      const scheduledReady = and(
        isNull(table.fullImportUserId), isNotNull(table.scheduleMinutes), isNotNull(table.scheduleUserId),
        or(
          and(lt(table.nextImportAt, now), isNull(table.importRunId), isNull(table.scheduleLeaseUntil)),
          and(lt(table.scheduleLeaseUntil, now), eq(table.importCancelled, false)),
        ),
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
        let interrupted = false;
        let nextProgressWrite = 0;
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
            if (stopped) {
              interrupted = true;
              break;
            }
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
              if (stopped) {
                interrupted = true;
                break;
              }
              progress.currentKey = issue.key;
              if (Date.now() >= nextProgressWrite) {
                await db.update(table).set({ importProgress: progress }).where(ownsRun);
                nextProgressWrite = Date.now() + 1000;
              }
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
                  .select({ importCancelled: table.importCancelled })
                  .from(table)
                  .where(ownsRun);
                if (!state || state.importCancelled)
                  throw new Error("Import stopped.");
                progress.failed++;
                if (progress.errors.length < 100) {
                  progress.errors.push({
                    id: issue.id, key: issue.key,
                    error: error instanceof Error ? error.message.slice(0, 1000) : "Import failed",
                  });
                }
              }
            }
            token = page.nextPageToken ?? undefined;
          } while (token && !interrupted);
          completed = progress.failed === 0 && !interrupted;
        } catch (error) {
          progress.message = error instanceof Error ? error.message : "Import failed.";
        } finally {
          clearInterval(heartbeat);
        }
        if (interrupted && manual) {
          const [queued] = await db.update(table).set({
            scheduleLeaseUntil: null,
            importProgress: { ...progress, currentKey: null, status: "queued" },
          }).where(and(ownsRun, eq(table.importCancelled, false))).returning({ id: table.id });
          if (queued) continue;
        }
        if (interrupted) progress.message = "Import interrupted by server shutdown.";
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
