import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import type { ProjectSummary } from "@spectron/shared";
import { createAPI } from "../src/index";
import { run } from "../../../apps/cli/src/cli";

type Issue = {
  id: string;
  key: string;
  title: string;
  description?: string;
  status: { name: string };
  priority: { name: string } | null;
  assignee: { id: string; email: string | null } | null;
  tags?: string[];
  dueAt: string | null;
  estimateSeconds: number | null;
  updatedAt: string;
};
type StoredFile = { id: string; filename: string; url: string };

test("CLI: login, issues, comments, files and raw API calls", async (t) => {
  const connection = process.env.TEST_DATABASE_URL || "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_cli_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const root = await mkdtemp(join(tmpdir(), "spectron-cli-test-"));
  const files = join(root, "files");
  const home = join(root, "config");
  const work = join(root, "work");
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
    secret: "cli-integration-test-secret-with-32-characters",
    sendResetEmail: async () => {},
    sendMagicLinkEmail: async () => {},
    sendVerificationEmail: async () => {},
  });
  const api = createAPI(auth, { db, appURL: origin, fileStorage: { root: files, maxBytes: 4096 } });
  await mkdir(work, { recursive: true });

  const register = async (email: string) => {
    const r = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: email.split("@")[0], email, password: "a long cli test password" }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { user: { id: string } };
    return { id: body.user.id, email, cookie: r.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") };
  };
  const trpc = async <T>(procedure: string, actor: { cookie: string }, input: unknown) => {
    const r = await api.request(`${origin}/api/trpc/${procedure}`, {
      method: "POST",
      headers: { origin, cookie: actor.cookie, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as { result: { data: T } }).result.data;
  };
  const owner = await register("owner@example.test");
  const member = await register("member@example.test");
  await pool.query("UPDATE users SET email_verified = true");
  const { token } = await trpc<{ token: string }>("apiTokens.create", owner, { name: "Terminal", expiresInDays: 30 });
  const p = await trpc<ProjectSummary>("projects.create", owner, { name: "Spectron", key: "SP" });
  await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')", [p.id, member.id]);
  await db.insert(schema.tag).values([
    { projectId: p.id, name: "backend", position: 0 },
    { projectId: p.id, name: "agents", position: 1 },
  ]);

  const cli = async (args: string[], options: { stdin?: string; env?: Record<string, string> } = {}) => {
    const sink = () => {
      const chunks: Buffer[] = [];
      const stream = new Writable({
        write(chunk, _encoding, done) {
          chunks.push(Buffer.from(chunk));
          done();
        },
      });
      return { stream, bytes: () => Buffer.concat(chunks) };
    };
    const stdout = sink();
    const stderr = sink();
    const code = await run(args, {
      env: { SPECTRON_CONFIG_DIR: home, ...options.env },
      cwd: work,
      stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetch: async (target, init) => api.request(target, init),
    });
    return {
      code,
      out: stdout.bytes().toString("utf8"),
      err: stderr.bytes().toString("utf8"),
      bytes: stdout.bytes(),
    };
  };
  const ok = async (args: string[], options?: Parameters<typeof cli>[1]) => {
    const result = await cli(args, options);
    assert.equal(result.code, 0, `${args.join(" ")}\n${result.err}`);
    return result.out;
  };
  const json = async <T>(args: string[], options?: Parameters<typeof cli>[1]) =>
    JSON.parse(await ok([...args, "--json"], options)) as T;

  // Help and usage errors.
  assert.match(await ok(["--help"]), /issue list\s+Search issues/);
  assert.match(await ok(["issue", "edit", "--help"]), /--clear <value>/);
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(["issue"])).code, 2);
  assert.match((await cli(["nope"])).err, /Unknown command "nope"/);
  assert.equal((await cli(["issue", "list", "--bogus"])).code, 2);

  // Not signed in: exit 4 and a pointer to the token page.
  const signedOut = await cli(["issue", "list"]);
  assert.equal(signedOut.code, 4);
  assert.match(signedOut.err, /spectron auth login.*API tokens/);

  // Login validates the token against /me before saving it, owner-only.
  assert.equal((await cli(["auth", "login", "--url", origin, "--with-token"], { stdin: "nope" })).code, 2);
  assert.equal((await cli(["auth", "login", "--url", "http://example.test", "--with-token"], { stdin: token })).code, 2);
  const rejected = await cli(["auth", "login", "--url", origin, "--with-token"], { stdin: `${token}x\n` });
  assert.equal(rejected.code, 4);
  await assert.rejects(stat(join(home, "config.json")));
  assert.equal((await cli(["auth", "login", "--url", origin])).code, 2, "no terminal and no --with-token");
  assert.match(await ok(["auth", "login", "--url", `${origin}/`, "--with-token"], { stdin: `${token}\n` }), /as owner <owner@example\.test> with token "Terminal"/);
  const config = join(home, "config.json");
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")), { url: origin, token });
  const me = await json<{ url: string; user: { email: string }; projects: { key: string }[] }>(["whoami"]);
  assert.equal(me.url, origin);
  assert.equal(me.user.email, owner.email);
  assert.deepEqual(me.projects.map((x) => x.key), ["SP"]);

  // Projects.
  assert.match(await ok(["project", "list"]), /SP\s+owner\s+Spectron/);
  const projectText = await ok(["project", "view", "sp"]);
  assert.match(projectText, /Statuses: Todo \(opened, default\), In progress/);
  assert.match(projectText, /Tags: agents, backend/);
  assert.match(projectText, /member <member@example\.test>/);

  // Create, with a description from stdin and an attachment.
  await writeFile(join(work, "notes.txt"), "first notes");
  const first = await json<Issue>(
    [
      "issue", "create", "-p", "SP", "-t", "Ship the CLI", "--description-file", "-",
      "--priority", "high", "-a", member.email, "--due", "2026-12-10", "--estimate", "1h30m",
      "--tag", "backend", "--attach", "notes.txt",
    ],
    { stdin: "Agents want a **terminal**.\n" },
  );
  assert.equal(first.key, "SP-1");
  assert.equal(first.description, "Agents want a **terminal**.\n");
  assert.equal(first.priority?.name, "High");
  assert.equal(first.assignee?.id, member.id);
  assert.equal(first.dueAt, "2026-12-10T00:00:00.000Z");
  assert.equal(first.estimateSeconds, 5400);
  assert.deepEqual(first.tags, ["backend"]);
  assert.match(await ok(["issue", "create", "-p", "SP", "-t", "Write docs", "-a", "me"]), /^Created SP-2 {2}Write docs\nhttp:\/\/localhost:5173\/#project\//);
  await ok(["issue", "create", "-p", "SP", "-t", "Undated chore"]);
  assert.match((await cli(["issue", "create", "-p", "SP"])).err, /--title/);
  assert.match((await cli(["issue", "create", "-t", "x"])).err, /--project/);
  assert.equal((await cli(["issue", "create", "-p", "SP", "-t", "x", "--estimate", "soon"])).code, 2);
  const badStatus = await cli(["issue", "create", "-p", "SP", "-t", "x", "-s", "Shipped", "--json"]);
  assert.equal(badStatus.code, 1);
  assert.deepEqual(JSON.parse(badStatus.err).error.status, 422);
  assert.match(JSON.parse(badStatus.err).error.message, /Unknown status "Shipped"/);

  // List: filters, sort, text table, and pagination across pages.
  const keys = async (...args: string[]) =>
    (await json<{ issues: Issue[] }>(["issue", "list", ...args])).issues.map((i) => i.key);
  assert.deepEqual(await keys("-p", "SP", "--sort", "key"), ["SP-1", "SP-2", "SP-3"]);
  assert.deepEqual(await keys("-a", "me"), ["SP-2"]);
  assert.deepEqual(await keys("-a", "none", "--sort", "key"), ["SP-3"]);
  assert.deepEqual(await keys("--due-after", "2026-12-01"), ["SP-1"]);
  assert.deepEqual(await keys("-q", "docs"), ["SP-2"]);
  assert.deepEqual(await keys("-c", "opened", "--sort", "-key"), ["SP-3", "SP-2", "SP-1"]);
  const table = await ok(["issue", "list", "--sort", "key"]);
  assert.match(table.split("\n")[0]!, /^KEY\s+STATUS\s+ASSIGNEE\s+DUE\s+TITLE$/);
  assert.match(table, /SP-1\s+Todo\s+member\s+2026-12-10\s+Ship the CLI/);
  const page = await json<{ issues: Issue[]; nextCursor: string | null }>(["issue", "list", "--sort", "key", "-L", "2"]);
  assert.deepEqual(page.issues.map((i) => i.key), ["SP-1", "SP-2"]);
  assert.ok(page.nextCursor);
  assert.deepEqual(await keys("--sort", "key", "--cursor", page.nextCursor), ["SP-3"]);
  assert.match((await cli(["issue", "list", "--sort", "key", "-L", "1"])).err, /More issues match/);
  assert.match((await cli(["issue", "list", "-q", "nothing-like-this"])).err, /No issues match/);
  assert.equal((await cli(["issue", "list", "-L", "0"])).code, 2);

  // View.
  const view = await ok(["issue", "view", "sp-1"]);
  assert.match(view, /^SP-1 {2}Ship the CLI/);
  assert.match(view, /Status: Todo · Priority: High/);
  assert.match(view, /Assignee: member <member@example\.test>/);
  assert.match(view, /Tags: backend/);
  assert.match(view, /Due: 2026-12-10 · Estimate: 1h 30m/);
  assert.match(view, /Agents want a \*\*terminal\*\*\./);
  const missing = await cli(["issue", "view", "SP-99"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /not found/);

  // Status, assignment and edits.
  assert.equal(await ok(["issue", "status", "SP-1", "in", "progress"]), "SP-1 → In progress\n");
  assert.equal(await ok(["issue", "assign", "SP-1", "none"]), "SP-1 → unassigned\n");
  assert.equal(await ok(["issue", "assign", "SP-1", "me"]), "SP-1 → owner <owner@example.test>\n");
  let edited = await json<Issue>(["issue", "edit", "SP-1", "--clear", "due", "--clear", "estimate", "-t", "Ship the CLI v1"]);
  assert.equal(edited.dueAt, null);
  assert.equal(edited.estimateSeconds, null);
  assert.equal(edited.title, "Ship the CLI v1");
  edited = await json<Issue>(["issue", "edit", "SP-1", "--add-tag", "Agents", "--remove-tag", "BACKEND"]);
  assert.deepEqual(edited.tags, ["agents"]);
  edited = await json<Issue>(["issue", "edit", "SP-1", "--add-tag", "backend", "--add-tag", "agents"]);
  assert.deepEqual(edited.tags, ["agents", "backend"]);
  edited = await json<Issue>(["issue", "edit", "SP-1", "--clear", "tags"]);
  assert.deepEqual(edited.tags, []);
  assert.equal((await cli(["issue", "edit", "SP-1"])).code, 2);
  assert.equal((await cli(["issue", "edit", "SP-1", "--clear", "title"])).code, 2);
  assert.equal((await cli(["issue", "edit", "SP-1", "--clear", "due", "--due", "2026-12-01"])).code, 2);
  assert.equal((await cli(["issue", "edit", "SP-1", "--tag", "x", "--add-tag", "y"])).code, 2);
  const stale = await cli(["issue", "edit", "SP-1", "-t", "Stale", "--expected-updated-at", "2000-01-01T00:00:00.000Z", "--json"]);
  assert.equal(stale.code, 1);
  assert.equal(JSON.parse(stale.err).error.code, "conflict");
  assert.match(await ok(["issue", "edit", "SP-1", "-d", "Short."]), /^Updated SP-1 {2}Ship the CLI v1/);

  // Comments with mentions, attachments and replies.
  await writeFile(join(work, "trace.log"), "stack trace");
  const comment = await json<{ id: string; body: string; mentions: { id: string }[]; attachments: StoredFile[] }>([
    "issue", "comment", "SP-1", "Please review <@member@example.test>", "--attach", "trace.log",
  ]);
  assert.equal(comment.body, `Please review <@${member.id}>`);
  assert.deepEqual(comment.mentions.map((m) => m.id), [member.id]);
  assert.deepEqual(comment.attachments.map((f) => f.filename), ["trace.log"]);
  assert.match(await ok(["issue", "comment", "SP-1", "--reply-to", comment.id, "--body-file", "-"], { stdin: "On it." }), /^Commented on SP-1/);
  assert.equal((await cli(["issue", "comment", "SP-1"])).code, 2);
  const thread = await ok(["issue", "comments", "SP-1"]);
  assert.match(thread, /^owner · \d{4}-\d\d-\d\d \d\d:\d\d · \S+ · 1 reply\n {2}Please review @member\n {2}Attachment: trace\.log \(11 B\)/);
  const replies = await json<{ comments: { body: string }[] }>(["issue", "comments", "SP-1", "--replies-to", comment.id]);
  assert.deepEqual(replies.comments.map((c) => c.body), ["On it."]);
  const withComments = await json<{ comments: { id: string }[] }>(["issue", "view", "SP-1", "--comments"]);
  assert.deepEqual(withComments.comments.map((c) => c.id), [comment.id]);

  // Attachments and downloads.
  await writeFile(join(work, "a.txt"), "alpha");
  await writeFile(join(work, "b.txt"), "beta");
  const attached = await json<{ attachments: StoredFile[] }>(["issue", "attach", "SP-1", "a.txt", "b.txt"]);
  assert.deepEqual(attached.attachments.map((f) => f.filename), ["a.txt", "b.txt"]);
  assert.equal((await cli(["issue", "attach", "SP-1", "missing.txt"])).code, 2);
  const listed = await json<{ attachments: StoredFile[] }>(["issue", "attachments", "SP-1"]);
  assert.deepEqual(listed.attachments.map((f) => f.filename).sort(), ["a.txt", "b.txt", "notes.txt", "trace.log"], "comment files are listed too");
  assert.match(await ok(["issue", "attachments", "SP-1"]), /^ID\s+SIZE\s+ADDED\s+NAME/);
  const alpha = attached.attachments[0]!;
  assert.equal((await cli(["file", "download", alpha.url, "-o", "-"])).bytes.toString(), "alpha");
  await rm(join(work, "a.txt"));
  assert.equal(await ok(["file", "download", "SP", alpha.id]), "Saved a.txt.\n");
  assert.equal(await readFile(join(work, "a.txt"), "utf8"), "alpha");
  assert.match((await cli(["file", "download", "SP", alpha.id])).err, /already exists/);
  await ok(["file", "download", "SP", alpha.id, "--force", "-o", "copy.txt"]);
  assert.equal(await readFile(join(work, "copy.txt"), "utf8"), "alpha");
  assert.equal((await cli(["file", "download", "https://elsewhere.test/api/v1/projects/SP/files/x"])).code, 1);
  const uploaded = await json<{ files: StoredFile[] }>(["file", "upload", "SP", "b.txt"]);
  assert.equal(uploaded.files[0]!.filename, "b.txt");

  // Raw API access.
  assert.equal((await json<Issue>(["api", "/issues/SP-1"])).key, "SP-1");
  assert.equal((await json<Issue>(["api", "api/v1/issues/SP-2"])).key, "SP-2");
  const patched = await json<Issue>(["api", "-X", "PATCH", "/issues/SP-2", "-d", '{"title":"Docs via api"}']);
  assert.equal(patched.title, "Docs via api");
  const posted = await json<Issue>(["api", "/issues", "-d", "@-"], { stdin: '{"project":"SP","title":"From stdin"}' });
  assert.equal(posted.key, "SP-4");
  assert.equal((await cli(["api", "/issues", "-d", "{nope"])).code, 2);
  assert.equal((await cli(["api", "/nothing-here"])).code, 1);

  // Environment overrides the saved login; logout forgets it.
  assert.equal((await cli(["whoami"], { env: { SPECTRON_TOKEN: "spk_wrong" } })).code, 4);
  assert.match((await cli(["auth", "logout"])).out, /Signed out/);
  await assert.rejects(stat(config));
  assert.equal((await cli(["whoami"])).code, 4);
  assert.equal(
    (await json<{ user: { email: string } }>(["whoami"], { env: { SPECTRON_URL: origin, SPECTRON_TOKEN: token } })).user.email,
    owner.email,
  );
});
