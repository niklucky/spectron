import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import { exportActions, type ExportConfig, type ExportProvider, type ExportStatus } from "@spectron/shared";
import { issueAccess, IssueInputError, IssueConflictError } from "../issues";
import type { JiraService } from "./jira";
import type { TrackerService } from "./tracker";
type Setting = typeof s.exportSetting.$inferSelect;
type Job = typeof s.exportJob.$inferSelect;
export const defaultExportConfig: ExportConfig = { mode: "off", intervalMinutes: 15, actions: [...exportActions] };
export function createExportService(db: Database, jira: JiraService, tracker: TrackerService) {
  async function access(actor: string, projectId: string, write = false) {
    await db.transaction(tx => issueAccess(tx, actor, projectId, write, true));
  }
  async function setting(projectId: string, provider: ExportProvider) {
    return (await db.select().from(s.exportSetting).where(and(eq(s.exportSetting.projectId, projectId), eq(s.exportSetting.provider, provider))))[0];
  }
  async function connected(projectId: string, provider: ExportProvider) {
    const table = provider === "jira" ? s.jiraIntegration : s.projectIntegration;
    if (!(await db.select({ id: table.id }).from(table).where(eq(table.projectId, projectId)))[0]) throw new IssueInputError("Connect the integration first.");
  }
  async function entityLinked(c: Setting, issueId: string, kind: "issue" | "comment" = "issue") {
    if (c.provider === "jira") {
      const rows = await db.select({ id: s.integrationRecord.externalId }).from(s.integrationRecord).innerJoin(s.jiraIntegration, eq(s.jiraIntegration.id, s.integrationRecord.integrationId)).where(and(eq(s.jiraIntegration.projectId, c.projectId), eq(s.integrationRecord.kind, kind), eq(s.integrationRecord.localId, issueId)));
      return !!rows[0]?.id;
    }
    const rows = await db.select({ id: s.integrationEntity.externalId }).from(s.integrationEntity).innerJoin(s.projectIntegration, eq(s.projectIntegration.id, s.integrationEntity.integrationId)).where(and(eq(s.projectIntegration.projectId, c.projectId), eq(s.integrationEntity.entityType, kind), eq(s.integrationEntity.localId, issueId)));
    return !!rows[0]?.id;
  }
  async function trackerRun(c: Setting, job: Job, target: Parameters<TrackerService["run"]>[4]) {
    const result = await tracker.run(c.actorId, c.projectId, "push", false, target);
    if (result.errors.length) throw new IssueConflictError(result.errors.join("; "));
  }
  async function dispatch(c: Setting, job: Job, reconcileId?: string) {
    await access(c.actorId, c.projectId, true);
    const [parent] = await db.select().from(s.issue).where(and(eq(s.issue.id, job.issueId), eq(s.issue.projectId, c.projectId)));
    if (!parent || parent.deletedAt) return;
    if (job.action.startsWith("comment.")) {
      const [comment] = await db.select().from(s.issueComment).where(and(eq(s.issueComment.id, job.entityId), eq(s.issueComment.issueId, job.issueId)));
      if (!comment || comment.deletedAt) return;
      if (job.action === "comment.update" && !c.config.actions.includes("comment.create") && !(await entityLinked(c, job.entityId, "comment"))) throw new IssueInputError("The comment is not linked. Enable comment creation or send it manually first.");
    }
    if (job.action.startsWith("worklog.")) {
      const [log] = await db.select().from(s.issueWorklog).where(and(eq(s.issueWorklog.id, job.entityId), eq(s.issueWorklog.issueId, job.issueId)));
      if (!log || (!reconcileId && (job.action === "worklog.create" ? !!log.deletedAt : !log.deletedAt))) return;
      // A worklog created and deleted before export needs no remote parent.
      if (job.action === "worklog.delete" && !(await entityLinked(c, job.issueId))) return;
    }
    if (!(await entityLinked(c, job.issueId))) {
      if (!c.config.actions.includes("issue.create")) throw new IssueInputError("The issue is not linked. Enable issue creation or export the issue manually first.");
      if (c.provider === "jira") await jira.pushIssue(c.actorId, c.projectId, job.issueId);
      else await trackerRun(c, job, { issueId: job.issueId });
    }
    if (job.action.startsWith("issue.")) {
      if (c.provider === "jira") await jira.pushIssue(c.actorId, c.projectId, job.issueId);
      else await trackerRun(c, job, { issueId: job.issueId });
    } else if (job.action.startsWith("comment.")) {
      if (c.provider === "jira") await jira.pushComment(c.actorId, c.projectId, job.entityId);
      else await trackerRun(c, job, { issueId: job.issueId, commentId: job.entityId });
    } else if (c.provider === "jira") {
      await jira.pushWorklog(c.actorId, c.projectId, job.entityId, job.action === "worklog.delete", reconcileId);
    } else {
      await trackerRun(c, job, { issueId: job.issueId, worklogId: job.entityId, remove: job.action === "worklog.delete", ...(reconcileId ? { reconcileId } : {}) });
    }
  }
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const settings = await db.select().from(s.exportSetting);
      for (const candidate of settings) {
        if (stopped || candidate.config.mode === "off" || (candidate.config.mode === "scheduled" && candidate.nextRunAt && candidate.nextRunAt > new Date())) continue;
        const guard = await db.$client.connect();
        const key = `export:${candidate.id}`;
        let held = false;
        let broken = false;
        const onError = () => { broken = true; };
        guard.on("error", onError);
        try {
          held = !!(await guard.query("select pg_try_advisory_lock(hashtext($1)) as locked", [key])).rows[0]?.locked;
          if (!held) continue;
          // Any running job left after its session lock disappeared was interrupted.
          await db.update(s.exportJob).set({ status: "pending" }).where(and(eq(s.exportJob.settingId, candidate.id), eq(s.exportJob.status, "running")));
          const jobs = await db.select().from(s.exportJob).where(and(eq(s.exportJob.settingId, candidate.id), eq(s.exportJob.status, "pending"), lte(s.exportJob.availableAt, new Date()))).orderBy(asc(s.exportJob.createdAt), asc(s.exportJob.id)).limit(100);
          for (const job of jobs) {
            if (stopped || broken) break;
            const c = await setting(candidate.projectId, candidate.provider);
            if (!c || c.config.mode === "off" || (c.config.mode === "scheduled" && c.nextRunAt && c.nextRunAt > new Date())) break;
            if (!c.config.actions.includes(job.action)) {
              await db.update(s.exportJob).set({ status: "cancelled", updatedAt: new Date() }).where(eq(s.exportJob.id, job.id));
              continue;
            }
            const [claimed] = await db.update(s.exportJob).set({ status: "running", attempts: job.attempts + 1, error: null, updatedAt: new Date() }).where(and(eq(s.exportJob.id, job.id), eq(s.exportJob.status, "pending"))).returning();
            if (!claimed) continue;
            try {
              await dispatch(c, job);
              await db.update(s.exportJob).set({ status: "succeeded", updatedAt: new Date() }).where(eq(s.exportJob.id, job.id));
            } catch (error) {
              const message = error instanceof Error ? error.message : "Export failed.";
              const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
              const transient = status === 429 || status >= 500 || /busy|current Jira request|Two Tracker sync/.test(message);
              const retry = transient && job.attempts < 4;
              await db.update(s.exportJob).set({ status: retry ? "pending" : "failed", error: message.slice(0, 2000), availableAt: new Date(Date.now() + Math.min(15 * 60_000, 10_000 * 2 ** job.attempts)), updatedAt: new Date() }).where(eq(s.exportJob.id, job.id));
            }
          }
          if (candidate.config.mode === "scheduled" && jobs.length < 100) {
            await db.update(s.exportSetting).set({ nextRunAt: new Date(Date.now() + candidate.config.intervalMinutes * 60_000) }).where(and(eq(s.exportSetting.id, candidate.id), eq(s.exportSetting.updatedAt, candidate.updatedAt)));
          }
        } finally {
          if (held && !broken) { try { await guard.query("select pg_advisory_unlock(hashtext($1))", [key]); } catch { broken = true; } }
          guard.off("error", onError);
          guard.release(broken);
        }
      }
    } finally { running = false; }
  }
  return {
    async get(actor: string, projectId: string, provider: ExportProvider): Promise<ExportStatus> {
      await access(actor, projectId);
      const c = await setting(projectId, provider);
      const counts: ExportStatus["counts"] = { pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
      if (!c) return { config: defaultExportConfig, nextRunAt: null, counts, entries: [] };
      const grouped = await db.select({ status: s.exportJob.status, count: sql<number>`count(*)::int` }).from(s.exportJob).where(eq(s.exportJob.settingId, c.id)).groupBy(s.exportJob.status);
      for (const row of grouped) counts[row.status] = row.count;
      const entries = await db.select().from(s.exportJob).where(eq(s.exportJob.settingId, c.id)).orderBy(sql`case when ${s.exportJob.status} = 'failed' then 0 when ${s.exportJob.status} in ('pending','running') then 1 else 2 end`, desc(s.exportJob.createdAt)).limit(50);
      return { config: c.config, nextRunAt: c.nextRunAt?.toISOString() ?? null, counts, entries: entries.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })) };
    },
    async save(actor: string, projectId: string, provider: ExportProvider, config: ExportConfig) {
      await access(actor, projectId, true);
      await connected(projectId, provider);
      if (!["off", "on_save", "scheduled"].includes(config.mode) || ![15,60,1440].includes(config.intervalMinutes) || config.actions.some(a => !exportActions.includes(a)) || new Set(config.actions).size !== config.actions.length) throw new IssueInputError("Invalid export settings.");
      await db.transaction(async tx => {
        await issueAccess(tx, actor, projectId, true, true);
        const values = { actorId: actor, config, nextRunAt: config.mode === "scheduled" ? new Date(Date.now() + config.intervalMinutes * 60_000) : null, updatedAt: new Date() };
        const [c] = await tx.insert(s.exportSetting).values({ projectId, provider, ...values }).onConflictDoUpdate({ target: [s.exportSetting.projectId, s.exportSetting.provider], set: values }).returning();
        const jobs = await tx.select().from(s.exportJob).where(and(eq(s.exportJob.settingId, c!.id), inArray(s.exportJob.status, ["pending", "failed"])));
        for (const job of jobs) if (config.mode === "off" || !config.actions.includes(job.action)) await tx.update(s.exportJob).set({ status: "cancelled", updatedAt: new Date() }).where(eq(s.exportJob.id, job.id));
      });
    },
    async retry(actor: string, projectId: string, provider: ExportProvider, id: string) {
      await access(actor, projectId, true);
      const c = await setting(projectId, provider);
      if (!c || c.config.mode === "off") throw new IssueInputError("Enable export before retrying.");
      const [job] = await db.select().from(s.exportJob).where(and(eq(s.exportJob.id, id), eq(s.exportJob.settingId, c.id)));
      if (!job || job.status !== "failed" || !c.config.actions.includes(job.action)) throw new IssueInputError("This export cannot be retried with the current settings.");
      await db.update(s.exportJob).set({ status: "pending", attempts: 0, availableAt: new Date(), updatedAt: new Date() }).where(and(eq(s.exportJob.id, id), eq(s.exportJob.status, "failed")));
    },
    async reconcile(actor: string, projectId: string, provider: ExportProvider, id: string, remoteId: string) {
      await access(actor, projectId, true);
      const c = await setting(projectId, provider);
      if (!c) throw new IssueInputError("Export settings not found.");
      const [job] = await db.select().from(s.exportJob).where(and(eq(s.exportJob.id, id), eq(s.exportJob.settingId, c.id)));
      if (!job || job.status !== "failed" || !job.action.startsWith("worklog.")) throw new IssueInputError("Choose a failed worklog export.");
      await dispatch({ ...c, actorId: actor }, job, remoteId);
    },
    tick,
    start() {
      const timer = setInterval(() => { void tick().catch(() => console.error("Export worker tick failed.")); }, 2000);
      timer.unref();
      return async () => { stopped = true; clearInterval(timer); while (running) await new Promise(resolve => setTimeout(resolve, 50)); };
    },
  };
}
export type ExportService = ReturnType<typeof createExportService>;
