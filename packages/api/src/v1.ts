/**
 * Public REST API for agents, scripts and the CLI.
 *
 * Authenticated with personal access tokens only (`Authorization: Bearer
 * spk_…`); browser cookies are ignored here, so these routes need no CSRF
 * protection. Every write goes through the same services as the app, so
 * history, validation and Jira export behave identically. See docs/api.md.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  ApiTokenInputError,
  FileInputError,
  FileSizeError,
  FileUnavailableError,
  IssueConflictError,
  IssueInputError,
  JiraApiError,
  ProjectAccessError,
  issueSortFields,
  type ApiTokenService,
  type CommentService,
  type FileService,
  type IssueService,
  type PublicApiService,
} from "@spectron/backend";
import {
  applicationIdPattern,
  filePreviewKind,
  issueTriggers,
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  type CommentBody,
  type CommentSummary,
  type ProjectFileSummary,
} from "@spectron/shared";
import { storedFileResponse } from "./files";

type Actor = {
  user: { id: string; name: string; email: string };
  token: { id: string; name: string };
};
type Env = { Variables: { actor: Actor } };

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const id = z.string().regex(applicationIdPattern);
const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const instant = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value));
const nullableDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullable();
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

const searchQuery = z
  .object({
    project: z.string().max(500).optional(),
    status: z.string().max(2000).optional(),
    statusCategory: z.string().max(200).optional(),
    assignee: z.string().max(254).optional(),
    q: z.string().max(255).optional(),
    createdAfter: instant.optional(),
    createdBefore: instant.optional(),
    updatedAfter: instant.optional(),
    updatedBefore: instant.optional(),
    dueAfter: instant.optional(),
    dueBefore: instant.optional(),
    startAfter: instant.optional(),
    startBefore: instant.optional(),
    sort: z
      .string()
      .regex(new RegExp(`^-?(${issueSortFields.join("|")})$`), `Sort by ${issueSortFields.join(", ")}; prefix with - for descending.`)
      .default("-updated"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

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
const createIssue = z
  .object({
    project: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(ISSUE_TITLE_MAX_LENGTH),
    attachments: z.array(id).max(20).optional(),
    ...issueFields,
  })
  .strict();
const updateIssue = z
  .object({
    title: z.string().trim().min(1).max(ISSUE_TITLE_MAX_LENGTH).optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
    ...issueFields,
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "expectedUpdatedAt"), "Send at least one field to change.");
const createComment = z
  .object({
    body: z.string().max(100000).default(""),
    parentId: id.nullable().optional(),
    attachments: z.array(id).max(20).default([]),
  })
  .strict();
const linkAttachment = z.object({ fileId: id }).strict();

/** `<@member-id>` or `<@email>` in comment text become mentions. */
const MENTION = /<@([^<>\s]{1,254})>/g;

