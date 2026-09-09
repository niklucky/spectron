import { ISSUE_TITLE_MAX_LENGTH, ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
import { enqueueExport } from "./integrations/export-events";
import {
  historyChanges as changes,
  normalizeHistoryChanges,
} from "./history-changes";
import { and, asc, desc, eq, isNull, inArray } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  formatWorklogDuration,
  issueTimestamp,
  validateIssueTiming,
} from "@spectron/shared";
import type {
  IssueFields,
  IssueOptionInput,
  IssueSettings,
  IssueSummary,
} from "@spectron/shared";
import { findExternalIdentity } from "./external-identities";
import { validateFieldValues } from "./fields";
import { ProjectAccessError } from "./projects";

const {
  project,
  projectMember,
  issue,
  issueState,
  issuePriority,
  issueType, tag, issueTag,
  issueHistory,
  projectHistory,
  user,
} = schema;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OptionalFields = { [K in keyof IssueFields]?: IssueFields[K] | undefined };
export class IssueInputError extends Error {}
export class IssueConflictError extends Error {}

export async function issueTagIds(tx: Tx | Database, issueId: string): Promise<string[]> {
  return (await tx.select({ id: issueTag.tagId }).from(issueTag).where(eq(issueTag.issueId, issueId))).map(t => t.id).sort();
}
export async function setIssueTags(tx: Tx, projectId: string, issueId: string, ids: string[]) {
  await tx.delete(issueTag).where(eq(issueTag.issueId, issueId));
  if (ids.length) await tx.insert(issueTag).values([...new Set(ids)].map(tagId => ({ projectId, issueId, tagId })));
}
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
  await tx.insert(issueType).values(["Story", "Epic", "Bug", "Task"].map((name, position) => ({ projectId, name, position })));
  await tx.insert(issuePriority).values(
    ["Urgent", "High", "Normal", "Low"].map((name, position) => ({
      projectId,
      name,
      position,
    })),
  );
}
const summary = (
  row: typeof issue.$inferSelect,
  prefix: string,
): IssueSummary => ({
  ...row,
  startAt: issueTimestamp(row.startAt),
  finishAt: issueTimestamp(row.finishAt),
  authorId: row.authorId ?? row.externalAuthorId!,
  assigneeId: row.assigneeId ?? row.externalAssigneeId,
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
  try {
    validateIssueTiming({
      ...current,
      ...Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      ),
    });
  } catch (e) {
    throw new IssueInputError((e as Error).message);
  }
  if (input.issueTypeId && input.issueTypeId !== current?.issueTypeId) {
    const [type] = await tx.select().from(issueType).where(and(eq(issueType.id, input.issueTypeId), eq(issueType.projectId, projectId), isNull(issueType.deletedAt)));
    if (!type) throw new IssueInputError("Choose an active issue type from this project.");
  }
  if (input.tagIds !== undefined) {
    if (input.tagIds.length > 100 || new Set(input.tagIds).size !== input.tagIds.length) throw new IssueInputError("Choose up to 100 distinct tags.");
    const available = input.tagIds.length ? await tx.select().from(tag).where(and(eq(tag.projectId, projectId), inArray(tag.id, input.tagIds), isNull(tag.deletedAt))) : [];
    const existingTags = current ? await issueTagIds(tx, current.id) : [];
    if (input.tagIds.some(id => !available.some(t => t.id === id) && !existingTags.includes(id))) throw new IssueInputError("Choose tags from this project.");
  }
  if (input.fieldValues !== undefined)
    await validateFieldValues(tx, projectId, input.fieldValues);
  if (
    input.title !== undefined &&
    (!input.title.trim() || input.title.length > ISSUE_TITLE_MAX_LENGTH)
  )
    throw new IssueInputError(`Enter a title of up to ${ISSUE_TITLE_MAX_LENGTH} characters.`);
  if (input.description !== undefined && input.description.length > ISSUE_DESCRIPTION_MAX_LENGTH)
    throw new IssueInputError(`Description must be at most ${ISSUE_DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")} characters.`);
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
    if (
      !member &&
      !(await findExternalIdentity(tx, projectId, input.assigneeId))
    )
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
function activityPreview(entry: typeof issueHistory.$inferSelect): string {
  if (entry.action === "deleted")
    return `${entry.entityType === "issue" ? "Issue" : entry.entityType === "comment" ? "Comment" : entry.entityType === "worklog" ? "Worklog" : "Attachment"} deleted`;
  const changes = normalizeHistoryChanges(entry.changes);
  const body = changes.body?.after;
  if (Array.isArray(body)) {
    const text = body
      .map((node) =>
        node && typeof node === "object" && !Array.isArray(node)
          ? String(node.text ?? (node.label ? `@${node.label}` : ""))
          : "",
      )
      .join("");
    if (text.trim()) return text.replace(/\s+/g, " ").slice(0, 240);
  }
  const attachment = changes.attachment?.after;
  const files = changes.files?.after;
  const file = attachment ?? (Array.isArray(files) ? files[0] : null);
  if (
    file &&
    typeof file === "object" &&
    !Array.isArray(file) &&
    typeof file.filename === "string"
  ) {
    const kind = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.filename)
      ? "Image"
      : /\.(mp4|mov|webm|mkv)$/i.test(file.filename)
        ? "Video"
        : "File";
    return `${kind}: ${file.filename}`.slice(0, 240);
  }
  if (entry.entityType === "worklog") {
    const seconds = changes.durationSeconds?.after;
    if (typeof seconds === "number")
      return `${entry.action === "created" ? "logged" : "updated work to"} ${formatWorklogDuration(seconds)}`;
    return entry.action === "created" ? "Logged work" : "Updated worklog";
  }
  if (entry.entityType === "issue" && entry.action === "created")
    return "Created issue";
  if (entry.action === "restored") return "Restored issue";
  const labels: Record<string, string> = {
    title: "title",
    description: "description",
    stateId: "state",
    priorityId: "priority",
    issueTypeId: "issue type",
    tagIds: "tags",
    assigneeId: "assignee",
    parentId: "parent",
    estimateTime: "estimate",
    startAt: "start date",
    finishAt: "finish date",
  };
  const fields = Object.keys(changes).map(
    (key) =>
      labels[key] ?? (key.startsWith("fieldValues.") ? "custom field" : key),
  );
  return (
    fields.length
      ? `Updated ${[...new Set(fields)].join(", ")}`
      : `Updated ${entry.entityType}`
  ).slice(0, 240);
}

