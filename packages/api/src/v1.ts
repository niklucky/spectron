/**
 * Public REST API for agents, scripts and the CLI.
 *
 * Authenticated with personal access tokens only (`Authorization: Bearer
 * spk_…`); browser cookies are ignored here, so these routes need no CSRF
 * protection. Every write goes through the same services as the app, so
 * history, validation and Jira export behave identically. The logic lives in
 * ./operations, shared with the MCP server. See docs/api.md.
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
  type ApiTokenService,
  type FileService,
} from "@spectron/backend";
import { filePreviewKind } from "@spectron/shared";
import { storedFileResponse } from "./files";
import {
  ApiError,
  createCommentInput,
  createIssueInput,
  id,
  instant,
  updateIssueInput,
  type Operations,
} from "./operations";

type Actor = {
  user: { id: string; name: string; email: string };
  token: { id: string; name: string };
};
type Env = { Variables: { actor: Actor } };

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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
    sort: z.string().max(20).default("-updated"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();
const linkAttachment = z.object({ fileId: id }).strict();

/** Maps service errors to HTTP status codes and stable error codes. */
export function apiErrorStatus(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { status: 400, code: "invalid_request", message: z.prettifyError(error) };
  if (error instanceof ProjectAccessError) return { status: 404, code: "not_found", message: error.message };
  if (error instanceof IssueConflictError) return { status: 409, code: "conflict", message: error.message };
  if (error instanceof FileSizeError) return { status: 413, code: "file_too_large", message: error.message };
  if (error instanceof FileUnavailableError) return { status: 503, code: "file_unavailable", message: error.message };
  if (
    error instanceof IssueInputError ||
    error instanceof FileInputError ||
    error instanceof ApiTokenInputError ||
    error instanceof JiraApiError
  )
    return { status: 422, code: "invalid_input", message: error.message };
  return { status: 500, code: "internal_error", message: "Something went wrong. Please try again." };
}

export function createV1Routes({
  tokens,
  operations: ops,
  files,
}: {
  tokens: ApiTokenService;
  operations: Operations;
  files: FileService;
}) {
  const v1 = new Hono<Env>();

  v1.onError((error, c) => {
    const { status, code, message } = apiErrorStatus(error);
    if (status === 500) console.error("Public API request failed.");
    return c.json({ error: { code, message } }, status as 400);
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
  const upload = (c: Context<Env>, projectId: string, attachToIssueId?: string) => {
    const filename = z
      .string({ error: "Pass the file name as ?filename=…" })
      .min(1)
      .max(1024)
      .parse(c.req.query("filename"));
    if (!c.req.raw.body) throw new FileInputError("Send the file bytes as the request body.");
    const length = c.req.header("content-length");
    if (length !== undefined && !/^\d+$/.test(length))
      throw new ApiError(400, "invalid_request", "Content-Length must be a whole number of bytes.");
    return ops.uploadFile(me(c), {
      projectId,
      filename,
      body: c.req.raw.body,
      length: length === undefined ? undefined : Number(length),
      attachToIssueId,
    });
  };

  v1.get("/me", async (c) => {
    const actor = c.get("actor");
    return c.json({ user: actor.user, token: actor.token, projects: await ops.projects(actor.user.id) });
  });

  v1.get("/projects", async (c) => c.json({ projects: await ops.projects(me(c)) }));
  v1.get("/projects/:project", async (c) => c.json(await ops.project(me(c), c.req.param("project"))));
  v1.post("/projects/:project/files", async (c) => {
    const p = await ops.resolveProject(me(c), c.req.param("project"));
    return c.json(await upload(c, p.id), 201);
  });
  v1.on(["GET", "HEAD"], "/projects/:project/files/:fileId", async (c) => {
    const p = await ops.resolveProject(me(c), c.req.param("project"));
    const file = await files.download(me(c), p.id, id.parse(c.req.param("fileId")));
    return storedFileResponse(c.req.raw, file, files.delivery, {
      inline: filePreviewKind(file.contentType) !== null && c.req.query("download") !== "1",
      cacheControl: "private, no-store",
    });
  });

  v1.get("/issues", async (c) => {
    const query = searchQuery.parse(c.req.query());
    return c.json(
      await ops.searchIssues(me(c), {
        ...query,
        projects: list(query.project),
        statuses: list(query.status),
        statusCategories: list(query.statusCategory),
      }),
    );
  });
  v1.post("/issues", async (c) => c.json(await ops.createIssue(me(c), await json(c, createIssueInput)), 201));
  v1.get("/issues/:issue", async (c) => c.json(await ops.getIssue(me(c), c.req.param("issue"))));
  v1.patch("/issues/:issue", async (c) =>
    c.json(await ops.updateIssue(me(c), c.req.param("issue"), await json(c, updateIssueInput))),
  );

  v1.get("/issues/:issue/comments", async (c) =>
    c.json(
      await ops.listComments(me(c), c.req.param("issue"), {
        parentId: c.req.query("parentId"),
        cursor: c.req.query("cursor"),
      }),
    ),
  );
  v1.post("/issues/:issue/comments", async (c) =>
    c.json(await ops.addComment(me(c), c.req.param("issue"), await json(c, createCommentInput)), 201),
  );

  v1.get("/issues/:issue/attachments", async (c) => c.json(await ops.listAttachments(me(c), c.req.param("issue"))));
  v1.post("/issues/:issue/attachments", async (c) => {
    // ?filename=… uploads the request body and attaches it in one transaction;
    // otherwise JSON {fileId} links an already uploaded project file.
    if (c.req.query("filename") !== undefined) {
      const target = await ops.resolveIssue(me(c), c.req.param("issue"));
      return c.json(await upload(c, target.projectId, target.id), 201);
    }
    const { fileId } = await json(c, linkAttachment);
    return c.json(await ops.linkFile(me(c), c.req.param("issue"), fileId), 201);
  });

  // Registered last: a mounted app's notFound handler is not consulted by the parent.
  v1.all("*", () => {
    throw new ApiError(404, "not_found", "Unknown API route. See docs/api.md.");
  });
  return v1;
}
