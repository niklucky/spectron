import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import {
  ProjectAccessError,
  createProjectService,
  createIssueService,
  createCommentService,
  createFieldService,
} from "@spectron/backend";
import {
  createTrackerService,
  sealToken,
  openToken,
  reverseMapping,
} from "../../backend/src/integrations/tracker";
import {
  YandexTrackerClient,
  type YTIssue,
  type YTComment,
} from "../../backend/src/integrations/yandex-client";
test("authenticated credential encryption and unambiguous reverse mappings", () => {
  const key = Buffer.alloc(32, 7).toString("base64"),
    sealed = sealToken("private", key);
  assert.equal(openToken(sealed, key), "private");
  assert.notEqual(sealed, sealToken("private", key));
  assert.throws(() =>
    openToken(sealed, Buffer.alloc(32, 8).toString("base64")),
  );
  assert.throws(() => sealToken("token", ""));
  assert.throws(() => openToken(sealed, ""), /INTEGRATION_ENCRYPTION_KEY/);
  assert.throws(() => openToken("malformed", key), /Could not decrypt/);
  assert.throws(() => reverseMapping({ a: "one", b: "one" }, "one"));
  assert.equal(reverseMapping({ a: "one", b: null }, "one"), "a");
});
test("HTTP headers, pagination, comment cursors and redacted errors", async (t) => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("comments"))
      return Response.json(
        calls.filter((c) => c.url.includes("comments")).length === 1
          ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
          : [],
      );
    if (url.includes("_findByUnique"))
      return url.includes("missing")
        ? new Response(null, { status: 404 })
        : Response.json({ id: "found" });
    if (url.includes("SECRET"))
      return new Response("TOKEN echoed", { status: 401 });
    return Response.json([]);
  });
  const client = new YandexTrackerClient("secret", undefined, "org");
  await client.getIssuesPaginated({ queue: "TEAM", page: 2 });
  assert.match(calls[0]!.url, /page=2/);
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)["X-Cloud-Org-Id"],
    "org",
  );
  assert.equal((await client.getComments("TEAM-1")).length, 100);
  assert.match(calls[2]!.url, /id=100/);
  assert.equal(await client.findByUnique("missing"), undefined);
  assert.equal((await client.findByUnique("existing"))!.id, "found");
  assert.equal(calls[3]!.init.method, "POST");
  assert.match(calls[3]!.url, /_findByUnique\?unique=missing/);
  await assert.rejects(
    client.getIssue("SECRET"),
    (e) => e instanceof Error && !e.message.includes("TOKEN"),
  );
});
test("database import/push, mappings, typed fields, permissions, repeat sync and conflicts", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_tracker_${randomUUID().replaceAll("-", "")}`,
    admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
  });
  await migrateDatabase(db);
  await db.insert(schema.user).values([
    { id: "owner", name: "Owner", email: "owner@test.local" },
    { id: "outsider", name: "Other", email: "other@test.local" },
  ]);
  const p = await createProjectService(db).create("owner", {
    name: "Tracker",
    key: "YT",
  });
  const issues = createIssueService(db),
    fieldService = createFieldService(db),
    fields = {
      create: async (
        actor: string,
        input: {
          projectId: string;
          name: string;
          type: "text" | "date" | "number" | "user";
        },
      ) => {
        await fieldService.save(actor, input);
        return (await issues.settings(actor, input.projectId)).fields!.find(
          (f) => f.name === input.name,
        )!;
      },
    };
  const state = (await issues.settings("owner", p.id)).states.find(
    (s) => s.isDefault,
  )!;
  const number = await fields.create("owner", {
    projectId: p.id,
    name: "Estimate",
    type: "number",
  });
  const date = await fields.create("owner", {
    projectId: p.id,
    name: "Due",
    type: "date",
  });
  const reference = await fields.create("owner", {
    projectId: p.id,
    name: "Type",
    type: "text",
  });
  const person = await fields.create("owner", {
    projectId: p.id,
    name: "Reviewer",
    type: "user",
  });
  await assert.rejects(
    fields.create("outsider", { projectId: p.id, name: "Bad", type: "text" }),
  );
  for (const values of [
    { [number.id]: "wrong" },
    { [date.id]: "2026-02-30" },
    { [person.id]: "outsider" },
  ])
    await assert.rejects(
      issues.create("owner", {
        projectId: p.id,
        title: "Bad",
        fieldValues: values,
      }),
    );
  let version = 1,
    created = 0,
    commentCreates = 0;
  const remote: YTIssue = {
    id: "remote1",
    key: "TEAM-1",
    version: 1,
    summary: "Imported",
    createdBy: { id: "remote-author", uid: 202, login: "remote.author", display: "Remote Author" },
    status: { id: "open", key: "open", display: "Open" },
    createdAt: "2026-01-01",
    updatedAt: "v1",
    estimate: 3,
    due: "2026-09-07",
    reviewer: { id: "different-reference", uid: 101 },
    type: { id: "task", key: "task", display: "Задача" },
  };
  const remoteIssues = [remote];
  const comments: YTComment[] = [
    {
      id: "1",
      text: "Remote comment",
      createdBy: { id: "different-reference", uid: 101, display: "Owner" },
      createdAt: "2026-01-01",
      updatedAt: "c1",
    },
  ];
  let allowTransition = false,
    transitionsExecuted = 0;
  let failComment = false,
    failIssue = false;
  class Fake extends YandexTrackerClient {
    override async getQueue() {
      return { id: "queue-id", key: "TEAM", name: "Team" };
    }
    override async getQueueStatuses() {
      return [{ id: "open", key: "open", display: "Open" }];
    }
    override async getPriorities() {
      return [];
    }
    override async getFields() {
      return [];
    }
    override async getQueueFields() {
      return [];
    }
    override async getUsers() {
      return [{ id: "101", display: "Owner" }];
    }
    override async getIssuesPaginated() {
      return {
        issues: remoteIssues.map((r) => ({ ...r })),
        total: remoteIssues.length,
        hasMore: false,
      };
    }
    override async getTransitions() {
      return allowTransition
        ? [
            {
              id: "start",
              display: "Start",
              to: { id: "progress", key: "progress", display: "In progress" },
            },
          ]
        : [];
    }
    override async executeTransition(key: string) {
      transitionsExecuted++;
      Object.assign(
        remoteIssues.find((r) => r.key === key)!,
        {
          status: { id: "progress", key: "progress", display: "In progress" },
          updatedAt: `v${++version}`,
        },
      );
    }
    override async getIssue(key: string) {
      return { ...remoteIssues.find((r) => r.key === key)! };
    }
    override async findByUnique(unique: string) {
      return remoteIssues.find((r) => r.unique === unique);
    }
    override async createIssue(
      input: Parameters<YandexTrackerClient["createIssue"]>[0],
    ) {
      created++;
      const r = {
        ...remote,
        id: `new${created}`,
        key: `TEAM-${created + 1}`,
        summary: input.summary,
        unique: input.unique,
        updatedAt: `v${++version}`,
      };
      remoteIssues.push(r);
      if (failIssue) {
        failIssue = false;
        throw new Error("Lost create response");
      }
      return { ...r };
    }
    override async updateIssue(
      key: string,
      input: Parameters<YandexTrackerClient["updateIssue"]>[1],
    ) {
      const r = remoteIssues.find((r) => r.key === key)!;
      Object.assign(r, input, { updatedAt: `v${++version}` });
      return { ...r };
    }
    override async getComments() {
      return comments.map((c) => ({ ...c }));
    }
    override async createComment(_key: string, text: string) {
      commentCreates++;
      const c = {
        ...comments[0]!,
        id: String(comments.length + 1),
        text,
        updatedAt: `c${++version}`,
      };
      comments.push(c);
      if (failComment) {
        failComment = false;
        throw new Error("Lost comment response");
      }
      return { ...c };
    }
    override async updateComment(_key: string, id: string, text: string) {
      const c = comments.find((c) => c.id === id)!;
      Object.assign(c, { text, updatedAt: `c${++version}` });
      return { ...c };
    }
  }
  const tracker = createTrackerService(
    db,
    Buffer.alloc(32).toString("base64"),
    () => new Fake("unused"),
  );
  const input = {
    projectId: p.id,
    organizationId: "org",
    organizationType: "cloud" as const,
    queue: "TEAM",
    token: "secret",
    mappings: {
      statuses: { open: state.id },
      priorities: {},
      users: { 101: "owner" },
      fields: {
        type: reference.id,
        estimate: number.id,
        due: date.id,
        reviewer: person.id,
        ignored: null,
      },
    },
  };
  await pool.query(
    "update issue_states set external_id='jira-state' where id=$1",
    [state.id],
  );
  await pool.query(
    "update project_fields set external_id='jira-field' where id=$1",
    [number.id],
  );
  await assert.rejects(tracker.test("outsider", input));
  await tracker.test("owner", input);
  assert.equal(await tracker.get("owner", p.id), null, "Testing must not save a connection");
  await tracker.save("owner", input);
  const beforeTest = await tracker.get("owner", p.id);
  const projectBeforeTest = (await pool.query("select external_id from projects where id=$1", [p.id])).rows;
  await tracker.test("owner", { ...input, token: undefined, queue: "OTHER" });
  assert.deepEqual(await tracker.get("owner", p.id), beforeTest, "Testing must not modify credentials or mappings");
  assert.deepEqual((await pool.query("select external_id from projects where id=$1", [p.id])).rows, projectBeforeTest);
  assert.equal(
    (
      await pool.query("select external_id from issue_states where id=$1", [
        state.id,
      ])
    ).rows[0].external_id,
    "jira-state",
  );
  assert.equal(
    (
      await pool.query("select external_id from project_fields where id=$1", [
        number.id,
      ])
    ).rows[0].external_id,
    "jira-field",
  );
  assert.equal((await tracker.metadata("owner", p.id)).statuses[0]!.id, "open");
  assert.equal(
    (await db.select().from(schema.project))[0]!.externalId,
    "queue-id",
  );
  assert.equal("token" in (await tracker.get("owner", p.id))!, false);
  assert.notEqual(
    (await db.select().from(schema.projectIntegration))[0]!.token,
    "secret",
  );
  await assert.rejects(tracker.get("outsider", p.id));
  await assert.rejects(tracker.run("outsider", p.id, "import"));
  const slotHolder = await pool.connect();
  try {
    await slotHolder.query(
      "select pg_advisory_lock(hashtext('tracker:sync-slot:0')), pg_advisory_lock(hashtext('tracker:sync-slot:1'))",
    );
    await assert.rejects(
      tracker.run("outsider", p.id, "import"),
      (error) => error instanceof ProjectAccessError,
    );
    await assert.rejects(
      tracker.run("owner", p.id, "import"),
      /Two Tracker sync/,
    );
  } finally {
    await slotHolder.query("select pg_advisory_unlock_all()");
    slotHolder.release();
  }

  await tracker.save("owner", { ...input, queue: "OTHER", token: undefined });
  assert.equal((await tracker.get("owner", p.id))!.queue, "OTHER");
  await tracker.save("owner", input);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(await tracker.run("owner", p.id, "import"), {
      processed: 1,
      errors: [],
    });
  await assert.rejects(
    tracker.save("owner", { ...input, queue: "OTHER" }),
    /synced records/,
  );
  let local = (await issues.list("owner", p.id))[0]!;
  assert.equal(local.externalId, "remote1");
  assert.notEqual(local.authorId, "owner");
  assert.equal(local.author?.name, "Remote Author");
  const originalTimestamp = local.updatedAt;
  const issueVersion = async () => (await pool.query("select xmin::text as version from issues where id=$1", [local.id])).rows[0].version;
  const beforeRepeat = await issueVersion();
  await tracker.run("owner", p.id, "import");
  assert.equal(await issueVersion(), beforeRepeat, "unchanged imports must not rewrite the issue author");
  const originalAuthor = remote.createdBy!;
  remote.createdBy = { id: "changed-author", uid: 303, login: "changed-author", display: "Changed Author" };
  await tracker.run("owner", p.id, "import");
  assert.equal((await issues.list("owner", p.id))[0]!.author?.name, "Changed Author");
  remote.createdBy = originalAuthor;
  await tracker.run("owner", p.id, "import");
  // Simulate a legacy import and verify attribution-only repair preserves the
  // content version used by edits and sync checkpoints.
  await pool.query("update issues set author_id='owner', external_author_id=null where id=$1", [local.id]);
  await tracker.repairAuthors("owner", p.id, local.id);
  const repaired = (await issues.list("owner", p.id))[0]!;
  assert.equal(repaired.author?.name, "Remote Author");
  assert.equal(repaired.updatedAt, originalTimestamp);
  const importedComment = (await db.select().from(schema.issueComment))[0]!;
  assert.equal(importedComment.authorId, null);
  assert.ok(importedComment.externalAuthorId);
  const mappedIdentity = (await db.select().from(schema.externalIdentity)).find(identity => identity.id === importedComment.externalAuthorId)!;
  assert.equal(mappedIdentity.localUserId, "owner");
  const commentVersions = async () => (await pool.query(
    "select c.xmin::text as comment_version, e.xmin::text as identity_version from issue_comments c join external_identities e on e.id=c.external_author_id where c.id=$1", [importedComment.id])).rows[0];
  const beforeCommentRepeat = await commentVersions();
  await tracker.run("owner", p.id, "import");
  assert.deepEqual(await commentVersions(), beforeCommentRepeat, "unchanged comment imports must not rewrite comments or identities");
  await tracker.repairAuthors("owner", p.id, local.id);
  assert.deepEqual(await commentVersions(), beforeCommentRepeat, "explicit repair must also skip settled authors");
  // Unchanged remote comments still repair legacy attribution and show unmapped
  // external authors instead of granting the importing account ownership.
  comments[0]!.createdBy = { id: "remote-author", uid: 202, display: "Remote Author" };
  await tracker.run("owner", p.id, "import");
  const externalComment = (await db.select().from(schema.issueComment))[0]!;
  assert.equal(externalComment.authorId, null);
  assert.equal(externalComment.externalAuthorId, repaired.authorId);
  const listedComment = (await createCommentService(db).list("owner", { projectId: p.id, issueId: local.id, parentId: null })).comments[0]!;
  assert.equal(listedComment.authorName, "Remote Author");
  assert.equal(listedComment.canEdit, false);
  comments[0]!.createdBy = { id: "different-reference", uid: 101, display: "Owner" };
  assert.equal(local.trackerKey, remote.key);
  assert.equal((await issues.settings("owner", p.id)).trackerConnected, true);
  assert.equal((await issues.settings("owner", p.id)).jiraConnected, false);
  assert.equal(local.fieldValues?.[reference.id], "Задача");
  assert.equal(local.fieldValues?.[number.id], 3);
  assert.equal(local.fieldValues?.[person.id], "owner");
  assert.equal((await db.select().from(schema.issueComment)).length, 1);
  comments[0]!.text = "Comment-only update";
  comments[0]!.updatedAt = "comment-only-v2";
  await tracker.run("owner", p.id, "import");
  assert.match(
    JSON.stringify((await db.select().from(schema.issueComment))[0]!.body),
    /Comment-only update/,
  );
  comments[0]!.text = "Script\n\n```bash\n  echo \"$body\"\n```";
  comments[0]!.updatedAt = "comment-markdown-v3";
  await tracker.run("owner", p.id, "import");
  assert.deepEqual((await db.select().from(schema.issueComment))[0]!.body,
    [{ type: "text", text: comments[0]!.text }]);
  remote.summary = "Remote edited";
  remote.updatedAt = "v2";
  await tracker.run("owner", p.id, "import");
  local = (await issues.list("owner", p.id))[0]!;
  assert.equal(local.title, "Remote edited");
  local = await issues.update("owner", {
    projectId: p.id,
    id: local.id,
    expectedUpdatedAt: local.updatedAt,
    title: "Local edited",
    fieldValues: { ...local.fieldValues, [number.id]: 8 },
  });
  assert.deepEqual(await tracker.run("owner", p.id, "push", false, { issueId: local.id }), {
    processed: 1,
    errors: [],
  });
  assert.equal(remote.summary, "Local edited");
  assert.equal(remote.estimate, 8);
  assert.deepEqual(await tracker.run("owner", p.id, "push", false, { issueId: "missing-issue" }), {
    processed: 0,
    errors: [],
  });
  await assert.rejects(tracker.run("outsider", p.id, "push", false, { issueId: local.id }));
  await db.insert(schema.issueComment).values({
    projectId: p.id,
    issueId: local.id,
    authorId: "owner",
    body: [{ type: "text", text: "Local comment" }],
  });
  for (let i = 0; i < 2; i++)
    assert.deepEqual((await tracker.run("owner", p.id, "push")).errors, []);
  assert.equal(commentCreates, 1);
  assert.equal(comments[1]!.text, "Local comment");
  const lc = (await db.select().from(schema.issueComment)).find(
    (c) => c.externalId === "2",
  );
  await tracker.run("owner", p.id, "import");
  const preservedAuthor = (await db.select().from(schema.issueComment)).find(c => c.id === lc!.id)!;
  assert.equal(preservedAuthor.authorId, "owner");
  assert.equal(preservedAuthor.externalAuthorId, null);
  await pool.query(
    "update issue_comments set body = $1::jsonb, updated_at = $2 where id = $3",
    [
      JSON.stringify([{ type: "text", text: "Edited comment" }]),
      new Date(lc!.updatedAt.getTime() + 10),
      lc!.id,
    ],
  );
  await tracker.run("owner", p.id, "push");
  assert.equal(comments[1]!.text, "Edited comment");
  assert.equal(commentCreates, 1);
  await db.insert(schema.issueComment).values({
    projectId: p.id,
    issueId: local.id,
    authorId: "owner",
    body: [{ type: "text", text: "Retry this comment" }],
  });
  failComment = true;
  assert.equal((await tracker.run("owner", p.id, "push")).errors.length, 1);
  assert.equal(commentCreates, 2);
  assert.deepEqual((await tracker.run("owner", p.id, "push")).errors, []);
  assert.equal(commentCreates, 3);
  assert.equal(comments.at(-1)!.text, "Retry this comment");
  await tracker.run("owner", p.id, "push");
  assert.equal(commentCreates, 3);
  await issues.create("owner", {
    projectId: p.id,
    title: "New local",
    stateId: state.id,
  });
  assert.deepEqual((await tracker.run("owner", p.id, "push")).errors, []);
  await tracker.run("owner", p.id, "push");
  assert.equal(created, 1);
  await issues.create("owner", {
    projectId: p.id,
    title: "Recover lost create",
    stateId: state.id,
  });
  failIssue = true;
  assert.equal((await tracker.run("owner", p.id, "push")).errors.length, 1);
  assert.equal(created, 2);
  assert.deepEqual((await tracker.run("owner", p.id, "push")).errors, []);
  assert.equal(created, 2);
  local = (await issues.list("owner", p.id)).find((i) => i.id === local.id)!;
  await issues.update("owner", {
    projectId: p.id,
    id: local.id,
    expectedUpdatedAt: local.updatedAt,
    title: "Conflict local",
  });
  remote.summary = "Conflict remote";
  remote.updatedAt = "conflict";
  assert.ok(
    (await tracker.run("owner", p.id, "import")).errors.some((e) =>
      e.includes("local edits"),
    ),
  );
  assert.ok(
    (await tracker.run("owner", p.id, "push")).errors.some((e) =>
      e.includes("Tracker changed"),
    ),
  );
  assert.equal(remote.summary, "Conflict remote");
  assert.deepEqual(
    (await tracker.run("owner", p.id, "import", true)).errors,
    [],
  );
  assert.equal(
    (await issues.list("owner", p.id)).find((i) => i.id === local.id)!.title,
    "Conflict remote",
  );
  const progress = (await issues.settings("owner", p.id)).states.find(
    (s) => s.trigger === "in_progress",
  )!;
  await tracker.save("owner", {
    ...input,
    mappings: {
      ...input.mappings,
      statuses: { ...input.mappings.statuses, progress: progress.id },
    },
  });
  const moving = await issues.create("owner", {
    projectId: p.id,
    title: "Needs transition",
    stateId: progress.id,
  });
  assert.ok(
    (await tracker.run("owner", p.id, "push")).errors.some((e) =>
      e.includes("no transition"),
    ),
  );
  assert.equal(created, 3);
  allowTransition = true;
  assert.deepEqual((await tracker.run("owner", p.id, "push")).errors, []);
  assert.equal(created, 3);
  assert.equal(transitionsExecuted, 1);
  const pushedIssue = (await issues.list("owner", p.id)).find(
    (i) => i.id === moving.id,
  )!;
  assert.equal(
    remoteIssues.find((r) => r.key === pushedIssue.externalKey)!.status!.id,
    "progress",
  );
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  class Paused extends Fake {
    override async getIssuesPaginated() {
      entered();
      await waiting;
      return super.getIssuesPaginated();
    }
  }
  const paused = createTrackerService(
    db,
    Buffer.alloc(32).toString("base64"),
    () => new Paused("unused"),
  );
  const running = paused.run("owner", p.id, "import");
  await started;
  try {
    await assert.rejects(tracker.run("owner", p.id, "import"), /busy/);
    const idle = await pool.query(
      "select count(*)::int as count from pg_stat_activity where datname=current_database() and state='idle in transaction'",
    );
    assert.equal(idle.rows[0].count, 0);
  } finally {
    release();
    await running;
  }
  assert.deepEqual((await tracker.run("owner", p.id, "import")).errors, []);

  remote.updatedAt = "deleted-field-race";
  class DeletedField extends Fake {
    override async getIssuesPaginated() {
      await pool.query(
        "update project_fields set deleted_at=now() where id=$1",
        [number.id],
      );
      return super.getIssuesPaginated();
    }
  }
  const racing = createTrackerService(
    db,
    Buffer.alloc(32).toString("base64"),
    () => new DeletedField("unused"),
  );
  try {
    const failed = await racing.run("owner", p.id, "import");
    assert.ok(
      failed.errors.some((e) => e.includes(number.id) && e.includes("deleted")),
    );
  } finally {
    await pool.query("update project_fields set deleted_at=null where id=$1", [
      number.id,
    ]);
  }
});

