import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import type { CommentBody, CommentSummary } from "@spectron/shared";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export async function commentSyncStates(tx: Tx, projectId: string, rows: {id: string; body: CommentBody}[]) {
  const states = new Map<string, NonNullable<CommentSummary["jiraSync"]>>();
  if (!rows.length) return states;
  const [connection] = await tx.select({id:s.jiraIntegration.id}).from(s.jiraIntegration).where(eq(s.jiraIntegration.projectId, projectId));
  if (!connection) return states;
  const ids = rows.map(r=>r.id);
  const records = await tx.select().from(s.integrationRecord).where(and(eq(s.integrationRecord.integrationId, connection.id), eq(s.integrationRecord.kind,"comment"), inArray(s.integrationRecord.localId, ids)));
  const jobs = await tx.select({entityId:s.exportJob.entityId,status:s.exportJob.status,createdAt:s.exportJob.createdAt})
    .from(s.exportJob).innerJoin(s.exportSetting,eq(s.exportSetting.id,s.exportJob.settingId))
    .where(and(eq(s.exportSetting.projectId,projectId),eq(s.exportSetting.provider,"jira"),inArray(s.exportJob.entityId,ids)));
  for (const row of rows) {
    const record = records.find(r=>r.localId===row.id);
    if (record?.externalId && record.localHash===canonical(row.body)) { states.set(row.id,"synced"); continue; }
    const latest = jobs.filter(j=>j.entityId===row.id).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime())[0];
    states.set(row.id, latest?.status === "running" ? "syncing" : latest?.status === "pending" ? "pending" : latest?.status === "failed" ? "failed" : "unsynced");
  }
  return states;
}
