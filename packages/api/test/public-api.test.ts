import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import type { ApiTokenSummary, ProjectSummary } from "@spectron/shared";
import { createAPI } from "../src/index";

type Issue = {
  id: string;
  key: string;
  title: string;
  description?: string;
  status: { id: string; name: string; category: string };
  priority: { id: string; name: string } | null;
  assignee: { id: string; name: string; email: string | null } | null;
  parent: { id: string; key: string } | null;
  tags?: string[];
  dueAt: string | null;
  startAt: string | null;
  updatedAt: string;
  url: string;
};
type Comment = {
  id: string;
  body: string;
  mentions: { id: string; name: string }[];
  attachments: { id: string; filename: string; url: string }[];
};

test("Public API: tokens, issues, filters, comments, mentions and files", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_public_api_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const root = await mkdtemp(join(tmpdir(), "spectron-public-api-test-"));
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await migrateDatabase(db);
  const origin = "http://localhost:5173";
  const auth = createAuth(db, {
    appURL: origin,
    secret: "public-api-integration-test-secret-32-characters",
    sendResetEmail: async () => {},
    sendMagicLinkEmail: async () => {},
    sendVerificationEmail: async () => {},
  });
  const api = createAPI(auth, { db, appURL: origin, fileStorage: { root, maxBytes: 4096 } });

  const register = async (email: string) => {
    const r = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: email.split("@")[0], email, password: "a long public api password" }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      email,
      cookie: r.headers.getSetCookie().map((s) => s.split(";")[0]).join("; "),
    };
  };
  const trpc = async <T>(procedure: string, actor: { cookie: string }, input?: unknown, mutation = true) => {
    const r = await api.request(
      `${origin}/api/trpc/${procedure}${mutation ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { origin, cookie: actor.cookie, "content-type": "application/json" },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as { result: { data: T } }).result.data;
  };
  const owner = await register("owner@example.test");
  const member = await register("member@example.test");
  const outsider = await register("outsider@example.test");

  // Tokens are created from a signed-in session and shown once.
  const created = await trpc<{ token: string; summary: ApiTokenSummary }>("apiTokens.create", owner, {
    name: "Claude Code",
    expiresInDays: 90,
  });
  assert.match(created.token, /^spk_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.summary.prefix, created.token.slice(0, 10));
  const listed = await trpc<ApiTokenSummary[]>("apiTokens.list", owner, undefined, false);
  assert.deepEqual(listed.map((token) => token.name), ["Claude Code"]);
  assert.equal(JSON.stringify(listed).includes(created.token), false);
  const outsiderToken = (
    await trpc<{ token: string }>("apiTokens.create", outsider, { name: "Mine", expiresInDays: null })
  ).token;
  const memberToken = (
    await trpc<{ token: string }>("apiTokens.create", member, { name: "Codex", expiresInDays: 30 })
  ).token;

  const call = (method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) =>
    api.request(`${origin}/api/v1${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
    });
  const ok = async <T>(r: Response, status = 200): Promise<T> => {
    assert.equal(r.status, status, await r.clone().text());
    return (await r.json()) as T;
  };
  const error = async (r: Response, status: number) => {
    assert.equal(r.status, status, await r.clone().text());
    return ((await r.json()) as { error: { code: string; message: string } }).error;
  };
  const token = created.token;

  // Authentication: bearer tokens only; session cookies do not work here.
  assert.equal((await error(await call("GET", "/me", null), 401)).code, "unauthorized");
  assert.equal((await call("GET", "/me", null)).headers.get("www-authenticate"), 'Bearer realm="spectron"');
  await error(await call("GET", "/me", null, undefined, { cookie: owner.cookie }), 401);
  await error(await call("GET", "/me", "spk_unknown"), 401);
  await error(await call("GET", "/me", `${token}x`), 401);

  const p = await trpc<ProjectSummary>("projects.create", owner, { name: "Spectron", key: "SP" });
  await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')", [p.id, member.id]);
  const q = await trpc<ProjectSummary>("projects.create", owner, { name: "Other", key: "OT" });

  const me = await ok<{ user: { id: string; email: string }; token: { name: string }; projects: { key: string }[] }>(
    await call("GET", "/me", token),
  );
  assert.equal(me.user.id, owner.id);
  assert.equal(me.user.email, owner.email);
  assert.equal(me.token.name, "Claude Code");
  assert.deepEqual(me.projects.map((project) => project.key), ["SP", "OT"]);

  const detail = await ok<{
    statuses: { name: string; category: string; isDefault: boolean }[];
    priorities: { name: string }[];
    members: { id: string; email: string }[];
  }>(await call("GET", "/projects/sp", token));
  assert.deepEqual(detail.statuses.map((s) => s.name), ["Todo", "In progress", "Blocked", "Cancelled", "Done"]);
  assert.equal(detail.statuses.find((s) => s.isDefault)?.name, "Todo");
  assert.deepEqual(detail.members.map((m) => m.email).sort(), [member.email, owner.email]);
  await error(await call("GET", "/projects/SP", outsiderToken), 404);

  // Create with names, emails and date-only values.
  const first = await ok<Issue>(
    await call("POST", "/issues", token, {
      project: "SP",
      title: "  Ship the public API  ",
      description: "Agents need **access**.",
      priority: "high",
      assignee: member.email,
      dueAt: "2026-12-10",
      startAt: "2026-12-01T09:00:00Z",
    }),
    201,
  );
  assert.equal(first.key, "SP-1");
  assert.equal(first.title, "Ship the public API");
  assert.equal(first.description, "Agents need **access**.");
  assert.equal(first.status.name, "Todo");
  assert.equal(first.priority?.name, "High");
  assert.deepEqual(first.assignee, { id: member.id, name: "member", email: member.email });
  assert.equal(first.dueAt, "2026-12-10T00:00:00.000Z");
  assert.equal(first.startAt, "2026-12-01T09:00:00.000Z");
  assert.equal(first.url, `${origin}/#project/${p.id}/issues/${first.id}`);
  const second = await ok<Issue>(
    await call("POST", "/issues", token, { project: p.id, title: "Write docs", status: "In progress", assignee: "me", parent: "SP-1", dueAt: "2026-12-05" }),
    201,
  );
  assert.equal(second.status.name, "In progress");
  assert.equal(second.assignee?.id, owner.id);
  assert.deepEqual(second.parent, { id: first.id, key: "SP-1" });
  const third = await ok<Issue>(await call("POST", "/issues", token, { project: "SP", title: "Undated chore" }), 201);
  await ok<Issue>(await call("POST", "/issues", token, { project: "OT", title: "Elsewhere" }), 201);

  const unknown = await error(await call("POST", "/issues", token, { project: "SP", title: "x", status: "Shipped" }), 422);
  assert.match(unknown.message, /Unknown status "Shipped"\. Available: Todo, In progress, Blocked, Cancelled, Done\./);
  await error(await call("POST", "/issues", token, { project: "SP", title: "x", assignee: outsider.email }), 422);
  await error(await call("POST", "/issues", token, { project: "SP", title: "x", dueAt: "soon" }), 400);
  await error(await call("POST", "/issues", token, { project: "SP", title: "x", extra: true }), 400);
  await error(await call("POST", "/issues", outsiderToken, { project: "SP", title: "x" }), 404);

  // Filters and sorting.
  const search = async (query: string, as = token) =>
    (await ok<{ issues: Issue[]; nextCursor: string | null }>(await call("GET", `/issues?${query}`, as)));
  const keys = async (query: string) => (await search(query)).issues.map((i) => i.key);
  assert.deepEqual(await keys("project=SP&sort=key"), ["SP-1", "SP-2", "SP-3"]);
  assert.deepEqual(await keys("project=SP&sort=-key"), ["SP-3", "SP-2", "SP-1"]);
  assert.deepEqual((await keys("project=SP,ot")).sort(), ["OT-1", "SP-1", "SP-2", "SP-3"]);
  assert.equal((await keys("")).length, 4);
  // Key order sorts by project prefix first, in both directions.
  assert.deepEqual(await keys("project=SP,OT&sort=key"), ["OT-1", "SP-1", "SP-2", "SP-3"]);
  assert.deepEqual(await keys("project=SP,OT&sort=-key"), ["SP-3", "SP-2", "SP-1", "OT-1"]);
  assert.deepEqual((await keys("status=in%20progress")), ["SP-2"]);
  assert.deepEqual((await keys("statusCategory=opened&project=SP&sort=key")), ["SP-1", "SP-3"]);
  assert.deepEqual(await keys("assignee=me"), ["SP-2"]);
  assert.deepEqual(await keys(`assignee=${encodeURIComponent(member.email)}`), ["SP-1"]);
  assert.deepEqual(await keys("assignee=none&project=SP"), ["SP-3"]);
  assert.deepEqual(await keys("assignee=nobody@example.test"), []);
  assert.deepEqual(await keys("dueAfter=2026-12-06"), ["SP-1"]);
  assert.deepEqual(await keys("dueBefore=2026-12-06"), ["SP-2"]);
  assert.deepEqual(await keys("sort=due&project=SP"), ["SP-2", "SP-1", "SP-3"]);
  assert.deepEqual(await keys("sort=-due&project=SP"), ["SP-1", "SP-2", "SP-3"]);
  assert.deepEqual(await keys("startAfter=2026-11-30&startBefore=2026-12-02"), ["SP-1"]);
  assert.deepEqual(await keys("createdAfter=2000-01-01&project=SP&sort=key"), ["SP-1", "SP-2", "SP-3"]);
  assert.deepEqual(await keys("createdBefore=2000-01-01"), []);
  assert.deepEqual(await keys("q=DOCS"), ["SP-2"]);
  assert.deepEqual(await keys("q=%25"), []);
  await pool.query("UPDATE issues SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1", [third.id]);
  assert.deepEqual(await keys("updatedBefore=2021-01-01"), ["SP-3"]);
  assert.deepEqual(await keys("updatedAfter=2021-01-01&project=SP&sort=key"), ["SP-1", "SP-2"]);
  const page1 = await search("project=SP&sort=key&limit=2");
  assert.deepEqual(page1.issues.map((i) => i.key), ["SP-1", "SP-2"]);
  assert.ok(page1.nextCursor);
  const page2 = await search(`project=SP&sort=key&limit=2&cursor=${page1.nextCursor}`);
  assert.deepEqual(page2.issues.map((i) => i.key), ["SP-3"]);
  assert.equal(page2.nextCursor, null);
  await error(await call("GET", "/issues?sort=title", token), 400);
  await error(await call("GET", "/issues?statusCategory=done", token), 400);
  await error(await call("GET", "/issues?cursor=nope", token), 400);
  await error(await call("GET", "/issues?createdAfter=yesterday", token), 400);
  assert.deepEqual((await search("", outsiderToken)).issues, []);
  await error(await call("GET", "/issues?project=SP", outsiderToken), 404);

  // Read and update by key; status changes go through the normal service.
  assert.equal((await ok<Issue>(await call("GET", "/issues/sp-1", token))).id, first.id);
  assert.equal((await ok<Issue>(await call("GET", `/issues/${first.id}`, memberToken))).key, "SP-1");
  await error(await call("GET", "/issues/SP-1", outsiderToken), 404);
  await error(await call("GET", "/issues/SP-99", token), 404);
  // Jira keys are informational: returned, but never used to address issues.
  await pool.query("UPDATE issues SET external_key = 'SP-3' WHERE id = $1", [second.id]);
  await pool.query("UPDATE issues SET external_key = 'LEGACY-7' WHERE id = $1", [third.id]);
  const native = await ok<Issue & { jiraKey: string | null }>(await call("GET", "/issues/SP-3", token));
  assert.equal(native.id, third.id);
  assert.equal(native.jiraKey, "LEGACY-7");
  await error(await call("GET", "/issues/LEGACY-7", token), 404);
  await error(await call("GET", "/issues/jira:SP-3", token), 404);
  await pool.query("UPDATE issues SET external_key = NULL WHERE id = ANY($1)", [[second.id, third.id]]);
  const moved = await ok<Issue>(await call("PATCH", "/issues/SP-1", memberToken, { status: "done", tags: [] }));
  assert.equal(moved.status.name, "Done");
  assert.equal(moved.status.category, "finished");
  // Without expectedUpdatedAt, concurrent edits to different fields both apply.
  const [retitled, rescheduled] = await Promise.all([
    call("PATCH", "/issues/SP-3", token, { title: "Undated chore, renamed" }),
    call("PATCH", "/issues/SP-3", memberToken, { dueAt: "2027-01-15" }),
  ]);
  await ok(retitled);
  await ok(rescheduled);
  const both = await ok<Issue>(await call("GET", "/issues/SP-3", token));
  assert.equal(both.title, "Undated chore, renamed");
  assert.equal(both.dueAt, "2027-01-15T00:00:00.000Z");
  await ok(await call("PATCH", "/issues/SP-3", token, { title: "Undated chore", dueAt: null }));
  const cleared = await ok<Issue>(await call("PATCH", "/issues/SP-1", token, { dueAt: null, assignee: null, priority: null }));
  assert.equal(cleared.dueAt, null);
  assert.equal(cleared.assignee, null);
  assert.equal(cleared.priority, null);
  assert.equal(cleared.status.name, "Done");
  await error(await call("PATCH", "/issues/SP-1", token, { title: "Stale", expectedUpdatedAt: first.updatedAt }), 409);
  await error(await call("PATCH", "/issues/SP-1", token, {}), 400);
  await error(await call("PATCH", "/issues/SP-1", token, { parent: "OT-1" }), 422);
  await error(await call("PATCH", "/issues/SP-1", outsiderToken, { title: "Hijack" }), 404);
  const history = await pool.query<{ actor_user_id: string; changes: Record<string, unknown> }>(
    "SELECT actor_user_id, changes FROM issue_history WHERE issue_id = $1 ORDER BY created_at, id",
    [first.id],
  );
  assert.equal(history.rows.at(-2)?.actor_user_id, member.id);
  assert.ok("stateId" in history.rows.at(-2)!.changes);

  // Files: upload straight onto an issue, or upload first and reference later.
  const bytes = new TextEncoder().encode("hello from an agent\n");
  const attached = await ok<{ id: string; filename: string; url: string; sizeBytes: number }>(
    await call("POST", "/issues/SP-2/attachments?filename=notes.txt", token, bytes),
    201,
  );
  assert.equal(attached.filename, "notes.txt");
  assert.equal(attached.sizeBytes, bytes.length);
  assert.equal(attached.url, `${origin}/api/v1/projects/${p.id}/files/${attached.id}`);
  const downloaded = await call("GET", `/projects/${p.id}/files/${attached.id}`, memberToken);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), "hello from an agent\n");
  assert.equal((await call("GET", `/projects/SP/files/${attached.id}`, outsiderToken)).status, 404);
  const attachments = await ok<{ attachments: { id: string }[] }>(await call("GET", "/issues/SP-2/attachments", token));
  assert.deepEqual(attachments.attachments.map((a) => a.id), [attached.id]);
  const loose = await ok<{ id: string }>(await call("POST", "/projects/SP/files?filename=log.txt", token, new TextEncoder().encode("log")), 201);
  await ok(await call("POST", "/issues/SP-3/attachments", token, { fileId: loose.id }), 201);
  assert.equal(
    (await ok<{ attachments: unknown[] }>(await call("GET", "/issues/SP-3/attachments", token))).attachments.length,
    1,
  );
  await error(await call("POST", "/issues/SP-3/attachments?filename=big.bin", token, new Uint8Array(5000)), 413);
  await error(await call("POST", "/projects/SP/files", token, bytes), 400);
  // Upload-and-attach is atomic: a deleted issue publishes no project file.
  const doomed = await ok<Issue>(await call("POST", "/issues", token, { project: "SP", title: "Doomed" }), 201);
  await pool.query("UPDATE issues SET deleted_at = now() WHERE id = $1", [doomed.id]);
  const filesBefore = (await pool.query("SELECT count(*)::int AS n FROM project_files WHERE project_id = $1", [p.id])).rows[0].n;
  await error(await call("POST", `/issues/${doomed.key}/attachments?filename=late.txt`, token, bytes), 422);
  const filesAfter = (await pool.query("SELECT count(*)::int AS n FROM project_files WHERE project_id = $1", [p.id])).rows[0].n;
  assert.equal(filesAfter, filesBefore);
  // Oversized JSON gets a v1 413, with or without a declared length.
  const huge = JSON.stringify({ fileId: "x".repeat(4 * 1024 * 1024) });
  assert.equal((await error(await call("POST", "/issues/SP-3/attachments", token, new TextEncoder().encode(huge), { "content-type": "application/json" }), 413)).code, "body_too_large");
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
      controller.close();
    },
  });
  const streamedResponse = await api.request(`${origin}/api/v1/issues/SP-3/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: streamed,
    duplex: "half",
  } as RequestInit);
  assert.equal((await error(streamedResponse, 413)).code, "body_too_large");
  assert.equal((await error(await call("POST", "/issues", token, { project: "SP", title: "x", description: "y".repeat(3_200_000) }), 413)).code, "body_too_large");

  // Comments with mentions by email or id, plus attachments.
  const comment = await ok<Comment>(
    await call("POST", "/issues/SP-2/comments", token, {
      body: `Ping <@${member.email}> and <@${owner.id}>: see the log`,
      attachments: [loose.id],
    }),
    201,
  );
  assert.equal(comment.body, `Ping <@${member.id}> and <@${owner.id}>: see the log`);
  assert.deepEqual(comment.mentions, [
    { id: member.id, name: "member" },
    { id: owner.id, name: "owner" },
  ]);
  assert.deepEqual(comment.attachments.map((a) => a.filename), ["log.txt"]);
  const mention = await pool.query("SELECT user_id FROM comment_mentions WHERE comment_id = $1 ORDER BY user_id", [comment.id]);
  assert.deepEqual(mention.rows.map((r) => r.user_id).sort(), [member.id, owner.id].sort());
  const reply = await ok<Comment & { parentId: string }>(
    await call("POST", "/issues/SP-2/comments", memberToken, { body: "On it", parentId: comment.id }),
    201,
  );
  assert.equal(reply.parentId, comment.id);
  const thread = await ok<{ comments: (Comment & { replyCount: number })[] }>(await call("GET", "/issues/SP-2/comments", token));
  assert.deepEqual(thread.comments.map((c) => [c.id, c.replyCount]), [[comment.id, 1]]);
  const replies = await ok<{ comments: Comment[] }>(await call("GET", `/issues/SP-2/comments?parentId=${comment.id}`, token));
  assert.deepEqual(replies.comments.map((c) => c.body), ["On it"]);
  const badMention = await error(await call("POST", "/issues/SP-2/comments", token, { body: `hi <@${outsider.email}>` }), 422);
  assert.match(badMention.message, /not a member/);
  await error(await call("POST", "/issues/SP-2/comments", token, { body: "   " }), 422);
  await error(await call("POST", "/issues/SP-2/comments", outsiderToken, { body: "hi" }), 404);
  for (let index = 0; index < 22; index++)
    await ok(await call("POST", "/issues/SP-3/comments", token, { body: `note ${index}` }), 201);
  const pageA = await ok<{ comments: Comment[]; nextCursor: string }>(await call("GET", "/issues/SP-3/comments", token));
  assert.equal(pageA.comments.length, 20);
  const pageB = await ok<{ comments: Comment[]; nextCursor: null }>(
    await call("GET", `/issues/SP-3/comments?cursor=${pageA.nextCursor}`, token),
  );
  assert.deepEqual(pageB.comments.map((c) => c.body), ["note 20", "note 21"]);

  // Repeated mentions resolve against one member lookup.
  const repeated = await ok<Comment>(
    await call("POST", "/issues/SP-1/comments", token, { body: `<@${member.email}> <@${member.email}> <@me>` }),
    201,
  );
  assert.deepEqual(repeated.mentions.map((m) => m.id).sort(), [member.id, owner.id].sort());

  // Project prefixes can repeat; a parent resolves within the child's project.
  const twin = await trpc<ProjectSummary>("projects.create", owner, { name: "Twin", key: "SP" });
  const twinIssue = await ok<Issue>(await call("POST", "/issues", token, { project: twin.id, title: "Twin root" }), 201);
  assert.equal(twinIssue.key, "SP-1");
  await error(await call("GET", "/issues/SP-1", token), 422);
  const reparented = await ok<Issue & { parent: { id: string } | null }>(
    await call("PATCH", `/issues/${third.id}`, token, { parent: "SP-1" }),
  );
  assert.equal(reparented.parent?.id, first.id);
  const twinChild = await ok<Issue>(await call("POST", "/issues", token, { project: twin.id, title: "Twin child", parent: "SP-1" }), 201);
  assert.equal(twinChild.parent?.id, twinIssue.id);
  await error(await call("POST", "/issues", token, { project: twin.id, title: "Orphan", parent: "SP-9" }), 422);

  // Unknown routes, revocation and expiry.
  assert.equal((await error(await call("GET", "/nope", token), 404)).code, "not_found");
  await trpc("apiTokens.revoke", owner, { id: created.summary.id });
  await error(await call("GET", "/me", token), 401);
  assert.deepEqual(await trpc<ApiTokenSummary[]>("apiTokens.list", owner, undefined, false), []);
  await pool.query("UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", [member.id]);
  await error(await call("GET", "/me", memberToken), 401);
  // Revoking another person's token is a no-op.
  const other = await trpc<{ summary: ApiTokenSummary }>("apiTokens.create", outsider, { name: "Second", expiresInDays: 365 });
  await trpc("apiTokens.revoke", owner, { id: other.summary.id });
  assert.equal((await trpc<ApiTokenSummary[]>("apiTokens.list", outsider, undefined, false)).length, 2);
  await assert.rejects(
    trpc("apiTokens.create", owner, { name: "Bad lifetime", expiresInDays: 7 }),
  );
  void q;
});
