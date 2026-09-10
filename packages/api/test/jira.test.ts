import { ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDatabase, migrateDatabase, schema as s } from "@spectron/db";
import {
  createJiraScheduler,
  createProjectService,
  createIssueService,
  createFieldService,
  createFileService,
  createJiraService,
  createCommentService,
  createWorklogService,
  createActivityService,
} from "@spectron/backend";
import {
  JiraClient,
  adfToText,
  textToAdf,
  type JiraIssue,
  type JiraComment,
} from "../../backend/src/integrations/jira-client";
import {
  encryptToken,
  decryptToken,
} from "../../backend/src/integrations/jira";
const secret = "test-integration-secret-at-least-32-characters";
test("Jira client rejects unsafe sites and token encryption authenticates ciphertext", () => {
  for (const url of [
    "http://team.atlassian.net",
    "https://localhost",
    "https://team.atlassian.net.evil.test",
    "https://team.atlassian.net/path",
    "https://x:y@team.atlassian.net",
    "https://team.atlassian.net:8443",
  ])
    assert.throws(() => new JiraClient(url, "email", "token"));
  const encrypted = encryptToken("private token", secret);
  assert.equal(decryptToken(encrypted, secret), "private token");
  assert.ok(!encrypted.includes("private token"));
  assert.throws(() => decryptToken(encrypted, secret + "wrong"));
  assert.equal(adfToText(textToAdf("first\n\nsecond")), "first\nsecond");
});
test("Jira project fields, import, publishing, conflicts and retry safety", async (t) => {
  const admin = createDatabase(
    process.env.TEST_DATABASE_URL ||
      "postgresql://spectron:spectron@127.0.0.1:5442/spectron",
  );
  const name = `test_jira_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(
    process.env.TEST_DATABASE_URL ||
      "postgresql://spectron:spectron@127.0.0.1:5442/spectron",
  );
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const root = await mkdtemp(join(tmpdir(), "spectron-jira-"));
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await migrateDatabase(db);
  await db.insert(s.user).values([
    { id: "owner", name: "Owner", email: "owner@test.invalid" },
    { id: "member", name: "Member", email: "member@test.invalid" },
    { id: "outsider", name: "Outsider", email: "outside@test.invalid" },
  ]);
  const projects = createProjectService(db),
    issues = createIssueService(db),
    fields = createFieldService(db),
    files = createFileService(db, { root }),
    jira = createJiraService(db, files, secret),
    comments = createCommentService(db);
  const p = await projects.create("owner", { name: "Jira test", key: "SP" }),
    q = await projects.create("outsider", { name: "Other", key: "OT" });
  await db
    .insert(s.projectMember)
    .values({ projectId: p.id, userId: "member", role: "member" });
  await fields.save("owner", {
    projectId: p.id,
    name: "Points",
    type: "number",
  });
  await fields.save("owner", { projectId: p.id, name: "Due", type: "date" });
  await fields.save("owner", {
    projectId: p.id,
    name: "Reviewer",
    type: "user",
  });
  await fields.save("owner", { projectId: p.id, name: "Notes", type: "text" });
  const settings = await issues.settings("owner", p.id),
    definitions = settings.fields!;
  const points = definitions.find((f) => f.name === "Points")!,
    due = definitions.find((f) => f.name === "Due")!,
    reviewer = definitions.find((f) => f.name === "Reviewer")!,
    notes = definitions.find((f) => f.name === "Notes")!;
  await assert.rejects(
    fields.save("member", { projectId: p.id, name: "Denied", type: "text" }),
  );
  for (const values of [
    { [points.id]: "3" },
    { [due.id]: "2026-02-30" },
    { [reviewer.id]: "outsider" },
    { foreign: "x" },
  ])
    await assert.rejects(
      issues.create("owner", {
        projectId: p.id,
        title: "Invalid",
        fieldValues: values,
      }),
    );
  await assert.rejects(
    fields.save("owner", {
      projectId: p.id,
      id: points.id,
      name: "Points",
      type: "text",
    }),
  );
  const actor = { accountId: "jira-owner", displayName: "Jira Owner" };
  const remote: JiraIssue = {
    id: "100",
    key: "TEAM-1",
    fields: {
      project: { key: "TEAM" },
      summary: "Imported issue",
      labels: ["frontend", "urgent"],
      issuetype: { id: "10001", name: "Story" },
      description: textToAdf("One\n\nTwo"),
      status: { id: "1", name: "Open" },
      priority: { id: "2", name: "Medium" },
      reporter: actor,
      assignee: actor,
      created: "2026-01-01T10:00:00Z",
      customfield_1: 3,
      customfield_2: "2026-09-01",
      customfield_3: actor,
      customfield_4: "notes",
      timeoriginalestimate: 7200,
      duedate: "2026-09-10",
      customfield_5: "2026-09-01T09:00:00+0300",
      attachment: [
        { id: "501", filename: "hello.txt", size: 5, author: actor },
      ],
    },
  };
  const remoteComments: JiraComment[] = [
    {
      id: "201",
      body: textToAdf("First"),
      author: actor,
      created: "2026-01-02T10:00:00Z",
    },
    {
      id: "202",
      body: textToAdf("Second"),
      author: actor,
      created: "2026-01-03T10:00:00Z",
    },
  ];
  const remoteMap = new Map<string, JiraIssue>([[remote.id, remote]]);
  let downloads = 0,
    creates = 0,
    commentCreates = 0,
    loseCreate = false,
    rejectCreate = false;
  const searchQueries: string[] = [];
  let paginateSearch = false;
  const writes: Record<string, unknown>[] = [];
  let hangNext = false;
  let requestStarted: () => void = () => {};
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      method = init?.method ?? "GET";
    assert.equal(url.hostname, "team.atlassian.net");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Basic ${Buffer.from("jira@example.test:token").toString("base64")}`,
    );
    if (hangNext && path === "/rest/api/3/issue/100") {
      hangNext = false;
      requestStarted();
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Cancelled", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    const json = (v: unknown, status = 200) => Response.json(v, { status });
    if (path.endsWith("/project/TEAM"))
      return json({ id: "10", key: "TEAM", name: "Team" });
    if (path.endsWith("/project/TEAM/statuses"))
      return json([
        {
          id: "10001",
          name: "Task",
          statuses: [
            { id: "1", name: "Open" },
            { id: "3", name: "Done" },
          ],
        },
      ]);
    if (path.endsWith("/priority")) return json([{ id: "2", name: "Medium" }]);
    if (path.endsWith("/field"))
      return json([
        ...[1, 2, 3, 4].map((id) => ({
          id: `customfield_${id}`,
          name: `Field ${id}`,
        })),
        { id: "summary", name: "Summary" },
        {
          id: "timeoriginalestimate",
          name: "Original estimate",
          schema: { type: "number" },
        },
        { id: "duedate", name: "Due date", schema: { type: "date" } },
        {
          id: "customfield_5",
          name: "Start date",
          schema: { type: "datetime" },
        },
      ]);
    if (path.endsWith("/user/assignable/search")) return json([actor]);
    if (path.endsWith("/search/jql")) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.fields, ["*all"]);
      assert.match(
        body.jql,
        /^project = "TEAM"(?: AND updated >= \d+)? ORDER BY updated ASC$/,
      );
      searchQueries.push(body.jql);
      if (paginateSearch && !body.nextPageToken)
        return json({
          issues: [remote],
          isLast: false,
          nextPageToken: "page-2",
          maxResults: 25,
        });
      return json({
        issues: paginateSearch ? [] : [remote],
        isLast: true,
        maxResults: 25,
      });
    }
    if (path.endsWith("/attachment/content/501")) {
      assert.equal(url.searchParams.get("redirect"), "false");
      downloads++;
      return new Response("hello");
    }
    if (path.endsWith("/issue") && method === "POST") {
      creates++;
      if (rejectCreate) return json({ errors: { summary: "required" } }, 400);
      const f = JSON.parse(String(init?.body)).fields;
      const created = {
        id: String(1000 + creates),
        key: `TEAM-${creates + 1}`,
        fields: { ...f, status: { id: "1", name: "Open" } },
      } as JiraIssue;
      remoteMap.set(created.id, created);
      if (loseCreate)
        throw new TypeError("Connection lost after Jira created the issue");
      return json({ id: created.id, key: created.key });
    }
    const match = path.match(/\/issue\/([^/]+)(.*)/);
    if (match) {
      const item =
        remoteMap.get(match[1]!) ??
        [...remoteMap.values()].find((r) => r.key === match[1]);
      assert.ok(item, `Unknown Jira issue ${path}`);
      const suffix = match[2];
      if (suffix === "/comment" && method === "GET") {
        const start = Number(url.searchParams.get("startAt") ?? 0);
        return json({
          comments: remoteComments.slice(start, start + 1),
          total: remoteComments.length,
          startAt: start,
          maxResults: 1,
        });
      }
      if (suffix === "/worklog")
        return json({
          worklogs: [
            {
              id: "301",
              author: actor,
              started: "2026-01-02T12:00:00Z",
              timeSpentSeconds: 3600,
              comment: textToAdf("Work"),
              created: "2026-01-02T12:00:00Z",
            },
          ],
          total: 1,
          startAt: 0,
          maxResults: 50,
        });
      if (suffix === "/transitions") {
        if (method === "POST") {
          item.fields.status = { id: "3", name: "Done" };
          return new Response(null, { status: 204 });
        }
        return json({
          transitions: [
            { id: "31", name: "Done", to: { id: "3", name: "Done" } },
          ],
        });
      }
      if (suffix?.startsWith("/comment") && ["POST", "PUT"].includes(method)) {
        const body = JSON.parse(String(init?.body)).body;
        const old = remoteComments.find((c) => suffix === `/comment/${c.id}`);
        if (old) {
          old.body = body;
          return json(old);
        }
        commentCreates++;
        const comment = {
          id: String(800 + commentCreates),
          body,
          author: actor,
        };
        remoteComments.push(comment);
        return json(comment);
      }
      if (method === "PUT") {
        const f = JSON.parse(String(init?.body)).fields;
        writes.push(f);
        Object.assign(item.fields, f);
        if (f.timetracking)
          item.fields.timeoriginalestimate =
            f.timetracking.originalEstimate === null
              ? null
              : Number.parseFloat(f.timetracking.originalEstimate) * 60;
        return new Response(null, { status: 204 });
      }
      return json(item);
    }
    throw new Error(`Unexpected Jira request ${method} ${path}`);
  };
  t.after(() => {
    globalThis.fetch = fetchBefore;
  });
  const config = {
    baseUrl: "https://team.atlassian.net",
    projectKey: "TEAM",
    email: "jira@example.test",
    apiToken: "token",
    issueTypeId: "10001",
  };
  await assert.rejects(jira.save("member", p.id, config));
  await assert.rejects(jira.test("member", p.id, config));
  await assert.rejects(jira.test("outsider", p.id, config));
  assert.ok((await jira.test("owner", p.id, config)).issueTypes.length);
  assert.equal(await jira.get("owner", p.id), null, "Testing must not save a connection");
  const saved = await jira.save("owner", p.id, { ...config, issueTypeId: "" });
  assert.equal(saved.issueTypeId, config.issueTypeId, "New connections provision a valid default before mapping");
  const beforeTest = await jira.get("owner", p.id);
  await jira.test("owner", p.id, { ...config, apiToken: "", issueTypeId: "other" });
  assert.deepEqual(await jira.get("owner", p.id), beforeTest, "Testing must not modify credentials or mappings");
  await jira.save("outsider", q.id, config);
  const beforeAuto = await issues.settings("outsider", q.id);
  const autoMapped = await jira.prepare("outsider", q.id);
  assert.equal(
    autoMapped.mappings.statuses["3"],
    beforeAuto.states.find((s) => s.name === "Done")!.id,
  );
  assert.equal(
    (await issues.settings("outsider", q.id)).states.filter(
      (s) => s.name === "Done",
    ).length,
    1,
  );

  await jira.save("owner", p.id, { ...config, apiToken: "" });
  await pool.query(
    "update jira_integrations set lease='test', lease_until=now()+interval '1 minute' where project_id=$1",
    [p.id],
  );
  await assert.rejects(
    jira.import("owner", p.id, "100"),
    /Another Jira operation/,
  );
  await pool.query(
    "update jira_integrations set lease=null, lease_until=null where project_id=$1",
    [p.id],
  );
  assert.ok(!("encryptedToken" in saved));
  assert.ok(!JSON.stringify(saved).includes('"token"'));
  await assert.rejects(jira.get("outsider", p.id));
  assert.equal((await jira.discover("owner", p.id)).issueTypes[0]!.id, "10001");
  remote.fields.summary = "T".repeat(256);
  await assert.rejects(jira.import("owner", p.id, "100"), /Jira title has 256 characters; Spectron allows 255/);
  remote.fields.summary = "T".repeat(153);
  const originalDescription = remote.fields.description;
  remote.fields.description = textToAdf("D".repeat(ISSUE_DESCRIPTION_MAX_LENGTH + 1));
  await assert.rejects(jira.import("owner", p.id, "100"), /Jira description has 1000001 characters; Spectron allows 1,000,000/);
  remote.fields.description = originalDescription;
  const autoImported = await jira.import("owner", p.id, "100");
  assert.equal((await issues.list("owner", p.id)).find(issue => issue.id === autoImported.id)?.title, remote.fields.summary);
  assert.equal((await issues.list("owner", p.id)).length, 1);
  const identity = (await issues.settings("owner", p.id))
    .externalIdentities![0]!;
  assert.equal(identity.displayName, "Jira Owner");
  assert.equal(identity.localUserId, null);
  assert.equal((await pool.query("select * from users")).rowCount, 3);
  assert.equal(
    (
      await pool.query("select * from project_members where project_id=$1", [
        p.id,
      ])
    ).rowCount,
    2,
  );
  await assert.rejects(issues.list(identity.id, p.id));
  const importedComments = await comments.list("owner", {
    projectId: p.id,
    issueId: autoImported.id,
    parentId: null,
  });
  assert.equal(importedComments.comments.length, 2);
  assert.equal(importedComments.comments[0]!.jiraSync, "synced");
  assert.equal(importedComments.comments[0]!.authorName, "Jira Owner");
  assert.equal(importedComments.comments[0]!.canEdit, false);
  const worklogService = createWorklogService(db);
  const importedLogs = await worklogService.list("owner", {
    projectId: p.id,
    issueId: autoImported.id,
    includeDeleted: false,
  });
  assert.equal(importedLogs.entries[0]!.workerName, "Jira Owner");
  assert.equal(importedLogs.entries[0]!.workerUserId, identity.id);
  const activity = await createActivityService(db).list("owner", {
    projectId: p.id,
    issueId: autoImported.id,
  });
  assert.ok(JSON.stringify(activity).includes("Jira Owner"));
  await assert.rejects(
    issues.create("outsider", {
      projectId: q.id,
      title: "Foreign identity",
      assigneeId: identity.id,
    }),
  );
  await fields.save("outsider", {
    projectId: q.id,
    name: "Foreign reviewer",
    type: "user",
  });
  const foreignField = (await issues.settings("outsider", q.id)).fields![0]!;
  await assert.rejects(
    issues.create("outsider", {
      projectId: q.id,
      title: "Foreign identity field",
      fieldValues: { [foreignField.id]: identity.id },
    }),
  );
  const mapping = {
    issueTypes: { "10001": settings.issueTypes![0]!.id },
    statuses: {
      "1": settings.states[0]!.id,
      "3": settings.states.find((s) => s.trigger === "finished")!.id,
    },
    priorities: { "2": settings.priorities[0]!.id },
    users: { "jira-owner": "owner" },
    fields: {
      labels: "issue:tags",
      customfield_1: points.id,
      customfield_2: due.id,
      customfield_3: reviewer.id,
      customfield_4: notes.id,
      ignored: null,
      timeoriginalestimate: "issue:estimateTime",
      duedate: "issue:finishAt",
      customfield_5: "issue:startAt",
    },
  };
  await jira.mappings("owner", p.id, mapping);
  await jira.prepare("owner", p.id);
  assert.ok((await issues.settings("owner", p.id)).jiraConnected);
  await assert.rejects(jira.prepare("member", p.id));
  const imported = await jira.import("owner", p.id, "100");
  await jira.import("owner", p.id, "100");
  assert.equal(downloads, 1);
  let rows = await issues.list("owner", p.id);
  assert.equal(rows.length, 1);
  let row = rows[0]!;
  assert.equal(row.issueTypeId, settings.issueTypes![0]!.id);
  assert.equal(row.tagIds!.length, 2);
  assert.equal((await pool.query("select * from tags where project_id=$1", [p.id])).rowCount, 2);
  remote.fields.labels = [];
  await jira.import("owner", p.id, "100");
  row = (await issues.list("owner", p.id))[0]!;
  assert.deepEqual(row.tagIds, []);
  remote.fields.labels = ["frontend", "urgent"];
  await jira.import("owner", p.id, "100");
  row = (await issues.list("owner", p.id))[0]!;
  assert.equal(row.tagIds!.length, 2);
  assert.equal((await pool.query("select * from tags where project_id=$1", [p.id])).rowCount, 2);
  assert.equal(row.externalId, "100");
  assert.equal(row.externalKey, "TEAM-1");
  assert.equal(row.key, "SP-1");
  assert.equal(row.fieldValues![points.id], 3);
  assert.equal(row.estimateTime, 7200);
  assert.equal(row.startAt, "2026-09-01T06:00:00.000Z");
  assert.equal(row.finishAt, "2026-09-10T00:00:00.000Z");
  assert.equal(row.fieldValues![reviewer.id], identity.id);
  assert.equal(
    (await issues.settings("owner", p.id)).externalIdentities![0]!.localUserId,
    "owner",
  );
  const linkedComments = await comments.list("owner", {
    projectId: p.id,
    issueId: row.id,
    parentId: null,
  });
  assert.equal(linkedComments.comments[0]!.authorName, "Owner");
  assert.equal(linkedComments.comments[0]!.canEdit, true);
  assert.equal(
    (await pool.query("select * from external_identities")).rowCount,
    1,
  );
  assert.equal(row.createdAt, "2026-01-01T10:00:00.000Z");
  assert.equal((await pool.query("select * from issue_comments")).rowCount, 2);
  assert.equal((await pool.query("select * from issue_worklogs")).rowCount, 1);
  assert.equal((await files.attachments("owner", p.id, row.id)).length, 1);
  await assert.rejects(jira.pushIssue("owner", q.id, row.id));
  row = await issues.update("owner", {
    projectId: p.id,
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    title: "Local edit",
  });
  await jira.import("owner", p.id, "100");
  assert.equal((await issues.list("owner", p.id))[0]!.title, "Local edit");
  remote.fields.summary = "Remote edit";
  await assert.rejects(
    jira.import("owner", p.id, "100"),
    /Both Spectron and Jira changed/,
  );
  await assert.rejects(jira.pushIssue("owner", p.id, row.id), /Jira changed/);
  await jira.pushIssue("owner", p.id, row.id, true);
  assert.equal(remote.fields.summary, "Local edit");
  assert.deepEqual((remote.fields.labels as string[]).slice().sort(), ["frontend", "urgent"]);
  assert.equal(remote.fields.issuetype?.id, "10001");
  row = (await issues.list("owner", p.id))[0]!;
  await issues.update("owner", {
    projectId: p.id,
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    title: "Title only",
  });
  await jira.pushIssue("owner", p.id, row.id);
  assert.deepEqual(
    Object.keys(writes.at(-1)!),
    ["summary"],
    "Unchanged ADF description must not be rewritten",
  );
  row = (await issues.list("owner", p.id))[0]!;
  await issues.update("owner", {
    projectId: p.id,
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    stateId: mapping.statuses["3"],
  });
  await jira.pushIssue("owner", p.id, row.id);
  assert.equal(remote.fields.status!.id, "3");
  const comment = await comments.save("owner", {
    projectId: p.id,
    issueId: row.id,
    parentId: null,
    body: [{ type: "text", text: "Local comment" }],
    files: [],
  });
  const syncState = async () => (await comments.list("owner", { projectId: p.id, issueId: row.id, parentId: null })).comments.find(c => c.id === comment.id)!.jiraSync;
  assert.equal(await syncState(), "unsynced");
  await jira.pushComment("owner", p.id, comment.id);
  assert.equal(await syncState(), "synced");
  await jira.pushComment("owner", p.id, comment.id);
  assert.equal(commentCreates, 1);
  assert.equal(await syncState(), "synced");
  const localComment = (
    await pool.query("select * from issue_comments where id=$1", [comment.id])
  ).rows[0];
  await comments.save("owner", {
    projectId: p.id,
    issueId: row.id,
    id: comment.id,
    expectedUpdatedAt: new Date(localComment.updated_at).toISOString(),
    body: [{ type: "text", text: "Edited comment" }],
    files: [],
  });
  assert.equal(await syncState(), "unsynced");
  await jira.pushComment("owner", p.id, comment.id);
  assert.equal(commentCreates, 1);
  assert.equal(await syncState(), "synced");
  assert.equal(adfToText(remoteComments.at(-1)!.body), "Edited comment");
  const localNew = await issues.create("owner", {
    projectId: p.id,
    title: "Publish me",
    stateId: mapping.statuses["1"],
    priorityId: settings.priorities[0]!.id,
  });
  rejectCreate = true;
  await assert.rejects(jira.pushIssue("owner", p.id, localNew.id));
  assert.equal((await jira.pending("owner", p.id)).length, 0);
  rejectCreate = false;
  loseCreate = true;
  await assert.rejects(jira.pushIssue("owner", p.id, localNew.id));
  const createsAfter = creates;
  await assert.rejects(
    jira.pushIssue("owner", p.id, localNew.id),
    /unknown outcome/,
  );
  assert.equal(creates, createsAfter);
  assert.equal((await jira.pending("owner", p.id)).length, 1);
  await assert.rejects(
    jira.reconcile("owner", p.id, "issue", localNew.id, "100"),
    /already linked/,
  );
  assert.equal(
    (await issues.list("owner", p.id)).find((r) => r.id === localNew.id)!
      .externalId,
    null,
  );
  loseCreate = false;
  await jira.reconcile(
    "owner",
    p.id,
    "issue",
    localNew.id,
    String(1000 + creates),
  );
  await jira.pushIssue("owner", p.id, localNew.id);
  assert.equal(creates, createsAfter);
  assert.equal((await jira.pending("owner", p.id)).length, 0);
  let timed = (await issues.list("owner", p.id)).find(
    (i) => i.externalId === "100",
  )!;
  await assert.rejects(
    issues.update("owner", {
      projectId: p.id,
      id: timed.id,
      expectedUpdatedAt: timed.updatedAt,
      estimateTime: -1,
    }),
  );
  await assert.rejects(
    issues.update("owner", {
      projectId: p.id,
      id: timed.id,
      expectedUpdatedAt: timed.updatedAt,
      finishAt: "2026-01-01T00:00:00Z",
    }),
    /Finish at/,
  );
  timed = await issues.update("owner", {
    projectId: p.id,
    id: timed.id,
    expectedUpdatedAt: timed.updatedAt,
    estimateTime: 5400,
    startAt: "2026-09-02T09:30:00Z",
    finishAt: "2026-09-12T00:00:00Z",
  });
  assert.equal(timed.estimateTime, 5400);
  assert.equal(timed.startAt, "2026-09-02T09:30:00.000Z");
  const timingHistory = await issues.history("owner", p.id, timed.id, 0);
  assert.ok(timingHistory.some((h) => h.changes.estimateTime?.after === 5400));
  await jira.pushIssue("owner", p.id, timed.id);
  assert.deepEqual(writes.at(-1)!.timetracking, { originalEstimate: "90m" });
  assert.equal(writes.at(-1)!.duedate, "2026-09-12");
  assert.equal(writes.at(-1)!.customfield_5, "2026-09-02T09:30:00.000Z");
  timed = (await issues.list("owner", p.id)).find((i) => i.id === timed.id)!;
  await issues.update("owner", {
    projectId: p.id,
    id: timed.id,
    expectedUpdatedAt: timed.updatedAt,
    estimateTime: null,
    startAt: null,
    finishAt: null,
  });
  await jira.pushIssue("owner", p.id, timed.id);
  assert.deepEqual(writes.at(-1)!.timetracking, { originalEstimate: null });
  assert.equal(writes.at(-1)!.duedate, null);
  assert.equal(writes.at(-1)!.customfield_5, null);
  await assert.rejects(
    jira.mappings("owner", p.id, {
      ...mapping,
      fields: { ...mapping.fields, bad: "issue:unknown" },
    }),
  );
  await assert.rejects(
    jira.mappings("owner", p.id, {
      ...mapping,
      fields: { ...mapping.fields, second: "issue:finishAt" },
    }),
    /one-to-one/,
  );
  remote.fields.summary = "Only this title changed";
  await jira.import("owner", p.id, "100");
  const { rows: deltaRows } = await pool.query(
    "SELECT changes FROM issue_history WHERE issue_id = $1 AND entity_type = 'issue' ORDER BY created_at DESC, id DESC LIMIT 1",
    [timed.id],
  );
  assert.deepEqual(deltaRows[0].changes, {
    title: { before: timed.title, after: "Only this title changed" },
  });
  const run = await jira.startImport("owner", p.id);
  await assert.rejects(jira.stopImport("member", p.id, run.runId));
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  hangNext = true;
  const cancelled = assert.rejects(
    jira.import("owner", p.id, "100", false, run.runId),
    /Import stopped/,
  );
  await started;
  await jira.stopImport("owner", p.id, run.runId);
  await cancelled;
  await assert.rejects(
    jira.search("owner", p.id, undefined, run.runId),
    /Import stopped/,
  );
  await assert.rejects(
    jira.import("owner", p.id, "100", false, run.runId),
    /Import stopped/,
  );
  await jira.finishImport("owner", p.id, run.runId);
  const resumed = await jira.startImport("owner", p.id);
  await jira.stopImport("owner", p.id, run.runId);
  await jira.prepare("owner", p.id, resumed.runId);
  await jira.import("owner", p.id, "100", false, resumed.runId);
  await jira.finishImport("owner", p.id, resumed.runId);
  assert.equal((await jira.get("owner", p.id))!.importRunId, null);
  await assert.rejects(jira.schedule("member", p.id, 15));
  await assert.rejects(jira.schedule("owner", p.id, 7));
  const scheduled = await jira.schedule("owner", p.id, 15);
  assert.equal(scheduled.scheduleMinutes, 15);
  assert.ok(scheduled.nextImportAt);
  const makeScheduleDue = () =>
    pool.query(
      "UPDATE jira_integrations SET next_import_at = now() - interval '1 minute' WHERE id = $1",
      [scheduled.id],
    );
  await makeScheduleDue();
  let prepared = 0;
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wrapped = {
    ...jira,
    prepare: async (...args: Parameters<typeof jira.prepare>) => {
      prepared++;
      entered();
      await barrier;
      return jira.prepare(...args);
    },
  };
  const worker = createJiraScheduler(db, wrapped);
  const active = worker.tick();
  await claimed;
  await createJiraScheduler(db, wrapped).tick();
  await assert.rejects(jira.startImport("owner", p.id), /current Jira request/);
  assert.equal(prepared, 1);
  release();
  await active;
  let status = (await jira.get("owner", p.id))!;
  assert.equal(status.importRunId, null);
  assert.match(status.lastScheduleResult!, /1 imported, 0 failed/);
  const watermark = async () => {
    const { rows } = await pool.query(
      "SELECT scheduled_import_watermark FROM jira_integrations WHERE id = $1",
      [scheduled.id],
    );
    return rows[0].scheduled_import_watermark?.toISOString() as
      | string
      | undefined;
  };
  const firstWatermark = await watermark();
  assert.equal(
    firstWatermark,
    status.lastScheduledAt,
    "checkpoint uses run start, not completion",
  );
  assert.equal(
    searchQueries.at(-1),
    'project = "TEAM" ORDER BY updated ASC',
    "first scheduled import is full",
  );
  await worker.tick();
  assert.equal(prepared, 1, "future schedule is not run early");

  // A crashed process leaves a claim that another process can recover.
  await makeScheduleDue();
  await pool.query(
    "UPDATE jira_integrations SET import_run_id = 'abandoned-schedule', schedule_lease_until = now() - interval '1 minute' WHERE id = $1",
    [scheduled.id],
  );
  paginateSearch = true;
  await worker.tick();
  paginateSearch = false;
  assert.equal(prepared, 2);
  const incrementalJql = `project = "TEAM" AND updated >= ${Date.parse(firstWatermark!) - 5 * 60_000} ORDER BY updated ASC`;
  assert.deepEqual(
    searchQueries.slice(-2),
    [incrementalJql, incrementalJql],
    "every page keeps the same lower bound",
  );
  const successfulWatermark = await watermark();

  await makeScheduleDue();
  await createJiraScheduler(db, {
    ...jira,
    import: async () => {
      throw new Error("Test issue conflict");
    },
  }).tick();
  assert.equal(
    await watermark(),
    successfulWatermark,
    "an issue failure must not advance the checkpoint",
  );
  assert.match(
    (await jira.get("owner", p.id))!.lastScheduleResult!,
    /1 failed/,
  );

  await makeScheduleDue();
  await createJiraScheduler(db, {
    ...jira,
    search: async () => {
      throw new Error("Test search failure");
    },
  }).tick();
  assert.equal(
    await watermark(),
    successfulWatermark,
    "a search failure must not advance the checkpoint",
  );

  // Stop remains effective for jobs started by the scheduler.
  await makeScheduleDue();
  await createJiraScheduler(db, {
    ...jira,
    prepare: async (userId, projectId, runId) => {
      await jira.stopImport(userId, projectId, runId!);
      return jira.prepare(userId, projectId, runId);
    },
  }).tick();
  status = (await jira.get("owner", p.id))!;
  assert.equal(status.importRunId, null);
  assert.match(status.lastScheduleResult!, /Import stopped/);
  assert.equal(
    await watermark(),
    successfulWatermark,
    "cancellation preserves the checkpoint",
  );

  // Even a cancellation arriving with the final empty page cannot advance it.
  await makeScheduleDue();
  await createJiraScheduler(db, {
    ...jira,
    search: async (userId, projectId, _token, runId) => {
      await jira.stopImport(userId, projectId, runId!);
      return { issues: [], nextPageToken: null };
    },
  }).tick();
  assert.equal(await watermark(), successfulWatermark);

  await makeScheduleDue();
  await createJiraScheduler(db, {
    ...jira,
    search: async () => ({ issues: [], nextPageToken: null }),
  }).tick();
  assert.equal(
    await watermark(),
    (await jira.get("owner", p.id))!.lastScheduledAt,
    "empty successful runs also advance the checkpoint",
  );
  const beforeManual = await watermark();
  await jira.search("owner", p.id);
  assert.equal(
    searchQueries.at(-1),
    'project = "TEAM" ORDER BY updated ASC',
    "manual full import ignores the scheduled checkpoint",
  );
  assert.equal(await watermark(), beforeManual);
  const disabled = await jira.schedule("owner", p.id, null);
  assert.equal(disabled.nextImportAt, null);
  await worker.tick();
  assert.equal(prepared, 2);
  await projects.archive("owner", p.id);
  await assert.rejects(
    jira.import("owner", p.id, imported.id),
    /Archived projects/,
  );
});