export function createV1Routes({
  tokens,
  publicApi,
  issues,
  comments,
  files,
  appURL,
}: {
  tokens: ApiTokenService;
  publicApi: PublicApiService;
  issues: IssueService;
  comments: CommentService;
  files: FileService;
  appURL: string;
}) {
  const v1 = new Hono<Env>();
  const fileURL = (projectId: string, projectFileId: string) =>
    `${appURL}/api/v1/projects/${projectId}/files/${projectFileId}`;

  v1.onError((error, c) => {
    const body = (status: number, code: string, message: string) =>
      c.json({ error: { code, message } }, status as 400);
    if (error instanceof ApiError) return body(error.status, error.code, error.message);
    if (error instanceof z.ZodError) return body(400, "invalid_request", z.prettifyError(error));
    if (error instanceof ProjectAccessError) return body(404, "not_found", error.message);
    if (error instanceof IssueConflictError) return body(409, "conflict", error.message);
    if (error instanceof FileSizeError) return body(413, "file_too_large", error.message);
    if (error instanceof FileUnavailableError) return body(503, "file_unavailable", error.message);
    if (
      error instanceof IssueInputError ||
      error instanceof FileInputError ||
      error instanceof ApiTokenInputError ||
      error instanceof JiraApiError
    )
      return body(422, "invalid_input", error.message);
    console.error("Public API request failed.");
    return body(500, "internal_error", "Something went wrong. Please try again.");
  });

  v1.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const actor = match ? await tokens.authenticate(match[1]!) : null;
    if (!actor) {
      c.header("WWW-Authenticate", 'Bearer realm="spectron"');
      throw new ApiError(
        401,
        "unauthorized",
        "Send a personal access token as `Authorization: Bearer spk_…`. Create one in Spectron → AI connections & agents → API tokens.",
      );
    }
    c.set("actor", actor);
    await next();
  });
  const me = (c: Context<Env>) => c.get("actor").user.id;
  const json = async <T>(c: Context<Env>, schema: z.ZodType<T>): Promise<T> => {
    // Size is enforced by the bodyLimit middleware in index.ts, streamed bodies included.
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiError(400, "invalid_json", "Send a JSON request body.");
    }
    return schema.parse(raw);
  };
  const upload = async (c: Context<Env>, projectId: string, attachToIssueId?: string) => {
    const filename = z
      .string({ error: "Pass the file name as ?filename=…" })
      .min(1)
      .max(1024)
      .parse(c.req.query("filename"));
    if (!c.req.raw.body) throw new FileInputError("Send the file bytes as the request body.");
    const length = c.req.header("content-length");
    if (length !== undefined && !/^\d+$/.test(length))
      throw new ApiError(400, "invalid_request", "Content-Length must be a whole number of bytes.");
    if (length === "0") throw new FileInputError("Empty files cannot be uploaded.");
    return files.upload(
      me(c),
      projectId,
      filename,
      c.req.raw.body,
      length === undefined ? undefined : Number(length),
      { attachToIssueId },
    );
  };
  const presentFile = (
    f: Pick<ProjectFileSummary, "projectFileId" | "projectId" | "filename" | "contentType" | "sizeBytes" | "createdAt">,
  ) => ({
    id: f.projectFileId,
    filename: f.filename,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes,
    createdAt: f.createdAt,
    url: fileURL(f.projectId, f.projectFileId),
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

  v1.get("/me", async (c) => {
    const actor = c.get("actor");
    const projects = await publicApi.memberProjects(actor.user.id);
    return c.json({ user: actor.user, token: actor.token, projects });
  });

  v1.get("/projects", async (c) => c.json({ projects: await publicApi.memberProjects(me(c)) }));
  v1.get("/projects/:project", async (c) =>
    c.json(await publicApi.projectDetail(me(c), c.req.param("project"))),
  );
  v1.post("/projects/:project/files", async (c) => {
    const p = await publicApi.resolveProject(me(c), c.req.param("project"));
    return c.json(presentFile(await upload(c, p.id)), 201);
  });
  v1.on(["GET", "HEAD"], "/projects/:project/files/:fileId", async (c) => {
    const p = await publicApi.resolveProject(me(c), c.req.param("project"));
    const file = await files.download(me(c), p.id, id.parse(c.req.param("fileId")));
    return storedFileResponse(c.req.raw, file, files.delivery, {
      inline: filePreviewKind(file.contentType) !== null && c.req.query("download") !== "1",
      cacheControl: "private, no-store",
    });
  });

  v1.get("/issues", async (c) => {
    const query = searchQuery.parse(c.req.query());
    const categories = list(query.statusCategory);
    const invalid = categories?.find((v) => !(issueTriggers as readonly string[]).includes(v));
    if (invalid)
      throw new ApiError(400, "invalid_request", `statusCategory must be one of ${issueTriggers.join(", ")}.`);
    const offset = cursor.decode(query.cursor, z.object({ offset: z.number().int().min(0).max(1_000_000) }))?.offset ?? 0;
    const descending = query.sort.startsWith("-");
    const result = await publicApi.search(me(c), {
      projects: list(query.project),
      statuses: list(query.status),
      categories: categories as typeof issueTriggers[number][] | undefined,
      assignee: query.assignee,
      q: query.q,
      createdAfter: query.createdAfter,
      createdBefore: query.createdBefore,
      updatedAfter: query.updatedAfter,
      updatedBefore: query.updatedBefore,
      dueAfter: query.dueAfter,
      dueBefore: query.dueBefore,
      startAfter: query.startAfter,
      startBefore: query.startBefore,
      sort: query.sort.replace(/^-/, "") as (typeof issueSortFields)[number],
      order: descending ? "desc" : "asc",
      limit: query.limit,
      offset,
    });
    return c.json({
      issues: result.issues,
      nextCursor: result.nextOffset === null ? null : cursor.encode({ offset: result.nextOffset }),
    });
  });

  v1.post("/issues", async (c) => {
    const input = await json(c, createIssue);
    const p = await publicApi.resolveProject(me(c), input.project);
    const { project: _, attachments, title, ...fields } = input;
    const resolved = await publicApi.resolveFields(me(c), p.id, fields);
    const created = await issues.create(me(c), {
      ...resolved,
      projectId: p.id,
      title,
      projectFileIds: attachments,
    });
    return c.json(await publicApi.issue(me(c), created.id), 201);
  });

  v1.get("/issues/:issue", async (c) => c.json(await publicApi.issue(me(c), c.req.param("issue"))));

  v1.patch("/issues/:issue", async (c) => {
    const input = await json(c, updateIssue);
    const target = await publicApi.resolveIssue(me(c), c.req.param("issue"));
    const { expectedUpdatedAt, ...fields } = input;
    const resolved = await publicApi.resolveFields(me(c), target.projectId, fields);
    await issues.update(me(c), {
      ...resolved,
      projectId: target.projectId,
      id: target.id,
      // Without a version the edit applies to whatever is current: only the
      // fields sent are written, so concurrent edits to other fields survive.
      expectedUpdatedAt,
    });
    return c.json(await publicApi.issue(me(c), target.id));
  });

  v1.get("/issues/:issue/comments", async (c) => {
    const target = await publicApi.resolveIssue(me(c), c.req.param("issue"));
    const parentId = c.req.query("parentId");
    const after = cursor.decode(
      c.req.query("cursor"),
      z.object({ createdAt: z.iso.datetime(), id }).strict(),
    );
    const page = await comments.list(me(c), {
      projectId: target.projectId,
      issueId: target.id,
      parentId: parentId ? id.parse(parentId) : null,
      cursor: after,
    });
    return c.json({
      comments: page.comments.map((comment) => presentComment(comment)),
      nextCursor: page.nextCursor ? cursor.encode(page.nextCursor) : null,
    });
  });

  v1.post("/issues/:issue/comments", async (c) => {
    const input = await json(c, createComment);
    const target = await publicApi.resolveIssue(me(c), c.req.param("issue"));
    const matches = [...input.body.matchAll(MENTION)];
    // Each mention adds up to two nodes; the comment service allows 1,000.
    if (matches.length > 400)
      throw new ApiError(422, "invalid_input", "Mention at most 400 people in one comment.");
    const findPerson = matches.length ? await publicApi.personResolver(me(c), target.projectId) : null;
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
    const { id: commentId } = await comments.save(me(c), {
      ...scope,
      parentId: input.parentId ?? null,
      body,
      files: input.attachments.map((projectFileId) => ({ projectId: target.projectId, projectFileId })),
    });
    // Read back through the normal listing so the response matches GET.
    let created: CommentSummary | undefined;
    let next: { createdAt: string; id: string } | undefined = since;
    do {
      const page = await comments.list(me(c), { ...scope, parentId: input.parentId ?? null, cursor: next });
      created = page.comments.find((comment) => comment.id === commentId);
      next = page.nextCursor ?? undefined;
    } while (!created && next);
    if (!created) throw new ApiError(404, "not_found", "Comment not found.");
    return c.json(presentComment(created), 201);
  });

  v1.get("/issues/:issue/attachments", async (c) => {
    const target = await publicApi.resolveIssue(me(c), c.req.param("issue"));
    const rows = await files.attachments(me(c), target.projectId, target.id);
    return c.json({ attachments: rows.map((row) => presentFile(row)) });
  });

  v1.post("/issues/:issue/attachments", async (c) => {
    const target = await publicApi.resolveIssue(me(c), c.req.param("issue"));
    // ?filename=… uploads the request body; otherwise JSON {fileId} links an
    // already uploaded project file.
    let projectFileId: string;
    if (c.req.query("filename") !== undefined)
      // Uploaded and attached in one transaction: nothing is published if the
      // issue cannot take attachments.
      projectFileId = (await upload(c, target.projectId, target.id)).projectFileId;
    else {
      projectFileId = (await json(c, linkAttachment)).fileId;
      await files.link(me(c), {
        projectId: target.projectId,
        issueId: target.id,
        sourceProjectId: target.projectId,
        projectFileId,
      });
    }
    const rows = await files.attachments(me(c), target.projectId, target.id);
    const attached = rows.find((row) => row.projectFileId === projectFileId);
    if (!attached) throw new ApiError(404, "not_found", "Attachment not found.");
    return c.json(presentFile(attached), 201);
  });

  // Registered last: a mounted app's notFound handler is not consulted by the parent.
  v1.all("*", () => {
    throw new ApiError(404, "not_found", "Unknown API route. See docs/api.md.");
  });
  return v1;
}
