import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import { createId, type GitConnectionInput, type GitConnectionRef, type GitConnectionSummary, type GitRepository } from "@spectron/shared";
import { ProjectAccessError } from "../projects";
import { IssueConflictError, IssueInputError } from "../issues";
import { decryptGitToken, encryptGitToken } from "./credentials";
import { createGitAdapterFactory, validateBranch, type GitAdapterFactory } from "./provider";
import { normalizeGitBaseURL } from "./transport";
const { gitConnection: c, gitRepository: r, project: p, projectMember: m } = schema;
type Connection = typeof c.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const binding = (row: Pick<Connection, "id" | "projectId" | "creatorId" | "provider" | "baseURL">) => JSON.stringify(["git", row.projectId, row.id, row.creatorId, row.provider, row.baseURL]);
const summary = (row: Connection): GitConnectionSummary => ({ id: row.id, projectId: row.projectId, creatorId: row.creatorId, name: row.name, provider: row.provider, baseURL: row.baseURL, revision: row.revision, actor: row.actor, commitAuthorName: row.commitAuthorName, commitAuthorEmail: row.commitAuthorEmail, checkStatus: row.checkStatus, checkedAt: row.checkedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() });
const repoSummary = (row: typeof r.$inferSelect, provider: Connection["provider"]): GitRepository => ({ id: row.id, projectId: row.projectId, connectionId: row.connectionId, externalId: row.externalId, fullName: row.fullName, webURL: row.webURL, cloneURL: row.cloneURL, defaultBranch: row.defaultBranch, targetBranch: row.targetBranch, archived: row.archived, isDefault: row.isDefault, revision: row.revision, provider });
function name(value: string) { const s = value.trim(); if (!s || s.length > 255 || /[\x00-\x1f\x7f<>]/.test(s)) throw new IssueInputError("Enter a name without control characters or angle brackets."); return s; }
function authorEmail(value: string) { const s = value.trim(); if (s.length > 254 || !/^[^\s<>@]+@[^\s<>@]+$/.test(s)) throw new IssueInputError("Enter a valid commit author email associated with the provider account."); return s; }
export function createGitService(db: Database, secret?: string, factory: GitAdapterFactory = createGitAdapterFactory()) {
  async function access(userId: string, projectId: string, owner: boolean, tx?: Tx) {
    const query = (tx ?? db).select({ id: p.id }).from(p).innerJoin(m, eq(m.projectId, p.id)).where(and(eq(p.id, projectId), eq(p.state, "active"), eq(m.userId, userId), owner ? eq(m.role, "owner") : undefined));
    // Serialize settings writes with project archival and other settings writes;
    // lock membership too so revocation cannot race the final configuration save.
    const rows = await (tx ? query.for("update") : query);
    if (!rows.length) throw new ProjectAccessError("Project not found or you cannot manage its Git settings.");
  }
  async function connection(userId: string, ref: GitConnectionRef, tx?: Tx) {
    await access(userId, ref.projectId, true, tx);
    const [row] = await (tx ?? db).select().from(c).where(and(eq(c.projectId, ref.projectId), eq(c.id, ref.id)));
    if (!row) throw new ProjectAccessError("Git connection not found.");
    if (row.revision !== ref.revision) throw new IssueConflictError("Git settings changed. Reload before continuing.");
    return row;
  }
  const adapter = (row: Connection) => factory(row, decryptGitToken(row.encryptedToken, binding(row), secret));
  async function repository(userId: string, ref: GitConnectionRef, tx?: Tx) {
    await access(userId, ref.projectId, true, tx);
    const [row] = await (tx ?? db).select().from(r).where(and(eq(r.projectId, ref.projectId), eq(r.id, ref.id)));
    if (!row) throw new ProjectAccessError("Project repository not found.");
    if (row.revision !== ref.revision) throw new IssueConflictError("Repository settings changed. Reload before continuing.");
    return row;
  }
  async function promoteDefault(tx: Tx, projectId: string) {
    const rows = await tx.select().from(r).where(eq(r.projectId, projectId)).orderBy(asc(r.createdAt), asc(r.id));
    if (rows.length && !rows.some(row => row.isDefault)) await tx.update(r).set({ isDefault: true, revision: sql`${r.revision} + 1` }).where(eq(r.id, rows[0]!.id));
  }
  const service = {
    async connections(userId: string, projectId: string) {
      await access(userId, projectId, true);
      return (await db.select().from(c).where(eq(c.projectId, projectId)).orderBy(asc(c.createdAt), asc(c.id))).map(summary);
    },
    async createConnection(userId: string, projectId: string, input: GitConnectionInput) {
      await access(userId, projectId, true);
      const values = { id: createId(), projectId, creatorId: userId, name: name(input.name), provider: input.provider, baseURL: normalizeGitBaseURL(input.provider, input.baseURL) };
      const encryptedToken = encryptGitToken(input.token, binding(values), secret);
      return db.transaction(async tx => {
        await access(userId, projectId, true, tx);
        const [row] = await tx.insert(c).values({ ...values, encryptedToken }).returning(); return summary(row!);
      });
    },
    async updateConnection(userId: string, ref: GitConnectionRef & { name: string; token?: string | undefined; commitAuthorName: string; commitAuthorEmail: string }) {
      return db.transaction(async tx => {
        const row = await connection(userId, ref, tx);
        const replacement = ref.token === undefined ? {} : {
          creatorId: userId, encryptedToken: encryptGitToken(ref.token, binding({ ...row, creatorId: userId }), secret),
          actor: null, checkedAt: null, checkStatus: "untested" as const,
          commitAuthorName: "", commitAuthorEmail: "",
        };
        const [saved] = await tx.update(c).set({ name: name(ref.name),
          commitAuthorName: ref.commitAuthorName ? name(ref.commitAuthorName) : "",
          commitAuthorEmail: ref.commitAuthorEmail ? authorEmail(ref.commitAuthorEmail) : "",
          ...replacement, revision: row.revision + 1 }).where(eq(c.id, row.id)).returning();
        return summary(saved!);
      });
    },
    async checkConnection(userId: string, ref: GitConnectionRef) {
      const row = await connection(userId, ref);
      let actor = null, message = "Provider identity verified. Repository and branch access are checked when you select them; push and PR permissions are not tested.", status: "passed" | "failed" = "passed";
      try { actor = await adapter(row).actor(); }
      catch (error) { status = "failed"; message = error instanceof IssueInputError ? error.message : "Could not check this Git connection. Try again."; }
      return db.transaction(async tx => {
        await connection(userId, ref, tx);
        const changedActor = actor && row.actor && actor.id !== row.actor.id;
        const [saved] = await tx.update(c).set({ actor, checkStatus: status, checkedAt: new Date(), revision: row.revision + 1,
          ...(actor ? { commitAuthorName: changedActor ? actor.name.replace(/[<>]/g, "").trim() : row.commitAuthorName || actor.name.replace(/[<>]/g, "").trim(),
            commitAuthorEmail: changedActor ? actor.email || "" : row.commitAuthorEmail || actor.email || "" } : {}),
        }).where(eq(c.id, row.id)).returning();
        return { connection: summary(saved!), message };
      });
    },
    async deleteConnection(userId: string, ref: GitConnectionRef) {
      await db.transaction(async tx => {
        const row = await connection(userId, ref, tx);
        const [used] = await tx.select({ id: r.id }).from(r).where(eq(r.connectionId, row.id)).limit(1);
        if (used) throw new IssueInputError("Remove this connection's project repositories before deleting it.");
        await tx.delete(c).where(eq(c.id, row.id));
      });
    },
    async browse(userId: string, ref: GitConnectionRef & { page: number }) {
      const row = await connection(userId, ref);
      if (row.checkStatus !== "passed") throw new IssueInputError("Check the connection before browsing repositories.");
      const result = await adapter(row).repositories(ref.page);
      await connection(userId, ref); return result;
    },
    async repositories(userId: string, projectId: string): Promise<GitRepository[]> {
      await access(userId, projectId, false);
      const rows = await db.select({ repo: r, provider: c.provider }).from(r).innerJoin(c, and(eq(c.id, r.connectionId), eq(c.projectId, r.projectId))).where(eq(r.projectId, projectId)).orderBy(asc(r.createdAt), asc(r.id));
      return rows.map(row => repoSummary(row.repo, row.provider));
    },
    async addRepository(userId: string, ref: GitConnectionRef & { fullName: string; externalId: string }) {
      const row = await connection(userId, ref);
      if (row.checkStatus !== "passed" || !row.actor) throw new IssueInputError("Check the connection before selecting repositories.");
      const client = adapter(row), remote = await client.repository(ref.fullName, ref.externalId);
      if (!remote.defaultBranch) throw new IssueInputError("This repository has no default branch. Create its initial branch on the provider first.");
      await client.branch(remote, remote.defaultBranch);
      return db.transaction(async tx => {
        await connection(userId, ref, tx);
        const existing = await tx.select({ id: r.id, connectionId: r.connectionId, externalId: r.externalId, baseURL: c.baseURL, provider: c.provider }).from(r).innerJoin(c, eq(c.id, r.connectionId)).where(eq(r.projectId, ref.projectId));
        if (existing.some(v => v.externalId === remote.externalId && v.provider === row.provider && v.baseURL === row.baseURL)) throw new IssueInputError("This repository is already selected for the project.");
        const [saved] = await tx.insert(r).values({ ...remote, projectId: ref.projectId, connectionId: row.id, targetBranch: remote.defaultBranch!, isDefault: !existing.length }).returning();
        return repoSummary(saved!, row.provider);
      });
    },
    async updateRepository(userId: string, ref: GitConnectionRef & { targetBranch: string; isDefault: boolean }) {
      const repo = await repository(userId, ref);
      const [row] = await db.select().from(c).where(eq(c.id, repo.connectionId));
      if (!row) throw new ProjectAccessError("Git connection not found.");
      const client = adapter(row), remote = await client.repository(repo.fullName, repo.externalId);
      await client.branch(remote, validateBranch(ref.targetBranch));
      await db.transaction(async tx => {
        await repository(userId, ref, tx);
        await connection(userId, { projectId: ref.projectId, id: row.id, revision: row.revision }, tx);
        if (repo.isDefault && !ref.isDefault) throw new IssueInputError("Choose another repository as the project default first.");
        if (ref.isDefault) await tx.update(r).set({ isDefault: false, revision: sql`${r.revision} + 1` }).where(and(eq(r.projectId, ref.projectId), eq(r.isDefault, true)));
        await tx.update(r).set({ ...remote, targetBranch: ref.targetBranch, isDefault: ref.isDefault, revision: repo.revision + 1 }).where(eq(r.id, repo.id));
      });
    },
    async removeRepository(userId: string, ref: GitConnectionRef) {
      await db.transaction(async tx => { const row = await repository(userId, ref, tx); await tx.delete(r).where(eq(r.id, row.id)); await promoteDefault(tx, ref.projectId); });
    },
    // Use at invocation time, never trust earlier composer discovery. This
    // returns scoped metadata only; future runners must recheck remote access.
    async authorizeRepositories(userId: string, projectId: string, ids: string[]) {
      if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw new IssueInputError("Select between 1 and 50 distinct project repositories.");
      await access(userId, projectId, false);
      const rows = await db.select({ repo: r, provider: c.provider }).from(r).innerJoin(c, eq(c.id, r.connectionId)).where(and(eq(r.projectId, projectId), inArray(r.id, ids)));
      if (rows.length !== ids.length) throw new ProjectAccessError("One or more repositories are outside this project.");
      return ids.map(id => { const row = rows.find(v => v.repo.id === id)!; return repoSummary(row.repo, row.provider); });
    },
  };
  return service;
}
export type GitService = ReturnType<typeof createGitService>;
