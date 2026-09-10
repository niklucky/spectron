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
    for (const repository of row.repositories) {
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
      repositories.push({ repository, token });
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
    return { key, repositories, attachments };
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
      await record(row, "Preparing a repository-backed session.");
      const config = await preparation(row);
      controller.signal.throwIfAborted();
      const repositories = await runtime.prepare(
        row,
        config,
        controller.signal,
        (message) => record(row, message),
      );
      const [prepared] = await db
        .update(r)
        .set({
          repositories,
          containerRetained: true,
          state: "working",
          updatedAt: new Date(),
        })
        .where(fence(row))
        .returning();
      if (!prepared) throw new Error("Run cancelled during preparation.");
      row = prepared;
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
        let accepted = false;
        const result = await runtime.turn(
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
          const turnLimit = !!queued && turnNumber >= 10;
          if (turnLimit)
            result.question =
              "This session reached its 10-turn limit. Reply to resume the remaining queued instructions.";
          const continuing = queued && !turnLimit;
          await tx
            .update(r)
            .set({
              result,
              state: continuing
                ? "working"
                : result.question
                  ? "needs_input"
                  : "completed",
              ...(continuing
                ? {}
                : {
                    claim: null,
                    leaseUntil: null,
                    idleUntil: new Date(Date.now() + idleHours * 3600_000),
                  }),
              updatedAt: new Date(),
            })
            .where(fence(row));
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
