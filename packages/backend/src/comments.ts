import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  createId,
  commentText,
  type CommentBody,
  type CommentCursor,
  type CommentDraft,
  type CommentPage,
  type CommentScope,
  type HistoryChanges,
  type ProjectFileSummary,
} from "@spectron/shared";
import { ProjectAccessError } from "./projects";
import { IssueInputError, IssueConflictError } from "./issues";
const {
  issueComment: comment,
  commentMention: mention,
  commentAttachment: attachment,
  project,
  projectMember,
  issue,
  user,
  projectFile,
  storedFile: file,
  issueHistory,
  projectHistory,
} = schema;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function access(
  tx: Tx,
  actor: string,
  scope: CommentScope,
  write = false,
  sources: string[] = [],
) {
  let projectActive = false;
  for (const id of [...new Set([scope.projectId, ...sources])].sort()) {
    const [p] = await tx
      .select()
      .from(project)
      .where(eq(project.id, id))
      .for(write && id === scope.projectId ? "update" : "share");
    const [m] = await tx
      .select()
      .from(projectMember)
      .where(
        and(eq(projectMember.projectId, id), eq(projectMember.userId, actor)),
      )
      .for("share");
    if (!p || !m) throw new ProjectAccessError("Project not found.");
    if (id === scope.projectId) projectActive = p.state === "active";
    if (write && id === scope.projectId && p.state !== "active")
      throw new IssueInputError("Archived projects are read-only.");
  }
  const [i] = await tx
    .select()
    .from(issue)
    .where(
      and(eq(issue.projectId, scope.projectId), eq(issue.id, scope.issueId)),
    );
  if (!i) throw new ProjectAccessError("Issue not found.");
  if (write && i.deletedAt)
    throw new IssueInputError("Restore the issue before changing comments.");
  const [m] = await tx
    .select()
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, scope.projectId),
        eq(projectMember.userId, actor),
      ),
    );
  return { role: m!.role, writable: projectActive && !i.deletedAt };
}
async function find(tx: Tx, scope: CommentScope, id: string) {
  const [row] = await tx
    .select()
    .from(comment)
    .where(
      and(
        eq(comment.id, id),
        eq(comment.issueId, scope.issueId),
        eq(comment.projectId, scope.projectId),
      ),
    );
  if (!row) throw new ProjectAccessError("Comment not found.");
  return row;
}
async function attached(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  return tx
    .select({
      link: attachment,
      file,
      association: projectFile,
      projectName: project.name,
    })
    .from(attachment)
    .innerJoin(projectFile, eq(projectFile.id, attachment.projectFileId))
    .innerJoin(file, eq(file.id, projectFile.fileId))
    .innerJoin(project, eq(project.id, projectFile.projectId))
    .where(
      and(
        inArray(attachment.commentId, ids),
        isNull(attachment.deletedAt),
        isNull(projectFile.deletedAt),
        isNull(file.deletedAt),
        eq(file.status, "ready"),
      ),
    )
    .orderBy(asc(attachment.position), asc(attachment.id));
}
function summaryFile(
  row: Awaited<ReturnType<typeof attached>>[number],
): ProjectFileSummary {
  return {
    id: row.file.id,
    projectId: row.association.projectId,
    projectFileId: row.association.id,
    projectName: row.projectName,
    filename: row.file.filename,
    contentType: row.file.contentType,
    sizeBytes: row.file.sizeBytes,
    uploadedBy: row.file.uploadedBy,
    createdAt: row.file.createdAt.toISOString(),
  };
}
async function normalizeBody(
  tx: Tx,
  projectId: string,
  body: CommentBody,
  previous: CommentBody = [],
): Promise<CommentBody> {
  if (body.length > 1000 || commentText(body).length > 100000)
    throw new IssueInputError("Comment is too long.");
  const people = await tx
    .select({ id: user.id, name: user.name })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.projectId, projectId))
    .for("share", { of: projectMember });
  const names = new Map(people.map((p) => [p.id, p.name]));
  const retained = new Map(
    previous.flatMap((n) =>
      n.type === "mention" ? [[n.userId, n.label] as const] : [],
    ),
  );
  return body.flatMap<CommentBody[number]>((n) => {
    if (n.type === "text") return n.text ? [n] : [];
    const label = names.get(n.userId) ?? retained.get(n.userId);
    if (label === undefined)
      throw new IssueInputError("Mentions must reference project members.");
    return [{ type: "mention" as const, userId: n.userId, label }];
  });
}
async function resolveFiles(
  tx: Tx,
  actor: string,
  scope: CommentScope,
  refs: CommentDraft["files"],
) {
  if (refs.length > 20)
    throw new IssueInputError("Attach up to 20 files per comment.");
  const resolved: { id: string; filename: string; fileId: string }[] = [];
  for (const ref of refs) {
    const [source] = await tx
      .select({ association: projectFile, file })
      .from(projectFile)
      .innerJoin(file, eq(file.id, projectFile.fileId))
      .where(
        and(
          eq(projectFile.id, ref.projectFileId),
          eq(projectFile.projectId, ref.projectId),
          isNull(projectFile.deletedAt),
          isNull(file.deletedAt),
          eq(file.status, "ready"),
        ),
      );
    if (!source) throw new ProjectAccessError("File not found.");
    let [target] = await tx
      .select()
      .from(projectFile)
      .where(
        and(
          eq(projectFile.projectId, scope.projectId),
          eq(projectFile.fileId, source.file.id),
        ),
      );
    if (!target || target.deletedAt) {
      [target] = await tx
        .insert(projectFile)
        .values({ projectId: scope.projectId, fileId: source.file.id })
        .onConflictDoUpdate({
          target: [projectFile.projectId, projectFile.fileId],
          set: { deletedAt: null },
        })
        .returning();
      await tx
        .insert(projectHistory)
        .values({
          projectId: scope.projectId,
          actorUserId: actor,
          entityType: "project_file",
          entityId: target!.id,
          changes: {
            file: {
              before: null,
              after: { fileId: source.file.id, filename: source.file.filename },
            },
          },
        });
    }
    if (!resolved.some((f) => f.id === target!.id))
      resolved.push({
        id: target!.id,
        filename: source.file.filename,
        fileId: source.file.id,
      });
  }
  return resolved;
}
async function syncRelations(
  tx: Tx,
  row: typeof comment.$inferSelect,
  body: CommentBody,
  files: Awaited<ReturnType<typeof resolveFiles>>,
  now: Date,
) {
  const people = new Set(
    body.flatMap((n) => (n.type === "mention" ? [n.userId] : [])),
  );
  const existing = await tx
    .select()
    .from(mention)
    .where(eq(mention.commentId, row.id));
  for (const old of existing)
    if (!old.deletedAt && !people.has(old.userId))
      await tx
        .update(mention)
        .set({ deletedAt: now })
        .where(eq(mention.id, old.id));
  for (const id of people)
    if (!existing.some((m) => m.userId === id && !m.deletedAt))
      await tx
        .insert(mention)
        .values({ commentId: row.id, userId: id })
        .onConflictDoUpdate({
          target: [mention.commentId, mention.userId],
          set: { deletedAt: null },
        });
  const links = await tx
    .select()
    .from(attachment)
    .where(eq(attachment.commentId, row.id));
  for (const old of links)
    if (!old.deletedAt && !files.some((f) => f.id === old.projectFileId))
      await tx
        .update(attachment)
        .set({ deletedAt: now })
        .where(eq(attachment.id, old.id));
  for (const [position, f] of files.entries())
    await tx
      .insert(attachment)
      .values({
        projectId: row.projectId,
        commentId: row.id,
        projectFileId: f.id,
        position,
      })
      .onConflictDoUpdate({
        target: [attachment.commentId, attachment.projectFileId],
        set: { deletedAt: null, position },
      });
}
export function createCommentService(db: Database) {
  return {
    async list(
      actor: string,
      scope: CommentScope & {
        parentId: string | null;
        cursor?: CommentCursor | undefined;
      },
    ): Promise<CommentPage> {
      return db.transaction(async (tx) => {
        const permissions = await access(tx, actor, scope);
        if (scope.parentId) await find(tx, scope, scope.parentId);
        const rows = await tx
          .select({
            comment,
            authorName: user.name,
            replyCount: sql<number>`(select count(*)::int from issue_comments replies where replies.issue_id = ${comment.issueId} and replies.parent_id = ${comment.id})`,
          })
          .from(comment)
          .innerJoin(user, eq(user.id, comment.authorId))
          .where(
            and(
              eq(comment.issueId, scope.issueId),
              scope.parentId
                ? eq(comment.parentId, scope.parentId)
                : isNull(comment.parentId),
              scope.cursor
                ? or(
                    gt(comment.createdAt, new Date(scope.cursor.createdAt)),
                    and(
                      eq(comment.createdAt, new Date(scope.cursor.createdAt)),
                      gt(comment.id, scope.cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(comment.createdAt), asc(comment.id))
          .limit(21);
        const page = rows.slice(0, 20),
          links = await attached(
            tx,
            page.filter((r) => !r.comment.deletedAt).map((r) => r.comment.id),
          );
        const last = page.at(-1)?.comment;
        return {
          comments: page.map(({ comment: r, authorName, replyCount }) => ({
            id: r.id,
            issueId: r.issueId,
            parentId: r.parentId,
            authorId: r.authorId,
            authorName,
            replyCount,
            body: r.deletedAt ? [] : r.body,
            attachments: r.deletedAt
              ? []
              : links.filter((l) => l.link.commentId === r.id).map(summaryFile),
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            deletedAt: r.deletedAt?.toISOString() ?? null,
            canEdit:
              permissions.writable && !r.deletedAt && r.authorId === actor,
            canDelete:
              permissions.writable &&
              !r.deletedAt &&
              (r.authorId === actor || permissions.role === "owner"),
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
      input: CommentScope &
        CommentDraft & {
          id?: string | undefined;
          parentId?: string | null | undefined;
          expectedUpdatedAt?: string | undefined;
        },
    ) {
      return db.transaction(async (tx) => {
        await access(
          tx,
          actor,
          input,
          true,
          input.files.map((f) => f.projectId),
        );
        const old = input.id ? await find(tx, input, input.id) : undefined;
        if (old && (old.authorId !== actor || old.deletedAt))
          throw new ProjectAccessError("Comment cannot be edited.");
        if (old && old.updatedAt.toISOString() !== input.expectedUpdatedAt)
          throw new IssueConflictError(
            "This comment changed. Reload comments before editing again.",
          );
        if (
          old &&
          input.parentId !== undefined &&
          input.parentId !== old.parentId
        )
          throw new IssueInputError("A reply's parent cannot be changed.");
        if (!old && input.parentId) await find(tx, input, input.parentId);
        const body = await normalizeBody(
          tx,
          input.projectId,
          input.body,
          old?.body,
        );
        const files = await resolveFiles(tx, actor, input, input.files);
        if (!commentText(body).trim() && !files.length)
          throw new IssueInputError("Write a comment or attach a file.");
        const oldFiles = old ? await attached(tx, [old.id]) : [];
        const beforeFiles = oldFiles.map((f) => ({
          id: f.association.id,
          filename: f.file.filename,
          fileId: f.file.id,
        }));
        const changes: HistoryChanges = {};
        if (!old || JSON.stringify(old.body) !== JSON.stringify(body))
          changes.body = { before: old?.body ?? null, after: body };
        if (JSON.stringify(beforeFiles) !== JSON.stringify(files))
          changes.files = { before: beforeFiles, after: files };
        if (old && !Object.keys(changes).length) return { id: old.id };
        const now = new Date(
          Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1),
        );
        const [row] = old
          ? await tx
              .update(comment)
              .set({ body, updatedAt: now })
              .where(eq(comment.id, old.id))
              .returning()
          : await tx
              .insert(comment)
              .values({
                id: createId(),
                projectId: input.projectId,
                issueId: input.issueId,
                parentId: input.parentId ?? null,
                authorId: actor,
                body,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
        await syncRelations(tx, row!, body, files, now);
        if (!old) changes.parentId = { before: null, after: row!.parentId };
        await tx
          .insert(issueHistory)
          .values({
            issueId: input.issueId,
            entityType: "comment",
            entityId: row!.id,
            actorUserId: actor,
            action: old ? "updated" : "created",
            changes,
          });
        return { id: row!.id };
      });
    },
    async delete(
      actor: string,
      input: CommentScope & { id: string; expectedUpdatedAt: string },
    ) {
      return db.transaction(async (tx) => {
        const permissions = await access(tx, actor, input, true),
          row = await find(tx, input, input.id);
        if (row.authorId !== actor && permissions.role !== "owner")
          throw new ProjectAccessError("Comment cannot be deleted.");
        if (row.updatedAt.toISOString() !== input.expectedUpdatedAt)
          throw new IssueConflictError(
            "This comment changed. Reload comments before deleting it.",
          );
        if (row.deletedAt) return;
        const files = await attached(tx, [row.id]),
          now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
        await tx
          .update(comment)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(comment.id, row.id));
        await tx
          .update(mention)
          .set({ deletedAt: now })
          .where(and(eq(mention.commentId, row.id), isNull(mention.deletedAt)));
        await tx
          .update(attachment)
          .set({ deletedAt: now })
          .where(
            and(eq(attachment.commentId, row.id), isNull(attachment.deletedAt)),
          );
        await tx
          .insert(issueHistory)
          .values({
            issueId: input.issueId,
            entityType: "comment",
            entityId: row.id,
            actorUserId: actor,
            action: "deleted",
            changes: {
              body: { before: row.body, after: null },
              files: {
                before: files.map((f) => ({
                  id: f.association.id,
                  filename: f.file.filename,
                  fileId: f.file.id,
                })),
                after: [],
              },
              deletedAt: { before: null, after: now.toISOString() },
            },
          });
      });
    },
  };
}
export type CommentService = ReturnType<typeof createCommentService>;
