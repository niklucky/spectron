import { commentSyncStates } from "./integrations/comment-sync-state";
import { normalizeHistoryChanges } from "./history-changes";
import { and, or, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import { commentText } from "@spectron/shared";
import type { IssueActivityPage, ProjectFileSummary } from "@spectron/shared";
import { ProjectAccessError } from "./projects";
const {
  project,
  projectMember,
  issue,
  issueHistory: history,
  user,
  issueComment: comment,
  commentAttachment,
  projectFile,
  storedFile: file,
} = schema;
export function createActivityService(db: Database) {
  return {
    async list(
      actor: string,
      input: {
        projectId: string;
        issueId: string;
        cursor?: string | undefined;
      },
    ): Promise<IssueActivityPage> {
      return db.transaction(async (tx) => {
        const [p] = await tx
          .select()
          .from(project)
          .where(eq(project.id, input.projectId))
          .for("share");
        const [m] = await tx
          .select()
          .from(projectMember)
          .where(
            and(
              eq(projectMember.projectId, input.projectId),
              eq(projectMember.userId, actor),
            ),
          )
          .for("share");
        if (!p || !m) throw new ProjectAccessError("Project not found.");
        const [i] = await tx
          .select()
          .from(issue)
          .where(
            and(
              eq(issue.id, input.issueId),
              eq(issue.projectId, input.projectId),
            ),
          );
        if (!i) throw new ProjectAccessError("Issue not found.");
        if (input.cursor) {
          const [anchor] = await tx
            .select({ id: history.id })
            .from(history)
            .where(
              and(
                eq(history.id, input.cursor),
                eq(history.issueId, input.issueId),
              ),
            );
          if (!anchor)
            throw new ProjectAccessError("Activity cursor not found.");
        }
        // Compare against the stored timestamp, preserving PostgreSQL microseconds.
        const rows = await tx
          .select({ entry: history, actorName: user.name })
          .from(history)
          .innerJoin(user, eq(user.id, history.actorUserId))
          .where(
            and(
              eq(history.issueId, input.issueId),
              input.cursor
                ? sql`(${history.createdAt}, ${history.id}) < (SELECT created_at, id FROM issue_history WHERE id = ${input.cursor} AND issue_id = ${input.issueId})`
                : undefined,
            ),
          )
          .orderBy(desc(history.createdAt), desc(history.id))
          .limit(51);
        const page = rows.slice(0, 50),
          ids = page.flatMap(({ entry: e }) =>
            e.entityType === "comment" && e.action === "created" && e.entityId
              ? [e.entityId]
              : [],
          );
        const comments = ids.length
          ? await tx
              .select({
                row: comment,
                authorName: sql<string>`coalesce(${user.name}, ${schema.externalIdentity.displayName}, 'Imported user')`,
                resolvedAuthorId: sql<string>`coalesce(${user.id}, ${schema.externalIdentity.id})`,
                replyCount: sql<number>`(select count(*)::int from issue_comments replies where replies.issue_id = ${comment.issueId} and replies.parent_id = ${comment.id})`,
              })
              .from(comment)
              .leftJoin(
                schema.externalIdentity,
                eq(schema.externalIdentity.id, comment.externalAuthorId),
              )
              .leftJoin(
                user,
                eq(
                  user.id,
                  sql`coalesce(${comment.authorId}, ${schema.externalIdentity.localUserId})`,
                ),
              )
              .where(
                and(
                  eq(comment.issueId, input.issueId),
                  inArray(comment.id, ids),
                ),
              )
          : [];
        const parentIds = [
          ...new Set(
            comments.flatMap((c) => (c.row.parentId ? [c.row.parentId] : [])),
          ),
        ];
        const parents = parentIds.length
          ? await tx
              .select({
                row: comment,
                authorName: sql<string>`coalesce(${user.name}, ${schema.externalIdentity.displayName}, 'Imported user')`,
              })
              .from(comment)
              .leftJoin(
                schema.externalIdentity,
                eq(schema.externalIdentity.id, comment.externalAuthorId),
              )
              .leftJoin(
                user,
                eq(
                  user.id,
                  sql`coalesce(${comment.authorId}, ${schema.externalIdentity.localUserId})`,
                ),
              )
              .where(
                and(
                  eq(comment.issueId, input.issueId),
                  inArray(comment.id, parentIds),
                ),
              )
          : [];
        const links = ids.length
          ? await tx
              .select()
              .from(commentAttachment)
              .where(
                and(
                  inArray(commentAttachment.commentId, ids),
                  eq(commentAttachment.projectId, input.projectId),
                  isNull(commentAttachment.deletedAt),
                ),
              )
          : [];
        const fileIds = new Set<string>(),
          associationIds = new Set(links.map((l) => l.projectFileId));
        for (const { entry: e } of page)
          for (const change of Object.values(e.changes))
            for (const value of [change.before, change.after]) {
              for (const part of Array.isArray(value) ? value : [value])
                if (part && typeof part === "object" && !Array.isArray(part)) {
                  if (typeof part.fileId === "string") fileIds.add(part.fileId);
                  if (typeof part.projectFileId === "string")
                    associationIds.add(part.projectFileId);
                }
            }
        const files =
          fileIds.size || associationIds.size
            ? await tx
                .select({ file, association: projectFile })
                .from(projectFile)
                .innerJoin(file, eq(file.id, projectFile.fileId))
                .where(
                  and(
                    eq(projectFile.projectId, input.projectId),
                    isNull(projectFile.deletedAt),
                    isNull(file.deletedAt),
                    eq(file.status, "ready"),
                    or(
                      fileIds.size ? inArray(file.id, [...fileIds]) : undefined,
                      associationIds.size
                        ? inArray(projectFile.id, [...associationIds])
                        : undefined,
                    ),
                  ),
                )
            : [];
        const summaries: ProjectFileSummary[] = files.map(
          ({ file: f, association: a }) => ({
            id: f.id,
            projectFileId: a.id,
            projectId: input.projectId,
            projectName: p.name,
            filename: f.filename,
            contentType: f.contentType,
            sizeBytes: f.sizeBytes,
            uploadedBy: f.uploadedBy ?? f.externalUploaderId!,
            createdAt: f.createdAt.toISOString(),
          }),
        );
        const syncStates = await commentSyncStates(tx, input.projectId, comments.map(c => c.row));
        return {
          nextCursor: rows.length > 50 ? page.at(-1)!.entry.id : null,
          events: page.reverse().map(({ entry: e, actorName }) => {
            e.changes = normalizeHistoryChanges(e.changes);
            const found =
                e.entityType === "comment" && e.action === "created"
                  ? comments.find((c) => c.row.id === e.entityId)
                  : undefined,
              r = found?.row;
            const commentFiles = r
              ? links
                  .filter((l) => l.commentId === r.id)
                  .sort((a, b) => a.position - b.position)
                  .flatMap((l) =>
                    summaries.filter(
                      (f) => f.projectFileId === l.projectFileId,
                    ),
                  )
              : [];
            const eventFileIds = new Set<string>();
            for (const change of Object.values(e.changes))
              for (const value of [change.before, change.after])
                for (const part of Array.isArray(value) ? value : [value])
                  if (
                    part &&
                    typeof part === "object" &&
                    !Array.isArray(part) &&
                    typeof part.fileId === "string"
                  )
                    eventFileIds.add(part.fileId);
            const parent = parents.find((p) => p.row.id === r?.parentId);
            return {
              replyTo: parent
                ? {
                    id: parent.row.id,
                    authorName: parent.authorName,
                    deleted: !!parent.row.deletedAt,
                    text: parent.row.deletedAt
                      ? "Comment deleted"
                      : commentText(parent.row.body).slice(0, 240),
                  }
                : null,
              entry: { ...e, actorName, createdAt: e.createdAt.toISOString() },
              files: summaries.filter((f) => eventFileIds.has(f.id)),
              comment:
                r && found
                  ? {
                      id: r.id,
                      jiraSync: syncStates.get(r.id),
                      issueId: r.issueId,
                      parentId: r.parentId,
                      authorId: found.resolvedAuthorId,
                      authorName: found.authorName,
                      body: r.deletedAt ? [] : r.body,
                      attachments: r.deletedAt ? [] : commentFiles,
                      replyCount: found.replyCount,
                      createdAt: r.createdAt.toISOString(),
                      updatedAt: r.updatedAt.toISOString(),
                      deletedAt: r.deletedAt?.toISOString() ?? null,
                      canEdit:
                        p.state === "active" &&
                        !i.deletedAt &&
                        !r.deletedAt &&
                        found.resolvedAuthorId === actor,
                      canDelete:
                        p.state === "active" &&
                        !i.deletedAt &&
                        !r.deletedAt &&
                        (found.resolvedAuthorId === actor ||
                          m.role === "owner"),
                    }
                  : null,
            };
          }),
        };
      });
    },
  };
}
export type ActivityService = ReturnType<typeof createActivityService>;
