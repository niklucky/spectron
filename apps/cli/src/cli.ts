/**
 * `spectron`: issues from the terminal, for people and agents. Every command
 * is a call to the public REST API (/api/v1, docs/api.md) authenticated with
 * a personal access token. Text output is for people; --json prints the API's
 * own response shapes for scripts and agents.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { ApiFailure, createClient, type Client, type Fetch, type Query } from "./client.js";
import {
  deleteConfig,
  normalizeURL,
  readConfig,
  resolveCredentials,
  configPath,
  UsageError,
  writeConfig,
  type Env,
} from "./config.js";
import {
  commentText,
  fileTable,
  issueDetail,
  issueTable,
  parseDuration,
  personLabel,
  projectDetail,
  table,
  type Comment,
  type Issue,
  type Project,
  type ProjectDetail,
  type StoredFile,
} from "./format.js";

export const VERSION = "0.1.0";
const TOKEN_HELP = "Create one in Spectron: account menu → AI connections & agents → API tokens.";

export type IO = {
  env: Env;
  cwd: string;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };
  stdout: Writable & { isTTY?: boolean; columns?: number };
  stderr: Writable;
  fetch: Fetch;
};

type OptionSpec = { type: "string" | "boolean"; short?: string; multiple?: boolean; help: string };
type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;
type Context = {
  io: IO;
  values: Values;
  args: string[];
  json: boolean;
  client: () => Promise<Client>;
  out: (text: string) => void;
  data: (value: unknown) => void;
  note: (text: string) => void;
  width: number | undefined;
};
type Command = {
  name: string;
  args?: string;
  summary: string;
  group: string;
  options?: Record<string, OptionSpec>;
  run: (ctx: Context) => Promise<void>;
};

const str = (ctx: Context, name: string) => {
  const value = ctx.values[name];
  return typeof value === "string" ? value : undefined;
};
const strings = (ctx: Context, name: string) => {
  const value = ctx.values[name];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
};
const flag = (ctx: Context, name: string) => ctx.values[name] === true;
const path = (ref: string) => encodeURIComponent(ref);

function need(ctx: Context, count: number, names: string) {
  if (ctx.args.length < count) throw new UsageError(`Missing ${names}.`);
}

async function readAll(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** A file's text, or stdin for `-`. */
async function readText(io: IO, file: string) {
  if (file === "-") return readAll(io.stdin);
  try {
    return await readFile(resolve(io.cwd, file), "utf8");
  } catch {
    throw new UsageError(`Couldn't read ${file}.`);
  }
}

