import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  createId,
  type AgentRunScope,
  type FeedbackComment,
  type FeedbackSelection,
  type GitActionInput,
  type GitReplyInput,
  type GitWorkspaceRef,
  type GitWorkspaceView,
} from "@spectron/shared";
import { runAccess, type RunDB } from "../agent-runs/service";
import { IssueConflictError, IssueInputError } from "../issues";
import { ProjectAccessError } from "../projects";
import { createGitService } from "./service";
import { createGitAdapterFactory, type GitAdapterFactory } from "./provider";
import { decryptGitToken, encryptGitToken } from "./credentials";
const {
  agentWorkspace: w,
  gitDiscussion: d,
  gitReplyDraft: reply,
  gitOperation: op,
  gitConnection: c,
  gitRepository: repo,
  projectMember: member,
} = schema;
type Workspace = typeof w.$inferSelect;
type Operation = typeof op.$inferSelect;
export async function selectedFeedback(
  db: RunDB,
  userId: string,
  scope: AgentRunScope,
  selections: FeedbackSelection[],
): Promise<FeedbackComment[]> {
  await runAccess(db, userId, scope, true);
  if (
    !selections.length ||
    selections.length > 50 ||
    new Set(selections.map((s) => `${s.discussionId}:${s.noteId}`)).size !==
      selections.length
  )
    throw new IssueInputError("Select 1–50 distinct comments.");
  const rows = await db
    .select({ discussion: d, workspace: w })
    .from(d)
    .innerJoin(w, eq(d.workspaceId, w.id))
    .where(
      and(
        eq(w.projectId, scope.projectId),
        eq(w.issueId, scope.issueId),
        inArray(
          d.id,
          selections.map((s) => s.discussionId),
        ),
      ),
    );
  return selections.map((s) => {
    const row = rows.find((r) => r.discussion.id === s.discussionId),
      note = row?.discussion.data.notes.find((n) => n.id === s.noteId);
    if (!row || !note)
      throw new ProjectAccessError(
        "A selected comment is no longer available in this issue.",
      );
    return {
      ...s,
      workspaceId: row.workspace.id,
      repositoryId: row.workspace.repositoryId,
      body: note.body,
      author: note.author.name,
      url: note.url,
      path: row.discussion.data.path,
      line: row.discussion.data.line,
    };
  });
}
export function createGitWorkflow(
  db: Database,
  secret?: string,
  factory: GitAdapterFactory = createGitAdapterFactory(),
) {
  async function access(
    tx: RunDB,
    userId: string,
    ref: GitWorkspaceRef,
    open = false,
  ) {
    const issue = await runAccess(tx, userId, ref, open, true);
    const [workspace] = await tx
      .select()
      .from(w)
      .where(
        and(
          eq(w.id, ref.workspaceId),
          eq(w.projectId, ref.projectId),
          eq(w.issueId, ref.issueId),
        ),
      )
      .for("update");
    if (!workspace?.pull)
      throw new ProjectAccessError("Linked PR/MR not found.");
    const [membership] = await tx
      .select()
      .from(member)
      .where(
        and(eq(member.projectId, ref.projectId), eq(member.userId, userId)),
      )
      .for("share");
    await createGitService(tx as Database).authorizeRepositories(
      userId,
      ref.projectId,
      [workspace.repositoryId],
    );
    return {
      workspace,
      canManage: issue.role === "owner",
      canMerge: issue.role === "owner" || membership?.canMerge === true,
    };
  }
  async function client(workspace: Workspace) {
    const [row] = await db
      .select({ repo, connection: c })
      .from(repo)
      .innerJoin(c, eq(repo.connectionId, c.id))
      .where(
        and(
          eq(repo.id, workspace.repositoryId),
          eq(repo.projectId, workspace.projectId),
        ),
      );
    if (!row)
      throw new ProjectAccessError("Repository connection unavailable.");
    const connection = row.connection;
    const token = decryptGitToken(
      connection.encryptedToken,
      JSON.stringify([
        "git",
        connection.projectId,
        connection.id,
        connection.creatorId,
        connection.provider,
        connection.baseURL,
      ]),
      secret,
    );
    const adapter = factory(connection, token).activity;
    if (!adapter)
      throw new IssueInputError("Provider collaboration is unavailable.");
    return { ...row, adapter };
  }
  async function sync(workspaceId: string, force = false) {
    const claim = createId();
    const [workspace] = await db
      .update(w)
      .set({ syncClaim: claim, syncLeaseUntil: new Date(Date.now() + 300000) })
      .where(
        and(
          eq(w.id, workspaceId),
          or(isNull(w.syncClaim), lt(w.syncLeaseUntil, new Date())),
          force ? undefined : lt(w.nextSyncAt, new Date()),
          sql`${w.pull} IS NOT NULL`,
          sql`EXISTS (SELECT 1 FROM projects p JOIN issues i ON i.project_id=p.id WHERE p.id=${w.projectId} AND p.state='active' AND i.id=${w.issueId} AND i.deleted_at IS NULL)`,
        ),
      )
      .returning();
    if (!workspace?.pull) {
      if (force)
        throw new IssueConflictError(
          "Synchronization is already in progress or the issue is unavailable. Try again shortly.",
        );
      return;
    }
    try {
      const { repo: repository, connection, adapter } = await client(workspace);
      const unchanged =
        !force &&
        adapter.probe &&
        workspace.activity?.providerVersion &&
        workspace.syncedVersion === workspace.syncVersion &&
        workspace.syncedAt &&
        workspace.syncedAt.getTime() > Date.now() - 3600000 &&
        (await adapter.probe(repository, workspace.pull.number)) ===
          workspace.activity.providerVersion;
      if (unchanged) {
        await db
          .update(w)
          .set({
            syncClaim: null,
            syncLeaseUntil: null,
            syncError: null,
            nextSyncAt: sql`CASE WHEN ${w.syncVersion} <> ${workspace.syncVersion} THEN now() ELSE ${new Date(Date.now() + 300000).toISOString()}::timestamptz END`,
          })
          .where(and(eq(w.id, workspaceId), eq(w.syncClaim, claim)));
        return;
      }
      const snapshot = await adapter.snapshot(
        repository,
        workspace.pull.number,
      );
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(w)
          .where(and(eq(w.id, workspaceId), eq(w.syncClaim, claim)))
          .for("update");
        if (!current) return;
        const [currentConnection] = await tx
          .select()
          .from(c)
          .where(eq(c.id, connection.id))
          .for("share");
        const [currentRepository] = await tx
          .select()
          .from(repo)
          .where(eq(repo.id, repository.id))
          .for("share");
        if (
          currentConnection?.revision !== connection.revision ||
          currentRepository?.revision !== repository.revision
        )
          throw new IssueConflictError(
            "Git settings changed during synchronization.",
          );
        const seen = new Set<string>();
        for (const discussion of snapshot.discussions) {
          seen.add(discussion.externalId);
          await tx
            .insert(d)
            .values({
              workspaceId,
              externalId: discussion.externalId,
              data: discussion,
            })
            .onConflictDoUpdate({
              target: [d.workspaceId, d.externalId],
              set: { data: discussion, updatedAt: new Date() },
            });
          for (const note of discussion.notes) {
            const replyMarker =
              /<!-- spectron-reply:([A-Za-z0-9_-]{21}) -->/.exec(note.body);
            if (replyMarker)
              await tx
                .update(reply)
                .set({
                  state: "published",
                  externalId: note.id,
                  error: null,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(reply.id, replyMarker[1]!),
                    inArray(reply.state, ["publishing", "uncertain"]),
                    sql`${reply.discussionId} IN (SELECT id FROM git_discussions WHERE workspace_id=${workspaceId})`,
                  ),
                );
            const findingMarker =
              /<!-- spectron-review:([A-Za-z0-9_-]{21}) -->/.exec(note.body);
            if (findingMarker)
              await tx
                .update(schema.agentReviewFinding)
                .set({
                  state: "published",
                  externalId: note.id,
                  externalURL: note.url,
                  error: null,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.agentReviewFinding.id, findingMarker[1]!),
                    inArray(schema.agentReviewFinding.state, [
                      "publishing",
                      "uncertain",
                    ]),
                    sql`${schema.agentReviewFinding.runId} IN (SELECT id FROM agent_runs WHERE review->>'workspaceId'=${workspaceId})`,
                  ),
                );
          }
        }
        for (const old of await tx
          .select()
          .from(d)
          .where(eq(d.workspaceId, workspaceId)))
          if (!seen.has(old.externalId))
            await tx
              .update(d)
              .set({
                data: {
                  ...old.data,
                  notes: [],
                  resolved: true,
                  resolvable: false,
                },
                updatedAt: new Date(),
              })
              .where(eq(d.id, old.id));
        await tx
          .update(w)
          .set({
            activity: snapshot.activity,
            pull: snapshot.activity.pull,
            syncedAt: new Date(),
            syncClaim: null,
            syncLeaseUntil: null,
            syncError: null,
            syncedVersion: workspace.syncVersion,
            nextSyncAt:
              current.syncVersion !== workspace.syncVersion
                ? new Date(0)
                : snapshot.activity.pull.state === "open"
                  ? new Date(Date.now() + 300000)
                  : null,
          })
          .where(and(eq(w.id, workspaceId), eq(w.syncClaim, claim)));
      });
    } catch (error) {
      await db
        .update(w)
        .set({
          syncClaim: null,
          syncLeaseUntil: null,
          syncError:
            error instanceof IssueInputError
              ? error.message
              : "Could not synchronize provider activity. Retry refresh.",
          nextSyncAt: sql`CASE WHEN ${w.syncVersion} <> ${workspace.syncVersion} THEN now() WHEN ${w.pull}->>'state' IN ('closed', 'merged') THEN NULL ELSE ${new Date(Date.now() + 900000).toISOString()}::timestamptz END`,
        })
        .where(and(eq(w.id, workspaceId), eq(w.syncClaim, claim)));
      if (force)
        throw new IssueInputError(
          "Could not synchronize provider activity. Check connection permissions and retry.",
        );
    }
  }
  async function finish(
    operation: Operation,
    state: Operation["state"],
    error: string | null = null,
  ) {
    return db.transaction(async (tx) => {
      const [saved] = await tx
        .update(op)
        .set({ state, error, updatedAt: new Date() })
        .where(
          and(eq(op.id, operation.id), eq(op.attemptId, operation.attemptId)),
        )
        .returning({ id: op.id });
      if (!saved) return false;
      if (
        state === "completed" ||
        state === "failed" ||
        (state === "uncertain" && operation.kind === "reply")
      )
        await tx
          .update(w)
          .set({
            operationId: null,
            nextSyncAt: new Date(),
            syncVersion: sql`${w.syncVersion}+1`,
          })
          .where(
            and(
              eq(w.id, operation.workspaceId),
              eq(w.operationId, operation.id),
            ),
          );
      if (operation.payload.replyId && state === "uncertain")
        await tx
          .update(reply)
          .set({ state: "uncertain", error, updatedAt: new Date() })
          .where(
            and(
              eq(reply.id, operation.payload.replyId),
              eq(reply.state, "publishing"),
            ),
          );
      return true;
    });
  }
  async function dispatch(
    userId: string,
    ref: GitWorkspaceRef,
    operation: Operation,
  ) {
    let sent = false;
    try {
      const current = await db.transaction((tx) =>
        access(tx, userId, ref, true),
      );
      const {
        repo: repository,
        connection,
        adapter,
      } = await client(current.workspace);
      const snapshot = await adapter.snapshot(
        repository,
        current.workspace.pull!.number,
      );
      const activity = snapshot.activity,
        payload = operation.payload;
      if (activity.pull.head !== payload.expectedHead)
        throw new IssueConflictError(
          "The PR/MR has a newer commit. Refresh and review it before taking this action.",
        );
      if (activity.pull.state !== "open")
        throw new IssueInputError(
          "The PR/MR is no longer open. Refresh its state.",
        );
      const [thread] = payload.discussionId
        ? await db
            .select()
            .from(d)
            .where(
              and(
                eq(d.id, payload.discussionId),
                eq(d.workspaceId, ref.workspaceId),
              ),
            )
        : [];
      const remoteThread = thread
        ? snapshot.discussions.find((t) => t.externalId === thread.externalId)
        : undefined;
      if (
        ["reply", "resolve", "reopen"].includes(operation.kind) &&
        !remoteThread
      )
        throw new IssueInputError("This provider discussion no longer exists.");
      if (
        ["resolve", "reopen"].includes(operation.kind) &&
        !remoteThread?.resolvable
      )
        throw new IssueInputError(
          "This discussion cannot be resolved with the current provider identity.",
        );
      if (
        operation.kind === "merge" &&
        (!activity.mergeable ||
          !payload.mergeMethod ||
          !activity.mergeMethods.includes(payload.mergeMethod))
      )
        throw new IssueInputError(activity.mergeReason);
      await db.transaction(async (tx) => {
        const latest = await access(tx, userId, ref, true);
        if (latest.workspace.operationId !== operation.id)
          throw new IssueConflictError("Action ownership was lost.");
        if (
          ["merge", "ready", "close"].includes(operation.kind) &&
          latest.workspace.ownerRunId
        )
          throw new IssueInputError(
            "Stop the active writer and wait for cleanup before changing PR/MR state.",
          );
        if (operation.kind === "merge" && !latest.canMerge)
          throw new ProjectAccessError("You do not have Can merge permission.");
        if (["ready", "close"].includes(operation.kind) && !latest.canManage)
          throw new ProjectAccessError(
            "Only project owners can mark ready or close PR/MRs.",
          );
        const [activeConnection] = await tx
          .select()
          .from(c)
          .where(eq(c.id, connection.id))
          .for("share");
        const [activeRepo] = await tx
          .select()
          .from(repo)
          .where(eq(repo.id, repository.id))
          .for("share");
        if (
          activeConnection?.revision !== connection.revision ||
          activeRepo?.revision !== repository.revision
        )
          throw new IssueConflictError(
            "Git settings changed. Retry after refreshing.",
          );
      });
      const [activeAttempt] = await db
        .update(op)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(op.id, operation.id),
            eq(op.attemptId, operation.attemptId),
            eq(op.state, "dispatching"),
          ),
        )
        .returning();
      if (!activeAttempt)
        throw new IssueConflictError(
          "Action was superseded by reconciliation.",
        );
      sent = true;
      if (operation.kind === "reply") {
        const externalId = await adapter.reply(
          repository,
          activity.pull,
          remoteThread!,
          payload.body!,
        );
        await db
          .update(reply)
          .set({
            state: "published",
            externalId,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(reply.id, payload.replyId!));
      } else if (operation.kind === "resolve" || operation.kind === "reopen")
        await adapter.resolve(
          repository,
          activity.pull,
          remoteThread!,
          operation.kind === "resolve",
        );
      else if (operation.kind === "ready")
        await adapter.ready(repository, activity);
      else if (operation.kind === "close")
        await adapter.close(repository, activity);
      else await adapter.merge(repository, activity, payload.mergeMethod!);
      await finish(operation, "completed");
    } catch (error) {
      const message = sent
        ? "The provider outcome is unconfirmed. Reconcile this action before trying another write."
        : error instanceof IssueInputError ||
            error instanceof IssueConflictError ||
            error instanceof ProjectAccessError
          ? error.message
          : "Action could not be validated.";
      const finished = await finish(
        operation,
        sent ? "uncertain" : "failed",
        message,
      );
      if (finished && !sent && operation.payload.replyId)
        await db
          .update(reply)
          .set({ state: "draft", error: message })
          .where(
            and(
              eq(reply.id, operation.payload.replyId),
              eq(reply.state, "publishing"),
            ),
          );
      throw new IssueInputError(message);
    } finally {
      await sync(ref.workspaceId, true).catch(() => {});
    }
  }
  async function owner(tx: RunDB, userId: string, projectId: string) {
    const [m] = await tx
      .select()
      .from(member)
      .innerJoin(schema.project, eq(member.projectId, schema.project.id))
      .where(
        and(
          eq(member.projectId, projectId),
          eq(member.userId, userId),
          eq(member.role, "owner"),
          eq(schema.project.state, "active"),
        ),
      )
      .for("update");
    if (!m)
      throw new ProjectAccessError(
        "Only current project owners can manage Git permissions and webhooks.",
      );
  }
  const service = {
    async list(
      userId: string,
      scope: AgentRunScope,
    ): Promise<GitWorkspaceView[]> {
      const a = await runAccess(db, userId, scope);
      const [m] = await db
        .select()
        .from(member)
        .where(
          and(eq(member.projectId, scope.projectId), eq(member.userId, userId)),
        );
      const workspaces = await db
        .select({ workspace: w, repository: repo, provider: c.provider })
        .from(w)
        .innerJoin(repo, eq(repo.id, w.repositoryId))
        .innerJoin(c, eq(c.id, repo.connectionId))
        .where(
          and(
            eq(w.issueId, scope.issueId),
            eq(w.projectId, scope.projectId),
            sql`${w.pull} IS NOT NULL`,
          ),
        )
        .orderBy(asc(w.createdAt));
      return Promise.all(
        workspaces.map(async ({ workspace, repository, provider }) => {
          const threads = await db
            .select()
            .from(d)
            .where(eq(d.workspaceId, workspace.id))
            .orderBy(asc(d.createdAt));
          const drafts = threads.length
            ? await db
                .select()
                .from(reply)
                .where(
                  inArray(
                    reply.discussionId,
                    threads.map((t) => t.id),
                  ),
                )
            : [];
          const users = await db
            .select({ id: schema.user.id, name: schema.user.name })
            .from(schema.user)
            .innerJoin(member, eq(member.userId, schema.user.id))
            .where(eq(member.projectId, scope.projectId));
          const operations = await db
            .select()
            .from(op)
            .where(eq(op.workspaceId, workspace.id))
            .orderBy(asc(op.createdAt));
          return {
            id: workspace.id,
            repositoryId: repository.id,
            repositoryName: repository.fullName,
            provider,
            activity: workspace.activity,
            pull: workspace.pull!,
            syncedAt: workspace.syncedAt?.toISOString() ?? null,
            syncing:
              !!workspace.syncClaim &&
              !!workspace.syncLeaseUntil &&
              workspace.syncLeaseUntil > new Date(),
            error: workspace.syncError,
            discussions: threads
              .filter((t) => t.data.notes.length)
              .map((t) => ({
                ...t.data,
                id: t.id,
                workspaceId: t.workspaceId,
              })),
            replies: drafts
              .filter((r) => !r.discardedAt)
              .map(({ createdAt, updatedAt, discardedAt, ...r }) => r),
            operations: operations.map(
              ({
                requestId,
                attemptId,
                payload,
                workspaceId,
                updatedAt,
                createdAt,
                ...o
              }) => ({
                ...o,
                requesterName:
                  users.find((u) => u.id === o.requesterId)?.name ??
                  "Former project member",
                createdAt: createdAt.toISOString(),
              }),
            ),
            canManage: a.role === "owner",
            canMerge: a.role === "owner" || m?.canMerge === true,
            writerRunId: workspace.ownerRunId,
          };
        }),
      );
    },
    async refresh(userId: string, ref: GitWorkspaceRef) {
      await db.transaction((tx) => access(tx, userId, ref));
      await sync(ref.workspaceId, true);
    },
    async discardReply(
      userId: string,
      args: GitWorkspaceRef & { id: string; revision: number },
    ) {
      // Reconcile once more before hiding the draft. Keep the row/marker for late provider recovery.
      await db.transaction(async (tx) => {
        const a = await access(tx, userId, args, true);
        const [draft] = await tx
          .select({ reply })
          .from(reply)
          .innerJoin(d, eq(reply.discussionId, d.id))
          .where(
            and(eq(reply.id, args.id), eq(d.workspaceId, args.workspaceId)),
          );
        if (!draft || (!a.canManage && draft.reply.authorId !== userId))
          throw new ProjectAccessError(
            "Reply not found or owned by another member.",
          );
        if (
          draft.reply.state !== "uncertain" ||
          draft.reply.revision !== args.revision
        )
          throw new IssueConflictError(
            "Only an unchanged uncertain reply can be discarded.",
          );
      });
      await sync(args.workspaceId, true);
      await db.transaction(async (tx) => {
        const a = await access(tx, userId, args, true);
        const [saved] = await tx
          .update(reply)
          .set({
            discardedAt: new Date(),
            revision: sql`${reply.revision}+1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(reply.id, args.id),
              eq(reply.revision, args.revision),
              eq(reply.state, "uncertain"),
              isNull(reply.discardedAt),
              a.canManage ? undefined : eq(reply.authorId, userId),
              sql`${reply.discussionId} IN (SELECT id FROM git_discussions WHERE workspace_id=${args.workspaceId})`,
            ),
          )
          .returning();
        if (!saved)
          throw new IssueConflictError(
            "The reply changed or was found on the provider. Refresh its status.",
          );
      });
    },
    async saveReply(userId: string, args: GitReplyInput) {
      if (!args.body.trim() || args.body.length > 20000)
        throw new IssueInputError("Enter a reply up to 20,000 characters.");
      return db.transaction(async (tx) => {
        const a = await access(tx, userId, args, true);
        const [thread] = await tx
          .select()
          .from(d)
          .where(
            and(
              eq(d.id, args.discussionId),
              eq(d.workspaceId, args.workspaceId),
            ),
          );
        if (!thread?.data.notes.length)
          throw new ProjectAccessError("Discussion not found.");
        if (args.id) {
          const [saved] = await tx
            .update(reply)
            .set({
              body: args.body.trim(),
              revision: sql`${reply.revision}+1`,
              error: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(reply.id, args.id),
                eq(reply.discussionId, args.discussionId),
                eq(reply.state, "draft"),
                isNull(reply.discardedAt),
                eq(reply.revision, args.revision ?? 0),
                a.canManage ? undefined : eq(reply.authorId, userId),
              ),
            )
            .returning({ id: reply.id });
          if (!saved)
            throw new IssueConflictError(
              "This reply changed, was published, or belongs to another member.",
            );
          return saved;
        }
        const [created] = await tx
          .insert(reply)
          .values({
            discussionId: args.discussionId,
            authorId: userId,
            body: args.body.trim(),
          })
          .returning({ id: reply.id });
        return created!;
      });
    },
    async publishReply(
      userId: string,
      args: GitWorkspaceRef & {
        id: string;
        revision: number;
        requestId: string;
      },
    ) {
      const operation = await db.transaction(async (tx) => {
        const a = await access(tx, userId, args, true);
        const [existing] = await tx
          .select()
          .from(op)
          .where(
            and(eq(op.requesterId, userId), eq(op.requestId, args.requestId)),
          );
        if (existing) {
          if (
            existing.workspaceId !== args.workspaceId ||
            existing.payload.replyId !== args.id
          )
            throw new IssueConflictError("Request ID already used.");
          return null;
        }
        if (a.workspace.operationId)
          throw new IssueConflictError(
            "Another provider action is pending. Reconcile it first.",
          );
        const [draft] = await tx
          .select()
          .from(reply)
          .innerJoin(d, eq(reply.discussionId, d.id))
          .where(
            and(eq(reply.id, args.id), eq(d.workspaceId, args.workspaceId)),
          )
          .for("update");
        if (
          !draft ||
          (!a.canManage && draft.git_reply_drafts.authorId !== userId)
        )
          throw new ProjectAccessError(
            "Reply not found or owned by another member.",
          );
        const r = draft.git_reply_drafts;
        if (r.state === "published") return null;
        if (
          r.discardedAt ||
          r.state !== "draft" ||
          r.revision !== args.revision
        )
          throw new IssueConflictError(
            "Reply changed or has an uncertain publication. Refresh first.",
          );
        const [created] = await tx
          .insert(op)
          .values({
            workspaceId: args.workspaceId,
            requesterId: userId,
            requestId: args.requestId,
            kind: "reply",
            payload: {
              expectedHead: a.workspace.pull!.head,
              discussionId: r.discussionId,
              replyId: r.id,
              body: `${r.body}\n\n<!-- spectron-reply:${r.id} -->`,
            },
          })
          .returning();
        await tx
          .update(w)
          .set({ operationId: created!.id })
          .where(eq(w.id, args.workspaceId));
        await tx
          .update(reply)
          .set({ state: "publishing", revision: r.revision + 1 })
          .where(eq(reply.id, r.id));
        return created!;
      });
      if (operation) await dispatch(userId, args, operation);
    },
    async act(userId: string, args: GitActionInput) {
      const operation = await db.transaction(async (tx) => {
        const a = await access(tx, userId, args, true);
        if (args.kind === "merge" && !a.canMerge)
          throw new ProjectAccessError("You do not have Can merge permission.");
        if (["ready", "close"].includes(args.kind) && !a.canManage)
          throw new ProjectAccessError(
            "Only project owners can mark ready or close PR/MRs.",
          );
        const [existing] = await tx
          .select()
          .from(op)
          .where(
            and(eq(op.requesterId, userId), eq(op.requestId, args.requestId)),
          );
        if (existing) {
          if (
            existing.workspaceId !== args.workspaceId ||
            existing.kind !== args.kind
          )
            throw new IssueConflictError("Request ID already used.");
          return null;
        }
        if (a.workspace.operationId)
          throw new IssueConflictError(
            "Another provider action is pending. Reconcile it first.",
          );
        if (
          ["ready", "merge", "close"].includes(args.kind) &&
          a.workspace.ownerRunId
        )
          throw new IssueInputError(
            "Stop the writer and wait for cleanup first.",
          );
        if (args.expectedHead !== a.workspace.pull!.head)
          throw new IssueConflictError(
            "Displayed commit changed. Refresh before acting.",
          );
        if (["resolve", "reopen"].includes(args.kind) && !args.discussionId)
          throw new IssueInputError("Select a discussion.");
        const [created] = await tx
          .insert(op)
          .values({
            workspaceId: args.workspaceId,
            requesterId: userId,
            requestId: args.requestId,
            kind: args.kind,
            payload: {
              expectedHead: args.expectedHead,
              ...(args.discussionId ? { discussionId: args.discussionId } : {}),
              ...(args.mergeMethod ? { mergeMethod: args.mergeMethod } : {}),
            },
          })
          .returning();
        await tx
          .update(w)
          .set({ operationId: created!.id })
          .where(eq(w.id, args.workspaceId));
        return created!;
      });
      if (operation) await dispatch(userId, args, operation);
    },
    async reconcile(
      userId: string,
      args: GitWorkspaceRef & { id: string; retry?: boolean | undefined },
    ) {
      await db.transaction((tx) => access(tx, userId, args));
      const [observed] = await db
        .select()
        .from(op)
        .where(and(eq(op.id, args.id), eq(op.workspaceId, args.workspaceId)));
      let operation = observed;
      if (!operation) throw new ProjectAccessError("Action not found.");
      if (["completed", "failed"].includes(operation.state)) return;
      if (
        operation.updatedAt.getTime() > Date.now() - 30000 &&
        operation.state === "dispatching"
      )
        throw new IssueConflictError(
          "Action is still in progress. Wait before reconciling.",
        );
      const [claimedReconciliation] = await db
        .update(op)
        .set({
          attemptId: createId(),
          state: "dispatching",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(op.id, operation.id),
            eq(op.attemptId, operation.attemptId),
            eq(op.updatedAt, operation.updatedAt),
          ),
        )
        .returning();
      if (!claimedReconciliation)
        throw new IssueConflictError(
          "Another action is in progress. Refresh first.",
        );
      operation = claimedReconciliation;
      try {
        await sync(args.workspaceId, true);
      } catch (error) {
        await finish(
          operation,
          "uncertain",
          "Could not refresh the provider. Reconcile again when available.",
        );
        throw error;
      }
      const { workspace } = await db.transaction((tx) =>
        access(tx, userId, args),
      );
      const payload = operation.payload;
      const [thread] = payload.discussionId
        ? await db
            .select()
            .from(d)
            .where(
              and(
                eq(d.id, payload.discussionId),
                eq(d.workspaceId, args.workspaceId),
              ),
            )
        : [];
      const [draft] = payload.replyId
        ? await db.select().from(reply).where(eq(reply.id, payload.replyId))
        : [];
      const confirmed =
        operation.kind === "reply"
          ? draft?.state === "published"
          : operation.kind === "resolve"
            ? !!thread?.data.notes.length && thread.data.resolved === true
            : operation.kind === "reopen"
              ? !!thread?.data.notes.length && thread.data.resolved === false
              : operation.kind === "ready"
                ? !workspace.pull!.draft
                : operation.kind === "close"
                  ? workspace.pull!.state === "closed"
                  : workspace.pull!.state === "merged" &&
                    workspace.pull!.head === payload.expectedHead;
      if (confirmed) {
        await finish(operation, "completed");
        return;
      }
      if (
        workspace.pull!.head !== payload.expectedHead ||
        workspace.pull!.state !== "open"
      ) {
        await finish(
          operation,
          "failed",
          "Provider state changed; the original action cannot be safely repeated.",
        );
        return;
      }
      if (args.retry && operation.kind !== "reply") {
        await dispatch(userId, args, operation);
      } else
        await finish(
          operation,
          "uncertain",
          "No confirmed effect found. Replies are never resent; other actions may be explicitly retried after checking the provider.",
        );
    },
    async permissions(userId: string, projectId: string) {
      await db.transaction((tx) => owner(tx, userId, projectId));
      return db
        .select({
          userId: member.userId,
          name: schema.user.name,
          role: member.role,
          canMerge: member.canMerge,
        })
        .from(member)
        .innerJoin(schema.user, eq(member.userId, schema.user.id))
        .where(eq(member.projectId, projectId));
    },
    async setMergeGrant(
      userId: string,
      args: { projectId: string; userId: string; canMerge: boolean },
    ) {
      await db.transaction(async (tx) => {
        await owner(tx, userId, args.projectId);
        const [saved] = await tx
          .update(member)
          .set({ canMerge: args.canMerge })
          .where(
            and(
              eq(member.projectId, args.projectId),
              eq(member.userId, args.userId),
            ),
          )
          .returning();
        if (!saved)
          throw new ProjectAccessError("Current project member not found.");
      });
    },
    async webhookSettings(userId: string, projectId: string) {
      await db.transaction((tx) => owner(tx, userId, projectId));
      return db
        .select({
          id: c.id,
          name: c.name,
          provider: c.provider,
          configured: sql<boolean>`${c.webhookSecret} IS NOT NULL`,
        })
        .from(c)
        .where(eq(c.projectId, projectId));
    },
    async setWebhook(
      userId: string,
      args: { projectId: string; connectionId: string; secret: string | null },
    ) {
      await db.transaction(async (tx) => {
        await owner(tx, userId, args.projectId);
        const [connection] = await tx
          .select()
          .from(c)
          .where(
            and(eq(c.id, args.connectionId), eq(c.projectId, args.projectId)),
          )
          .for("update");
        if (!connection) throw new ProjectAccessError("Connection not found.");
        if (args.secret !== null && args.secret.length < 32)
          throw new IssueInputError(
            "Use a webhook secret of at least 32 characters.",
          );
        await tx
          .update(c)
          .set({
            webhookSecret:
              args.secret === null
                ? null
                : encryptGitToken(
                    args.secret,
                    JSON.stringify([
                      "webhook",
                      connection.projectId,
                      connection.id,
                    ]),
                    secret,
                  ),
          })
          .where(eq(c.id, connection.id));
      });
    },
    async webhook(connectionId: string, headers: Headers, body: string) {
      if (Buffer.byteLength(body) > 1024 * 1024)
        throw new IssueInputError("Webhook too large.");
      const [connection] = await db
        .select()
        .from(c)
        .where(eq(c.id, connectionId));
      if (!connection?.webhookSecret)
        throw new ProjectAccessError("Webhook not configured.");
      const key = decryptGitToken(
        connection.webhookSecret,
        JSON.stringify(["webhook", connection.projectId, connection.id]),
        secret,
      );
      const expected =
        connection.provider === "github"
          ? `sha256=${createHmac("sha256", key).update(body).digest("hex")}`
          : key;
      const received =
        headers.get(
          connection.provider === "github"
            ? "x-hub-signature-256"
            : "x-gitlab-token",
        ) ?? "";
      if (
        Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
      )
        throw new ProjectAccessError("Invalid webhook signature.");
      const delivery = headers.get(
        connection.provider === "github"
          ? "x-github-delivery"
          : "x-gitlab-event-uuid",
      );
      if (!delivery || delivery.length > 255)
        throw new IssueInputError("Delivery ID required.");
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.gitWebhookDelivery)
          .values({ connectionId, deliveryId: delivery })
          .onConflictDoNothing()
          .returning();
        if (!created) return;
        await tx
          .update(w)
          .set({ nextSyncAt: new Date(), syncVersion: sql`${w.syncVersion}+1` })
          .where(
            and(
              eq(w.projectId, connection.projectId),
              sql`${w.repositoryId} IN (SELECT id FROM git_repositories WHERE connection_id=${connectionId})`,
            ),
          );
      });
    },
    sync,
    start() {
      let busy = false;
      let stopped = false;
      let task: Promise<void> = Promise.resolve();
      const timer = setInterval(() => {
        if (busy || stopped) return;
        busy = true;
        task = (async () => {
          const rows = await db
            .select({ id: w.id })
            .from(w)
            .where(
              and(
                lt(w.nextSyncAt, new Date()),
                sql`${w.pull} IS NOT NULL`,
                sql`EXISTS (SELECT 1 FROM projects p JOIN issues i ON i.project_id=p.id WHERE p.id=${w.projectId} AND p.state='active' AND i.id=${w.issueId} AND i.deleted_at IS NULL)`,
                or(isNull(w.syncClaim), lt(w.syncLeaseUntil, new Date())),
              ),
            )
            .orderBy(asc(w.nextSyncAt))
            .limit(4);
          for (const row of rows) {
            if (stopped) break;
            await sync(row.id);
          }
        })()
          .catch(() => {})
          .finally(() => {
            busy = false;
          });
      }, 5000);
      return async () => {
        stopped = true;
        clearInterval(timer);
        await task;
      };
    },
  };
  return service;
}
