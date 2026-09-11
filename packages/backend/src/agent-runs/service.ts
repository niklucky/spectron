import { releaseWorkspaces, reserveWorkspaces } from "./workspaces";
import { modelLimits, promptByteBudget } from "./model-limits";
import { runPrompt } from "./prompt";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  createId,
  commentText,
  type AgentInvocation,
  type AgentRunScope,
  type AgentRunView,
} from "@spectron/shared";
import { createAIService } from "../ai";
import { createGitService } from "../git/service";
import {
  createIssueService,
  IssueConflictError,
  IssueInputError,
} from "../issues";
import { ProjectAccessError } from "../projects";
import type { FileService } from "../files";
const {
  agentRun: r,
  agentRunInput: input,
  agentRunEvent: event,
  issue,
  issueState,
  project,
  projectMember,
  aiAgent,
  user,
} = schema;
export type Run = typeof r.$inferSelect;
export type RunDB =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function runAccess(
  db: RunDB,
  userId: string,
  scope: AgentRunScope,
  open = false,
  write = false,
) {
  // Project lock also serializes against the existing issue mutation service.
  const [p] = await db
    .select({ role: projectMember.role })
    .from(project)
    .innerJoin(projectMember, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(project.id, scope.projectId),
        eq(project.state, "active"),
        eq(projectMember.userId, userId),
      ),
    )
    .for(write ? "update" : "share");
  const [row] = await db
    .select({ issue, trigger: issueState.trigger })
    .from(issue)
    .innerJoin(issueState, eq(issue.stateId, issueState.id))
    .where(
      and(eq(issue.id, scope.issueId), eq(issue.projectId, scope.projectId)),
    )
    .for("share");
  if (!p || !row) throw new ProjectAccessError("Issue not found.");
  if (
    open &&
    (row.issue.deletedAt || ["finished", "cancelled"].includes(row.trigger))
  )
    throw new IssueInputError("Reopen the issue before invoking an agent.");
  return { ...row, role: p.role };
}
export function createAgentRunService(db: Database, files: FileService) {
  async function controlled(
    tx: RunDB,
    userId: string,
    scope: AgentRunScope & { id: string },
    open = true,
  ) {
    const access = await runAccess(tx, userId, scope, open, true);
    const [row] = await tx
      .select()
      .from(r)
      .where(
        and(
          eq(r.id, scope.id),
          eq(r.issueId, scope.issueId),
          eq(r.projectId, scope.projectId),
        ),
      )
      .for("update");
    if (!row || (row.requesterId !== userId && access.role !== "owner"))
      throw new ProjectAccessError(
        "Only the requester or a project owner can control this run.",
      );
    return row;
  }
  return {
    async list(userId: string, scope: AgentRunScope): Promise<AgentRunView[]> {
      const access = await runAccess(db, userId, scope);
      const rows = await db
        .select({
          id: r.id,
          projectId: r.projectId,
          issueId: r.issueId,
          agent: r.agent,
          requesterId: r.requesterId,
          requesterName: r.requesterName,
          command: r.command,
          message: r.message,
          repositories: r.repositories,
          implementation: r.implementation,
          continuationId: sql<string | null>`${r.context}->>'continuationId'`,
          publicationOnly: sql<boolean>`coalesce((${r.context}->>'publicationOnly')::boolean, false)`,
          state: r.state,
          stopRequested: r.stopRequested,
          result: r.result,
          error: r.error,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          containerRetained: r.containerRetained,
          appliedAt: r.appliedAt,
          attachments: sql<
            { id: string; name: string }[]
          >`coalesce(${r.context}->'attachments', '[]'::jsonb)`,
        })
        .from(r)
        .where(eq(r.issueId, scope.issueId))
        .orderBy(asc(r.createdAt));
      if (!rows.length) return [];
      const ids = rows.map((row) => row.id);
      const [inputs, events, workspaces] = await Promise.all([
        db
          .select()
          .from(input)
          .where(inArray(input.runId, ids))
          .orderBy(asc(input.createdAt), asc(input.id)),
        db
          .select()
          .from(event)
          .where(inArray(event.runId, ids))
          .orderBy(asc(event.createdAt), asc(event.id)),
        db
          .select({
            lastRunId: schema.agentWorkspace.lastRunId,
            ownerRunId: schema.agentWorkspace.ownerRunId,
            pending: sql<boolean>`${schema.agentWorkspace.pending} IS NOT NULL`,
          })
          .from(schema.agentWorkspace)
          .where(eq(schema.agentWorkspace.issueId, scope.issueId)),
      ]);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const retryMessage = (row: (typeof rows)[number]) => {
        const seen = new Set<string>();
        while (row.publicationOnly && row.continuationId && !seen.has(row.id)) {
          seen.add(row.id);
          const parent = byId.get(row.continuationId);
          if (!parent) break;
          row = parent;
        }
        return row.message;
      };
      return rows.map(({ continuationId: _continuationId, ...row }) => ({
        ...row,
        retryMessage: retryMessage(byId.get(row.id)!),
        canRetryPublication: workspaces.some(
          (w) => w.lastRunId === row.id && !w.ownerRunId && w.pending,
        ),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        appliedAt: row.appliedAt?.toISOString() ?? null,
        canControl: row.requesterId === userId || access.role === "owner",
        inputs: inputs
          .filter((i) => i.runId === row.id)
          .map((i) => ({
            id: i.id,
            userId: i.userId,
            message: i.message,
            state: i.state,
            createdAt: i.createdAt.toISOString(),
          })),
        events: events
          .filter((e) => e.runId === row.id)
          .map((e) => ({
            id: e.id,
            message: e.message,
            createdAt: e.createdAt.toISOString(),
          })),
      }));
    },
    async invoke(userId: string, args: AgentInvocation) {
      if (!args.message.trim() || args.message.length > 100_000)
        throw new IssueInputError(
          "Enter instructions up to 100,000 characters.",
        );
      // Attachment ownership is checked before the snapshot transaction; rechecked by the worker before file access.
      for (const id of args.fileIds)
        await files.download(userId, args.projectId, id);
      return db.transaction(async (tx) => {
        const current = await runAccess(
          tx,
          userId,
          args,
          true,
          args.command === "implement",
        );
        const [duplicate] = await tx
          .select({ id: r.id, issueId: r.issueId })
          .from(r)
          .where(
            and(eq(r.requesterId, userId), eq(r.requestId, args.requestId)),
          );
        if (duplicate) {
          if (duplicate.issueId !== args.issueId)
            throw new IssueInputError("Request ID already used.");
          return { id: duplicate.id };
        }
        const agent = (
          await createAIService(tx as unknown as Database).available(
            userId,
            args.projectId,
          )
        ).find((a) => a.id === args.agentId);
        if (!agent)
          throw new ProjectAccessError(
            "This agent is no longer available to you.",
          );
        const [config] = await tx
          .select()
          .from(aiAgent)
          .where(and(eq(aiAgent.id, agent.id), isNull(aiAgent.deletedAt)))
          .for("share");
        if (!config?.connectionId)
          throw new ProjectAccessError("Agent connection not found.");
        const repositories = await createGitService(
          tx as unknown as Database,
        ).authorizeRepositories(userId, args.projectId, args.repositoryIds);
        const [requester] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, userId));
        const comments = await tx
          .select({
            body: schema.issueComment.body,
            authorId: schema.issueComment.authorId,
            authorName: user.name,
            createdAt: schema.issueComment.createdAt,
          })
          .from(schema.issueComment)
          .leftJoin(user, eq(user.id, schema.issueComment.authorId))
          .where(
            and(
              eq(schema.issueComment.issueId, args.issueId),
              isNull(schema.issueComment.deletedAt),
            ),
          )
          .orderBy(asc(schema.issueComment.createdAt));
        const previous = await tx
          .select({
            id: r.id,
            agent: r.agent,
            message: sql<string>`left(${r.message}, 1000)`,
            result: sql<
              Run["result"]
            >`CASE WHEN ${r.result} IS NULL THEN NULL ELSE jsonb_build_object('summary', left(${r.result}->>'summary', 1000), 'details', left(${r.result}->>'details', 4000)) END`,
          })
          .from(r)
          .where(eq(r.issueId, args.issueId))
          .orderBy(desc(r.createdAt), desc(r.id))
          .limit(10);
        previous.reverse();
        let continuation: Run | undefined;
        if (args.continuationId) {
          [continuation] = await tx
            .select()
            .from(r)
            .where(
              and(eq(r.id, args.continuationId), eq(r.issueId, args.issueId)),
            );
          if (
            !continuation ||
            !["completed", "failed", "stopped"].includes(continuation.state)
          )
            throw new IssueInputError("Select a finished run to continue.");
        }
        if (
          args.publicationOnly &&
          (args.command !== "implement" ||
            continuation?.command !== "implement" ||
            continuation.agentId !== args.agentId)
        )
          throw new IssueInputError(
            "Select a finished implementation by this agent to retry publication.",
          );
        const attached = await tx
          .select({ projectFileId: schema.issueAttachment.projectFileId })
          .from(schema.issueAttachment)
          .where(
            and(
              eq(schema.issueAttachment.issueId, args.issueId),
              isNull(schema.issueAttachment.deletedAt),
            ),
          );
        const commentFiles = await tx
          .select({ id: schema.commentAttachment.projectFileId })
          .from(schema.commentAttachment)
          .innerJoin(
            schema.issueComment,
            eq(schema.issueComment.id, schema.commentAttachment.commentId),
          )
          .where(
            and(
              eq(schema.issueComment.issueId, args.issueId),
              isNull(schema.issueComment.deletedAt),
              isNull(schema.commentAttachment.deletedAt),
            ),
          );
        const settings = await createIssueService(
          tx as unknown as Database,
        ).settings(userId, args.projectId);
        const people = await tx
          .select({ id: user.id, name: user.name })
          .from(user)
          .innerJoin(projectMember, eq(projectMember.userId, user.id))
          .where(eq(projectMember.projectId, args.projectId));
        const tags = await tx
          .select({ id: schema.issueTag.tagId })
          .from(schema.issueTag)
          .where(eq(schema.issueTag.issueId, args.issueId));
        const earlierInputs = previous.length
          ? await tx
              .select({
                runId: input.runId,
                message: sql<string>`left(${input.message}, 1000)`,
                state: input.state,
                userId: input.userId,
              })
              .from(input)
              .where(
                inArray(
                  input.runId,
                  previous.map((r) => r.id),
                ),
              )
              .orderBy(desc(input.createdAt), desc(input.id))
              .limit(20)
          : [];
        const limits = modelLimits(agent);
        const context = {
          modelLimits: limits,
          projectKey: (
            await tx
              .select({ key: project.key })
              .from(project)
              .where(eq(project.id, args.projectId))
          )[0]!.key,
          issue: { ...current.issue, tagIds: tags.map((t) => t.id) },
          settings,
          people,
          earlierInputs: earlierInputs.reverse(),
          historyNotice:
            "Includes up to 10 recent agent results (summary and details excerpts) and 20 recent steering excerpts. Full history remains in issue chat.",
          status: current.trigger,
          comments: comments.map((c) => ({ ...c, body: commentText(c.body) })),
          previous,
          fileIds: [
            ...new Set([
              ...attached.map((f) => f.projectFileId),
              ...commentFiles.map((f) => f.id),
              ...args.fileIds,
            ]),
          ],
          continuationId: continuation?.id ?? null,
          publicationOnly: !!args.publicationOnly,
          ...(args.publicationOnly && continuation?.result
            ? {
                publicationResult: {
                  ...continuation.result,
                  details: continuation.result.details.slice(0, 30000),
                  question: undefined,
                  rewrite: undefined,
                },
              }
            : {}),
        };
        const attachedFiles = context.fileIds.length
          ? await tx
              .select({
                id: schema.projectFile.id,
                name: schema.storedFile.filename,
              })
              .from(schema.projectFile)
              .innerJoin(
                schema.storedFile,
                eq(schema.projectFile.fileId, schema.storedFile.id),
              )
              .where(
                and(
                  eq(schema.projectFile.projectId, args.projectId),
                  inArray(schema.projectFile.id, context.fileIds),
                ),
              )
          : [];
        const finalContext = { ...context, attachments: attachedFiles };
        const promptSize = () =>
          Buffer.byteLength(
            runPrompt(
              {
                command: args.command,
                repositories,
                context: finalContext,
                message: args.message,
                result: null,
              },
              [],
            ) + config.instructions,
            "utf8",
          );
        const budget = promptByteBudget(limits);
        // Historical results are excerpts, not a permanent lockout. Drop oldest
        // excerpts first; immutable full results remain available in chat.
        while (promptSize() > budget && finalContext.previous.length)
          finalContext.previous.shift();
        while (promptSize() > budget && finalContext.earlierInputs.length)
          finalContext.earlierInputs.shift();
        if (!args.publicationOnly && promptSize() > budget)
          throw new IssueInputError(
            `This issue and its instructions exceed the model's ${budget.toLocaleString("en-US")}-byte input budget after omitting prior agent history. Shorten the issue conversation, description, or agent instructions.`,
          );
        const [created] = await tx
          .insert(r)
          .values({
            id: createId(),
            projectId: args.projectId,
            issueId: args.issueId,
            requestId: args.requestId,
            requesterId: userId,
            requesterName: requester!.name,
            agentId: agent.id,
            agent,
            command: args.command,
            message: args.message.trim(),
            repositories,
            context: finalContext,
            instructions: config.instructions,
            connectionId: config.connectionId,
          })
          .onConflictDoNothing()
          .returning({ id: r.id });
        if (created) {
          if (args.command === "implement") {
            const [run] = await tx.select().from(r).where(eq(r.id, created.id));
            await reserveWorkspaces(tx, run!, repositories);
          }
          return created;
        }
        const [retry] = await tx
          .select({ id: r.id })
          .from(r)
          .where(
            and(
              eq(r.requesterId, userId),
              eq(r.requestId, args.requestId),
              eq(r.issueId, args.issueId),
            ),
          );
        if (!retry) throw new IssueConflictError("Request ID already used.");
        return retry;
      });
    },
    async stop(userId: string, args: AgentRunScope & { id: string }) {
      await db.transaction(async (tx) => {
        const row = await controlled(tx, userId, args, false);
        const unclaimed =
          row.state === "queued" && !row.claim && !row.containerRetained;
        await tx
          .update(r)
          .set({
            stopRequested: true,
            ...(unclaimed ? { state: "stopped" as const } : {}),
            ...(["queued", "preparing", "working", "needs_input"].includes(
              row.state,
            )
              ? { error: "Stopped by a project member." }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(r.id, row.id));
        if (unclaimed) await releaseWorkspaces(tx, row);
      });
    },
    async instruct(
      userId: string,
      args: AgentRunScope & { id: string; requestId: string; message: string },
    ) {
      await db.transaction(async (tx) => {
        const row = await controlled(tx, userId, args);
        if (row.context.publicationOnly)
          throw new IssueInputError(
            "This run only retries publication. Start a continuation for new agent instructions.",
          );
        if (
          row.stopRequested ||
          !["queued", "preparing", "working", "needs_input"].includes(row.state)
        )
          throw new IssueInputError(
            "This run has finished. Start a continuation.",
          );
        if (
          !(
            await createAIService(tx as unknown as Database).available(
              userId,
              args.projectId,
            )
          ).some((a) => a.id === row.agentId)
        )
          throw new ProjectAccessError("Agent access was removed.");
        if (!args.message.trim() || args.message.length > 100_000)
          throw new IssueInputError(
            "Enter instructions up to 100,000 characters.",
          );
        await tx
          .insert(input)
          .values({
            runId: row.id,
            userId,
            requestId: args.requestId,
            message: args.message.trim(),
          })
          .onConflictDoNothing();
        if (row.state === "needs_input")
          await tx
            .update(r)
            .set({ state: "queued", idleUntil: null, updatedAt: new Date() })
            .where(eq(r.id, row.id));
      });
    },
    async previewRewrite(userId: string, args: AgentRunScope & { id: string }) {
      return db.transaction(async (tx) => {
        const row = await controlled(tx, userId, args);
        if (
          row.command !== "rewrite-issue" ||
          row.state !== "completed" ||
          !row.result?.rewrite ||
          row.appliedAt
        )
          throw new IssueInputError("No unapplied rewrite is available.");
        const access = await runAccess(tx, userId, args, true);
        const tags = await tx
          .select({ id: schema.issueTag.tagId })
          .from(schema.issueTag)
          .where(eq(schema.issueTag.issueId, args.issueId));
        const current: Record<string, unknown> = {
          ...access.issue,
          tagIds: tags.map((t) => t.id).sort(),
        };
        const original = row.context.issue as Record<string, unknown>;
        const same = (a: unknown, b: unknown) =>
          JSON.stringify(Array.isArray(a) ? [...a].sort() : a) ===
          JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
        return {
          expectedUpdatedAt: access.issue.updatedAt.toISOString(),
          stale: access.issue.updatedAt.toISOString() !== original.updatedAt,
          changes: Object.entries(row.result.rewrite).map(
            ([field, proposed]) => ({
              field,
              current: current[field] ?? null,
              proposed,
              changedSinceInvocation: !same(current[field], original[field]),
            }),
          ),
        };
      });
    },
    async apply(
      userId: string,
      args: AgentRunScope & {
        id: string;
        expectedUpdatedAt?: string | undefined;
      },
    ) {
      // Existing issue service validates fields and optimistic revision and emits normal history/export events.
      await db.transaction(async (tx) => {
        const row = await controlled(tx, userId, args);
        if (row.appliedAt) return;
        if (
          row.command !== "rewrite-issue" ||
          row.state !== "completed" ||
          !row.result?.rewrite
        )
          throw new IssueInputError("No unapplied rewrite is available.");
        const original = row.context.issue as { updatedAt: string };
        await createIssueService(tx as unknown as Database).update(userId, {
          projectId: row.projectId,
          id: row.issueId,
          expectedUpdatedAt: args.expectedUpdatedAt ?? original.updatedAt,
          ...row.result.rewrite,
        });
        await tx
          .update(r)
          .set({ appliedAt: new Date() })
          .where(eq(r.id, row.id));
      });
    },
  };
}
export type AgentRunService = ReturnType<typeof createAgentRunService>;
