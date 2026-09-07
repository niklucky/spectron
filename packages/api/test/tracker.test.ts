import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import {
  createProjectService,
  createIssueService,
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
    status: { id: "open", key: "open", display: "Open" },
    createdAt: "2026-01-01",
    updatedAt: "v1",
    estimate: 3,
    due: "2026-09-07",
    reviewer: { id: "remoteUser" },
  };
  const remoteIssues = [remote];
  const comments: YTComment[] = [
    {
      id: "1",
      text: "Remote comment",
      createdBy: { id: "remoteUser", display: "Owner" },
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
      return [{ id: "remoteUser", display: "Owner" }];
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
      users: { remoteUser: "owner" },
      fields: {
        estimate: number.id,
        due: date.id,
        reviewer: person.id,
        ignored: null,
      },
    },
  };
  await tracker.save("owner", input);
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
  assert.equal(local.fieldValues?.[number.id], 3);
  assert.equal(local.fieldValues?.[person.id], "owner");
  assert.equal((await db.select().from(schema.issueComment)).length, 1);
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
  assert.deepEqual(await tracker.run("owner", p.id, "push"), {
    processed: 1,
    errors: [],
  });
  assert.equal(remote.summary, "Local edited");
  assert.equal(remote.estimate, 8);
  await db.insert(schema.issueComment).values({
    projectId: p.id,
    issueId: local.id,
    authorId: "owner",
    body: [{ type: "text", text: "Local comment" }],
  });
  for (let i = 0; i < 2; i++)
    assert.deepEqual((await tracker.run("owner", p.id, "push")).errors, []);
  assert.equal(commentCreates, 1);
  const lc = (await db.select().from(schema.issueComment)).find(
    (c) => c.externalId === "2",
  );
  await pool.query(
    "update issue_comments set body = $1::jsonb, updated_at = $2 where id = $3",
    [
      JSON.stringify([{ type: "text", text: "Edited comment" }]),
      new Date(lc!.updatedAt.getTime() + 10),
      lc!.id,
    ],
  );
  await tracker.run("owner", p.id, "push");
  assert.match(comments[1]!.text, /Edited comment/);
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
  assert.equal(commentCreates, 2);
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
});
