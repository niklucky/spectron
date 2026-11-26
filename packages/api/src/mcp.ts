/**
 * MCP server at /api/mcp: the same issue operations as /api/v1, as tools.
 *
 * Accepts two kinds of bearer token:
 * - OAuth access tokens issued by the Better Auth MCP plugin. Clients find
 *   the authorization server through the RFC 9728 metadata linked from the
 *   401 challenge, then sign the person in and ask for consent.
 * - Personal access tokens (spk_…), for clients configured with a header.
 * Either way the tools act as that person, who must have a verified email.
 */

import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createMcpTokenVerifier,
  type ApiTokenService,
  type Auth,
  type OAuthAppService,
} from "@spectron/backend";
import { issueTriggers } from "@spectron/shared";
import {
  ApiError,
  createCommentInput,
  createIssueInput,
  id,
  sortMessage,
  updateIssueFields,
  type Operations,
} from "./operations";
import { apiErrorStatus } from "./v1";

/** Decoded file size accepted by upload_file; the request carries it base64-encoded. */
export const MCP_MAX_FILE_BYTES = 3 * 1024 * 1024;
/** Request bodies above this are refused before parsing. */
export const MCP_MAX_BODY_BYTES = 5 * 1024 * 1024;

type Actor = { userId: string; via: string };

const dateFilter = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .optional()
  .describe("ISO date (2026-12-01, midnight UTC) or date-time.");
const issueRef = z
  .string()
  .min(1)
  .max(64)
  .describe("Spectron issue key such as SP-12, or the issue id.");

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
});
async function run(action: () => Promise<unknown>) {
  try {
    return json(await action());
  } catch (error) {
    const { status, code, message } = apiErrorStatus(error);
    if (status === 500) console.error("MCP tool call failed.");
    // Tool errors are results the model can read and correct, not protocol errors.
    return { isError: true, content: [{ type: "text" as const, text: `${code}: ${message}` }] };
  }
}

