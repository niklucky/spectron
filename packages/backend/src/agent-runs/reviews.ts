import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type {
  AgentRunScope,
  FindingEdit,
  ReviewTarget,
  ReviewFindingInput,
} from "@spectron/shared";
import { runAccess, type RunDB } from "./service";
import { createGitService } from "../git/service";
import {
  createGitAdapterFactory,
  type GitAdapterFactory,
} from "../git/provider";
import { decryptGitToken } from "../git/credentials";
import { reviewLocation, type ReviewDiff } from "../git/reviews";
import { IssueConflictError, IssueInputError } from "../issues";
import { ProjectAccessError } from "../projects";
const {
  agentRun: r,
  agentWorkspace: w,
  agentReviewFinding: f,
  gitConnection: c,
} = schema;
type Ref = AgentRunScope & { id: string };
export function validReviewFindings(value: unknown): ReviewFindingInput[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new IssueInputError(
      "The review must return at most 100 structured findings.",
    );
  return value.map((v) => {
    if (
      !v ||
      typeof v !== "object" ||
      typeof v.path !== "string" ||
      !v.path ||
      v.path.length > 4096 ||
      v.path.startsWith("/") ||
      v.path.split("/").includes("..") ||
      /[\x00-\x1f]/.test(v.path) ||
      !Number.isSafeInteger(v.line) ||
      v.line < 1 ||
      !["LEFT", "RIGHT"].includes(v.side) ||
      typeof v.explanation !== "string" ||
      !v.explanation.trim() ||
      v.explanation.length > 20000 ||
      (v.suggestedFix !== undefined &&
        (typeof v.suggestedFix !== "string" || v.suggestedFix.length > 20000))
    )
      throw new IssueInputError(
        "The agent returned an invalid review finding. Start a new review.",
      );
    return {
      path: v.path,
      line: v.line,
      side: v.side,
      explanation: v.explanation.trim(),
      ...(v.suggestedFix ? { suggestedFix: v.suggestedFix } : {}),
    };
  });
}
export async function reviewTargets(
  db: RunDB,
  userId: string,
  scope: AgentRunScope,
): Promise<ReviewTarget[]> {
  await runAccess(db, userId, scope);
  const repos = await createGitService(db as Database).repositories(
    userId,
    scope.projectId,
  );
  const rows = await db
    .select()
    .from(w)
    .where(and(eq(w.projectId, scope.projectId), eq(w.issueId, scope.issueId)))
    .orderBy(asc(w.createdAt));
  return rows.flatMap((row) => {
    const repo = repos.find((repo) => repo.id === row.repositoryId);
    return row.pull && repo
      ? [
          {
            workspaceId: row.id,
            repositoryId: repo.id,
            repositoryName: repo.fullName,
            pull: row.pull,
          },
        ]
      : [];
  });
}
export function createReviewService(
  db: Database,
  secret?: string,
  factory: GitAdapterFactory = createGitAdapterFactory(),
) {
  async function controlled(tx: RunDB, userId: string, ref: Ref) {
    const access = await runAccess(tx, userId, ref, true, true);
    const [run] = await tx
      .select()
      .from(r)
      .where(
        and(
          eq(r.id, ref.id),
          eq(r.issueId, ref.issueId),
          eq(r.projectId, ref.projectId),
        ),
      )
      .for("update");
    if ((!run?.review && !run?.context.branchReview) || (run.requesterId !== userId && access.role !== "owner"))
      throw new ProjectAccessError(
        "Only the review requester or a project owner can edit or publish findings.",
      );
    if (run.state !== "completed" || run.stopRequested)
      throw new IssueInputError(
        "Only completed reviews can be published or edited.",
      );
    await createGitService(tx as Database).authorizeRepositories(
      userId,
      ref.projectId,
      [run.review?.repositoryId ?? (run.context.branchReview as import("@spectron/shared").BranchReview).repositoryId],
    );
    return run;
  }
  async function client(userId: string, ref: Ref) {
    const run = await db.transaction((tx) => controlled(tx, userId, ref));
    if(!run.review)throw new IssueInputError("Branch review findings are local. Review a linked PR/MR to publish comments.");
    const [repo] = await createGitService(db).authorizeRepositories(
      userId,
      ref.projectId,
      [run.review!.repositoryId],
    );
    const original = run.repositories.find((v) => v.id === repo!.id);
    if (
      !original ||
      repo!.revision !== original.revision ||
      repo!.connectionId !== original.connectionId
    )
      throw new IssueInputError(
        "Repository settings changed. Run a fresh review.",
      );
    const [connection] = await db
      .select()
      .from(c)
      .where(and(eq(c.id, repo!.connectionId), eq(c.projectId, ref.projectId)));
    if (!connection)
      throw new ProjectAccessError("Git connection unavailable.");
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
    const adapter = factory(connection, token);
    if (!adapter.reviews)
      throw new IssueInputError(
        "Review publication is unavailable for this provider.",
      );
    return { run, repo: repo!, adapter: adapter.reviews, connection };
  }
  return {
    reviewTargets: (userId: string, scope: AgentRunScope) =>
      reviewTargets(db, userId, scope),
    async editFinding(userId: string, args: FindingEdit) {
      if (
        !args.explanation.trim() ||
        args.explanation.length > 20000 ||
        args.suggestedFix.length > 20000
      )
        throw new IssueInputError(
          "Enter a finding and optional fix up to 20,000 characters each.",
        );
      await db.transaction(async (tx) => {
        await controlled(tx, userId, args);
        const [saved] = await tx
          .update(f)
          .set({
            explanation: args.explanation.trim(),
            suggestedFix: args.suggestedFix,
            state: args.dismissed ? "dismissed" : "draft",
            error: null,
            revision: args.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(f.id, args.findingId),
              eq(f.runId, args.id),
              eq(f.revision, args.revision),
              inArray(
                f.state,
                args.dismissed
                  ? ["draft", "dismissed", "stale"]
                  : ["draft", "dismissed"],
              ),
            ),
          )
          .returning({ id: f.id });
        if (!saved)
          throw new IssueConflictError(
            "This finding changed or cannot be edited. Reload the review.",
          );
      });
    },
    async publishFindings(
      userId: string,
      args: Ref & { findingIds: string[] },
    ) {
      if (
        !args.findingIds.length ||
        args.findingIds.length > 100 ||
        new Set(args.findingIds).size !== args.findingIds.length
      )
        throw new IssueInputError(
          "Select between 1 and 100 distinct findings.",
        );
      // Validate the entire selection before any remote effect.
      await db.transaction(async (tx) => {
        await controlled(tx, userId, args);
        const rows = await tx
          .select()
          .from(f)
          .where(and(eq(f.runId, args.id), inArray(f.id, args.findingIds)));
        if (rows.length !== args.findingIds.length)
          throw new ProjectAccessError("Finding not found in this review.");
      });
      for (const id of args.findingIds) {
        const { run, repo, adapter, connection } = await client(userId, args);
        const [finding] = await db
          .select()
          .from(f)
          .where(and(eq(f.id, id), eq(f.runId, run.id)));
        if (
          !finding ||
          ["published", "dismissed", "stale"].includes(finding.state)
        )
          continue;
        const marker = `<!-- spectron-review:${id} -->`;
        // A durable attempt is never sent twice. Ambiguous outcomes permit only read-only reconciliation.
        if (["publishing", "uncertain"].includes(finding.state)) {
          let remote;
          try {
            remote = await adapter.findFinding(repo, run.review!.pull, marker);
          } catch {
            throw new IssueInputError(
              "Could not reconcile this publication. Retry after the provider is available.",
            );
          }
          if (remote)
            await db
              .update(f)
              .set({
                state: "published",
                externalId: remote.id,
                externalURL: remote.url,
                error: null,
                updatedAt: new Date(),
              })
              .where(eq(f.id, id));
          else
            await db
              .update(f)
              .set({
                state: "uncertain",
                error:
                  "Publication is unconfirmed. Check the provider, then reconcile again. This finding will not be sent twice.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(f.id, id),
                  inArray(f.state, ["publishing", "uncertain"]),
                ),
              );
          continue;
        }
        let diff: ReviewDiff;
        try {
          diff = await adapter.review(repo, run.review!.pull.number);
        } catch {
          throw new IssueInputError(
            "The current PR/MR diff could not be verified. No finding was sent. Retry when the provider is available.",
          );
        }
        const original = run.context.reviewDiff as ReviewDiff | undefined;
        const stale =
          diff.pull.state !== "open" ||
          diff.pull.head !== run.review!.pull.head ||
          diff.base !== original?.base ||
          diff.start !== original?.start ||
          diff.pull.targetBranch !== run.review!.pull.targetBranch ||
          diff.pull.sourceBranch !== run.review!.pull.sourceBranch ||
          !reviewLocation(diff, finding);
        if (stale) {
          await db
            .update(f)
            .set({
              state: "stale",
              error:
                "The PR/MR changed or this location cannot be verified. Run a fresh review before publishing.",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(f.id, id),
                eq(f.state, "draft"),
                eq(f.revision, finding.revision),
              ),
            );
          continue;
        }
        const claimed = await db.transaction(async (tx) => {
          await controlled(tx, userId, args);
          const [currentRepository] = await tx
            .select()
            .from(schema.gitRepository)
            .where(eq(schema.gitRepository.id, repo.id))
            .for("share");
          if (currentRepository?.revision !== repo.revision)
            throw new IssueConflictError(
              "Repository settings changed. Run a fresh review.",
            );
          const [currentConnection] = await tx
            .select()
            .from(c)
            .where(eq(c.id, connection.id))
            .for("share");
          if (currentConnection?.revision !== connection.revision)
            throw new IssueConflictError(
              "Git credentials changed. Retry publication.",
            );
          return (
            await tx
              .update(f)
              .set({
                state: "publishing",
                publishedBy: userId,
                revision: finding.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(f.id, id),
                  eq(f.state, "draft"),
                  eq(f.revision, finding.revision),
                ),
              )
              .returning()
          )[0];
        });
        if (!claimed) continue;
        try {
          const body = `${finding.explanation}${finding.suggestedFix ? `\n\nSuggested fix:\n${finding.suggestedFix}` : ""}\n\nReview by ${run.agent.name}; published by a Spectron project member.\n${marker}`;
          const remote = await adapter.publishFinding(
            repo,
            diff,
            finding,
            body,
          );
          await db
            .update(f)
            .set({
              state: "published",
              externalId: remote.id,
              externalURL: remote.url,
              error: null,
              updatedAt: new Date(),
            })
            .where(eq(f.id, id));
        } catch {
          await db
            .update(f)
            .set({
              state: "uncertain",
              error:
                "Provider publication could not be confirmed. Reconcile to find the original comment; it will not be sent again.",
              updatedAt: new Date(),
            })
            .where(and(eq(f.id, id), eq(f.state, "publishing")));
        }
      }
    },
  };
}