export function createIssueService(db: Database) {
  return {
    async list(userId: string, projectId: string): Promise<IssueSummary[]> {
      return db.transaction(async (tx) => {
        const p = await issueAccess(tx, userId, projectId);
        const rows = await tx
          .select()
          .from(issue)
          .where(eq(issue.projectId, projectId))
          .orderBy(desc(issue.updatedAt), desc(issue.number));
        const userIds = [
          ...new Set(
            rows
              .flatMap((row) => [row.authorId, row.assigneeId])
              .filter((id): id is string => !!id),
          ),
        ];
        const people = userIds.length
          ? await tx
              .select({ id: user.id, name: user.name, image: user.image })
              .from(user)
              .where(inArray(user.id, userIds))
          : [];
        const external = await tx
          .select()
          .from(schema.externalIdentity)
          .where(eq(schema.externalIdentity.projectId, projectId));
        const identities = new Map<
          string,
          { name: string; image: string | null }
        >([
          ...people.map(
            (person) =>
              [person.id, { name: person.name, image: person.image }] as const,
          ),
          ...external.map(
            (person) =>
              [
                person.id,
                { name: person.displayName, image: person.avatarUrl },
              ] as const,
          ),
        ]);
        const latest = await tx
          .selectDistinctOn([issueHistory.issueId], {
            entry: issueHistory,
            actorName: user.name,
            actorImage: user.image,
          })
          .from(issueHistory)
          .innerJoin(issue, eq(issue.id, issueHistory.issueId))
          .innerJoin(user, eq(user.id, issueHistory.actorUserId))
          .where(eq(issue.projectId, projectId))
          .orderBy(
            issueHistory.issueId,
            desc(issueHistory.createdAt),
            desc(issueHistory.id),
          );
        const activity = new Map(
          latest.map(({ entry, actorName, actorImage }) => [
            entry.issueId,
            {
              actorName,
              actorImage,
              preview: activityPreview(entry),
              createdAt: entry.createdAt.toISOString(),
            },
          ]),
        );
        const links = await tx.select().from(issueTag).where(eq(issueTag.projectId, projectId));
        return rows.map((row) => ({
          tagIds: links.filter(link => link.issueId === row.id).map(link => link.tagId).sort(),
          ...summary(row, p.key),
          lastActivity: activity.get(row.id) ?? null,
          author:
            identities.get(row.authorId ?? row.externalAuthorId ?? "") ?? null,
          assignee:
            identities.get(row.assigneeId ?? row.externalAssigneeId ?? "") ??
            null,
        }));
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
        const fields = await tx
          .select()
          .from(schema.projectField)
          .where(
            and(
              eq(schema.projectField.projectId, projectId),
              isNull(schema.projectField.deletedAt),
            ),
          )
          .orderBy(asc(schema.projectField.createdAt));
        const [integration] = await tx
          .select({ id: schema.jiraIntegration.id, baseUrl: schema.jiraIntegration.baseUrl })
          .from(schema.jiraIntegration)
          .where(eq(schema.jiraIntegration.projectId, projectId));
        return {
          issueTypes: (await tx.select().from(issueType).where(eq(issueType.projectId, projectId)).orderBy(asc(issueType.position))).map(t => ({ ...t, deletedAt: t.deletedAt?.toISOString() ?? null })),
          tags: (await tx.select().from(tag).where(eq(tag.projectId, projectId)).orderBy(asc(tag.name))).map(t => ({ ...t, deletedAt: t.deletedAt?.toISOString() ?? null })),
          jiraConnected: !!integration,
          jiraBaseUrl: integration?.baseUrl ?? null,
          externalIdentities: await tx
            .select({
              id: schema.externalIdentity.id,
              externalId: schema.externalIdentity.externalId,
              displayName: schema.externalIdentity.displayName,
              localUserId: schema.externalIdentity.localUserId,
            })
            .from(schema.externalIdentity)
            .where(eq(schema.externalIdentity.projectId, projectId)),
          fields: fields.map(({ id, name, type, externalId }) => ({
            id,
            name,
            type,
            externalId,
          })),
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
      input: {
        projectId: string;
        title: string;
        projectFileIds?: string[] | undefined;
      } & Omit<OptionalFields, "title">,
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
          estimateTime: input.estimateTime ?? null,
          startAt: issueTimestamp(input.startAt),
          finishAt: issueTimestamp(input.finishAt),
          fieldValues: input.fieldValues ?? {},
          title: input.title.trim(),
          description: input.description ?? "",
          parentId: input.parentId ?? null,
          assigneeId: input.assigneeId ?? null,
          priorityId: input.priorityId ?? null,
          issueTypeId: input.issueTypeId ?? null,
          tagIds: [...(input.tagIds ?? [])].sort(),
          stateId: input.stateId ?? defaultState.id,
        };
        await validate(tx, p.id, values);
        const attachmentIds = [...new Set(input.projectFileIds ?? [])];
        if (attachmentIds.length > 20)
          throw new IssueInputError("Attach up to 20 files per issue.");
        const attachments = [];
        for (const id of attachmentIds) {
          const [file] = await tx
            .select({
              association: schema.projectFile,
              file: schema.storedFile,
            })
            .from(schema.projectFile)
            .innerJoin(
              schema.storedFile,
              eq(schema.storedFile.id, schema.projectFile.fileId),
            )
            .where(
              and(
                eq(schema.projectFile.id, id),
                eq(schema.projectFile.projectId, p.id),
                isNull(schema.projectFile.deletedAt),
                isNull(schema.storedFile.deletedAt),
                eq(schema.storedFile.status, "ready"),
              ),
            );
          if (!file)
            throw new IssueInputError(
              "An attachment is unavailable in this project. Remove it and try again.",
            );
          attachments.push(file);
        }
        const number = p.issueCounter + 1;
        await tx
          .update(project)
          .set({ issueCounter: number })
          .where(eq(project.id, p.id));
        const identity = values.assigneeId
          ? await findExternalIdentity(tx, p.id, values.assigneeId)
          : undefined;
        const [row] = await tx
          .insert(issue)
          .values({
            ...values,
            assigneeId: identity ? null : values.assigneeId,
            externalAssigneeId: identity?.id ?? null,
            projectId: p.id,
            number,
            authorId: userId,
          })
          .returning();
        await setIssueTags(tx, p.id, row!.id, values.tagIds ?? []);
        const result = { ...summary(row!, p.key), tagIds: values.tagIds ?? [] };
        await tx.insert(issueHistory).values({
          issueId: row!.id,
          actorUserId: userId,
          action: "created",
          createdAt: row!.createdAt,
          changes: changes({}, result),
        });
        for (const [position, { association, file }] of attachments.entries()) {
          const [attachment] = await tx
            .insert(schema.issueAttachment)
            .values({
              projectId: p.id,
              issueId: row!.id,
              projectFileId: association.id,
              position,
            })
            .returning();
          await tx.insert(issueHistory).values({
            issueId: row!.id,
            actorUserId: userId,
            entityType: "attachment",
            entityId: attachment!.id,
            action: "created",
            changes: {
              attachment: {
                before: null,
                after: {
                  filename: file.filename,
                  fileId: file.id,
                  projectFileId: association.id,
                },
              },
            },
          });
        }
        await enqueueExport(tx, p.id, row!.id, row!.id, "issue.create");
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
        const oldTagIds = await issueTagIds(tx, row.id);
        if (values.tagIds) values.tagIds = [...values.tagIds].sort();
        if (values.startAt !== undefined)
          values.startAt = issueTimestamp(values.startAt);
        if (values.finishAt !== undefined)
          values.finishAt = issueTimestamp(values.finishAt);
        if (values.title !== undefined) values.title = values.title.trim();
        await validate(tx, p.id, values, row);
        const clean = Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== undefined),
        );
        const diff = changes(
          {
            ...row,
            tagIds: oldTagIds,
            startAt: issueTimestamp(row.startAt),
            finishAt: issueTimestamp(row.finishAt),
            assigneeId: row.assigneeId ?? row.externalAssigneeId,
          },
          clean,
        );
        const identity = values.assigneeId
          ? await findExternalIdentity(tx, p.id, values.assigneeId)
          : undefined;
        if (!Object.keys(diff).length) return { ...summary(row, p.key), tagIds: oldTagIds };
        const [updated] = await tx
          .update(issue)
          .set({
            ...values,
            ...(values.assigneeId !== undefined
              ? {
                  assigneeId: identity ? null : values.assigneeId,
                  externalAssigneeId: identity?.id ?? null,
                }
              : {}),
            updatedAt: new Date(
              Math.max(Date.now(), row.updatedAt.getTime() + 1),
            ),
          })
          .where(eq(issue.id, row.id))
          .returning();
        await tx.insert(issueHistory).values({
          issueId: row.id,
          actorUserId: userId,
          action: "updated",
          changes: diff,
        });
        if (values.tagIds !== undefined) await setIssueTags(tx, p.id, row.id, values.tagIds);
        await enqueueExport(tx, p.id, row.id, row.id, "issue.update");
        return { ...summary(updated!, p.key), tagIds: values.tagIds ?? oldTagIds };
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
          return { ...summary(row, p.key), tagIds: await issueTagIds(tx, row.id) };
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
        await tx.insert(issueHistory).values({
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
        return { ...summary(updated!, p.key), tagIds: await issueTagIds(tx, updated!.id) };
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
          changes: normalizeHistoryChanges(entry.changes),
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
        const table = input.kind === "state" ? issueState : input.kind === "type" ? issueType : input.kind === "tag" ? tag : issuePriority;
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
            typeof issueState.$inferSelect | undefined;
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
              await tx.insert(projectHistory).values({
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
                .update(table)
                .set(common)
                .where(eq(table.id, input.id))
                .returning()
            : await tx
                .insert(table)
                .values({ ...common, projectId: input.projectId })
                .returning();
        }
        await tx.insert(projectHistory).values({
          projectId: input.projectId,
          actorUserId: userId,
          entityType: input.kind,
          entityId: result!.id,
          changes: changes(before ?? {}, result!),
        });
        return { id: result!.id, position: result!.position };
      });
    },
    async deleteOption(
      userId: string,
      input: { projectId: string; kind: "state" | "priority" | "type" | "tag"; id: string },
    ) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, input.projectId, true, true);
        const table = input.kind === "state" ? issueState : input.kind === "type" ? issueType : input.kind === "tag" ? tag : issuePriority;
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
        await tx.insert(projectHistory).values({
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
