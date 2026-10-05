import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  commentText,
  localAppName,
  type LocalHandoffInput,
  type LocalHandoffView,
  type LocalHandoffDraft,
  type AgentRunScope,
} from "@spectron/shared";
import { runAccess } from "./agent-runs/service";
import { IssueInputError } from "./issues";
import { ProjectAccessError } from "./projects";
import type { FileService } from "./files";

const h = schema.localHandoff;
type Handoff = typeof h.$inferSelect;
const publicView = (row: Handoff): LocalHandoffView => ({
  id: row.id,
  projectId: row.projectId,
  issueId: row.issueId,
  ownerId: row.ownerId,
  ownerName: row.ownerName,
  agentName: row.agentName,
  application: row.application,
  message: row.message,
  createdAt: row.createdAt.toISOString(),
  launchRequestedAt: row.launchRequestedAt?.toISOString() ?? null,
  filesRevoked: row.fileToken === null,
});
const excerpt = (text: string, limit: number) =>
  text.length > limit
    ? `${text.slice(0, limit)}\n[Excerpt; see issue for the full text.]`
    : text;
const filename = (name: string) => name.replace(/[\[\]\\\r\n]/g, " ");

export function createLocalHandoffService(
  db: Database,
  files: FileService,
  appURL: string,
) {
  const base = appURL.replace(/\/$/, "");
  async function owned(userId: string, scope: AgentRunScope & { id: string }) {
    return db.transaction(async (tx) => {
      await runAccess(tx, userId, scope);
      const [row] = await tx
        .select()
        .from(h)
        .where(
          and(
            eq(h.id, scope.id),
            eq(h.projectId, scope.projectId),
            eq(h.issueId, scope.issueId),
            eq(h.ownerId, userId),
          ),
        );
      if (!row) throw new ProjectAccessError("Handoff not found.");
      return row;
    });
  }
  const service = {
    async create(
      userId: string,
      input: LocalHandoffInput,
    ): Promise<LocalHandoffView> {
      for (const id of input.fileIds)
        await files.download(userId, input.projectId, id);
      return db.transaction(async (tx) => {
        const current = await runAccess(tx, userId, input, true, true);
        const [duplicate] = await tx
          .select()
          .from(h)
          .where(and(eq(h.ownerId, userId), eq(h.requestId, input.requestId)));
        if (duplicate) {
          if (
            duplicate.projectId !== input.projectId ||
            duplicate.issueId !== input.issueId
          )
            throw new IssueInputError("Request ID already used.");
          return publicView(duplicate);
        }
        const [agent] = await tx
          .select()
          .from(schema.aiAgent)
          .where(
            and(
              eq(schema.aiAgent.id, input.agentId),
              eq(schema.aiAgent.ownerId, userId),
              isNull(schema.aiAgent.deletedAt),
            ),
          )
          .for("share");
        if (!agent?.localApp)
          throw new ProjectAccessError("Local app agent not found.");
        const [requester] = await tx
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, userId));
        const [project] = await tx
          .select({ key: schema.project.key })
          .from(schema.project)
          .where(eq(schema.project.id, input.projectId));
        const [repository] = input.repositoryId
          ? await tx
              .select()
              .from(schema.gitRepository)
              .where(
                and(
                  eq(schema.gitRepository.id, input.repositoryId),
                  eq(schema.gitRepository.projectId, input.projectId),
                ),
              )
          : [];
        if (input.repositoryId && !repository)
          throw new IssueInputError("Select a current project repository.");
        const comments = await tx
          .select({
            id: schema.issueComment.id,
            body: schema.issueComment.body,
            name: schema.user.name,
            createdAt: schema.issueComment.createdAt,
          })
          .from(schema.issueComment)
          .leftJoin(
            schema.user,
            eq(schema.user.id, schema.issueComment.authorId),
          )
          .where(
            and(
              eq(schema.issueComment.issueId, input.issueId),
              isNull(schema.issueComment.deletedAt),
            ),
          )
          .orderBy(
            desc(schema.issueComment.createdAt),
            desc(schema.issueComment.id),
          )
          .limit(50);
        // Read the public request and file references, never another handoff's
        // private summary, agent instructions or download token.
        const previousHandoffs = await tx
          .select({
            id: h.id,
            ownerName: h.ownerName,
            agentName: h.agentName,
            message: h.message,
            attachments: h.attachments,
            createdAt: h.createdAt,
          })
          .from(h)
          .where(
            and(eq(h.projectId, input.projectId), eq(h.issueId, input.issueId)),
          )
          .orderBy(desc(h.createdAt), desc(h.id))
          .limit(50);
        const recentConversation = [
          ...comments.map((comment) => ({
            id: comment.id,
            name: comment.name ?? "External participant",
            text: commentText(comment.body),
            createdAt: comment.createdAt,
            fileIds: [] as string[],
          })),
          ...previousHandoffs.map((handoff) => ({
            id: handoff.id,
            name: `${handoff.ownerName} → ${handoff.agentName} (local handoff)`,
            text: handoff.message,
            createdAt: handoff.createdAt,
            fileIds: handoff.attachments.map((file) => file.id),
          })),
        ]
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          )
          .slice(0, 50)
          .reverse();
        const results = await tx
          .select({
            agent: schema.agentRun.agent,
            message: schema.agentRun.message,
            result: schema.agentRun.result,
          })
          .from(schema.agentRun)
          .where(eq(schema.agentRun.issueId, input.issueId))
          .orderBy(desc(schema.agentRun.createdAt), desc(schema.agentRun.id))
          .limit(10);
        const attached = await tx
          .select({ id: schema.issueAttachment.projectFileId })
          .from(schema.issueAttachment)
          .where(
            and(
              eq(schema.issueAttachment.issueId, input.issueId),
              isNull(schema.issueAttachment.deletedAt),
            ),
          );
        const commentFiles = await tx
          .select({ id: schema.commentAttachment.projectFileId })
          .from(schema.commentAttachment)
          .innerJoin(
            schema.issueComment,
            eq(schema.issueComment.id, schema.commentAttachment.commentId),
          )
          .where(
            and(
              eq(schema.issueComment.issueId, input.issueId),
              isNull(schema.issueComment.deletedAt),
              isNull(schema.commentAttachment.deletedAt),
            ),
          );
        const ids = [
          ...new Set([
            ...attached.map((f) => f.id),
            ...commentFiles.map((f) => f.id),
            ...recentConversation.flatMap((entry) => entry.fileIds),
            ...input.fileIds,
          ]),
        ];
        const attachments = ids.length
          ? await tx
              .select({
                id: schema.projectFile.id,
                name: schema.storedFile.filename,
              })
              .from(schema.projectFile)
              .innerJoin(
                schema.storedFile,
                eq(schema.storedFile.id, schema.projectFile.fileId),
              )
              .where(
                and(
                  eq(schema.projectFile.projectId, input.projectId),
                  inArray(schema.projectFile.id, ids),
                  eq(schema.storedFile.status, "ready"),
                  isNull(schema.projectFile.deletedAt),
                  isNull(schema.storedFile.deletedAt),
                ),
              )
          : [];
        const issueKey = `${project!.key}-${current.issue.number}`;
        // Preserve the latest request. Excerpts explicitly link to the full history.
        const conversation = recentConversation
          .map(
            (c) =>
              `${c.name} (${c.createdAt.toISOString()}):\n${excerpt(c.text, 2000)}`,
          )
          .join("\n\n");
        const summary = [
          `# ${issueKey}: ${current.issue.title}`,
          `Issue: ${base}/#project/${input.projectId}/${input.issueId}`,
          `Handed off by ${requester!.name} to ${agent.name} (${localAppName(agent.localApp)}).`,
          `## Latest request\n${input.command === "discuss" ? "" : `Requested action: /${input.command}\n`}${input.message}`,
          repository
            ? `Repository: ${repository.cloneURL}\nTarget branch: ${repository.targetBranch}`
            : "",
          agent.instructions
            ? `## Agent instructions\n${agent.instructions}`
            : "",
          `## Issue description\n${excerpt(current.issue.description, 8000) || "No description."}`,
          conversation
            ? `## Recent conversation\n${conversation.length > 12000 ? `[Earlier messages omitted; see the issue.]\n${conversation.slice(-12000)}` : conversation}`
            : "",
          results.length
            ? `## Recent agent work\n${results
                .reverse()
                .map(
                  (r) =>
                    `${r.agent.name}: ${excerpt(r.message, 500)}\n${excerpt(r.result ? `${r.result.summary}\n${r.result.details}` : "No result recorded.", 2000)}`,
                )
                .join("\n\n")}`
            : "",
          "Use your local app's permissions and project instructions. Attachment links provide downloads; file contents have not been inspected by Spectron.",
        ]
          .filter(Boolean)
          .join("\n\n");
        const [row] = await tx
          .insert(h)
          .values({
            projectId: input.projectId,
            issueId: input.issueId,
            ownerId: userId,
            ownerName: requester!.name,
            requestId: input.requestId,
            agentName: agent.name,
            application: agent.localApp,
            message: input.message,
            summary,
            originUrl: repository?.cloneURL ?? null,
            repositoryId: repository?.id ?? null,
            attachments,
            fileToken: attachments.length
              ? randomBytes(32).toString("hex")
              : null,
            filesExpireAt: new Date(Date.now() + 7 * 86400000),
          })
          .onConflictDoNothing()
          .returning();
        if (row) return publicView(row);
        const [retry] = await tx
          .select()
          .from(h)
          .where(and(eq(h.ownerId, userId), eq(h.requestId, input.requestId)));
        if (
          !retry ||
          retry.projectId !== input.projectId ||
          retry.issueId !== input.issueId
        )
          throw new IssueInputError("Request ID already used.");
        return publicView(retry);
      });
    },
    async list(
      userId: string,
      scope: AgentRunScope,
    ): Promise<LocalHandoffView[]> {
      return db.transaction(async (tx) => {
        await runAccess(tx, userId, scope);
        const rows = await tx
          .select()
          .from(h)
          .where(
            and(eq(h.projectId, scope.projectId), eq(h.issueId, scope.issueId)),
          )
          .orderBy(asc(h.createdAt), asc(h.id));
        return rows.map(publicView);
      });
    },
    async draft(
      userId: string,
      scope: AgentRunScope & { id: string },
    ): Promise<LocalHandoffDraft> {
      const row = await owned(userId, scope);
      const links = row.attachments.map((file) => {
        const grant =
          row.fileToken && row.filesExpireAt.getTime() > Date.now()
            ? `?handoff=${row.id}&token=${row.fileToken}&download=1`
            : "?download=1";
        return `- [${filename(file.name)}](${base}/api/files/${row.projectId}/${file.id}${grant})`;
      });
      const notice =
        row.fileToken && row.filesExpireAt.getTime() > Date.now()
          ? `Download links expire ${row.filesExpireAt.toISOString()}. Keep this draft private.`
          : "Download access has expired or was revoked. These links require Spectron sign-in.";
      return {
        summary: `${row.summary}${links.length ? `\n\n## Attachments\n${notice}\n${links.join("\n")}` : ""}`,
        originUrl: row.originUrl,
        repositoryId: row.repositoryId,
        expiresAt: row.filesExpireAt.toISOString(),
      };
    },
    async markLaunch(userId: string, scope: AgentRunScope & { id: string }) {
      await owned(userId, scope);
      await db
        .update(h)
        .set({ launchRequestedAt: new Date() })
        .where(eq(h.id, scope.id));
    },
    async revokeFiles(userId: string, scope: AgentRunScope & { id: string }) {
      await owned(userId, scope);
      await db.update(h).set({ fileToken: null }).where(eq(h.id, scope.id));
    },
    async downloadOwner(
      projectId: string,
      fileId: string,
      handoffId: string,
      token: string,
    ) {
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new ProjectAccessError("File not found.");
      const [row] = await db
        .select()
        .from(h)
        .where(and(eq(h.id, handoffId), eq(h.projectId, projectId)));
      if (
        !row?.fileToken ||
        row.filesExpireAt.getTime() <= Date.now() ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(row.fileToken)) ||
        !row.attachments.some((f) => f.id === fileId)
      )
        throw new ProjectAccessError("File not found.");
      await db.transaction(async (tx) => {
        const access = await runAccess(tx, row.ownerId, row);
        if (access.issue.deletedAt)
          throw new ProjectAccessError("File not found.");
      });
      return row.ownerId;
    },
  };
  return service;
}
export type LocalHandoffService = ReturnType<typeof createLocalHandoffService>;
