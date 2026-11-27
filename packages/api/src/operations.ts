/**
 * Agent-facing operations shared by the REST API (/api/v1) and the MCP server
 * (/api/mcp). Each transport parses its own input format, then calls these
 * with the acting user's id, so both behave identically.
 */
import { z } from "zod";
import {
  FileInputError,
  issueSortFields,
  type CommentService,
  type FileService,
  type IssueService,
  type IssueSortField,
  type PublicApiService,
} from "@spectron/backend";
import {
  applicationIdPattern,
  issueTriggers,
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  type CommentBody,
  type CommentSummary,
  type IssueTrigger,
  type ProjectFileSummary,
} from "@spectron/shared";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const id = z.string().regex(applicationIdPattern);
const nullableDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullable();
export const instant = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value));
export const sortPattern = new RegExp(`^-?(${issueSortFields.join("|")})$`);
export const sortMessage = `Sort by ${issueSortFields.join(", ")}; prefix with - for descending.`;

const issueFields = {
  description: z.string().max(ISSUE_DESCRIPTION_MAX_LENGTH).optional(),
  status: z.string().min(1).max(80).optional(),
  priority: z.string().min(1).max(80).nullable().optional(),
  type: z.string().min(1).max(80).nullable().optional(),
  assignee: z.string().min(1).max(254).nullable().optional(),
  parent: z.string().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().min(1).max(80)).max(100).optional(),
  startAt: nullableDate.optional(),
  dueAt: nullableDate.optional(),
  estimateSeconds: z.number().int().min(0).max(2147483647).nullable().optional(),
};
export const createIssueInput = z
  .object({
    project: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(ISSUE_TITLE_MAX_LENGTH),
    attachments: z.array(id).max(20).optional(),
    ...issueFields,
  })
  .strict();
export const updateIssueFields = z
  .object({
    title: z.string().trim().min(1).max(ISSUE_TITLE_MAX_LENGTH).optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
    ...issueFields,
  })
  .strict();
export const updateIssueInput = updateIssueFields.refine(
  (input) => Object.keys(input).some((key) => key !== "expectedUpdatedAt"),
  "Send at least one field to change.",
);
export const createCommentInput = z
  .object({
    body: z.string().max(100000).default(""),
    parentId: id.nullable().optional(),
    attachments: z.array(id).max(20).default([]),
  })
  .strict();

export type IssueSearchParams = {
  projects?: string[] | undefined;
  statuses?: string[] | undefined;
  statusCategories?: string[] | undefined;
  assignee?: string | undefined;
  q?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
  updatedAfter?: Date | undefined;
  updatedBefore?: Date | undefined;
  dueAfter?: Date | undefined;
  dueBefore?: Date | undefined;
  startAfter?: Date | undefined;
  startBefore?: Date | undefined;
  sort: string;
  limit: number;
  cursor?: string | undefined;
};

