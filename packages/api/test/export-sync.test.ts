import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { and, eq } = createRequire(new URL("../../backend/package.json", import.meta.url))("drizzle-orm") as typeof import("../../backend/node_modules/drizzle-orm");
import { createDatabase, migrateDatabase, schema as s } from "@spectron/db";
import { createProjectService, createIssueService, createCommentService, createWorklogService, createFileService, createJiraService, createTrackerService, createExportService } from "@spectron/backend";
import { encryptToken } from "../../backend/src/integrations/jira";
import { sealToken } from "../../backend/src/integrations/tracker";
import { exportActions } from "@spectron/shared";

for (const provider of ["jira", "tracker"] as const) test(`${provider}: durable automatic export lifecycle and recovery`, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://spectron:spectron@127.0.0.1:5442/spectron");
  const admin = createDatabase(url.toString());
  const name = `test_export_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`); url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await pool.end(); await admin.pool.query(`DROP DATABASE "${name}"`); await admin.pool.end(); });
  await migrateDatabase(db);
  await db.insert(s.user).values([{ id: "owner", name: "Owner", email: "owner@test.invalid" }, { id: "member", name: "Member", email: "member@test.invalid" }]);
  const projects = createProjectService(db), issues = createIssueService(db), comments = createCommentService(db), worklogs = createWorklogService(db);
  const p = await projects.create("owner", { name: "Export", key: "EX" });
  await db.insert(s.projectMember).values({ projectId: p.id, userId: "member", role: "member" });
  const state = (await issues.settings("owner", p.id)).states[0]!;
  const secret = Buffer.alloc(32, 1).toString("base64");
  if (provider === "jira") await db.insert(s.jiraIntegration).values({ projectId: p.id, baseUrl: "https://test.atlassian.net", email: "test@test.invalid", encryptedToken: encryptToken("token", secret), projectKey: "TEAM", issueTypeId: "task", mappings: { statuses: { open: state.id }, priorities: {}, fields: {}, users: {} } });
  else await db.insert(s.projectIntegration).values({ projectId: p.id, organizationId: "org", organizationType: "cloud", queue: "TEAM", token: sealToken("token", secret), mappings: { statuses: { open: state.id }, priorities: {}, fields: {}, users: {} } });
  const jira = createJiraService(db, createFileService(db), secret), tracker = createTrackerService(db, secret);
  let worker = createExportService(db, jira, tracker);
  const remotes: any[] = [], remoteComments = new Map<string, any[]>(), logs = new Map<string, any[]>();
  const logSequences = new Map<string, number>();
  let sequence = 0, version = 0, worklogCreates = 0, issueCreates = 0, failWorklog = "", failUpdate = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname.replace(/^\/rest\/api\/3|^\/v3|^\/v2/, "").replace(/\/$/, ""), method = init?.method ?? "GET";
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/field") return json([]);
    if (path === "/issues/_findByUnique") { const found = remotes.find(r => r.unique === url.searchParams.get("unique")); return found ? json(found) : json({}, 404); }
    if (["/issue", "/issues"].includes(path) && method === "POST") {
      issueCreates++;
      const id = String(++sequence), key = `TEAM-${id}`, fields = data.fields ?? data;
      const r = provider === "jira" ? { id, key, fields: { ...fields, project: { key: "TEAM" }, status: { id: "open", name: "Open" } } } : { id, key, ...fields, status: { id: "open", key: "open", display: "Open" }, version: ++version, updatedAt: `v${version}`, createdAt: "2026-01-01" };
      remotes.push(r); remoteComments.set(id, []); logs.set(id, []); return json(r);
    }
    const match = path.match(/^\/issues?\/([^/]+)(?:\/(comment|comments|worklog|transitions)(?:\/([^/]+))?)?$/);
    if (!match) throw new Error(`Unexpected request ${method} ${path}`);
    const remote = remotes.find(r => r.id === match[1] || r.key === match[1]);
    assert.ok(remote, path);
    const kind = match[2], id = match[3];
    if (!kind) {
      if (method !== "GET") {
        if (failUpdate) { failUpdate = false; return json({}, 503); }
        if (provider === "jira") Object.assign(remote.fields, data.fields);
        else Object.assign(remote, data, { updatedAt: `v${++version}`, version });
      }
      return json(remote);
    }
    if (kind === "transitions") return json({ transitions: [] });
    if (provider === "tracker" && method !== "GET") Object.assign(remote, { updatedAt: `v${++version}`, version });
    const list = kind === "worklog" ? logs.get(remote.id)! : remoteComments.get(remote.id)!;
    if (method === "GET") return json(provider === "jira" ? { [kind === "worklog" ? "worklogs" : "comments"]: list, total: list.length, maxResults: 100, startAt: 0 } : list);
    if (method === "DELETE") { const index = list.findIndex(r => String(r.id) === id); if (index >= 0) list.splice(index, 1); return new Response(null, { status: 204 }); }
    if (method === "POST") {
      if (kind === "worklog") {
        worklogCreates++;
        if (failWorklog === "reject") { failWorklog = ""; return json({}, 429); }
      }
      const entryId = kind === "worklog" && provider === "tracker" ? String((logSequences.get(remote.id) ?? 0) + 1) : String(++sequence);
      if (kind === "worklog") logSequences.set(remote.id, Number(entryId));
      const entry = { id: entryId, ...data, updatedAt: `v${++version}`, updated: `v${version}` };
      list.push(entry);
      if (kind === "worklog" && failWorklog === "lost") { failWorklog = ""; throw new Error("Response lost"); }
      return json(entry);
    }
    const entry = list.find(r => r.id === id); assert.ok(entry);
    Object.assign(entry, data, { updatedAt: `v${++version}`, updated: `v${version}` }); return json(entry);
  };
  const config = { mode: "on_save" as const, intervalMinutes: 15 as const, actions: [...exportActions] };
  const status = () => worker.get("owner", p.id, provider);
  const newIssue = (title: string) => issues.create("member", { projectId: p.id, title, stateId: state.id });
  assert.equal((await status()).config.mode, "off");
  await newIssue("Before enabling"); assert.equal((await status()).entries.length, 0);
  await assert.rejects(worker.save("member", p.id, provider, config));
  await assert.rejects(worker.get("member", p.id, provider));
  await worker.save("owner", p.id, provider, config);
  let issue = await newIssue("First");
  assert.equal((await status()).counts.pending, 1);
  await db.update(s.exportJob).set({ status: "running" }).where(eq(s.exportJob.entityId, issue.id));
  worker = createExportService(db, jira, tracker); // Recover an interrupted claim after restart.
  await Promise.all([worker.tick(), createExportService(db, jira, tracker).tick()]);
  assert.equal(issueCreates, 1, JSON.stringify(await status()));
  assert.equal((await status()).counts.succeeded, 1);
  issue = await issues.update("member", { projectId: p.id, id: issue.id, expectedUpdatedAt: issue.updatedAt, title: "Changed" });
  await worker.tick(); assert.equal(provider === "jira" ? remotes[0].fields.summary : remotes[0].summary, "Changed");
  const scope = { projectId: p.id, issueId: issue.id };
  const comment = await comments.save("member", { ...scope, body: [{ type: "text", text: "Hello" }], files: [] });
  await worker.tick(); assert.equal(remoteComments.get(remotes[0].id)!.length, 1, JSON.stringify(await status()));
  const [savedComment] = await db.select().from(s.issueComment).where(eq(s.issueComment.id, comment.id));
  await comments.save("member", { ...scope, id: comment.id, expectedUpdatedAt: savedComment!.updatedAt.toISOString(), body: [{ type: "text", text: "Edited" }], files: [] });
  await worker.tick(); assert.equal(remoteComments.get(remotes[0].id)!.length, 1); assert.match(JSON.stringify(remoteComments.get(remotes[0].id)), /Edited/);
  const newLog = () => worklogs.save("member", { ...scope, workerUserId: "member", startedAt: "2026-09-09T10:00:00.000Z", durationSeconds: 91, description: "Work" });
  const deleteLog = async (id: string) => { const [log] = await db.select().from(s.issueWorklog).where(eq(s.issueWorklog.id, id)); await worklogs.setDeleted("member", { ...scope, id, expectedUpdatedAt: log!.updatedAt.toISOString(), deleted: true }); };
  const log = await newLog(); await worker.tick();
  assert.equal(logs.get(remotes[0].id)!.length, 1, JSON.stringify(await status()));
  assert.equal(provider === "jira" ? logs.get(remotes[0].id)![0].timeSpentSeconds : logs.get(remotes[0].id)![0].duration, provider === "jira" ? 91 : "PT91S");
  await deleteLog(log.id); await worker.tick(); assert.equal(logs.get(remotes[0].id)!.length, 0);
  assert.equal((await status()).counts.succeeded, 6);
  issue = await issues.update("member", { projectId: p.id, id: issue.id, expectedUpdatedAt: issue.updatedAt, title: "After child exports" });
  await worker.tick();
  assert.equal(provider === "jira" ? remotes[0].fields.summary : remotes[0].summary, "After child exports", JSON.stringify(await status()));
  // Scheduled mode does not send before its due time; create and delete coalesce safely.
  await worker.save("owner", p.id, provider, { ...config, mode: "scheduled" });
  const discarded = await newLog(); await deleteLog(discarded.id);
  const scheduledIssue = await newIssue("Scheduled"); await worker.tick(); assert.equal(issueCreates, 1);
  await db.update(s.exportSetting).set({ nextRunAt: new Date(0) }).where(eq(s.exportSetting.projectId, p.id));
  await worker.tick(); assert.equal(issueCreates, 2); assert.equal(worklogCreates, 1);
  // Worklog uncertain creates never blindly POST again, even after restarting.
  await worker.save("owner", p.id, provider, config);
  failWorklog = "lost"; const uncertain = await newLog(); await worker.tick();
  await db.update(s.exportJob).set({ availableAt: new Date(0) }).where(eq(s.exportJob.status, "pending")); await worker.tick();
  let failed = (await status()).entries.find(e => e.entityId === uncertain.id)!;
  assert.equal(failed.status, "failed", JSON.stringify(await status()));
  await worker.retry("owner", p.id, provider, failed.id); worker = createExportService(db, jira, tracker); await worker.tick();
  assert.equal(worklogCreates, 2); failed = (await status()).entries.find(e => e.entityId === uncertain.id)!; assert.match(failed.error!, /reconciliation/);
  await worker.reconcile("owner", p.id, provider, failed.id, String(logs.get(remotes[0].id)![0].id));
  await worker.retry("owner", p.id, provider, failed.id); await worker.tick(); assert.equal(worklogCreates, 2);
  // Remote edits prevent deletion.
  logs.get(remotes[0].id)![0].comment = "Remote edit";
  await deleteLog(uncertain.id); await worker.tick();
  assert.equal(logs.get(remotes[0].id)!.length, 1);
  assert.ok((await status()).entries.some(e => e.entityId === uncertain.id && e.status === "failed" && e.error?.includes("changed")));
  // A definitive 429 rejection can be retried without reconciliation.
  failWorklog = "reject"; const rateLimited = await newLog(); await worker.tick();
  await db.update(s.exportJob).set({ availableAt: new Date(0) }).where(eq(s.exportJob.status, "pending"));
  // Tracker wraps provider errors in its result, so an owner can explicitly retry it.
  const rejected = (await status()).entries.find(e => e.entityId === rateLimited.id)!;
  if (rejected.status === "failed") await worker.retry("owner", p.id, provider, rejected.id);
  await worker.tick(); assert.equal(worklogCreates, 4);
  const secondIssueLog = await worklogs.save("member", { projectId: p.id, issueId: scheduledIssue.id, workerUserId: "member", startedAt: "2026-09-09T10:00:00.000Z", durationSeconds: 60, description: "Other issue" });
  await worker.tick();
  assert.ok((await status()).entries.some(e => e.entityId === secondIssueLog.id && e.status === "succeeded"), JSON.stringify(await status()));
  // The queue write and local mutation commit together.
  await pool.query("CREATE FUNCTION reject_export_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue unavailable'; END $$");
  await pool.query("CREATE TRIGGER reject_export_test BEFORE INSERT ON export_jobs FOR EACH ROW EXECUTE FUNCTION reject_export_test()");
  await assert.rejects(newIssue("Must roll back"));
  await pool.query("DROP TRIGGER reject_export_test ON export_jobs");
  assert.equal(Number((await pool.query("SELECT count(*) FROM issues WHERE title = 'Must roll back'")).rows[0].count), 0);
  // Comment updates cannot bypass the disabled create action.
  await worker.save("owner", p.id, provider, { ...config, actions: ["comment.update"] });
  const localComment = await comments.save("member", { ...scope, body: [{ type: "text", text: "Local only" }], files: [] });
  const [unlinkedComment] = await db.select().from(s.issueComment).where(eq(s.issueComment.id, localComment.id));
  await comments.save("member", { ...scope, id: localComment.id, expectedUpdatedAt: unlinkedComment!.updatedAt.toISOString(), body: [{ type: "text", text: "Still local" }], files: [] });
  await worker.tick();
  assert.equal(remoteComments.get(remotes[0].id)!.length, 1);
  assert.ok((await status()).entries.some(e => e.entityId === localComment.id && e.status === "failed"));
  // Disabled actions do not enqueue; turning Off cancels queued changes.
  await worker.save("owner", p.id, provider, { ...config, actions: ["issue.update"] });
  const before = (await status()).entries.length;
  await newIssue("Not exported"); assert.equal((await status()).entries.length, before);
  await issues.update("member", { projectId: p.id, id: scheduledIssue.id, expectedUpdatedAt: scheduledIssue.updatedAt, title: "Cancelled export" });
  await worker.save("owner", p.id, provider, { ...config, mode: "off" });
  await worker.tick(); assert.ok((await status()).counts.cancelled > 0);
  // Export settings do not grant a removed owner continuing background access.
  await worker.save("owner", p.id, provider, config); const blocked = await newIssue("Revoked owner");
  await db.delete(s.projectMember).where(and(eq(s.projectMember.projectId, p.id), eq(s.projectMember.userId, "owner")));
  await worker.tick();
  const [job] = await db.select().from(s.exportJob).where(eq(s.exportJob.entityId, blocked.id)); assert.equal(job!.status, "failed");
});
