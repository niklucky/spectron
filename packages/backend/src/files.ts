import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  createId,
  defaultMaxFileBytes,
  type FilePage,
  type ProjectFileSummary,
  type StoredFile,
} from "@spectron/shared";
import { ProjectAccessError } from "./projects";

const {
  storedFile: file,
  projectFile,
  issueAttachment,
  project,
  projectMember,
  issue,
  issueHistory,
  projectHistory,
} = schema;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FileStorageConfig = {
  root: string;
  maxBytes?: number;
  delivery?: "stream" | "nginx";
};
export class FileInputError extends Error {}
export class FileSizeError extends FileInputError {}
export class FileUnavailableError extends Error {}
const fileSummary = (row: typeof file.$inferSelect): StoredFile => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  uploadedBy: row.uploadedBy ?? row.externalUploaderId!,
  createdAt: row.createdAt.toISOString(),
});
async function member(
  tx: Tx,
  userId: string,
  projectId: string,
  write = false,
) {
  const [p] = await tx
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .for(write ? "update" : "share");
  const [m] = await tx
    .select()
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
      ),
    )
    .for("share");
  if (!p || !m) throw new ProjectAccessError("Project not found.");
  if (write && p.state !== "active")
    throw new FileInputError("Archived projects are read-only.");
  return p;
}
async function editableIssue(tx: Tx, projectId: string, issueId: string) {
  const [row] = await tx
    .select()
    .from(issue)
    .where(and(eq(issue.id, issueId), eq(issue.projectId, projectId)));
  if (!row) throw new ProjectAccessError("Issue not found.");
  if (row.deletedAt)
    throw new FileInputError(
      "Restore the issue before changing its attachments.",
    );
  return row;
}
const visibleFile = and(
  eq(file.status, "ready"),
  isNull(file.deletedAt),
  isNull(projectFile.deletedAt),
);
export function createFileService(db: Database, config?: FileStorageConfig) {
  const maxBytes = config?.maxBytes ?? defaultMaxFileBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("Invalid file size limit.");
  function pathFor(key: string) {
    if (!config?.root)
      throw new FileUnavailableError("File storage is not configured.");
    if (
      !/^(?:\.pending\/[A-Za-z0-9_-]{21}|\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{21}\.[a-z0-9]+)$/.test(
        key,
      )
    )
      throw new FileUnavailableError("File unavailable.");
    return resolve(config.root, key);
  }
  return {
    maxBytes,
    delivery: config?.delivery ?? "stream",
    async upload(
      userId: string,
      projectId: string,
      originalName: string,
      body: ReadableStream<Uint8Array>,
      declaredSize?: number,
    ) {
      const filename = Buffer.from(originalName, "utf8")
        .toString("utf8")
        .split(/[\\/]/)
        .at(-1)!
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim();
      if (!filename || filename.length > 255)
        throw new FileInputError("Choose a filename of up to 255 characters.");
      if (
        declaredSize !== undefined &&
        (!Number.isSafeInteger(declaredSize) ||
          declaredSize < 1 ||
          declaredSize > maxBytes)
      )
        throw new FileSizeError(
          `Files must contain between 1 and ${maxBytes} bytes.`,
        );
      const id = createId();
      const pendingKey = `.pending/${id}`;
      const pendingPath = pathFor(pendingKey);
      await db.transaction(async (tx) => {
        await member(tx, userId, projectId, true);
        await tx
          .insert(file)
          .values({ id, uploadedBy: userId, filename, storageKey: pendingKey });
      });
      let sizeBytes = 0;
      try {
        await mkdir(dirname(pendingPath), { recursive: true });
        const counter = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            sizeBytes += chunk.length;
            if (sizeBytes > maxBytes)
              done(
                new FileSizeError(`File exceeds the ${maxBytes}-byte limit.`),
              );
            else done(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(body as import("node:stream/web").ReadableStream),
          counter,
          createWriteStream(pendingPath, { flags: "wx", mode: 0o644 }),
        );
        if (!sizeBytes)
          throw new FileInputError("Empty files cannot be uploaded.");
        if (declaredSize !== undefined && declaredSize !== sizeBytes)
          throw new FileInputError(
            "The upload was incomplete. Please try again.",
          );
        // Unknown or truncated formats remain opaque downloads; never trust a supplied MIME type.
        const detected = await fileTypeFromFile(pendingPath).catch(
          () => undefined,
        );
        const ext =
          detected?.ext && /^[a-z0-9]+$/.test(detected.ext)
            ? detected.ext
            : "bin";
        const storageKey = `${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;
        const finalPath = pathFor(storageKey);
        await mkdir(dirname(finalPath), { recursive: true });
        await rename(pendingPath, finalPath);
        // Retain the final path even if the project was archived while uploading.
        await db
          .update(file)
          .set({
            storageKey,
            sizeBytes,
            contentType: detected?.mime ?? "application/octet-stream",
          })
          .where(eq(file.id, id));
        return await db.transaction(async (tx) => {
          const p = await member(tx, userId, projectId, true);
          const [ready] = await tx
            .update(file)
            .set({ status: "ready" })
            .where(eq(file.id, id))
            .returning();
          const [association] = await tx
            .insert(projectFile)
            .values({ projectId, fileId: id })
            .returning();
          await tx.insert(projectHistory).values({
            projectId,
            actorUserId: userId,
            entityType: "project_file",
            entityId: association!.id,
            changes: {
              file: { before: null, after: { fileId: id, filename } },
            },
          });
          return {
            ...fileSummary(ready!),
            projectFileId: association!.id,
            projectId,
            projectName: p.name,
          } satisfies ProjectFileSummary;
        });
      } catch (cause) {
        // Bytes and records are retained, including partial/failed uploads. No automatic purge.
        await db
          .update(file)
          .set({ status: "failed" })
          .where(and(eq(file.id, id), eq(file.status, "pending")))
          .catch(() => {});
        throw cause;
      }
    },
    async library(
      userId: string,
      input: {
        projectId?: string | undefined;
        search?: string | undefined;
        offset: number;
      },
    ): Promise<FilePage> {
      return db.transaction(async (tx) => {
        if (input.projectId) await member(tx, userId, input.projectId);
        const search = input.search?.trim().replace(/[\\%_]/g, "\\$&");
        const rows = await tx
          .select({ file, association: projectFile, projectName: project.name })
          .from(projectFile)
          .innerJoin(file, eq(file.id, projectFile.fileId))
          .innerJoin(project, eq(project.id, projectFile.projectId))
          .innerJoin(
            projectMember,
            and(
              eq(projectMember.projectId, project.id),
              eq(projectMember.userId, userId),
            ),
          )
          .where(
            and(
              visibleFile,
              input.projectId
                ? eq(project.id, input.projectId)
                : eq(project.state, "active"),
              search ? ilike(file.filename, `%${search}%`) : undefined,
            ),
          )
          .orderBy(desc(file.createdAt), asc(projectFile.id))
          .limit(51)
          .offset(input.offset);
        return {
          files: rows
            .slice(0, 50)
            .map(({ file: row, association, projectName }) => ({
              ...fileSummary(row),
              projectFileId: association.id,
              projectId: association.projectId,
              projectName,
            })),
          nextOffset: rows.length > 50 ? input.offset + 50 : null,
        };
      });
    },
    async attachments(userId: string, projectId: string, issueId: string) {
      return db.transaction(async (tx) => {
        await member(tx, userId, projectId);
        const [owner] = await tx
          .select({ id: issue.id })
          .from(issue)
          .where(and(eq(issue.id, issueId), eq(issue.projectId, projectId)));
        if (!owner) throw new ProjectAccessError("Issue not found.");
        const rows = await tx
          .select({
            file,
            association: projectFile,
            attachment: issueAttachment,
            projectName: project.name,
          })
          .from(issueAttachment)
          .innerJoin(
            projectFile,
            eq(projectFile.id, issueAttachment.projectFileId),
          )
          .innerJoin(file, eq(file.id, projectFile.fileId))
          .innerJoin(project, eq(project.id, projectFile.projectId))
          .where(
            and(
              eq(issueAttachment.issueId, issueId),
              visibleFile,
              isNull(issueAttachment.deletedAt),
            ),
          )
          .orderBy(asc(issueAttachment.position), asc(issueAttachment.id));
        return rows.map(
          ({ file: row, association, attachment, projectName }) => ({
            ...fileSummary(row),
            projectFileId: association.id,
            projectId,
            projectName,
            attachmentId: attachment.id,
            position: attachment.position,
          }),
        );
      });
    },
    async link(
      userId: string,
      input: {
        projectId: string;
        issueId: string;
        sourceProjectId: string;
        projectFileId: string;
      },
    ) {
      return db.transaction(async (tx) => {
        // Stable project lock order protects cross-project reuse from deadlocks and revoked access.
        for (const projectId of [
          ...new Set([input.projectId, input.sourceProjectId]),
        ].sort())
          await member(tx, userId, projectId, projectId === input.projectId);
        await editableIssue(tx, input.projectId, input.issueId);
        const [source] = await tx
          .select({ file, association: projectFile })
          .from(projectFile)
          .innerJoin(file, eq(file.id, projectFile.fileId))
          .where(
            and(
              eq(projectFile.id, input.projectFileId),
              eq(projectFile.projectId, input.sourceProjectId),
              visibleFile,
            ),
          );
        if (!source) throw new ProjectAccessError("File not found.");
        let [target] = await tx
          .select()
          .from(projectFile)
          .where(
            and(
              eq(projectFile.projectId, input.projectId),
              eq(projectFile.fileId, source.file.id),
            ),
          );
        if (!target || target.deletedAt) {
          const before = target?.deletedAt?.toISOString() ?? null;
          [target] = await tx
            .insert(projectFile)
            .values({ projectId: input.projectId, fileId: source.file.id })
            .onConflictDoUpdate({
              target: [projectFile.projectId, projectFile.fileId],
              set: { deletedAt: null },
            })
            .returning();
          await tx.insert(projectHistory).values({
            projectId: input.projectId,
            actorUserId: userId,
            entityType: "project_file",
            entityId: target!.id,
            changes: {
              file: {
                before: before ? { deletedAt: before } : null,
                after: {
                  fileId: source.file.id,
                  filename: source.file.filename,
                },
              },
            },
          });
        }
        const [existing] = await tx
          .select()
          .from(issueAttachment)
          .where(
            and(
              eq(issueAttachment.issueId, input.issueId),
              eq(issueAttachment.projectFileId, target!.id),
            ),
          );
        if (existing && !existing.deletedAt) return { id: existing.id };
        const [last] = await tx
          .select({ position: issueAttachment.position })
          .from(issueAttachment)
          .where(eq(issueAttachment.issueId, input.issueId))
          .orderBy(desc(issueAttachment.position))
          .limit(1);
        const [attachment] = await tx
          .insert(issueAttachment)
          .values({
            projectId: input.projectId,
            issueId: input.issueId,
            projectFileId: target!.id,
            position: (last?.position ?? -1) + 1,
          })
          .onConflictDoUpdate({
            target: [issueAttachment.issueId, issueAttachment.projectFileId],
            set: { deletedAt: null },
          })
          .returning();
        await tx.insert(issueHistory).values({
          issueId: input.issueId,
          entityType: "attachment",
          entityId: attachment!.id,
          actorUserId: userId,
          action: existing ? "restored" : "created",
          changes: {
            attachment: {
              before: null,
              after: {
                filename: source.file.filename,
                fileId: source.file.id,
                projectFileId: target!.id,
              },
            },
          },
        });
        return { id: attachment!.id };
      });
    },
    async unlink(
      userId: string,
      input: { projectId: string; issueId: string; attachmentId: string },
    ) {
      return db.transaction(async (tx) => {
        await member(tx, userId, input.projectId, true);
        await editableIssue(tx, input.projectId, input.issueId);
        const [row] = await tx
          .select({ attachment: issueAttachment, file })
          .from(issueAttachment)
          .innerJoin(
            projectFile,
            eq(projectFile.id, issueAttachment.projectFileId),
          )
          .innerJoin(file, eq(file.id, projectFile.fileId))
          .where(
            and(
              eq(issueAttachment.id, input.attachmentId),
              eq(issueAttachment.issueId, input.issueId),
              eq(issueAttachment.projectId, input.projectId),
            ),
          );
        if (!row) throw new ProjectAccessError("Attachment not found.");
        if (row.attachment.deletedAt) return;
        await tx
          .update(issueAttachment)
          .set({ deletedAt: new Date() })
          .where(eq(issueAttachment.id, input.attachmentId));
        await tx.insert(issueHistory).values({
          issueId: input.issueId,
          entityType: "attachment",
          entityId: input.attachmentId,
          actorUserId: userId,
          action: "deleted",
          changes: {
            attachment: {
              before: {
                filename: row.file.filename,
                fileId: row.file.id,
                projectFileId: row.attachment.projectFileId,
              },
              after: null,
            },
          },
        });
      });
    },
    async download(userId: string, projectId: string, projectFileId: string) {
      const row = await db.transaction(async (tx) => {
        await member(tx, userId, projectId);
        const [row] = await tx
          .select({ file })
          .from(projectFile)
          .innerJoin(file, eq(file.id, projectFile.fileId))
          .where(
            and(
              eq(projectFile.id, projectFileId),
              eq(projectFile.projectId, projectId),
              visibleFile,
            ),
          );
        if (!row) throw new ProjectAccessError("File not found.");
        return row.file;
      });
      const path = pathFor(row.storageKey);
      const metadata = await stat(path).catch(() => null);
      if (!metadata?.isFile() || metadata.size !== row.sizeBytes)
        throw new FileUnavailableError("File contents are unavailable.");
      return { ...fileSummary(row), path, storageKey: row.storageKey };
    },
  };
}
export type FileService = ReturnType<typeof createFileService>;