test("Tracker suggestions match Russian names and keys without overwriting choices or ambiguous pairs", async () => {
  const { matchTrackerMappings, trackerFieldType } =
    await import("@spectron/shared");
  assert.deepEqual(
    matchTrackerMappings(
      "statuses",
      [
        { id: "1", display: "В работе" },
        { id: "2", display: "Открыт" },
      ],
      [
        { id: "progress", name: "In progress" },
        { id: "open", name: "Open" },
      ],
      { "2": null },
    ),
    { "1": "progress", "2": null },
  );
  assert.deepEqual(
    matchTrackerMappings(
      "priorities",
      [{ id: "1", display: "Высокий" }],
      [{ id: "high", name: "High" }],
      {},
    ),
    { "1": "high" },
  );
  assert.deepEqual(
    matchTrackerMappings(
      "statuses",
      [
        { id: "1", display: "В работе" },
        { id: "2", display: "In progress" },
      ],
      [{ id: "progress", name: "In progress" }],
      {},
    ),
    {},
  );
  assert.deepEqual(
    matchTrackerMappings(
      "statuses",
      [{ id: "1", display: "Открыт" }],
      [
        { id: "a", name: "Open" },
        { id: "b", name: "Open" },
      ],
      {},
    ),
    {},
  );
  assert.deepEqual(
    matchTrackerMappings(
      "fields",
      [
        {
          id: "remote",
          display: "Дата начала",
          key: "startDate",
          schema: { type: "date" },
        },
      ],
      [{ id: "local", name: "Start date", type: "date" }],
      {},
    ),
    { remote: "local" },
  );
  assert.deepEqual(
    matchTrackerMappings(
      "fields",
      [{ id: "remote", display: "Оценка", schema: { type: "number" } }],
      [{ id: "local", name: "Estimate", type: "text" }],
      {},
    ),
    {},
  );
  assert.deepEqual(
    matchTrackerMappings(
      "fields",
      [{ id: "r", display: "Мой показатель", schema: { type: "number" } }],
      [{ id: "l", name: "  МОЙ показатель ", type: "number" }],
      { other: "l" },
    ),
    { r: "l" },
  );
  assert.equal(
    trackerFieldType({ id: "r", schema: { type: "array" } }),
    undefined,
  );
});

