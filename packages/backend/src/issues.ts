import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type {
  HistoryChanges,
  IssueFields,
  IssueOptionInput,
  IssueSettings,
  IssueSummary,
} from "@spectron/shared";
import { validateCustomFields } from "./project-fields";
import { ProjectAccessError } from "./projects";

const {
  project,
  projectMember,
  issue,
  issueState,
  issuePriority,
  issueHistory,
  projectHistory,
  user,
} = schema;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OptionalFields = { [K in keyof IssueFields]?: IssueFields[K] | undefined };
export class IssueInputError extends Error {}
export class IssueConflictError extends Error {}

export async function seedIssueSettings(tx: Tx, projectId: string) {
  await tx.insert(issueState).values(
    [
      { name: "Todo", trigger: "opened" as const, isDefault: true },
      { name: "In progress", trigger: "in_progress" as const },
      { name: "Blocked", trigger: "blocked" as const },
      { name: "Cancelled", trigger: "cancelled" as const },
      { name: "Done", trigger: "finished" as const },
    ].map((s, position) => ({ ...s, projectId, position })),
  );
  await tx
    .insert(issuePriority)
    .values(
      ["Urgent", "High", "Normal", "Low"].map((name, position) => ({
        projectId,
        name,
        position,
      })),
    );
}
function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): HistoryChanges {
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        Object.keys(after)
          .filter(
            (key) =>
              JSON.stringify(before[key] ?? null) !==
              JSON.stringify(after[key] ?? null),
          )
          .map((key) => [
            key,
            { before: before[key] ?? null, after: after[key] ?? null },
          ]),
      ),
    ),
  ) as HistoryChanges;
}
const summary = (
  row: typeof issue.$inferSelect,
  prefix: string,
): IssueSummary => ({
  ...row,
  key: `${prefix}-${row.number}`,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() ?? null,
});
export async function issueAccess(
  tx: Tx,
  userId: string,
  projectId: string,
  write = false,
  owner = false,
) {
  // All project writes share this lock: allocation, parenting, config and archive.
  const [p] = await tx
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .for(write ? "update" : "share");
  const [member] = await tx
    .select()
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
      ),
    )
    .for("share");
  if (!p || !member || (owner && member.role !== "owner"))
    throw new ProjectAccessError("Project not found or not editable.");
  if (write && p.state !== "active")
    throw new IssueInputError("Archived projects are read-only.");
  return p;
}
async function validate(
  tx: Tx,
  projectId: string,
  input: OptionalFields,
  current?: typeof issue.$inferSelect,
) {
  if (input.customFields !== undefined)
    await validateCustomFields(tx, projectId, input.customFields);
  if (
    input.title !== undefined &&
    (!input.title.trim() || input.title.length > 140)
  )
    throw new IssueInputError("Enter a title of up to 140 characters.");
  if (input.description !== undefined && input.description.length > 100_000)
    throw new IssueInputError("Description is too long.");
  if (input.stateId !== undefined && input.stateId !== current?.stateId) {
    const [state] = await tx
      .select()
      .from(issueState)
      .where(
        and(
          eq(issueState.id, input.stateId),
          eq(issueState.projectId, projectId),
          isNull(issueState.deletedAt),
        ),
      );
    if (!state)
      throw new IssueInputError("Choose an active state from this project.");
  }
  if (input.priorityId && input.priorityId !== current?.priorityId) {
    const [priority] = await tx
      .select()
      .from(issuePriority)
      .where(
        and(
          eq(issuePriority.id, input.priorityId),
          eq(issuePriority.projectId, projectId),
          isNull(issuePriority.deletedAt),
        ),
      );
    if (!priority)
      throw new IssueInputError("Choose an active priority from this project.");
  }
  if (input.assigneeId && input.assigneeId !== current?.assigneeId) {
    const [member] = await tx
      .select()
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.userId, input.assigneeId),
        ),
      )
      .for("share");
    if (!member)
      throw new IssueInputError("Assignee must belong to this project.");
  }
  if (input.parentId && input.parentId !== current?.parentId) {
    let parentId: string | null = input.parentId;
    const seen = new Set<string>(current ? [current.id] : []);
    while (parentId) {
      if (seen.has(parentId))
        throw new IssueInputError("An issue cannot be its own ancestor.");
      seen.add(parentId);
      const [parent] = await tx
        .select()
        .from(issue)
        .where(
          and(
            eq(issue.id, parentId),
            eq(issue.projectId, projectId),
            isNull(issue.deletedAt),
          ),
        );
      if (!parent)
        throw new IssueInputError(
          "Choose a non-deleted parent from this project.",
        );
      parentId = parent.parentId;
    }
  }
}
export function createIssueService(db: Database) {
  return {
    async list(userId: string, projectId: string) {
      return db.transaction(async (tx) => {
        const p = await issueAccess(tx, userId, projectId);
        const rows = await tx
          .select()
          .from(issue)
          .where(eq(issue.projectId, projectId))
          .orderBy(desc(issue.updatedAt), desc(issue.number));
        return rows.map((row) => summary(row, p.key));
      });
    },
    async settings(userId: string, projectId: string): Promise<IssueSettings> {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, projectId);
        const states = await tx
          .select()
          .from(issueState)
          .where(eq(issueState.projectId, projectId))
          .orderBy(asc(issueState.position), asc(issueState.id));
        const priorities = await tx
          .select()
          .from(issuePriority)
          .where(eq(issuePriority.projectId, projectId))
          .orderBy(asc(issuePriority.position), asc(issuePriority.id));
        return {
          fields: await tx
            .select({
              id: schema.projectField.id,
              name: schema.projectField.name,
              type: schema.projectField.type,
            })
            .from(schema.projectField)
            .where(eq(schema.projectField.projectId, projectId)),
          states: states.map((s) => ({
            ...s,
            deletedAt: s.deletedAt?.toISOString() ?? null,
          })),
          priorities: priorities.map((s) => ({
            ...s,
            deletedAt: s.deletedAt?.toISOString() ?? null,
          })),
        };
      });
    },
    async create(
      userId: string,
      input: { projectId: string; title: string } & Omit<
        OptionalFields,
        "title"
      >,
    ) {
      return db.transaction(async (tx) => {
        const p = await issueAccess(tx, userId, input.projectId, true);
        const [defaultState] = await tx
          .select()
          .from(issueState)
          .where(
            and(
              eq(issueState.projectId, p.id),
              eq(issueState.isDefault, true),
              isNull(issueState.deletedAt),
            ),
          );
        if (!defaultState)
          throw new IssueInputError(
            "Select a default Opened state in project settings.",
          );
        const values: IssueFields = {
          title: input.title.trim(),
          description: input.description ?? "",
          parentId: input.parentId ?? null,
          assigneeId: input.assigneeId ?? null,
          priorityId: input.priorityId ?? null,
          stateId: input.stateId ?? defaultState.id,
          customFields: input.customFields ?? {},
        };
        await validate(tx, p.id, values);
        const number = p.issueCounter + 1;
        await tx
          .update(project)
          .set({ issueCounter: number })
          .where(eq(project.id, p.id));
        const [row] = await tx
          .insert(issue)
          .values({ ...values, projectId: p.id, number, authorId: userId })
          .returning();
        const result = summary(row!, p.key);
        await tx
          .insert(issueHistory)
          .values({
            issueId: row!.id,
            actorUserId: userId,
            action: "created",
            createdAt: row!.createdAt,
            changes: changes({}, result),
          });
        return result;
      });
    },
    async update(
      userId: string,
      input: {
        projectId: string;
        id: string;
        expectedUpdatedAt: string;
      } & OptionalFields,
    ) {
      return db.transaction(async (tx) => {
        const p = await issueAccess(tx, userId, input.projectId, true);
        const [row] = await tx
          .select()
          .from(issue)
          .where(and(eq(issue.id, input.id), eq(issue.projectId, p.id)));
        if (!row) throw new ProjectAccessError("Issue not found.");
        if (row.deletedAt)
          throw new IssueInputError("Restore the issue before editing it.");
        if (row.updatedAt.toISOString() !== input.expectedUpdatedAt)
          throw new IssueConflictError(
            "This issue changed. Reload it before saving your edits.",
          );
        const {
          projectId: _,
          id: __,
          expectedUpdatedAt: ___,
          ...values
        } = input;
        if (values.title !== undefined) values.title = values.title.trim();
        await validate(tx, p.id, values, row);
        const clean = Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== undefined),
        );
        const diff = changes(row, clean);
        if (!Object.keys(diff).length) return summary(row, p.key);
        const [updated] = await tx
          .update(issue)
          .set({
            ...values,
            updatedAt: new Date(
              Math.max(Date.now(), row.updatedAt.getTime() + 1),
            ),
          })
          .where(eq(issue.id, row.id))
          .returning();
        await tx
          .insert(issueHistory)
          .values({
            issueId: row.id,
            actorUserId: userId,
            action: "updated",
            changes: diff,
          });
        return summary(updated!, p.key);
      });
    },
    async setDeleted(
      userId: string,
      input: {
        projectId: string;
        id: string;
        deleted: boolean;
        expectedUpdatedAt: string;
      },
    ) {
      return db.transaction(async (tx) => {
        const p = await issueAccess(tx, userId, input.projectId, true);
        const [row] = await tx
          .select()
          .from(issue)
          .where(and(eq(issue.id, input.id), eq(issue.projectId, p.id)));
        if (!row) throw new ProjectAccessError("Issue not found.");
        if (row.updatedAt.toISOString() !== input.expectedUpdatedAt)
          throw new IssueConflictError(
            "This issue changed. Reload it before continuing.",
          );
        if (Boolean(row.deletedAt) === input.deleted)
          return summary(row, p.key);
        if (input.deleted) {
          const [child] = await tx
            .select({ id: issue.id })
            .from(issue)
            .where(and(eq(issue.parentId, row.id), isNull(issue.deletedAt)))
            .limit(1);
          if (child)
            throw new IssueInputError(
              "Reparent or delete this issue’s children first.",
            );
        } else if (row.parentId) {
          await validate(tx, p.id, { parentId: row.parentId });
        }
        const deletedAt = input.deleted ? new Date() : null;
        const [updated] = await tx
          .update(issue)
          .set({
            deletedAt,
            updatedAt: new Date(
              Math.max(Date.now(), row.updatedAt.getTime() + 1),
            ),
          })
          .where(eq(issue.id, row.id))
          .returning();
        await tx
          .insert(issueHistory)
          .values({
            issueId: row.id,
            actorUserId: userId,
            action: input.deleted ? "deleted" : "restored",
            changes: {
              deletedAt: {
                before: row.deletedAt?.toISOString() ?? null,
                after: deletedAt?.toISOString() ?? null,
              },
            },
          });
        return summary(updated!, p.key);
      });
    },
    async history(userId: string, projectId: string, id: string, offset = 0) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, projectId);
        const [row] = await tx
          .select({ id: issue.id })
          .from(issue)
          .where(and(eq(issue.id, id), eq(issue.projectId, projectId)));
        if (!row) throw new ProjectAccessError("Issue not found.");
        const rows = await tx
          .select({ entry: issueHistory, actorName: user.name })
          .from(issueHistory)
          .innerJoin(user, eq(user.id, issueHistory.actorUserId))
          .where(eq(issueHistory.issueId, id))
          .orderBy(asc(issueHistory.createdAt), asc(issueHistory.id))
          .limit(100)
          .offset(offset);
        return rows.map(({ entry, actorName }) => ({
          ...entry,
          actorName,
          createdAt: entry.createdAt.toISOString(),
        }));
      });
    },
    async saveOption(userId: string, input: IssueOptionInput) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, input.projectId, true, true);
        if (!input.name.trim() || input.name.length > 80)
          throw new IssueInputError("Enter a name of up to 80 characters.");
        const table = input.kind === "state" ? issueState : issuePriority;
        const [before] = input.id
          ? await tx
              .select()
              .from(table)
              .where(
                and(
                  eq(table.id, input.id),
                  eq(table.projectId, input.projectId),
                ),
              )
          : [];
        if (input.id && (!before || before.deletedAt))
          throw new IssueInputError("Option not found or deleted.");
        const common = {
          name: input.name.trim(),
          position: input.position,
          color: input.color,
        };
        let result;
        if (input.kind === "state") {
          if (!input.trigger)
            throw new IssueInputError("Choose a canonical state.");
          const stateBefore = before as
            | typeof issueState.$inferSelect
            | undefined;
          const isDefault = input.isDefault ?? stateBefore?.isDefault ?? false;
          if (isDefault && input.trigger !== "opened")
            throw new IssueInputError("The default state must map to Opened.");
          if (stateBefore?.isDefault && !isDefault)
            throw new IssueInputError("Choose another default state first.");
          // Historical use also locks the mapping, including after issues move away.
          if (stateBefore && stateBefore.trigger !== input.trigger) {
            throw new IssueInputError(
              "Canonical mappings are fixed. Create a replacement state instead.",
            );
          }
          if (isDefault) {
            const [previousDefault] = await tx
              .select()
              .from(issueState)
              .where(
                and(
                  eq(issueState.projectId, input.projectId),
                  eq(issueState.isDefault, true),
                ),
              );
            if (previousDefault && previousDefault.id !== input.id) {
              await tx
                .update(issueState)
                .set({ isDefault: false })
                .where(eq(issueState.id, previousDefault.id));
              await tx
                .insert(projectHistory)
                .values({
                  projectId: input.projectId,
                  actorUserId: userId,
                  entityId: previousDefault.id,
                  entityType: "state",
                  changes: { isDefault: { before: true, after: false } },
                });
            }
          }
          const values = { ...common, trigger: input.trigger, isDefault };
          [result] = input.id
            ? await tx
                .update(issueState)
                .set(values)
                .where(eq(issueState.id, input.id))
                .returning()
            : await tx
                .insert(issueState)
                .values({ ...values, projectId: input.projectId })
                .returning();
        } else {
          [result] = input.id
            ? await tx
                .update(issuePriority)
                .set(common)
                .where(eq(issuePriority.id, input.id))
                .returning()
            : await tx
                .insert(issuePriority)
                .values({ ...common, projectId: input.projectId })
                .returning();
        }
        await tx
          .insert(projectHistory)
          .values({
            projectId: input.projectId,
            actorUserId: userId,
            entityType: input.kind,
            entityId: result!.id,
            changes: changes(before ?? {}, result!),
          });
        return { id: result!.id };
      });
    },
    async deleteOption(
      userId: string,
      input: { projectId: string; kind: "state" | "priority"; id: string },
    ) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, input.projectId, true, true);
        const table = input.kind === "state" ? issueState : issuePriority;
        const [row] = await tx
          .select()
          .from(table)
          .where(
            and(eq(table.id, input.id), eq(table.projectId, input.projectId)),
          );
        if (!row) throw new IssueInputError("Option not found.");
        if (row.deletedAt) return;
        if ("isDefault" in row && row.isDefault)
          throw new IssueInputError(
            "Choose another default state before deleting this one.",
          );
        const deletedAt = new Date();
        await tx.update(table).set({ deletedAt }).where(eq(table.id, row.id));
        await tx
          .insert(projectHistory)
          .values({
            projectId: input.projectId,
            actorUserId: userId,
            entityId: row.id,
            entityType: input.kind,
            changes: {
              deletedAt: { before: null, after: deletedAt.toISOString() },
            },
          });
      });
    },
  };
}
export type IssueService = ReturnType<typeof createIssueService>;