/** Reads one line from the terminal; hidden input is not echoed. */
function prompt(io: IO, question: string, hidden = false) {
  io.stderr.write(question);
  const { stdin } = io;
  const raw = hidden && stdin.isTTY && typeof stdin.setRawMode === "function";
  return new Promise<string>((done, fail) => {
    let value = "";
    const finish = (settle: () => void) => {
      stdin.off("data", onData);
      if (raw) {
        stdin.setRawMode!(false);
        io.stderr.write("\n");
      }
      stdin.pause();
      settle();
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n") return finish(() => done(value.trim()));
        if (ch === "\u0003" || ch === "\u0004") return finish(() => fail(new UsageError("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    if (raw) stdin.setRawMode!(true);
    stdin.on("data", onData);
    stdin.resume();
  });
}

/** Streams a local file to an upload endpoint. */
async function uploadFile(ctx: Context, endpoint: string, file: string) {
  const full = resolve(ctx.io.cwd, file);
  let info;
  try {
    info = await stat(full);
  } catch {
    throw new UsageError(`Couldn't read ${file}.`);
  }
  if (!info.isFile()) throw new UsageError(`${file} is not a file.`);
  const client = await ctx.client();
  return client.json<StoredFile>("POST", endpoint, {
    query: { filename: basename(full) },
    body: Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>,
    length: info.size,
    headers: { "content-type": "application/octet-stream" },
  });
}

/** Follows `nextCursor` until `limit` items (or all, without a limit). */
async function collect<T>(
  fetchPage: (cursor: string | undefined, pageSize: number) => Promise<{ items: T[]; nextCursor: string | null }>,
  limit = Infinity,
  cursor?: string,
) {
  const items: T[] = [];
  let next: string | null | undefined = cursor;
  do {
    const page = await fetchPage(next ?? undefined, Math.min(200, limit - items.length));
    items.push(...page.items);
    next = page.nextCursor;
  } while (next && items.length < limit);
  return { items, nextCursor: next ?? null };
}

const fieldOptions: Record<string, OptionSpec> = {
  title: { type: "string", short: "t", help: "Title" },
  description: { type: "string", short: "d", help: "Description (Markdown)" },
  "description-file": { type: "string", help: "Read the description from a file, or - for stdin" },
  status: { type: "string", short: "s", help: "Status name" },
  priority: { type: "string", help: "Priority name" },
  type: { type: "string", help: "Issue type name" },
  assignee: { type: "string", short: "a", help: "me, an email or a member id" },
  parent: { type: "string", help: "Parent issue key, e.g. SP-1" },
  tag: { type: "string", multiple: true, help: "Tag name; repeat for several" },
  start: { type: "string", help: "Start date, e.g. 2026-12-01" },
  due: { type: "string", help: "Due date, e.g. 2026-12-10" },
  estimate: { type: "string", help: "Estimate, e.g. 2h30m, 90m, or seconds" },
};

/** Issue fields from the shared flags, in the API's names. */
async function issueFields(ctx: Context) {
  const body: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) body[key] = value;
  };
  set("title", str(ctx, "title"));
  const descriptionFile = str(ctx, "description-file");
  if (descriptionFile !== undefined && str(ctx, "description") !== undefined)
    throw new UsageError("Use either --description or --description-file.");
  set("description", descriptionFile !== undefined ? await readText(ctx.io, descriptionFile) : str(ctx, "description"));
  set("status", str(ctx, "status"));
  set("priority", str(ctx, "priority"));
  set("type", str(ctx, "type"));
  set("assignee", str(ctx, "assignee"));
  set("parent", str(ctx, "parent"));
  set("startAt", str(ctx, "start"));
  set("dueAt", str(ctx, "due"));
  const estimate = str(ctx, "estimate");
  if (estimate !== undefined) {
    const seconds = parseDuration(estimate);
    if (seconds === null) throw new UsageError(`Can't read estimate "${estimate}". Use e.g. 2h30m, 90m or 3600.`);
    body.estimateSeconds = seconds;
  }
  if (ctx.values.tag !== undefined) body.tags = strings(ctx, "tag");
  return body;
}

/** `--clear` names → the API field and its empty value. */
const CLEARABLE: Record<string, [string, unknown]> = {
  description: ["description", ""],
  priority: ["priority", null],
  type: ["type", null],
  assignee: ["assignee", null],
  parent: ["parent", null],
  tags: ["tags", []],
  start: ["startAt", null],
  due: ["dueAt", null],
  estimate: ["estimateSeconds", null],
};

const issueRef = (ctx: Context) => {
  need(ctx, 1, "issue key, e.g. SP-12");
  return ctx.args[0]!;
};
const issueLine = (issue: Issue) => `${issue.key}  ${issue.title}\n${issue.url}`;

const commands: Command[] = [
  {
    name: "auth login",
    group: "Account",
    summary: "Sign in with a personal access token",
    options: {
      url: { type: "string", help: "Spectron address, e.g. https://spectron.example.com" },
      "with-token": { type: "boolean", help: "Read the token from stdin instead of prompting" },
    },
    async run(ctx) {
      const { io } = ctx;
      const saved = await readConfig(io.env);
      const interactive = io.stdin.isTTY === true && !flag(ctx, "with-token");
      let url = str(ctx, "url") ?? io.env.SPECTRON_URL ?? saved.url;
      if (!url && interactive) url = await prompt(io, "Spectron address (e.g. https://spectron.example.com): ");
      if (!url) throw new UsageError("Pass the server address with --url.");
      url = normalizeURL(url);
      let token: string;
      if (interactive) {
        io.stderr.write(`Paste a personal access token for ${url}. ${TOKEN_HELP}\n`);
        token = await prompt(io, "Token: ", true);
      } else if (flag(ctx, "with-token")) {
        token = (await readAll(io.stdin)).trim();
      } else {
        throw new UsageError("No terminal to prompt in. Pipe the token in with --with-token.");
      }
      if (!/^spk_\S+$/.test(token)) throw new UsageError(`That doesn't look like a Spectron token (spk_…). ${TOKEN_HELP}`);
      const client = createClient({ url, token, fetch: io.fetch, userAgent: userAgent() });
      const me = await client.json<Me>("GET", "/me");
      const file = await writeConfig(io.env, { url, token });
      if (ctx.json) return ctx.data(me);
      ctx.out(`Signed in to ${url} as ${me.user.name} <${me.user.email}> with token "${me.token.name}".`);
      ctx.note(`Saved to ${file}.`);
      if (io.env.SPECTRON_TOKEN) ctx.note("SPECTRON_TOKEN is set and takes precedence over the saved token.");
    },
  },
  {
    name: "auth status",
    group: "Account",
    summary: "Show who you are signed in as",
    async run(ctx) {
      const client = await ctx.client();
      const me = await client.json<Me>("GET", "/me");
      if (ctx.json) return ctx.data({ url: client.url, ...me });
      const source = ctx.io.env.SPECTRON_TOKEN ? "SPECTRON_TOKEN" : configPath(ctx.io.env);
      ctx.out(
        [
          `${client.url}`,
          `Signed in as ${me.user.name} <${me.user.email}> · token "${me.token.name}" (from ${source})`,
          `Projects: ${me.projects.map((p) => p.key).join(", ") || "none"}`,
        ].join("\n"),
      );
    },
  },
  {
    name: "auth logout",
    group: "Account",
    summary: "Forget the saved token on this machine",
    async run(ctx) {
      await deleteConfig(ctx.io.env);
      if (ctx.json) return ctx.data({ signedOut: true });
      ctx.out("Signed out on this machine.");
      ctx.note("The token itself keeps working until you revoke it in Spectron → AI connections & agents → API tokens.");
      if (ctx.io.env.SPECTRON_TOKEN) ctx.note("SPECTRON_TOKEN is still set in your environment.");
    },
  },
  {
    name: "project list",
    group: "Projects",
    summary: "Projects you belong to",
    async run(ctx) {
      const { projects } = await (await ctx.client()).json<{ projects: Project[] }>("GET", "/projects");
      if (ctx.json) return ctx.data({ projects });
      ctx.out(table(["KEY", "ROLE", "NAME"], projects.map((p) => [p.key, p.role ?? "", p.name]), ctx.width));
    },
  },
  {
    name: "project view",
    args: "<project>",
    group: "Projects",
    summary: "Statuses, priorities, types, tags, fields and members",
    async run(ctx) {
      need(ctx, 1, "project key");
      const detail = await (await ctx.client()).json<ProjectDetail>("GET", `/projects/${path(ctx.args[0]!)}`);
      if (ctx.json) return ctx.data(detail);
      ctx.out(projectDetail(detail));
    },
  },
  {
    name: "issue list",
    group: "Issues",
    summary: "Search issues",
    options: {
      project: { type: "string", short: "p", help: "Project keys, comma-separated (default: all yours)" },
      status: { type: "string", short: "s", help: "Status names, comma-separated" },
      category: {
        type: "string",
        short: "c",
        help: "Status categories: opened, in_progress, blocked, cancelled, finished",
      },
      assignee: { type: "string", short: "a", help: "me, none, an email or a member id" },
      search: { type: "string", short: "q", help: "Text in the title" },
      "created-after": { type: "string", help: "Created on or after (date or date-time)" },
      "created-before": { type: "string", help: "Created before" },
      "updated-after": { type: "string", help: "Updated on or after" },
      "updated-before": { type: "string", help: "Updated before" },
      "due-after": { type: "string", help: "Due on or after" },
      "due-before": { type: "string", help: "Due before" },
      "start-after": { type: "string", help: "Starting on or after" },
      "start-before": { type: "string", help: "Starting before" },
      sort: { type: "string", help: "created, updated, due, start or key; prefix - for descending (default -updated)" },
      limit: { type: "string", short: "L", help: "Most issues to return (default 50)" },
      cursor: { type: "string", help: "Continue from a previous --json nextCursor" },
    },
    async run(ctx) {
      const limit = Number(str(ctx, "limit") ?? 50);
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit must be a positive whole number.");
      const query: Query = {
        project: str(ctx, "project"),
        status: str(ctx, "status"),
        statusCategory: str(ctx, "category"),
        assignee: str(ctx, "assignee"),
        q: str(ctx, "search"),
        sort: str(ctx, "sort"),
      };
      for (const [option, param] of [
        ["created-after", "createdAfter"],
        ["created-before", "createdBefore"],
        ["updated-after", "updatedAfter"],
        ["updated-before", "updatedBefore"],
        ["due-after", "dueAfter"],
        ["due-before", "dueBefore"],
        ["start-after", "startAfter"],
        ["start-before", "startBefore"],
      ] as const)
        query[param] = str(ctx, option);
      const client = await ctx.client();
      const { items: issues, nextCursor } = await collect(
        async (cursor, pageSize) => {
          const page = await client.json<{ issues: Issue[]; nextCursor: string | null }>("GET", "/issues", {
            query: { ...query, limit: pageSize, cursor },
          });
          return { items: page.issues, nextCursor: page.nextCursor };
        },
        limit,
        str(ctx, "cursor"),
      );
      if (ctx.json) return ctx.data({ issues, nextCursor });
      if (!issues.length) return ctx.note("No issues match.");
      ctx.out(issueTable(issues, ctx.width));
      if (nextCursor) ctx.note(`More issues match. Raise --limit or pass --cursor ${nextCursor}`);
    },
  },
  {
    name: "issue view",
    args: "<issue>",
    group: "Issues",
    summary: "An issue with its description and fields",
    options: { comments: { type: "boolean", help: "Include comments" } },
    async run(ctx) {
      const ref = issueRef(ctx);
      const client = await ctx.client();
      const issue = await client.json<Issue>("GET", `/issues/${path(ref)}`);
      const comments = flag(ctx, "comments") ? await allComments(client, issue.id) : undefined;
      if (ctx.json) return ctx.data(comments ? { ...issue, comments } : issue);
      ctx.out(issueDetail(issue));
      if (comments?.length) ctx.out(`\nComments:\n\n${comments.map(commentText).join("\n\n")}`);
    },
  },
  {
    name: "issue create",
    group: "Issues",
    summary: "Create an issue",
    options: {
      project: { type: "string", short: "p", help: "Project key (required)" },
      ...fieldOptions,
      attach: { type: "string", multiple: true, help: "File to attach; repeat for several" },
    },
    async run(ctx) {
      const project = str(ctx, "project");
      if (!project) throw new UsageError("Pass the project with --project.");
      const body = await issueFields(ctx);
      if (!body.title) throw new UsageError("Pass a title with --title.");
      const attachments: string[] = [];
      for (const file of strings(ctx, "attach"))
        attachments.push((await uploadFile(ctx, `/projects/${path(project)}/files`, file)).id);
      const issue = await (await ctx.client()).json<Issue>("POST", "/issues", {
        json: { project, ...body, ...(attachments.length ? { attachments } : {}) },
      });
      if (ctx.json) return ctx.data(issue);
      ctx.out(`Created ${issueLine(issue)}`);
    },
  },
  {
    name: "issue edit",
    args: "<issue>",
    group: "Issues",
    summary: "Change an issue's fields",
    options: {
      ...fieldOptions,
      tag: { type: "string", multiple: true, help: "Replace all tags; repeat for several" },
      "add-tag": { type: "string", multiple: true, help: "Add a tag; repeat for several" },
      "remove-tag": { type: "string", multiple: true, help: "Remove a tag; repeat for several" },
      clear: {
        type: "string",
        multiple: true,
        help: `Empty a field: ${Object.keys(CLEARABLE).join(", ")}`,
      },
      "expected-updated-at": {
        type: "string",
        help: "Fail with a conflict if the issue changed since this updatedAt",
      },
    },
    async run(ctx) {
      const ref = issueRef(ctx);
      const body = await issueFields(ctx);
      for (const name of strings(ctx, "clear")) {
        const entry = CLEARABLE[name];
        if (!entry) throw new UsageError(`Can't clear "${name}". Clearable: ${Object.keys(CLEARABLE).join(", ")}.`);
        if (entry[0] in body) throw new UsageError(`--clear ${name} conflicts with setting it.`);
        body[entry[0]] = entry[1];
      }
      const expected = str(ctx, "expected-updated-at");
      if (expected) body.expectedUpdatedAt = expected;
      const client = await ctx.client();
      const add = strings(ctx, "add-tag");
      const remove = strings(ctx, "remove-tag");
      if (add.length || remove.length) {
        if ("tags" in body) throw new UsageError("Use --add-tag/--remove-tag or --tag/--clear tags, not both.");
        const current = await client.json<Issue>("GET", `/issues/${path(ref)}`);
        const lower = (tag: string) => tag.toLowerCase();
        const removed = new Set(remove.map(lower));
        const tags = (current.tags ?? []).filter((tag) => !removed.has(lower(tag)));
        for (const tag of add) if (!tags.some((t) => lower(t) === lower(tag))) tags.push(tag);
        body.tags = tags;
        // Read-modify-write: refuse if someone changed the issue meanwhile.
        body.expectedUpdatedAt ??= current.updatedAt;
      }
      if (!Object.keys(body).some((key) => key !== "expectedUpdatedAt"))
        throw new UsageError("Nothing to change. Pass at least one field; see `spectron issue edit --help`.");
      const issue = await client.json<Issue>("PATCH", `/issues/${path(ref)}`, { json: body });
      if (ctx.json) return ctx.data(issue);
      ctx.out(`Updated ${issueLine(issue)}`);
    },
  },
  {
    name: "issue status",
    args: "<issue> <status>",
    group: "Issues",
    summary: "Move an issue to another status",
    async run(ctx) {
      need(ctx, 2, "issue key and status name");
      const [ref, ...status] = ctx.args;
      const issue = await (await ctx.client()).json<Issue>("PATCH", `/issues/${path(ref!)}`, {
        json: { status: status.join(" ") },
      });
      if (ctx.json) return ctx.data(issue);
      ctx.out(`${issue.key} → ${issue.status.name}`);
    },
  },
  {
    name: "issue assign",
    args: "<issue> <person>",
    group: "Issues",
    summary: "Assign an issue: me, an email, a member id, or none",
    async run(ctx) {
      need(ctx, 2, "issue key and person (me, email, member id or none)");
      const [ref, person] = ctx.args as [string, string];
      const issue = await (await ctx.client()).json<Issue>("PATCH", `/issues/${path(ref)}`, {
        json: { assignee: person.toLowerCase() === "none" ? null : person },
      });
      if (ctx.json) return ctx.data(issue);
      ctx.out(`${issue.key} → ${issue.assignee ? personLabel(issue.assignee) : "unassigned"}`);
    },
  },
  {
    name: "issue comment",
    args: "<issue> [text]",
    group: "Issues",
    summary: "Comment on an issue; mention people with <@email>",
    options: {
      "body-file": { type: "string", short: "F", help: "Read the comment from a file, or - for stdin" },
      "reply-to": { type: "string", help: "Comment id to reply to" },
      attach: { type: "string", multiple: true, help: "File to attach; repeat for several" },
    },
    async run(ctx) {
      const ref = issueRef(ctx);
      const file = str(ctx, "body-file");
      const inline = ctx.args.slice(1).join(" ");
      if (file !== undefined && inline) throw new UsageError("Pass the comment as text or with --body-file, not both.");
      const body = file !== undefined ? await readText(ctx.io, file) : inline;
      const files = strings(ctx, "attach");
      if (!body.trim() && !files.length) throw new UsageError("Write a comment, or attach a file.");
      const client = await ctx.client();
      const attachments: string[] = [];
      if (files.length) {
        const issue = await client.json<Issue>("GET", `/issues/${path(ref)}`);
        for (const f of files) attachments.push((await uploadFile(ctx, `/projects/${issue.project.id}/files`, f)).id);
      }
      const reply = str(ctx, "reply-to");
      const comment = await client.json<Comment>("POST", `/issues/${path(ref)}/comments`, {
        json: { body, attachments, ...(reply ? { parentId: reply } : {}) },
      });
      if (ctx.json) return ctx.data(comment);
      ctx.out(`Commented on ${ref.toUpperCase()} (${comment.id}).`);
    },
  },
  {
    name: "issue comments",
    args: "<issue>",
    group: "Issues",
    summary: "Comments on an issue, oldest first",
    options: { "replies-to": { type: "string", help: "Show replies to this comment id instead" } },
    async run(ctx) {
      const ref = issueRef(ctx);
      const comments = await allComments(await ctx.client(), ref, str(ctx, "replies-to"));
      if (ctx.json) return ctx.data({ comments });
      if (!comments.length) return ctx.note("No comments yet.");
      ctx.out(comments.map(commentText).join("\n\n"));
    },
  },
  {
    name: "issue attach",
    args: "<issue> <file>...",
    group: "Issues",
    summary: "Upload files and attach them to an issue",
    async run(ctx) {
      need(ctx, 2, "issue key and at least one file");
      const [ref, ...files] = ctx.args as [string, ...string[]];
      const attached: StoredFile[] = [];
      for (const file of files) attached.push(await uploadFile(ctx, `/issues/${path(ref)}/attachments`, file));
      if (ctx.json) return ctx.data({ attachments: attached });
      ctx.out(fileTable(attached, ctx.width));
    },
  },
  {
    name: "issue attachments",
    args: "<issue>",
    group: "Issues",
    summary: "Files attached to an issue",
    async run(ctx) {
      const ref = issueRef(ctx);
      const { attachments } = await (await ctx.client()).json<{ attachments: StoredFile[] }>(
        "GET",
        `/issues/${path(ref)}/attachments`,
      );
      if (ctx.json) return ctx.data({ attachments });
      if (!attachments.length) return ctx.note("No attachments.");
      ctx.out(fileTable(attachments, ctx.width));
    },
  },
  {
    name: "file upload",
    args: "<project> <file>...",
    group: "Files",
    summary: "Upload files to a project without attaching them",
    async run(ctx) {
      need(ctx, 2, "project key and at least one file");
      const [project, ...files] = ctx.args as [string, ...string[]];
      const uploaded: StoredFile[] = [];
      for (const file of files) uploaded.push(await uploadFile(ctx, `/projects/${path(project)}/files`, file));
      if (ctx.json) return ctx.data({ files: uploaded });
      ctx.out(fileTable(uploaded, ctx.width));
    },
  },
  {
    name: "file download",
    args: "<file-url | project file-id>",
    group: "Files",
    summary: "Download a file",
    options: {
      output: { type: "string", short: "o", help: "Where to save it; - for stdout (default: its name, here)" },
      force: { type: "boolean", help: "Overwrite an existing file" },
    },
    async run(ctx) {
      need(ctx, 1, "file URL, or project key and file id");
      const target =
        ctx.args.length >= 2 ? `/projects/${path(ctx.args[0]!)}/files/${path(ctx.args[1]!)}` : ctx.args[0]!;
      const client = await ctx.client();
      const response = await client.send("GET", target, { headers: { accept: "*/*" } });
      if (!response.body) throw new ApiFailure(0, "empty_response", "The server sent no file.");
      const output = str(ctx, "output");
      const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      if (output === "-") {
        await pipeline(body, ctx.io.stdout, { end: false });
        return;
      }
      const name = output ?? dispositionName(response.headers.get("content-disposition")) ?? basename(new URL(response.url || "http://x/file").pathname);
      const destination = resolve(ctx.io.cwd, name);
      try {
        await pipeline(body, createWriteStream(destination, { flags: flag(ctx, "force") ? "w" : "wx" }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new UsageError(`${name} already exists. Pass --force to overwrite it, or -o to choose another name.`);
        throw error;
      }
      if (ctx.json) return ctx.data({ path: destination });
      ctx.out(`Saved ${name}.`);
    },
  },
  {
    name: "api",
    args: "<path>",
    group: "Advanced",
    summary: "Call any /api/v1 endpoint, e.g. spectron api /issues/SP-12",
    options: {
      method: { type: "string", short: "X", help: "HTTP method (default GET, or POST with --data)" },
      data: { type: "string", short: "d", help: "JSON body; @file reads a file, @- reads stdin" },
    },
    async run(ctx) {
      need(ctx, 1, "path, e.g. /me");
      const raw = str(ctx, "data");
      let json: unknown;
      if (raw !== undefined) {
        const text = raw.startsWith("@") ? await readText(ctx.io, raw.slice(1)) : raw;
        try {
          json = JSON.parse(text);
        } catch {
          throw new UsageError("--data must be JSON.");
        }
      }
      const method = (str(ctx, "method") ?? (json === undefined ? "GET" : "POST")).toUpperCase();
      const target = ctx.args[0]!;
      // Accepts /issues, issues, /api/v1/issues or a full URL on this server.
      const route = /^https?:\/\//.test(target) ? target : `/${target.replace(/^\/?(api\/v1\/?)?/, "")}`;
      const response = await (await ctx.client()).send(method, route, {
        ...(json === undefined ? {} : { json }),
        headers: { accept: "*/*" },
      });
      if ((response.headers.get("content-type") ?? "").includes("application/json"))
        return ctx.data(await response.json());
      if (response.body)
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), ctx.io.stdout, {
          end: false,
        });
    },
  },
];

const aliases: Record<string, string> = { whoami: "auth status", login: "auth login", logout: "auth logout" };

type Me = { user: { id: string; name: string; email: string }; token: { id: string; name: string }; projects: Project[] };

async function allComments(client: Client, ref: string, parentId?: string) {
  const { items } = await collect(async (cursor) => {
    const page = await client.json<{ comments: Comment[]; nextCursor: string | null }>(
      "GET",
      `/issues/${path(ref)}/comments`,
      { query: { cursor, parentId } },
    );
    return { items: page.comments, nextCursor: page.nextCursor };
  });
  return items;
}

/** The file name from Content-Disposition, reduced to a bare name. */
function dispositionName(header: string | null) {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  let name: string | undefined;
  try {
    name = encoded ? decodeURIComponent(encoded) : undefined;
  } catch {
    name = undefined;
  }
  name ??= /filename="([^"]*)"/i.exec(header)?.[1];
  const safe = name ? basename(name.replaceAll("\\", "/")) : "";
  return safe && safe !== "." && safe !== ".." ? safe : null;
}