function buildServer(ops: Operations, actor: Actor) {
  const me = actor.userId;
  const server = new McpServer(
    { name: "spectron", version: "1.0.0" },
    {
      instructions: [
        "Spectron is an issue tracker. Issues are addressed by their Spectron key (SP-12) or id.",
        "Call get_project first to learn a project's statuses, priorities, types, tags and members.",
        "Statuses, priorities, types and tags are given by name; people by email, member id or \"me\".",
        "Mention people in comments as <@email> or <@member-id>.",
        "Changes are made as the signed-in person and appear in issue history.",
      ].join(" "),
    },
  );
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  server.registerTool(
    "whoami",
    { description: "The signed-in person and the projects they belong to.", annotations: read },
    () => run(async () => ({ userId: me, via: actor.via, projects: await ops.projects(me) })),
  );
  server.registerTool(
    "list_projects",
    { description: "Projects the signed-in person belongs to, with their keys.", annotations: read },
    () => run(async () => ({ projects: await ops.projects(me) })),
  );
  server.registerTool(
    "get_project",
    {
      description:
        "A project's statuses (with categories), priorities, types, tags, custom fields and members. Use it to find valid names before creating or updating issues.",
      inputSchema: z.object({ project: z.string().min(1).max(64).describe("Project key (SP) or id.") }),
      annotations: read,
    },
    ({ project }) => run(() => ops.project(me, project)),
  );
  server.registerTool(
    "search_issues",
    {
      description:
        "Search issues across the person's projects. Date filters ending in After are inclusive, Before exclusive. Returns a page of issues and nextCursor; pass it back as cursor for the next page.",
      inputSchema: z.object({
        project: z.array(z.string().min(1).max(64)).max(20).optional().describe("Project keys or ids. Default: all."),
        status: z.array(z.string().min(1).max(80)).max(50).optional().describe("Status names or ids."),
        statusCategory: z.array(z.enum(issueTriggers)).max(5).optional(),
        assignee: z.string().max(254).optional().describe('"me", "none", an email or a member id.'),
        q: z.string().max(255).optional().describe("Case-insensitive title search."),
        createdAfter: dateFilter,
        createdBefore: dateFilter,
        updatedAfter: dateFilter,
        updatedBefore: dateFilter,
        dueAfter: dateFilter,
        dueBefore: dateFilter,
        startAfter: dateFilter,
        startBefore: dateFilter,
        sort: z.string().max(20).optional().describe(`${sortMessage} Default -updated.`),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25."),
        cursor: z.string().max(200).optional(),
      }),
      annotations: read,
    },
    (input) =>
      run(() => {
        const date = (value: string | undefined) => (value === undefined ? undefined : new Date(value));
        return ops.searchIssues(me, {
          projects: input.project,
          statuses: input.status,
          statusCategories: input.statusCategory,
          assignee: input.assignee,
          q: input.q,
          createdAfter: date(input.createdAfter),
          createdBefore: date(input.createdBefore),
          updatedAfter: date(input.updatedAfter),
          updatedBefore: date(input.updatedBefore),
          dueAfter: date(input.dueAfter),
          dueBefore: date(input.dueBefore),
          startAfter: date(input.startAfter),
          startBefore: date(input.startBefore),
          sort: input.sort ?? "-updated",
          limit: input.limit ?? 25,
          cursor: input.cursor,
        });
      }),
  );
  server.registerTool(
    "get_issue",
    {
      description: "An issue with its description, tags and custom fields.",
      inputSchema: z.object({ issue: issueRef }),
      annotations: read,
    },
    ({ issue }) => run(() => ops.getIssue(me, issue)),
  );
  server.registerTool(
    "create_issue",
    {
      description:
        "Create an issue. Use names for status, priority, type and tags, and an email, member id or \"me\" for assignee. dueAt/startAt take ISO dates. attachments takes file ids from upload_file.",
      inputSchema: createIssueInput,
      annotations: write,
    },
    (input) => run(() => ops.createIssue(me, input)),
  );
  server.registerTool(
    "update_issue",
    {
      description:
        "Change an issue, including its status. Only the fields you send are written; send null to clear one. Pass expectedUpdatedAt (the issue's updatedAt) to fail with a conflict if someone changed it since you read it.",
      inputSchema: updateIssueFields.extend({ issue: issueRef }),
      annotations: { ...write, idempotentHint: true },
    },
    ({ issue, ...fields }) =>
      run(async () => {
        if (!Object.keys(fields).some((key) => key !== "expectedUpdatedAt"))
          throw new ApiError(400, "invalid_request", "Send at least one field to change.");
        return ops.updateIssue(me, issue, fields);
      }),
  );
  server.registerTool(
    "list_comments",
    {
      description:
        "Top-level comments on an issue, oldest first, or the replies to one comment when parentId is given. Mentions appear as <@member-id> with names in mentions.",
      inputSchema: z.object({ issue: issueRef, parentId: id.optional(), cursor: z.string().max(200).optional() }),
      annotations: read,
    },
    ({ issue, parentId, cursor }) => run(() => ops.listComments(me, issue, { parentId, cursor })),
  );
  server.registerTool(
    "add_comment",
    {
      description:
        "Comment on an issue. Mention project members as <@email> or <@member-id>; they are notified. Set parentId to reply in a thread. attachments takes file ids from upload_file.",
      inputSchema: createCommentInput.extend({ issue: issueRef }),
      annotations: write,
    },
    ({ issue, ...input }) => run(() => ops.addComment(me, issue, input)),
  );
  server.registerTool(
    "list_attachments",
    {
      description: "Files attached to an issue, with download URLs for the REST API.",
      inputSchema: z.object({ issue: issueRef }),
      annotations: read,
    },
    ({ issue }) => run(() => ops.listAttachments(me, issue)),
  );
  server.registerTool(
    "upload_file",
    {
      description: `Upload a file (base64, up to ${MCP_MAX_FILE_BYTES / 1024 / 1024} MB). With issue, it is attached to that issue; with project only, use the returned id in add_comment or create_issue attachments.`,
      inputSchema: z
        .object({
          issue: issueRef.optional(),
          project: z.string().min(1).max(64).optional().describe("Project key or id, when not attaching to an issue."),
          filename: z.string().min(1).max(255),
          contentBase64: z.string().min(1).max(Math.ceil(MCP_MAX_FILE_BYTES / 3) * 4 + 4),
        })
        .refine((input) => input.issue || input.project, "Give an issue to attach to, or a project."),
      annotations: write,
    },
    (input) =>
      run(async () => {
        const bytes = Buffer.from(input.contentBase64, "base64");
        if (!bytes.length) throw new ApiError(422, "invalid_input", "contentBase64 decodes to an empty file.");
        let projectId: string;
        let attachToIssueId: string | undefined;
        if (input.issue) {
          const target = await ops.resolveIssue(me, input.issue);
          projectId = target.projectId;
          attachToIssueId = target.id;
        } else projectId = (await ops.resolveProject(me, input.project!)).id;
        return ops.uploadFile(me, {
          projectId,
          filename: input.filename,
          body: new Blob([bytes]).stream(),
          length: bytes.length,
          attachToIssueId,
        });
      }),
  );
  return server;
}

