import { and, eq } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import type { ExportProvider } from "@spectron/shared";
import { IssueConflictError, IssueInputError } from "../issues";
type Log = typeof s.issueWorklog.$inferSelect;
export async function exportWorklog<R extends { id: string }>(db: Database, input: {
  provider: ExportProvider; projectId: string; row: Log; remove: boolean;
  list: () => Promise<R[]>; create: () => Promise<R>; delete: (id: string) => Promise<void>;
  fingerprint: (remote: R) => string;
  imported?: { externalId: string | null; remoteHash: string | null } | undefined;
  linked?: ((remote: R) => Promise<void>) | undefined;
  reconcileId?: string | undefined;
}) {
  const { row } = input;
  // Tracker worklog IDs are scoped to their issue; qualify them in the checkpoint.
  const storedId = (id: string) => input.provider === "tracker" ? `${row.issueId}/${id}` : id;
  const remoteId = (id: string) => input.provider === "tracker" ? id.slice(row.issueId.length + 1) : id;
  const scope = and(eq(s.exportWorklog.projectId, input.projectId), eq(s.exportWorklog.provider, input.provider), eq(s.exportWorklog.localId, row.id));
  let [link] = await db.select().from(s.exportWorklog).where(scope);
  if (!link) {
    [link] = await db.insert(s.exportWorklog).values({ projectId: input.projectId, provider: input.provider, localId: row.id, externalId: input.imported?.externalId ? storedId(input.imported.externalId) : null, remoteVersion: input.imported?.remoteHash ?? null }).returning();
  }
  if (!link) throw new Error("Worklog checkpoint unavailable.");
  if (input.reconcileId) {
    if (!link.pendingCreate) throw new IssueInputError("No uncertain worklog create to reconcile.");
    const remote = (await input.list()).find(r => String(r.id) === input.reconcileId);
    if (!remote) throw new IssueInputError("Worklog not found on the linked issue.");
    await db.update(s.exportWorklog).set({ externalId: storedId(String(remote.id)), remoteVersion: input.fingerprint(remote), pendingCreate: false }).where(scope);
    await input.linked?.(remote);
    return;
  }
  if (link.pendingCreate) throw new IssueConflictError("Worklog create needs reconciliation: enter its remote worklog ID in the export log before retrying.");
  if (input.remove) {
    if (!row.deletedAt) return; // Restored before the queue reached this deletion.
    if (!link.externalId || link.remoteVersion === "deleted") return;
    const remote = (await input.list()).find(r => String(r.id) === remoteId(link.externalId!));
    if (remote) {
      if (link.remoteVersion && input.fingerprint(remote) !== link.remoteVersion) throw new IssueConflictError("Remote worklog changed. Import/review it before deleting; export will not overwrite the change.");
      await input.delete(remoteId(link.externalId));
    }
    await db.update(s.exportWorklog).set({ remoteVersion: "deleted", updatedAt: new Date() }).where(scope);
    return;
  }
  if (row.deletedAt || link.remoteVersion === "deleted") return;
  if (link.externalId) {
    const remote = (await input.list()).find(r => String(r.id) === remoteId(link.externalId!));
    if (!remote) throw new IssueConflictError("Exported worklog no longer exists remotely.");
    await input.linked?.(remote);
    return;
  }
  await db.update(s.exportWorklog).set({ pendingCreate: true }).where(scope);
  let remote: R;
  try { remote = await input.create(); }
  catch (error) {
    // These responses definitively reject creation. A timeout/5xx stays uncertain.
    if (error && typeof error === "object" && "status" in error && [400,401,403,404,422,429].includes(Number(error.status))) await db.update(s.exportWorklog).set({ pendingCreate: false }).where(scope);
    throw error;
  }
  await db.update(s.exportWorklog).set({ externalId: storedId(String(remote.id)), remoteVersion: input.fingerprint(remote), pendingCreate: false, updatedAt: new Date() }).where(scope);
  await input.linked?.(remote);
}