/**
 * parseArgs refuses a value that starts with a dash (`--sort -updated`).
 * Glue such a value to its option unless it is itself a known flag.
 */
function attachDashValues(args: string[], specs: Record<string, OptionSpec>) {
  const flags = new Set(
    Object.entries(specs).flatMap(([name, spec]) => [`--${name}`, ...(spec.short ? [`-${spec.short}`] : [])]),
  );
  const takesValue = (arg: string) => {
    const spec = arg.startsWith("--")
      ? specs[arg.slice(2)]
      : Object.values(specs).find((s) => s.short && `-${s.short}` === arg);
    return spec?.type === "string";
  };
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === "--") {
      out.push(...args.slice(i));
      break;
    }
    if (takesValue(arg) && next !== undefined && next.startsWith("-") && next !== "-" && !flags.has(next)) {
      out.push(`${arg}=${next}`);
      i++;
    } else out.push(arg);
  }
  return out;
}

const userAgent = () => `spectron-cli/${VERSION} node/${process.versions.node}`;

const globalOptions: Record<string, OptionSpec> = {
  json: { type: "boolean", help: "Print the API's JSON response" },
  help: { type: "boolean", short: "h", help: "Show help" },
};

function commandHelp(command: Command) {
  const options = { ...command.options, ...globalOptions };
  const rows = Object.entries(options).map(([name, spec]) => [
    `${spec.short ? `-${spec.short}, ` : "    "}--${name}${spec.type === "string" ? " <value>" : ""}`,
    spec.help,
  ]);
  return [
    `${command.summary}.`,
    "",
    `Usage: spectron ${command.name}${command.args ? ` ${command.args}` : ""} [options]`,
    "",
    "Options:",
    table(["", ""], rows).split("\n").slice(1).map((line) => `  ${line}`).join("\n"),
  ].join("\n");
}