export function createMcpRoute({
  auth,
  tokens,
  apps,
  operations,
  appURL,
}: {
  auth: Auth;
  tokens: ApiTokenService;
  apps: OAuthAppService;
  operations: Operations;
  appURL: string;
}) {
  const verify = createMcpTokenVerifier(auth, appURL);
  const metadata = `${appURL}/.well-known/oauth-protected-resource/api/mcp`;
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const actor = authInfo?.extra as Actor | undefined;
      // The route below always sets this; a missing actor must never fall back to anyone.
      if (!actor?.userId) throw new Error("MCP request without an authenticated actor.");
      return buildServer(operations, actor);
    },
    { maxRequestBodySize: MCP_MAX_BODY_BYTES, onerror: () => console.error("MCP request failed.") },
  );
  const serve = (request: Request, info: AuthInfo) => handler.fetch(request, { authInfo: info });
  /** RFC 6750 / RFC 9728 challenge: tells MCP clients where to start OAuth. */
  const challenge = (status: 401 | 403, message: string, error?: "invalid_token") =>
    new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
      status,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer ${error ? `error="${error}", ` : ""}resource_metadata="${metadata}"`,
      },
    });
  const viaOAuth = async (request: Request, token: string) => {
    let claims: Awaited<ReturnType<typeof verify>>;
    try {
      claims = await verify(token);
    } catch {
      return challenge(401, "Invalid or expired access token.", "invalid_token");
    }
    const person = await tokens.verifiedUser(claims.sub!);
    if (!person) return challenge(403, "Your Spectron account must have a verified email.");
    const clientId = typeof claims.azp === "string" ? claims.azp : String(claims.client_id ?? "");
    // Disconnecting an app in settings removes its consent; honour that
    // immediately rather than when this access token expires.
    if (!clientId || !(await apps.isConnected(person.id, clientId)))
      return challenge(401, "This app was disconnected from Spectron. Connect it again.", "invalid_token");
    return serve(request, {
      token,
      clientId,
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
      ...(typeof claims.exp === "number" ? { expiresAt: claims.exp } : {}),
      extra: { userId: person.id, via: `oauth:${clientId}` } satisfies Actor,
    });
  };
  return async (request: Request): Promise<Response> => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!bearer) return challenge(401, "Sign in to Spectron to use this MCP server.");
    if (!bearer.startsWith("spk_")) return viaOAuth(request, bearer);
    const actor = await tokens.authenticate(bearer);
    if (!actor) return challenge(401, "Invalid or revoked personal access token.", "invalid_token");
    return serve(request, {
      token: "",
      clientId: `pat:${actor.token.id}`,
      scopes: [],
      extra: { userId: actor.user.id, via: `token:${actor.token.name}` } satisfies Actor,
    });
  };
}
