import { and, eq, sql } from "drizzle-orm";
import { schema } from "@spectron/db";
import {
  createId,
  type GitRepository,
  type ImplementationOutcome,
} from "@spectron/shared";
import { IssueConflictError, IssueInputError } from "../issues";
import type { RunDB, Run } from "./service";
const w = schema.agentWorkspace;
export type Workspace = typeof w.$inferSelect;
export async function reserveWorkspaces(
  db: RunDB,
  run: Run,
  repositories: GitRepository[],
) {
  const outcomes: ImplementationOutcome[] = [];
  let hasPendingPublication = false;
  // The caller holds the project lock; deterministic ordering also permits future finer locking.
  for (const repo of [...repositories].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const id = createId();
    await db
      .insert(w)
      .values({
        id,
        projectId: run.projectId,
        issueId: run.issueId,
        repositoryId: repo.id,
        branch: `spectron/${id}`,
        targetBranch: repo.targetBranch,
      })
      .onConflictDoNothing();
    const [workspace] = await db
      .select()
      .from(w)
      .where(and(eq(w.issueId, run.issueId), eq(w.repositoryId, repo.id)))
      .for("update");
    if (!workspace) throw new Error("Workspace unavailable.");
    hasPendingPublication ||= !!workspace.pending;
    if (workspace.ownerRunId && workspace.ownerRunId !== run.id)
      throw new IssueConflictError(
        "An implementation already owns this repository workspace. Send instructions to that run, or stop it and wait for cleanup before continuing.",
      );
    if (
      run.context.publicationOnly &&
      workspace.lastRunId !== run.context.continuationId
    )
      throw new IssueConflictError(
        "Newer work exists in this workspace. Retry publication from its latest run.",
      );
    if (workspace.targetBranch !== repo.targetBranch)
      throw new IssueInputError(
        "This implementation uses a different target branch. Restore the repository target setting before continuing.",
      );
    if (workspace.pull && workspace.pull.state !== "open")
      throw new IssueInputError(
        "This implementation's PR/MR is closed or merged. Start a new issue for new work.",
      );
    await db
      .update(w)
      .set({
        ownerRunId: run.id,
        lastRunId: run.id,
        contributions: run.context.publicationOnly
          ? workspace.contributions
          : [
              ...workspace.contributions,
              {
                runId: run.id,
                agentName: run.agent.name,
                requesterName: run.requesterName,
              },
            ],
        updatedAt: new Date(),
      })
      .where(eq(w.id, workspace.id));
    outcomes.push({
      workspaceId: workspace.id,
      repositoryId: repo.id,
      branch: workspace.branch,
      targetBranch: workspace.targetBranch,
      status: "preparing",
      ...(workspace.pull ? { pull: workspace.pull } : {}),
    });
  }
  if (run.context.publicationOnly && !hasPendingPublication)
    throw new IssueInputError(
      "There is no pending publication. Use Retry implementation to run the agent with the saved request.",
    );
  await db
    .update(schema.agentRun)
    .set({ implementation: outcomes })
    .where(eq(schema.agentRun.id, run.id));
}
export async function ownedWorkspaces(db: RunDB, run: Run) {
  const rows = await db.select().from(w).where(eq(w.ownerRunId, run.id));
  if (rows.length !== run.repositories.length)
    throw new Error("Implementation workspace ownership was lost.");
  return rows;
}
export async function releaseWorkspaces(db: RunDB, run: Run) {
  // Never release a waiting run: its unfinished work is reserved until explicit resume/Stop.
  await db
    .update(w)
    .set({ ownerRunId: null, updatedAt: new Date() })
    .where(
      and(
        eq(w.ownerRunId, run.id),
        sql`EXISTS (SELECT 1 FROM agent_runs WHERE id = ${run.id} AND (claim = ${run.claim} OR (claim IS NULL AND state IN ('completed','failed','stopped') AND NOT container_retained)))`,
      ),
    );
}
