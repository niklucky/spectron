import { enqueueExport } from "./integrations/export-events";
import { sql, and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Database } from "@spectron/db";
import type {
  HistoryChanges,
  WorklogFields,
  WorklogPage,
  WorklogScope,
} from "@spectron/shared";
import { findExternalIdentity } from "./external-identities";
import { ProjectAccessError } from "./projects";
import { IssueConflictError, IssueInputError } from "./issues";
const {
  issueWorklog: worklog,
  issue,
  project,
  projectMember,
  user,
  issueHistory,
} = schema;
const worker = alias(user, "worker"),
  recorder = alias(user, "recorder");
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function access(
  tx: Tx,
  actor: string,
  scope: WorklogScope,
  write = false,
) {
  const [p] = await tx
    .select()
    .from(project)
    .where(eq(project.id, scope.projectId))
    .for(write ? "update" : "share");
  const [m] = await tx
    .select()
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, scope.projectId),
        eq(projectMember.userId, actor),
      ),
    )
    .for("share");
  if (!p || !m) throw new ProjectAccessError("Project not found.");
  const [i] = await tx
    .select()
    .from(issue)
    .where(
      and(eq(issue.id, scope.issueId), eq(issue.projectId, scope.projectId)),
    );
  if (!i) throw new ProjectAccessError("Issue not found.");
  if (write && (p.state !== "active" || i.deletedAt))
    throw new IssueInputError(
      "Worklogs are read-only for archived projects and deleted issues.",
    );
}
async function find(tx: Tx, scope: WorklogScope, id: string, version: string) {
  const [row] = await tx
    .select()
    .from(worklog)
    .where(
      and(
        eq(worklog.id, id),
        eq(worklog.issueId, scope.issueId),
        eq(worklog.projectId, scope.projectId),
      ),
    );
  if (!row) throw new ProjectAccessError("Worklog not found.");
  if (row.updatedAt.toISOString() !== version)
    throw new IssueConflictError(
      "This worklog changed. Cancel and reopen it before trying again.",
    );
  return row;
}
const fields = (row: typeof worklog.$inferSelect): WorklogFields => ({
  workerUserId: row.workerUserId ?? row.externalWorkerId!,
  startedAt: row.startedAt.toISOString(),
  durationSeconds: row.durationSeconds,
  description: row.description,
});
export function createWorklogService(db: Database) {
  return {
    async list(
      actor: string,
      input: WorklogScope & {
        includeDeleted: boolean;
        cursor?: { createdAt: string; id: string } | undefined;
      },
    ): Promise<WorklogPage> {
      return db.transaction(async (tx) => {
        await access(tx, actor, input);
        const rows = await tx
          .select({
            row: worklog,
            workerName: sql<string>`coalesce(${worker.name},${schema.externalIdentity.displayName},'Imported user')`,
            recorderName: recorder.name,
          })
          .from(worklog)
          .leftJoin(
            schema.externalIdentity,
            eq(schema.externalIdentity.id, worklog.externalWorkerId),
          )
          .leftJoin(
            worker,
            eq(
              worker.id,
              sql`coalesce(${worklog.workerUserId},${schema.externalIdentity.localUserId})`,
            ),
          )
          .innerJoin(recorder, eq(recorder.id, worklog.recordedBy))
          .where(
            and(
              eq(worklog.issueId, input.issueId),
              input.includeDeleted ? undefined : isNull(worklog.deletedAt),
              input.cursor
                ? or(
                    lt(worklog.createdAt, new Date(input.cursor.createdAt)),
                    and(
                      eq(worklog.createdAt, new Date(input.cursor.createdAt)),
                      lt(worklog.id, input.cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(worklog.createdAt), desc(worklog.id))
          .limit(21);
        const page = rows.slice(0, 20),
          last = page.at(-1)?.row;
        return {
          entries: page.map(({ row, workerName, recorderName }) => ({
            ...row,
            ...fields(row),
            workerName,
            recorderName,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            deletedAt: row.deletedAt?.toISOString() ?? null,
          })),
          nextCursor:
            rows.length > 20 && last
              ? { createdAt: last.createdAt.toISOString(), id: last.id }
              : null,
        };
      });
    },
    async save(
      actor: string,
      input: WorklogScope &
        WorklogFields & {
          id?: string | undefined;
          expectedUpdatedAt?: string | undefined;
        },
    ) {
      return db.transaction(async (tx) => {
        await access(tx, actor, input, true);
        const old = input.id
          ? await find(tx, input, input.id, input.expectedUpdatedAt ?? "")
          : undefined;
        if (old?.deletedAt)
          throw new IssueInputError("Restore the worklog before editing it.");
        const startedAt = new Date(input.startedAt);
        if (
          !Number.isFinite(startedAt.getTime()) ||
          !Number.isInteger(input.durationSeconds) ||
          input.durationSeconds < 1 ||
          input.durationSeconds > 2147483647 ||
          input.description.length > 10000
        )
          throw new IssueInputError(
            "Enter a valid start time, positive duration and description up to 10,000 characters.",
          );
        if (!old || old.workerUserId !== input.workerUserId) {
          const [m] = await tx
            .select()
            .from(projectMember)
            .where(
              and(
                eq(projectMember.projectId, input.projectId),
                eq(projectMember.userId, input.workerUserId),
              ),
            )
            .for("share");
          if (
            !m &&
            !(await findExternalIdentity(
              tx,
              input.projectId,
              input.workerUserId,
            ))
          )
            throw new IssueInputError("Choose a project member as the worker.");
        }
        const next: WorklogFields = {
            workerUserId: input.workerUserId,
            startedAt: startedAt.toISOString(),
            durationSeconds: input.durationSeconds,
            description: input.description.trim(),
          },
          before = old ? fields(old) : null,
          changes: HistoryChanges = {};
        for (const key of Object.keys(next) as (keyof WorklogFields)[])
          if (!before || before[key] !== next[key])
            changes[key] = { before: before?.[key] ?? null, after: next[key] };
        if (old && !Object.keys(changes).length) return { id: old.id };
        const now = new Date(
          Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1),
        );
        const identity = await findExternalIdentity(
          tx,
          input.projectId,
          input.workerUserId,
        );
        const values = {
          ...next,
          workerUserId: identity ? null : next.workerUserId,
          externalWorkerId: identity?.id ?? null,
          startedAt,
          updatedAt: now,
        };
        const [row] = old
          ? await tx
              .update(worklog)
              .set(values)
              .where(eq(worklog.id, old.id))
              .returning()
          : await tx
              .insert(worklog)
              .values({
                ...values,
                projectId: input.projectId,
                issueId: input.issueId,
                recordedBy: actor,
                createdAt: now,
              })
              .returning();
        if (!old) changes.recordedBy = { before: null, after: actor };
        await tx.insert(issueHistory).values({
          issueId: input.issueId,
          entityType: "worklog",
          entityId: row!.id,
          actorUserId: actor,
          action: old ? "updated" : "created",
          changes,
        });
        if (!old) await enqueueExport(tx, input.projectId, input.issueId, row!.id, "worklog.create");
        return { id: row!.id };
      });
    },
    async setDeleted(
      actor: string,
      input: WorklogScope & {
        id: string;
        expectedUpdatedAt: string;
        deleted: boolean;
      },
    ) {
      return db.transaction(async (tx) => {
        await access(tx, actor, input, true);
        const row = await find(tx, input, input.id, input.expectedUpdatedAt);
        if (!!row.deletedAt === input.deleted) return;
        if (input.deleted) await enqueueExport(tx, input.projectId, input.issueId, row.id, "worklog.delete");
        const now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
          deletedAt = input.deleted ? now : null;
        await tx
          .update(worklog)
          .set({ deletedAt, updatedAt: now })
          .where(eq(worklog.id, row.id));
        await tx.insert(issueHistory).values({
          issueId: input.issueId,
          entityType: "worklog",
          entityId: row.id,
          actorUserId: actor,
          action: input.deleted ? "deleted" : "restored",
          changes: {
            deletedAt: {
              before: row.deletedAt?.toISOString() ?? null,
              after: deletedAt?.toISOString() ?? null,
            },
          },
        });
      });
    },
  };
}
export type WorklogService = ReturnType<typeof createWorklogService>;
