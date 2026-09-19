import { validReviewFindings } from "./reviews";
import { reviewLocation, type ReviewDiff } from "../git/reviews";
import { createImplementation } from "./implementation";
import { releaseWorkspaces, reserveWorkspaces } from "./workspaces";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import { createId } from "@spectron/shared";
import { createAIService } from "../ai";
import { decryptAIKey } from "../ai-credentials";
import { decryptGitToken } from "../git/credentials";
import { createGitService } from "../git/service";
import type { GitAdapterFactory } from "../git/provider";
import type { FileService } from "../files";
import { runAccess, type Run } from "./service";
import type { AgentRuntime, RuntimePreparation } from "./runtime";
const { agentRun: r, agentRunInput: input, agentRunEvent: event } = schema;
const activeStates = ["queued", "preparing", "working", "needs_input"] as const;
import { runPrompt } from "./prompt";
export { runPrompt } from "./prompt";
export function createAgentWorker(
  db: Database,
  files: FileService,
  runtime: AgentRuntime,
  options: {
    aiSecret?: string;
    integrationSecret?: string;
    gitFactory: GitAdapterFactory;
    idleHours?: number;
    appURL?: string;
  },
) {
  const running = new Map<string, AbortController>();
  const tasks = new Set<Promise<void>>();
  let closing = false;
  const idleHours = options.idleHours ?? 3;
  if (!Number.isFinite(idleHours) || idleHours < 0.01 || idleHours > 168)
    throw new Error("AGENT_IDLE_HOURS must be between 0.01 and 168.");
  const fence = (row: Run) =>
    and(eq(r.id, row.id), eq(r.claim, row.claim!), eq(r.stopRequested, false));
  async function authorized(row: Run) {
    await runAccess(db, row.requesterId, row, true);
    if (
      !(
        await createAIService(db).available(row.requesterId, row.projectId)
      ).some((a) => a.id === row.agentId)
    )
      throw new Error("Agent or project access was removed.");
    await createGitService(db).authorizeRepositories(
      row.requesterId,
      row.projectId,
      row.repositories.map((repo) => repo.id),
    );
  }
  async function preparation(row: Run): Promise<RuntimePreparation> {
    await authorized(row);
    const [connection] = await db
      .select()
      .from(schema.aiConnection)
      .where(
        and(
          eq(schema.aiConnection.id, row.connectionId),
          eq(schema.aiConnection.ownerId, row.agent.ownerId),
          eq(schema.aiConnection.provider, row.agent.provider),
        ),
      );
    if (!connection)
      throw new Error("The original AI connection is no longer available.");
    const key = decryptAIKey(
      connection.encryptedKey,
      JSON.stringify([connection.ownerId, connection.id, connection.provider]),
      options.aiSecret,
    );
    const repositories: RuntimePreparation["repositories"] = [];
    const preparationErrors: Record<string, string> = {};
    for (const repository of row.repositories) {
      try {
        const [c] = await db
          .select()
          .from(schema.gitConnection)
          .where(
            and(
              eq(schema.gitConnection.id, repository.connectionId),
              eq(schema.gitConnection.projectId, row.projectId),
            ),
          );
        if (!c) throw new Error("Git connection is no longer available.");
        const token = decryptGitToken(
          c.encryptedToken,
          JSON.stringify([
            "git",
            c.projectId,
            c.id,
            c.creatorId,
            c.provider,
            c.baseURL,
          ]),
          options.integrationSecret,
        );
        const adapter = options.gitFactory(c, token);
        const remote = await adapter.repository(
          repository.fullName,
          repository.externalId,
        );
        if (remote.cloneURL !== repository.cloneURL)
          throw new Error(
            "The repository moved. Start a new run with its current location.",
          );
        await adapter.branch(remote, repository.targetBranch);
        if (
          row.command === "review-code" &&
          typeof row.context.reviewBranch === "string"
        ) {
          if (!adapter.reviews?.branchReview)
            throw new Error("Branch review unavailable.");
          if (!row.context.branchReview)
            row.context.branchReview = {
              ...(await adapter.reviews.branchReview(
                remote,
                row.context.reviewBranch,
                repository.targetBranch,
              )),
              repositoryId: repository.id,
              repositoryName: repository.fullName,
            };
        } else if (row.command === "review-code") {
          if (!row.review || !adapter.reviews)
            throw new Error("PR/MR review unavailable.");
          if (!row.context.reviewDiff) {
            const diff = await adapter.reviews.review(
              remote,
              row.review.pull.number,
            );
            if (diff.pull.state !== "open")
              throw new Error("Select an open PR/MR to review.");
            row.review = { ...row.review, pull: diff.pull };
            row.context.reviewDiff = diff;
          }
        }
        repositories.push({
          repository,
          token,
          author: { name: c.commitAuthorName, email: c.commitAuthorEmail },
          connection: {
            provider: c.provider,
            baseURL: c.baseURL,
            revision: c.revision,
          },
        });
      } catch (error) {
        if (row.command !== "implement") throw error;
        preparationErrors[repository.id] =
          error instanceof Error
            ? error.message
            : "Repository preparation failed.";
      }
    }
    const attachments: RuntimePreparation["attachments"] = [];
    let size = 0;
    for (const id of row.context.fileIds as string[]) {
      const file = await files.download(row.requesterId, row.projectId, id);
      size += file.sizeBytes;
      if (size > 100 * 1024 * 1024)
        throw new Error("Attachments exceed the 100 MB execution limit.");
      attachments.push({
        id,
        filename: file.filename,
        contentType: file.contentType,
        path: file.path,
      });
    }
    return { key, repositories, attachments, preparationErrors };
  }
  async function record(row: Run, message: string) {
    // INSERT guarded by the lease prevents late callbacks from resurrecting stopped runs.
    await db.execute(
      sql`INSERT INTO agent_run_events (id, run_id, message) SELECT ${createId()}, ${row.id}, ${message} FROM agent_runs WHERE id = ${row.id} AND claim = ${row.claim} AND NOT stop_requested AND (SELECT count(*) FROM agent_run_events WHERE run_id = ${row.id}) < 300`,
    );
  }
  async function execute(row: Run) {
    const controller = new AbortController();
    running.set(row.id, controller);
    let pulseBusy = false;
    let lastAuthorization = Date.now();
    const heartbeat = setInterval(() => {
      if (pulseBusy) return;
      pulseBusy = true;
      void (async () => {
        const [current] = await db
          .select({ claim: r.claim, stop: r.stopRequested })
          .from(r)
          .where(eq(r.id, row.id));
        if (
          !current ||
          current.claim !== row.claim ||
          current.stop ||
          closing
        ) {
          controller.abort(
            new Error(
              closing
                ? "Worker interrupted by shutdown. Continue explicitly."
                : current?.stop
                  ? "Execution stopped by request."
                  : "Worker lost its execution lease. Continue explicitly.",
            ),
          );
          return;
        }
        if (Date.now() - lastAuthorization >= 15_000) {
          try {
            await authorized(row);
          } catch {
            controller.abort(
              new Error(
                "Agent or project authorization could not be verified. Continue explicitly after checking access.",
              ),
            );
            return;
          }
          lastAuthorization = Date.now();
        }
        await db
          .update(r)
          .set({ leaseUntil: new Date(Date.now() + 60_000) })
          .where(fence(row));
      })()
        .catch(() =>
          controller.abort(
            new Error(
              "Worker heartbeat failed. Available output was preserved; continue explicitly.",
            ),
          ),
        )
        .finally(() => {
          pulseBusy = false;
        });
    }, 1000);
    try {
      if (row.handoffFromId && !row.implementation.length) {
        await db.transaction(async (tx) => {
          await runAccess(tx, row.requesterId, row, true, true);
          const [old] = await tx
            .select()
            .from(r)
            .where(eq(r.id, row.handoffFromId!))
            .for("share");
          if (
            !old ||
            old.claim ||
            old.containerRetained ||
            !["stopped", "failed", "completed"].includes(old.state)
          )
            throw new Error("Previous execution has not stopped safely.");
          const oldInputs = await tx
            .select()
            .from(input)
            .where(eq(input.runId, old.id))
            .orderBy(asc(input.createdAt));
          row.context.handoffSummary = {
            agent: old.agent.name,
            message: old.message,
            result: old.result,
            error: old.error,
            implementation: old.implementation,
            instructions: oldInputs.map((i) => ({
              message: i.message,
              state: i.state,
            })),
          };
          row.context.fileIds = [
            ...new Set([
              ...((old.context.fileIds ?? []) as string[]),
              ...((row.context.fileIds ?? []) as string[]),
            ]),
          ];
          const originalFeedback = (old.context.feedbackComments ??
            []) as import("@spectron/shared").FeedbackComment[];
          row.context.feedbackComments = [
            ...originalFeedback,
            ...oldInputs.flatMap((i) => i.feedback),
            ...((row.context.feedbackComments ??
              []) as import("@spectron/shared").FeedbackComment[]),
          ];
          await reserveWorkspaces(tx, row, row.repositories);
          const [updated] = await tx
            .update(r)
            .set({ context: row.context })
            .where(fence(row))
            .returning();
          if (!updated) throw new Error("Handoff was cancelled.");
          row.implementation = updated.implementation;
        });
        await record(
          row,
          "Previous tools stopped. Starting a new agent session in the preserved workspace.",
        );
      }
      await record(row, "Preparing a repository-backed session.");
      const config = await preparation(row);
      controller.signal.throwIfAborted();
      const implementation =
        row.command === "implement"
          ? createImplementation(
              db,
              row,
              config,
              runtime.writableGit ??
                (() => {
                  throw new Error("Writable runtime unavailable.");
                })(),
              options.gitFactory,
              controller.signal,
              options.appURL ?? "http://localhost:5187",
            )
          : null;
      if (implementation)
        await implementation.prepare((message) => record(row, message));
      const publicationOnly = row.context.publicationOnly === true;
      const repositories = publicationOnly
        ? row.repositories
        : await runtime.prepare(row, config, controller.signal, (message) =>
            record(row, message),
          );
      const [prepared] = await db
        .update(r)
        .set({
          repositories,
          review: row.review,
          context: row.context,
          containerRetained: !publicationOnly,
          state: "working",
          updatedAt: new Date(),
        })
        .where(fence(row))
        .returning();
      if (!prepared) throw new Error("Run cancelled during preparation.");
      Object.assign(row, prepared);
      // Resumption/steering is serial: a new CLI turn in the same session only after the previous invocation exits.
      for (let turnNumber = 1; ; turnNumber++) {
        controller.signal.throwIfAborted();
        await authorized(row);
        const pending = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(r)
            .where(fence(row))
            .for("update");
          if (!current) throw new Error("Run cancelled.");
          const queued = await tx
            .select()
            .from(input)
            .where(and(eq(input.runId, row.id), eq(input.state, "queued")))
            .orderBy(asc(input.createdAt), asc(input.id));
          return queued;
        });
        if (pending.length)
          await record(
            row,
            "Starting the next session turn with queued instructions.",
          );
        const feedback = new Map(
          (
            (row.context.feedbackComments ??
              []) as import("@spectron/shared").FeedbackComment[]
          ).map((c) => [`${c.discussionId}:${c.noteId}`, c]),
        );
        for (const i of pending)
          for (const c of i.feedback)
            feedback.set(`${c.discussionId}:${c.noteId}`, c);
        row.context.feedbackComments = [...feedback.values()];
        let accepted = false;
        const result: import("@spectron/shared").AgentResult = publicationOnly
          ? ((row.context.publicationResult as
              | import("@spectron/shared").AgentResult
              | undefined) ?? {
              summary: "Publish saved implementation changes",
              details: "No new model execution or verification was performed.",
            })
          : await runtime.turn(
              row,
              runPrompt(
                row,
                pending.map((i) => i.message),
              ),
              controller.signal,
              (message) => record(row, message),
              async (text) => {
                await db
                  .update(r)
                  .set({
                    result: { summary: "Partial response", details: text },
                    updatedAt: new Date(),
                  })
                  .where(fence(row));
              },
              async () => {
                accepted = true;
                if (pending.length)
                  await db
                    .update(input)
                    .set({ state: "delivered" })
                    .where(
                      inArray(
                        input.id,
                        pending.map((i) => i.id),
                      ),
                    );
              },
            );
        row.result = result;
        if (pending.length && !accepted) {
          await db.update(r).set({ result }).where(fence(row));
          throw new Error(
            "OpenCode returned a response without confirming instruction delivery. The result was saved; continue explicitly to avoid repeating a paid request.",
          );
        }
        const shouldFinish = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(r)
            .where(fence(row))
            .for("update");
          if (!current) throw new Error("Run cancelled.");
          const [queued] = await tx
            .select({ id: input.id })
            .from(input)
            .where(and(eq(input.runId, row.id), eq(input.state, "queued")))
            .limit(1);
          if (queued && turnNumber >= 10)
            result.question =
              "This session reached its 10-turn limit. Reply to resume the remaining queued instructions.";
          await tx
            .update(r)
            .set({ result, context: row.context, updatedAt: new Date() })
            .where(fence(row));
          return !queued || turnNumber >= 10;
        });
        if (!shouldFinish) continue;
        let publicationFailed = false;
        if (implementation) {
          await record(
            row,
            "Stopping execution tools and preserving the implementation workspace.",
          );
          await runtime.cleanup(row.id);
          await db
            .update(r)
            .set({ containerRetained: false })
            .where(fence(row));
          if (!result.question) {
            await record(
              row,
              "Saving attributed commits and publishing draft PR/MRs.",
            );
            publicationFailed = await implementation.publish();
          }
        }
        const done = await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(r)
            .where(fence(row))
            .for("update");
          if (!current) throw new Error("Run cancelled.");
          const [queued] = await tx
            .select({ id: input.id })
            .from(input)
            .where(and(eq(input.runId, row.id), eq(input.state, "queued")))
            .limit(1);
          // Instructions arriving while publication runs stay queued for an explicit restored session.
          if (queued && implementation)
            result.question =
              "Additional instructions arrived during publication. Reply to resume the saved workspace.";
          const continuing = queued && !implementation && turnNumber < 10;
          if (row.command === "implement" && !continuing && !result.question) {
            const comments = (row.context.feedbackComments ??
              []) as import("@spectron/shared").FeedbackComment[];
            const replies = new Map<string, string[]>();
            const reportedComments = new Set<string>();
            const validFeedback: NonNullable<typeof result.feedback> = [];
            let droppedFeedback = 0;
            for (const feedback of result.feedback ?? []) {
              const selected = comments.find(
                (c) =>
                  c.discussionId === feedback.discussionId &&
                  c.noteId === feedback.noteId,
              );
              const key = `${feedback.discussionId}:${feedback.noteId}`;
              if (!selected || reportedComments.has(key)) {
                droppedFeedback++;
                continue;
              }
              validFeedback.push(feedback);
              reportedComments.add(key);
              if (feedback.reply?.trim())
                replies.set(feedback.discussionId, [
                  ...(replies.get(feedback.discussionId) ?? []),
                  feedback.reply.trim(),
                ]);
            }
            result.feedback = validFeedback;
            if (droppedFeedback)
              result.details += `\n\nIgnored ${droppedFeedback} duplicate or unselected feedback result(s). Selected comments without an outcome are reported as unresolved.`;
            for (const [discussionId, bodies] of replies)
              await tx
                .insert(schema.gitReplyDraft)
                .values({
                  discussionId,
                  authorId: row.requesterId,
                  runId: row.id,
                  body: bodies.join("\n\n").slice(0, 20000),
                })
                .onConflictDoNothing();
            if (comments.length) {
              const reported = new Set(
                (result.feedback ?? []).map(
                  (f) => `${f.discussionId}:${f.noteId}`,
                ),
              );
              result.feedback = [
                ...(result.feedback ?? []),
                ...comments
                  .filter((c) => !reported.has(`${c.discussionId}:${c.noteId}`))
                  .map((c) => ({
                    discussionId: c.discussionId,
                    noteId: c.noteId,
                    status: "unresolved" as const,
                    explanation:
                      "The agent did not report an outcome for this selected comment.",
                  })),
              ];
            }
          }
          if (
            row.command === "review-code" &&
            !continuing &&
            !result.question
          ) {
            const findings = validReviewFindings(result.findings);
            const branch = row.context.branchReview as
              | import("@spectron/shared").BranchReview
              | undefined;
            const diff = branch ?? (row.context.reviewDiff as ReviewDiff);
            if (
              row.repositories[0]?.commit !==
              (branch?.head ?? row.review?.pull.head)
            )
              throw new Error(
                "Review checkout was not verified at the reviewed commit.",
              );
            for (const [ordinal, finding] of findings.entries()) {
              const valid = reviewLocation(diff, finding);
              await tx
                .insert(schema.agentReviewFinding)
                .values({
                  runId: row.id,
                  ordinal,
                  ...finding,
                  state: valid ? "draft" : "stale",
                  error: valid
                    ? null
                    : "Location is outside a verifiable changed line. Run a fresh review.",
                })
                .onConflictDoNothing();
            }
          }
          await tx
            .update(r)
            .set({
              result,
              context: row.context,
              state: continuing
                ? "working"
                : result.question
                  ? "needs_input"
                  : publicationFailed
                    ? "failed"
                    : "completed",
              error: publicationFailed
                ? "Some repositories could not be published. See their outcomes; continue explicitly to retry."
                : null,
              ...(continuing
                ? {}
                : {
                    claim: null,
                    leaseUntil: null,
                    idleUntil: implementation
                      ? null
                      : new Date(Date.now() + idleHours * 3600_000),
                  }),
              updatedAt: new Date(),
            })
            .where(fence(row));
          if (implementation && !result.question)
            await releaseWorkspaces(tx, row);
          return !continuing;
        });
        if (done) break;
      }
    } catch (error) {
      // Preserve partial output and workspace; never automatically replay uncertain paid execution.
      let cleanupError = false;
      try {
        await runtime.cleanup(row.id);
      } catch {
        cleanupError = true;
      }
      if (!cleanupError && row.command === "implement")
        await releaseWorkspaces(db, row);
      const [current] = await db
        .select({ stopRequested: r.stopRequested, error: r.error })
        .from(r)
        .where(eq(r.id, row.id));
      const stopped = !!current?.stopRequested;
      await db
        .update(r)
        .set({
          state: stopped ? "stopped" : "failed",
          error: cleanupError
            ? "Execution ended, but container cleanup failed. Cleanup will retry."
            : stopped
              ? current?.error ||
                "Execution stopped. Available output and workspace were preserved."
              : controller.signal.aborted
                ? (controller.signal.reason as Error).message
                : error instanceof Error
                  ? error.message
                  : "Agent execution failed.",
          containerRetained: cleanupError,
          idleUntil: cleanupError ? new Date() : null,
          claim: null,
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(and(eq(r.id, row.id), eq(r.claim, row.claim!)));
    } finally {
      clearInterval(heartbeat);
      running.delete(row.id);
    }
  }
  async function tick() {
    if (closing) return;
    // Claim expired/cleanup work as well, so multiple worker processes cannot remove each other's live containers.
    for (let n = 0; n < 2; n++) {
      if (running.size >= 2) break;
      const row = await db.transaction(async (tx) => {
        const [next] = await tx
          .select()
          .from(r)
          .where(
            and(
              or(isNull(r.claim), lt(r.leaseUntil, new Date())),
              sql`(${r.stopRequested} OR ${r.handoffFromId} IS NULL OR EXISTS (SELECT 1 FROM agent_runs old WHERE old.id=${r.handoffFromId} AND old.claim IS NULL AND NOT old.container_retained AND old.state IN ('completed','failed','stopped')))`,
              or(
                eq(r.state, "queued"),
                inArray(r.state, ["preparing", "working"]),
                and(
                  eq(r.stopRequested, true),
                  or(
                    inArray(r.state, [...activeStates]),
                    eq(r.containerRetained, true),
                  ),
                ),
                and(eq(r.containerRetained, true), lt(r.idleUntil, new Date())),
              ),
            ),
          )
          .orderBy(asc(r.createdAt))
          .for("update", { skipLocked: true })
          .limit(1);
        if (!next) return null;
        const claim = createId();
        await tx
          .update(r)
          .set({
            claim,
            leaseUntil: new Date(Date.now() + 60_000),
            ...(next.state === "queued" && !next.stopRequested
              ? { state: "preparing" as const }
              : {}),
          })
          .where(eq(r.id, next.id));
        return { ...next, claim };
      });
      if (!row) break;
      if (row.state === "queued" && !row.stopRequested) {
        const task = execute(row).catch(() => {
          /* Lease recovery handles database outages. */
        });
        tasks.add(task);
        void task.finally(() => tasks.delete(task));
      } else {
        try {
          await runtime.cleanup(row.id);
          const interrupted = ["preparing", "working"].includes(row.state);
          if (
            row.command === "implement" &&
            (row.state !== "needs_input" || row.stopRequested)
          )
            await releaseWorkspaces(db, row);
          await db
            .update(r)
            .set({
              containerRetained: false,
              idleUntil: null,
              claim: null,
              leaseUntil: null,
              ...(row.stopRequested &&
              activeStates.includes(row.state as (typeof activeStates)[number])
                ? { state: "stopped" as const }
                : interrupted
                  ? {
                      state: "failed" as const,
                      error:
                        "Worker interrupted. Available output and workspace were retained; continue explicitly.",
                    }
                  : {}),
              updatedAt: new Date(),
            })
            .where(and(eq(r.id, row.id), eq(r.claim, row.claim)));
        } catch {
          await db
            .update(r)
            .set({
              leaseUntil: new Date(Date.now() + 30_000),
              error: "Container cleanup failed; retrying.",
            })
            .where(and(eq(r.id, row.id), eq(r.claim, row.claim)));
        }
      }
    }
  }
  return {
    tick,
    async settle() {
      await Promise.all([...tasks]);
    },
    start() {
      let busy = false;
      const timer = setInterval(() => {
        if (!busy) {
          busy = true;
          void tick()
            .catch(() => {})
            .finally(() => {
              busy = false;
            });
        }
      }, 1000);
      return async () => {
        closing = true;
        clearInterval(timer);
        for (const controller of running.values())
          controller.abort(
            new Error(
              "Worker interrupted by shutdown. Available output and workspace were retained; continue explicitly.",
            ),
          );
        await Promise.all([...tasks]);
      };
    },
  };
}