test("Status name matching preserves choices and avoids ambiguous or deleted targets", async () => {
  const { matchJiraStatuses } = await import("@spectron/shared");
  const local = [
    { id: "todo", name: "Todo" },
    { id: "progress", name: "In progress" },
    { id: "done", name: "Done" },
    { id: "old", name: "Archived", deletedAt: "2026-01-01" },
    { id: "duplicate1", name: "Review" },
    { id: "duplicate2", name: " review " },
    { id: "blocked", name: "Blocked" },
  ];
  const existing = { custom: "done" };
  const result = matchJiraStatuses(
    [
      { id: "1", name: " todo " },
      { id: "2", name: "IN PROGRESS" },
      { id: "2", name: "IN PROGRESS" }, // same Jira status in multiple issue types
      { id: "3", name: "Done" },
      { id: "custom", name: "Todo" },
      { id: "4", name: "Archived" },
      { id: "5", name: "Review" },
      { id: "6", name: "Blocked" },
      { id: "7", name: "blocked" },
      { id: "8", name: "Unknown" },
    ],
    local,
    existing,
  );
  // Two distinct remote Todo names are ambiguous; explicit custom -> done stays intact.
  assert.deepEqual(result, { custom: "done", "2": "progress" });
  assert.deepEqual(
    matchJiraStatuses([{ id: "1", name: " todo " }], local, {}),
    { "1": "todo" },
  );
  assert.deepEqual(existing, { custom: "done" });
});