/** `<@member-id>` or `<@email>` in comment text become mentions. */
const MENTION = /<@([^<>\s]{1,254})>/g;
const cursor = {
  encode: (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"),
  decode<T>(raw: string | undefined, schema: z.ZodType<T>): T | undefined {
    if (!raw) return undefined;
    try {
      return schema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    } catch {
      throw new ApiError(400, "invalid_cursor", "The cursor is invalid. Start again without it.");
    }
  },
};

export function createOperations({
  publicApi,
  issues,
  comments,
  files,
  appURL,
}: {
  publicApi: PublicApiService;
  issues: IssueService;
  comments: CommentService;
  files: FileService;
  appURL: string;
}) {
  const presentFile = (
    f: Pick<ProjectFileSummary, "projectFileId" | "projectId" | "filename" | "contentType" | "sizeBytes" | "createdAt">,
  ) => ({
    id: f.projectFileId,
    filename: f.filename,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes,
    createdAt: f.createdAt,
    url: `${appURL}/api/v1/projects/${f.projectId}/files/${f.projectFileId}`,
  });
  const presentComment = (comment: CommentSummary) => {
    const mentions = new Map<string, string>();
    const body = comment.body
      .map((node) => {
        if (node.type === "text") return node.text;
        mentions.set(node.userId, node.label);
        return `<@${node.userId}>`;
      })
      .join("");
    return {
      id: comment.id,
      parentId: comment.parentId,
      author: { id: comment.authorId, name: comment.authorName },
      body: comment.deletedAt ? "" : body,
      mentions: [...mentions].map(([id, name]) => ({ id, name })),
      attachments: comment.attachments.map((f) => presentFile(f)),
      replyCount: comment.replyCount,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      deletedAt: comment.deletedAt,
    };
  };

  return {
    presentFile,
    projects: (userId: string) => publicApi.memberProjects(userId),
    project: (userId: string, ref: string) => publicApi.projectDetail(userId, ref),
    resolveProject: (userId: string, ref: string) => publicApi.resolveProject(userId, ref),
    resolveIssue: (userId: string, ref: string) => publicApi.resolveIssue(userId, ref),

    async searchIssues(userId: string, params: IssueSearchParams) {
      const invalid = params.statusCategories?.find((v) => !(issueTriggers as readonly string[]).includes(v));
      if (invalid)
        throw new ApiError(400, "invalid_request", `statusCategory must be one of ${issueTriggers.join(", ")}.`);
      if (!sortPattern.test(params.sort)) throw new ApiError(400, "invalid_request", sortMessage);
      const offset =
        cursor.decode(params.cursor, z.object({ offset: z.number().int().min(0).max(1_000_000) }))?.offset ?? 0;
      const result = await publicApi.search(userId, {
        projects: params.projects,
        statuses: params.statuses,
        categories: params.statusCategories as IssueTrigger[] | undefined,
        assignee: params.assignee,
        q: params.q,
        createdAfter: params.createdAfter,
        createdBefore: params.createdBefore,
        updatedAfter: params.updatedAfter,
        updatedBefore: params.updatedBefore,
        dueAfter: params.dueAfter,
        dueBefore: params.dueBefore,
        startAfter: params.startAfter,
        startBefore: params.startBefore,
        sort: params.sort.replace(/^-/, "") as IssueSortField,
        order: params.sort.startsWith("-") ? "desc" : "asc",
        limit: params.limit,
        offset,
      });
      return {
        issues: result.issues,
        nextCursor: result.nextOffset === null ? null : cursor.encode({ offset: result.nextOffset }),
      };
    },

    getIssue: (userId: string, ref: string) => publicApi.issue(userId, ref),

    async createIssue(userId: string, input: z.infer<typeof createIssueInput>) {
      const p = await publicApi.resolveProject(userId, input.project);
      const { project: _, attachments, title, ...fields } = input;
      const resolved = await publicApi.resolveFields(userId, p.id, fields);
      const created = await issues.create(userId, {
        ...resolved,
        projectId: p.id,
        title,
        projectFileIds: attachments,
      });
      return publicApi.issue(userId, created.id);
    },

    async updateIssue(userId: string, ref: string, input: z.infer<typeof updateIssueInput>) {
      const target = await publicApi.resolveIssue(userId, ref);
      const { expectedUpdatedAt, ...fields } = input;
      const resolved = await publicApi.resolveFields(userId, target.projectId, fields);
      await issues.update(userId, {
        ...resolved,
        projectId: target.projectId,
        id: target.id,
        // Without a version the edit applies to whatever is current: only the
        // fields sent are written, so concurrent edits to other fields survive.
        expectedUpdatedAt,
      });
      return publicApi.issue(userId, target.id);
    },

    async listComments(userId: string, ref: string, options: { parentId?: string | undefined; cursor?: string | undefined }) {
      const target = await publicApi.resolveIssue(userId, ref);
      const after = cursor.decode(options.cursor, z.object({ createdAt: z.iso.datetime(), id }).strict());
      const page = await comments.list(userId, {
        projectId: target.projectId,
        issueId: target.id,
        parentId: options.parentId ? id.parse(options.parentId) : null,
        cursor: after,
      });
      return {
        comments: page.comments.map((comment) => presentComment(comment)),
        nextCursor: page.nextCursor ? cursor.encode(page.nextCursor) : null,
      };
    },

    async addComment(userId: string, ref: string, input: z.infer<typeof createCommentInput>) {
      const target = await publicApi.resolveIssue(userId, ref);
      const matches = [...input.body.matchAll(MENTION)];
      // Each mention adds up to two nodes; the comment service allows 1,000.
      if (matches.length > 400)
        throw new ApiError(422, "invalid_input", "Mention at most 400 people in one comment.");
      const findPerson = matches.length ? await publicApi.personResolver(userId, target.projectId) : null;
      const body: CommentBody = [];
      let position = 0;
      for (const match of matches) {
        const person = findPerson!(match[1]!);
        if (match.index > position) body.push({ type: "text", text: input.body.slice(position, match.index) });
        body.push({ type: "mention", userId: person.id, label: person.name });
        position = match.index + match[0].length;
      }
      if (position < input.body.length) body.push({ type: "text", text: input.body.slice(position) });
      const scope = { projectId: target.projectId, issueId: target.id };
      // Comments list oldest first; start the read-back just before this write.
      const since = { createdAt: new Date(Date.now() - 60_000).toISOString(), id: "" };
      const { id: commentId } = await comments.save(userId, {
        ...scope,
        parentId: input.parentId ?? null,
        body,
        files: input.attachments.map((projectFileId) => ({ projectId: target.projectId, projectFileId })),
      });
      // Read back through the normal listing so the response matches GET.
      let created: CommentSummary | undefined;
      let next: { createdAt: string; id: string } | undefined = since;
      do {
        const page = await comments.list(userId, { ...scope, parentId: input.parentId ?? null, cursor: next });
        created = page.comments.find((comment) => comment.id === commentId);
        next = page.nextCursor ?? undefined;
      } while (!created && next);
      if (!created) throw new ApiError(404, "not_found", "Comment not found.");
      return presentComment(created);
    },

    async listAttachments(userId: string, ref: string) {
      const target = await publicApi.resolveIssue(userId, ref);
      const rows = await files.attachments(userId, target.projectId, target.id);
      return { attachments: rows.map((row) => presentFile(row)) };
    },

    /**
     * Stores a file in a project, optionally attaching it to an issue in the
     * same transaction so nothing is published if the issue cannot take it.
     */
    async uploadFile(
      userId: string,
      input: {
        projectId: string;
        filename: string;
        body: ReadableStream<Uint8Array>;
        length?: number | undefined;
        attachToIssueId?: string | undefined;
      },
    ) {
      if (input.length === 0) throw new FileInputError("Empty files cannot be uploaded.");
      return presentFile(
        await files.upload(userId, input.projectId, input.filename, input.body, input.length, {
          attachToIssueId: input.attachToIssueId,
        }),
      );
    },

    async linkFile(userId: string, ref: string, fileId: string) {
      const target = await publicApi.resolveIssue(userId, ref);
      // The response comes from the write itself, so a concurrent unlink
      // cannot turn a committed link into a 404.
      const linked = await files.link(userId, {
        projectId: target.projectId,
        issueId: target.id,
        sourceProjectId: target.projectId,
        projectFileId: fileId,
      });
      return presentFile(linked.file);
    },
  };
}
export type Operations = ReturnType<typeof createOperations>;
