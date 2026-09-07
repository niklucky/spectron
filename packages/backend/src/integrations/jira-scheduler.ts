import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import { createId } from "@spectron/shared";
import type { JiraService } from "./jira";

// Claims are durable across API processes; expired claims recover after a crash.
export function createJiraScheduler(db: Database, jira: JiraService) {
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const available = () =>
        and(
          lt(s.jiraIntegration.nextImportAt, new Date()),
          or(
            isNull(s.jiraIntegration.leaseUntil),
            lt(s.jiraIntegration.leaseUntil, new Date()),
          ),
          or(
            and(
              isNull(s.jiraIntegration.importRunId),
              isNull(s.jiraIntegration.scheduleLeaseUntil),
            ),
            lt(s.jiraIntegration.scheduleLeaseUntil, new Date()),
          ),
        );
      const candidates = await db
        .select()
        .from(s.jiraIntegration)
        .where(available())
        .limit(10);
      for (const candidate of candidates) {
        if (stopped) break;
        if (!candidate.scheduleMinutes || !candidate.scheduleUserId) continue;
        const runId = createId();
        const startedAt = new Date();
        const [c] = await db
          .update(s.jiraIntegration)
          .set({
            importRunId: runId,
            importCancelled: false,
            scheduleLeaseUntil: new Date(Date.now() + 15 * 60_000),
            nextImportAt: new Date(
              Date.now() + candidate.scheduleMinutes * 60_000,
            ),
            lastScheduledAt: startedAt,
            lastScheduleResult: "Running…",
          })
          .where(
            and(
              eq(s.jiraIntegration.id, candidate.id),
              eq(s.jiraIntegration.scheduleMinutes, candidate.scheduleMinutes),
              eq(s.jiraIntegration.scheduleUserId, candidate.scheduleUserId),
              available(),
            ),
          )
          .returning();
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
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];
        let result = "";
        let completed = false;
        // Re-read a short overlap for delayed indexing and clock differences.
        // Keep this lower bound identical across every page in the run.
        const updatedAfter = c.scheduledImportWatermark
          ? new Date(c.scheduledImportWatermark.getTime() - 5 * 60_000)
          : undefined;
        try {
          // Every service operation rechecks project ownership and archived state.
          await jira.prepare(c.scheduleUserId!, c.projectId, runId);
          let token: string | undefined;
          do {
            const page = await jira.search(
              c.scheduleUserId!,
              c.projectId,
              token,
              runId,
              updatedAfter,
            );
            for (const issue of page.issues) {
              if (stopped)
                throw new Error("Import interrupted by server shutdown.");
              try {
                await jira.import(
                  c.scheduleUserId!,
                  c.projectId,
                  issue.id,
                  false,
                  runId,
                );
                imported++;
              } catch (error) {
                const [state] = await db
                  .select()
                  .from(s.jiraIntegration)
                  .where(ownsRun);
                if (!state || state.importCancelled)
                  throw new Error("Import stopped.");
                failed++;
                if (errors.length < 3)
                  errors.push(
                    `${issue.key}: ${error instanceof Error ? error.message : "Import failed"}`,
                  );
              }
            }
            token = page.nextPageToken ?? undefined;
          } while (token);
          completed = failed === 0 && !stopped;
          result = `${imported} imported, ${failed} failed.${errors.length ? " " + errors.join("; ") : ""}`;
        } catch (error) {
          result = `${imported} imported, ${failed} failed. ${error instanceof Error ? error.message : "Import failed."}`;
        } finally {
          clearInterval(heartbeat);
          await db
            .update(s.jiraIntegration)
            .set({
              importRunId: null,
              scheduleLeaseUntil: null,
              lastScheduleResult: result.slice(0, 4000),
              // A stop can arrive after the last page; check cancellation atomically.
              ...(completed
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
      const timer = setInterval(poll, 30_000);
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