test("Tracker user metadata uses distinct uid values as mapping IDs", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json([
      { uid: 101, display: "First" },
      { uid: "202", display: "Second" },
      { id: "legacy", display: "Legacy" },
    ]),
  );
  const users = await new YandexTrackerClient(
    "test",
    undefined,
    "org",
  ).getUsers();
  assert.deepEqual(
    users.map((u) => u.id),
    ["101", "202", "legacy"],
  );
  const mappings = { [users[0]!.id]: "local-user" };
  assert.equal(mappings[users[1]!.id], undefined);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json([{ display: "Missing ID" }]),
  );
  await assert.rejects(
    new YandexTrackerClient("test", undefined, "org").getUsers(),
    /without an identifier/,
  );
});

test("Tracker network failures report a retryable, credential-free error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network failure with secret");
  });
  await assert.rejects(
    new YandexTrackerClient(
      "private-token",
      undefined,
      "org",
    ).getIssuesPaginated({ queue: "TEAM" }),
    (e) =>
      e instanceof Error &&
      e.message.includes("timed out") &&
      !e.message.includes("secret") &&
      !e.message.includes("private-token"),
  );
});

test("Tracker mapping refresh drops deleted local targets and preserves explicit ignores", async () => {
  const { matchTrackerMappings } = await import("@spectron/shared");
  assert.deepEqual(
    matchTrackerMappings(
      "statuses",
      [
        { id: "open", name: "Open" },
        { id: "ignored", name: "Other" },
      ],
      [{ id: "replacement", name: "Open" }],
      { open: "deleted", ignored: null },
    ),
    { open: "replacement", ignored: null },
  );
  assert.deepEqual(
    matchTrackerMappings(
      "fields",
      [{ id: "field", name: "Gone", schema: { type: "string" } }],
      [],
      { field: "deleted" },
    ),
    {},
  );
});