test("Built-in Jira field conversions retain units, dates and explicit clears", async () => {
  const { importBuiltIn, exportBuiltIn } = await import(
    "../../backend/src/integrations/jira-fields"
  );
  assert.equal(
    importBuiltIn("issue:estimateTime", { originalEstimateSeconds: 3600 }),
    3600,
  );
  assert.equal(
    importBuiltIn("issue:finishAt", "2026-09-01"),
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(
    importBuiltIn("issue:startAt", "2026-09-01T10:00:00+0300"),
    "2026-09-01T07:00:00.000Z",
  );
  assert.equal(importBuiltIn("issue:estimateTime", null), null);
  assert.throws(() => importBuiltIn("issue:estimateTime", "2h"));
  assert.throws(() => importBuiltIn("issue:finishAt", "2026-02-30"));
  assert.throws(() =>
    exportBuiltIn("timeoriginalestimate", "issue:estimateTime", 61),
  );
  assert.deepEqual(
    exportBuiltIn("customfield_1", "issue:startAt", "2026-09-01T10:00:00Z", {
      id: "customfield_1",
      name: "Date",
      schema: { type: "date" },
    }),
    { customfield_1: "2026-09-01" },
  );
});

test("Issue history stores field deltas and reads legacy snapshots", async () => {
  const { historyChanges, normalizeHistoryChanges } = await import(
    "../../backend/src/history-changes"
  );
  const before = {
    title: "Old",
    estimateTime: 60,
    fieldValues: { a: "keep", b: 1, removed: "value" },
  };
  const after = {
    title: "New",
    estimateTime: 60,
    fieldValues: { b: 2, a: "keep" },
  };
  const expected = {
    title: { before: "Old", after: "New" },
    "fieldValues.b": { before: 1, after: 2 },
    "fieldValues.removed": { before: "value", after: null },
  };
  assert.deepEqual(historyChanges(before, after), expected);
  assert.deepEqual(historyChanges(before, { estimateTime: 60 }), {});
  assert.deepEqual(
    historyChanges(before, {
      fieldValues: { removed: "value", b: 1, a: "keep" },
    }),
    {},
  );
  assert.deepEqual(
    normalizeHistoryChanges({ jira: { before, after } }),
    expected,
  );
  assert.deepEqual(
    historyChanges(
      { durationSeconds: 60, description: "same" },
      { durationSeconds: 120, description: "same" },
    ),
    { durationSeconds: { before: 60, after: 120 } },
  );
});
