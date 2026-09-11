import { and, eq, gt } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type { ImplementationOutcome } from "@spectron/shared";
import { createAIService } from "../ai";
import { createGitService } from "../git/service";
import type { GitAdapterFactory } from "../git/provider";
import { runAccess, type Run, type RunDB } from "./service";
import { ownedWorkspaces, type Workspace } from "./workspaces";
import type { WritableGit, WriteCredential } from "./writable-git";
import type { RuntimePreparation } from "./runtime";
const r = schema.agentRun,
  w = schema.agentWorkspace;
const line = (s: string) => s.replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
export function contribution(run: Run, appURL: string) {
  const issue = run.context.issue as { number: number; title: string };
  const issueRef = `${String(run.context.projectKey ?? run.projectId)}-${issue.number}`;
  const url = `${appURL.replace(/\/$/, "")}/#project/${run.projectId}/${run.issueId}`;
  const title = `Implement ${issueRef}: ${line(issue.title).slice(0, 160)}`;
  return {
    title,
    message: `${title}\n\nSpectron-Issue: ${line(issueRef)}\nSpectron-Agent: ${line(run.agent.name)}\nSpectron-Requested-By: ${line(run.requesterName)}\nSpectron-Run: ${run.id}\n`,
    body: `${run.result?.summary ?? "Implementation saved for review."}\n\n${run.result?.details?.slice(0, 30000) ?? "Verification was not completed. Inspect the saved changes before marking ready."}\n\nAgent: ${line(run.agent.name)} · Requested by: ${line(run.requesterName)}\n\n[Issue ${issueRef}](${url}) · [Run ${run.id}](${url}/run/${run.id})\n\n<!-- spectron-workspace-contribution:${run.id} -->`,
  };
}
export function createImplementation(
  db: Database,
  run: Run,
  config: RuntimePreparation,
  git: WritableGit,
  factory: GitAdapterFactory,
  signal: AbortSignal,
  appURL: string,
) {
  const credentials = new Map(
    config.repositories.map((c) => [c.repository.id, c]),
  );
  const outcomes = new Map(run.implementation.map((o) => [o.repositoryId, o]));
  const available = new Set<string>();
  async function guard<T>(
    workspace: Workspace,
    action: (tx: RunDB, current: Workspace) => Promise<T>,
  ) {
    signal.throwIfAborted();
    return db.transaction(async (tx) => {
      // Keep access checks and checkpoints short; never hold these locks during I/O.
      await runAccess(tx, run.requesterId, run, true);
      const [currentRun] = await tx
        .select()
        .from(r)
        .where(
          and(
            eq(r.id, run.id),
            eq(r.claim, run.claim!),
            eq(r.stopRequested, false),
            gt(r.leaseUntil, new Date()),
          ),
        )
        .for("update");
      if (!currentRun)
        throw new Error("Execution stopped or lease lost before publication.");
      if (
        !(
          await createAIService(tx as unknown as Database).available(
            run.requesterId,
            run.projectId,
          )
        ).some((a) => a.id === run.agentId)
      )
        throw new Error("Agent access was removed before publication.");
      const [repo] = await createGitService(
        tx as unknown as Database,
      ).authorizeRepositories(run.requesterId, run.projectId, [
        workspace.repositoryId,
      ]);
      const c = credentials.get(workspace.repositoryId);
      if (
        !c ||
        repo?.cloneURL !== c.repository.cloneURL ||
        repo.targetBranch !== workspace.targetBranch
      )
        throw new Error(
          "Repository settings changed during execution. Start a continuation after checking settings.",
        );
      const [connection] = await tx
        .select({ revision: schema.gitConnection.revision })
        .from(schema.gitConnection)
        .where(eq(schema.gitConnection.id, repo.connectionId))
        .for("share");
      if (!connection || connection.revision !== c.connection?.revision)
        throw new Error(
          "Git connection settings changed during execution. Continue with the current identity and credentials.",
        );
      const [current] = await tx
        .select()
        .from(w)
        .where(and(eq(w.id, workspace.id), eq(w.ownerRunId, run.id)))
        .for("update");
      if (!current) throw new Error("Workspace ownership was lost.");
      signal.throwIfAborted();
      const result = await action(tx, current);
      await tx
        .update(r)
        .set({ leaseUntil: new Date(Date.now() + 60_000) })
        .where(eq(r.id, run.id));
      return result;
    });
  }
  async function operation<T>(workspace: Workspace, action: () => Promise<T>) {
    await guard(workspace, async () => {});
    signal.throwIfAborted();
    const result = await action();
    // Remote effects may already exist after cancellation. Keep pending state so
    // a later continuation can reconcile them before attempting another write.
    await guard(workspace, async () => {});
    return result;
  }
  async function saveOutcome(
    workspace: Workspace,
    patch: Partial<ImplementationOutcome>,
  ) {
    const outcome = { ...outcomes.get(workspace.repositoryId)!, ...patch };
    outcomes.set(workspace.repositoryId, outcome);
    run.implementation = [...outcomes.values()];
    await db
      .update(r)
      .set({ implementation: run.implementation, updatedAt: new Date() })
      .where(and(eq(r.id, run.id), eq(r.claim, run.claim!)));
  }
  function credential(workspace: Workspace): WriteCredential {
    const c = credentials.get(workspace.repositoryId);
    if (!c?.author?.name || !c.author.email)
      throw new Error(
        "Configure the Git connection's commit author name and email before implementation.",
      );
    return { ...c, author: c.author };
  }
  function adapter(workspace: Workspace) {
    const c = credentials.get(workspace.repositoryId);
    if (!c)
      throw new Error(
        config.preparationErrors?.[workspace.repositoryId] ??
          "Git connection unavailable.",
      );
    if (!c.connection) throw new Error("Git connection unavailable.");
    const a = factory(c.connection, c.token);
    if (!a.findPull || !a.createDraft)
      throw new Error("Git provider does not support draft publication.");
    return {
      find: a.findPull.bind(a),
      create: a.createDraft.bind(a),
      repo: c.repository,
    };
  }
  async function reconcile(workspace: Workspace) {
    const a = adapter(workspace),
      c = credential(workspace);
    const pull = await a.find(a.repo, workspace.branch, workspace.targetBranch);
    if (pull) {
      await guard(workspace, async (tx) => {
        await tx.update(w).set({ pull }).where(eq(w.id, workspace.id));
      });
      workspace.pull = pull;
      await saveOutcome(workspace, { pull });
      if (pull.state !== "open" || !pull.draft)
        throw new Error(
          "The PR/MR is closed, merged, or marked ready. Return it to an open draft on the provider before continuing.",
        );
    } else if (workspace.pull)
      throw new Error(
        "The linked PR/MR could not be found. Check it on the provider before continuing.",
      );
    if (!workspace.pending) return;
    const pending = workspace.pending;
    await saveOutcome(workspace, {
      status: "publishing",
      commit: pending.commit,
    });
    await operation(workspace, () =>
      git.push(workspace, c, pending.commit, pending.expectedRemote, signal),
    );
    await guard(workspace, async (tx) => {
      await tx
        .update(w)
        .set({ remoteCommit: pending.commit, updatedAt: new Date() })
        .where(eq(w.id, workspace.id));
    });
    workspace.remoteCommit = pending.commit;
    // Lookup before every create, including after a lost response. Both providers reject duplicate open source/target requests.
    const existing = await a.find(
      a.repo,
      workspace.branch,
      workspace.targetBranch,
    );
    if (existing && (existing.state !== "open" || !existing.draft))
      throw new Error(
        "The PR/MR changed state during publication. Inspect it before continuing.",
      );
    const linked =
      existing ??
      (await operation(workspace, async () =>
        a.create(
          a.repo,
          {
            source: workspace.branch,
            target: workspace.targetBranch,
            title: pending.title,
            body: pending.body,
          },
          signal,
        ),
      ));
    await guard(workspace, async (tx) => {
      await tx
        .update(w)
        .set({
          pull: linked,
          pending: null,
          remoteCommit: pending.commit,
          headCommit: pending.commit,
          updatedAt: new Date(),
        })
        .where(eq(w.id, workspace.id));
    });
    workspace.pending = null;
    workspace.pull = linked;
    await saveOutcome(workspace, {
      status: "published",
      pull: linked,
      commit: pending.commit,
      error: undefined,
    });
  }
  return {
    async prepare(activity: (message: string) => Promise<void>) {
      const workspaces = await ownedWorkspaces(db, run);
      config.writable = [];
      for (const workspace of workspaces) {
        try {
          await reconcile(workspace);
          const prepared = await operation(workspace, () =>
            git.prepare(workspace, credential(workspace), signal),
          );
          await guard(workspace, async (tx) => {
            await tx
              .update(w)
              .set({ baseCommit: prepared.base, headCommit: prepared.head })
              .where(eq(w.id, workspace.id));
          });
          const repo = run.repositories.find(
            (r) => r.id === workspace.repositoryId,
          )!;
          repo.commit = prepared.head;
          if (prepared.target !== prepared.base)
            await activity(
              `${repo.fullName}: the target branch has advanced since implementation began. Recheck the plan and integration before marking ready.`,
            );
          config.writable.push({
            repositoryId: workspace.repositoryId,
            workspaceId: workspace.id,
          });
          available.add(workspace.repositoryId);
          await saveOutcome(workspace, {
            status: "saved",
            commit: prepared.head,
            error: undefined,
          });
        } catch (e) {
          signal.throwIfAborted();
          await saveOutcome(workspace, {
            status: "failed",
            error:
              e instanceof Error ? e.message : "Workspace preparation failed.",
          });
        }
      }
      config.repositories = config.repositories.filter((c) =>
        available.has(c.repository.id),
      );
      run.context.unavailableRepositories = [...outcomes.values()]
        .filter((o) => o.status === "failed")
        .map((o) => ({ repositoryId: o.repositoryId, reason: o.error }));
      if (!available.size)
        throw new Error(
          "No implementation workspace could be prepared. See repository outcomes; saved work is retained.",
        );
    },
    async publish() {
      for (const workspace of await ownedWorkspaces(db, run)) {
        if (!available.has(workspace.repositoryId)) continue;
        try {
          const c = credential(workspace),
            note = contribution(run, appURL);
          if (workspace.contributions.some((c) => c.runId !== run.id)) {
            // Unfinished edits can outlive their original agent. Preserve every contributor until the commit is checkpointed.
            note.message +=
              "\nWorkspace contributions:\n" +
              workspace.contributions
                .filter((c) => c.runId !== run.id)
                .map(
                  (c) =>
                    `Spectron-Agent: ${line(c.agentName)}\nSpectron-Requested-By: ${line(c.requesterName)}\nSpectron-Run: ${c.runId}`,
                )
                .join("\n\n") +
              "\n";
            note.body +=
              "\n\nWorkspace contributions:\n" +
              workspace.contributions
                .filter((c) => c.runId !== run.id)
                .map(
                  (c) =>
                    `- ${line(c.agentName)}; requested by ${line(c.requesterName)}; run ${c.runId}`,
                )
                .join("\n");
          }
          // A crash after commit but before this DB checkpoint is recovered from the protected local branch HEAD.
          const commit = await operation(workspace, () =>
            git.commit(workspace, c, note.message, signal),
          );
          if (commit === (workspace.remoteCommit ?? workspace.baseCommit)) {
            await guard(workspace, async (tx) => {
              await tx
                .update(w)
                .set({ contributions: [] })
                .where(eq(w.id, workspace.id));
            });
            await saveOutcome(workspace, {
              status: workspace.pull ? "published" : "unchanged",
              commit,
              error: undefined,
            });
            continue;
          }
          const pending = {
            commit,
            expectedRemote: workspace.remoteCommit,
            title: note.title,
            body: note.body,
            runId: run.id,
          };
          await guard(workspace, async (tx) => {
            await tx
              .update(w)
              .set({ pending, headCommit: commit, contributions: [] })
              .where(eq(w.id, workspace.id));
          });
          workspace.pending = pending;
          await reconcile(workspace);
        } catch (e) {
          signal.throwIfAborted();
          await saveOutcome(workspace, {
            status: "failed",
            error:
              e instanceof Error
                ? e.message
                : "Publication failed. Continue explicitly to reconcile.",
          });
        }
      }
      return [...outcomes.values()].some((o) => o.status === "failed");
    },
  };
}