function mainHelp() {
  const groups = new Map<string, Command[]>();
  for (const c of commands) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  const width = Math.max(...commands.map((c) => c.name.length)) + 2;
  return [
    "Work with Spectron issues from the terminal.",
    "",
    "Usage: spectron <command> [options]",
    ...[...groups].flatMap(([group, list]) => [
      "",
      `${group}:`,
      ...list.map((c) => `  ${c.name.padEnd(width)}${c.summary}`),
    ]),
    "",
    "Add --json to any command for machine-readable output, and --help for its options.",
    "Issues are addressed by Spectron key (SP-12); people by me, email or member id.",
    "SPECTRON_URL and SPECTRON_TOKEN override the saved login.",
  ].join("\n");
}

/** Runs one invocation and returns the exit code. */
export async function run(argv: string[], io: IO): Promise<number> {
  const json = argv.includes("--json");
  const fail = (code: number, message: string, details?: { status?: number; code?: string }) => {
    io.stderr.write(json ? `${JSON.stringify({ error: { message, ...details } })}\n` : `error: ${message}\n`);
    return code;
  };
  const first = argv[0];
  if (!first || first === "--help" || first === "-h" || first === "help") {
    io.stdout.write(`${mainHelp()}\n`);
    return first ? 0 : 2;
  }
  if (first === "--version" || first === "-v" || first === "version") {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const words = aliases[first] ? [...aliases[first].split(" "), ...argv.slice(1)] : argv;
  const command =
    commands.find((c) => c.name === `${words[0]} ${words[1]}`) ?? commands.find((c) => c.name === words[0]);
  if (!command) {
    const group = commands.filter((c) => c.name.startsWith(`${first} `));
    if (group.length && (argv.length === 1 || argv[1] === "--help" || argv[1] === "-h")) {
      io.stdout.write(`${group.map((c) => `spectron ${c.name.padEnd(20)}${c.summary}`).join("\n")}\n`);
      return argv.length === 1 ? 2 : 0;
    }
    return fail(2, `Unknown command "${words.slice(0, 2).join(" ")}". Run \`spectron --help\` for the list.`);
  }
  const rest = words.slice(command.name.split(" ").length);
  const specs = { ...command.options, ...globalOptions };
  let parsed;
  try {
    parsed = parseArgs({
      args: attachDashValues(rest, specs),
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        Object.entries(specs).map(([name, { type, short, multiple }]) => [
          name,
          { type, ...(short ? { short } : {}), ...(multiple ? { multiple } : {}) },
        ]),
      ),
    });
  } catch (error) {
    return fail(2, `${(error as Error).message.split("\n")[0]} Run \`spectron ${command.name} --help\` for its options.`);
  }
  if (parsed.values.help) {
    io.stdout.write(`${commandHelp(command)}\n`);
    return 0;
  }
  const width = io.stdout.isTTY ? io.stdout.columns : undefined;
  const ctx: Context = {
    io,
    values: parsed.values as Values,
    args: parsed.positionals,
    json,
    width,
    out: (text) => void io.stdout.write(`${text}\n`),
    data: (value) => void io.stdout.write(`${JSON.stringify(value, null, 2)}\n`),
    note: (text) => void io.stderr.write(`${text}\n`),
    async client() {
      const { url, token } = await resolveCredentials(io.env);
      if (!url || !token) throw new ApiFailure(401, "not_signed_in", `Not signed in. Run \`spectron auth login\` with a personal access token. ${TOKEN_HELP}`);
      return createClient({ url, token, fetch: io.fetch, userAgent: userAgent() });
    },
  };
  try {
    await command.run(ctx);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) return fail(2, error.message);
    if (error instanceof ApiFailure) {
      const message =
        error.status === 401 && error.code !== "not_signed_in"
          ? `The server rejected the token: it may be revoked or expired, or the account's email isn't verified. Run \`spectron auth login\` with a new one. ${TOKEN_HELP}`
          : error.message;
      return fail(error.status === 401 ? 4 : 1, message, { status: error.status, code: error.code });
    }
    return fail(1, error instanceof Error ? error.message : String(error));
  }
}
