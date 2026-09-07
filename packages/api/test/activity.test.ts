import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import {
  createId,
  type IssueActivityPage,
  type ProjectSummary,
  type IssueSummary,
  type CommentPage,
} from "@spectron/shared";
import { createAPI } from "../src/index";
test("Unified issue activity preserves access, history and pagination", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_activity_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
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
  const origin = "http://localhost:5173";
  const auth = createAuth(db, {
    appURL: origin,
    secret: "issue-integration-test-secret-with-32-characters",
    sendResetEmail: async () => {},
  });
  const api = createAPI(auth, { db, appURL: origin });
  const register = async (email: string) => {
    const r = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: email.split("@")[0],
        email,
        password: "a long issue test password",
      }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      cookie: r.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  };
  const owner = await register("owner@example.test"),
    member = await register("member@example.test"),
    outsider = await register("outsider@example.test");
  const call = (
    procedure: string,
    actor: typeof owner | null,
    input?: unknown,
    mutation = false,
    requestOrigin = origin,
  ) =>
    api.request(
      `${origin}/api/trpc/${procedure}${mutation ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: {
          origin: requestOrigin,
          cookie: actor?.cookie ?? "",
          "content-type": "application/json",
        },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
  const data = async <T>(r: Response): Promise<T> => {
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as { result: { data: T } }).result.data;
  };
  const p = await data<ProjectSummary>(
    await call("projects.create", owner, { name: "Spectron", key: "SP" }, true),
  );
  const q = await data<ProjectSummary>(
    await call("projects.create", owner, { name: "Other", key: "MKS" }, true),
  );
  await pool.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')",
    [p.id, member.id],
  );

  const issue = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: p.id, title: "Chat activity" },
      true,
    ),
  );
  const other = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: q.id, title: "Other" },
      true,
    ),
  );
  const scope = { projectId: p.id, issueId: issue.id };
  const activity = (extra: Record<string, unknown> = {}) =>
    call("issues.activity", owner, { ...scope, ...extra });
  const f = createId(),
    pf = createId();
  await pool.query(
    "INSERT INTO files(id,uploaded_by,storage_key,filename,status) VALUES($1,$2,$3,'chat.txt','ready')",
    [f, owner.id, `2026-09-07/${f}.bin`],
  );
  await pool.query(
    "INSERT INTO project_files(id,project_id,file_id) VALUES($1,$2,$3)",
    [pf, p.id, f],
  );
  const root = await data<{ id: string }>(
    await call(
      "comments.create",
      member,
      {
        ...scope,
        parentId: null,
        body: [{ type: "text", text: "Original comment" }],
        files: [{ projectId: p.id, projectFileId: pf }],
      },
      true,
    ),
  );
  const reply = await data<{ id: string }>(
    await call(
      "comments.create",
      owner,
      {
        ...scope,
        parentId: root.id,
        body: [{ type: "text", text: "Reply" }],
        files: [],
      },
      true,
    ),
  );
  await data(
    await call(
      "files.link",
      owner,
      { ...scope, sourceProjectId: p.id, projectFileId: pf },
      true,
    ),
  );
  await data(
    await call(
      "worklogs.create",
      owner,
      {
        ...scope,
        workerUserId: member.id,
        startedAt: "2026-09-07T10:00:00Z",
        durationSeconds: 1800,
        description: "Work",
      },
      true,
    ),
  );
  await t.test(
    "one chronological feed contains comments, files, issue and worklog history",
    async () => {
      const page = await data<IssueActivityPage>(await activity());
      assert.equal(page.events.length, 5);
      assert.equal(page.events[0]!.entry.entityType, "issue");
      assert.equal(page.events.at(-1)!.entry.entityType, "worklog");
      const message = page.events.find((e) => e.comment?.id === root.id)!;
      assert.equal(message.comment!.authorName, "member");
      assert.equal(message.comment!.canEdit, false);
      assert.equal(message.comment!.canDelete, true);
      assert.equal(message.comment!.attachments[0]!.id, f);
      const child = page.events.find((e) => e.comment?.id === reply.id)!;
      assert.equal(child.replyTo!.text, "Original comment");
      assert.equal(child.replyTo!.authorName, "member");
      assert.equal(
        page.events.find((e) => e.entry.entityType === "attachment")!.files[0]!
          .projectFileId,
        pf,
      );
      assert.equal((await call("issues.activity", null, scope)).status, 401);
      assert.equal(
        (await call("issues.activity", outsider, scope)).status,
        404,
      );
      assert.equal((await activity({ projectId: q.id })).status, 404);
      const foreign = await data<IssueActivityPage>(
        await activity({ projectId: q.id, issueId: other.id }),
      );
      assert.equal(
        (await activity({ cursor: foreign.events[0]!.entry.id })).status,
        404,
      );
    },
  );
  await t.test(
    "deleted comments become placeholders, with audit and reply context retained",
    async () => {
      const page = await data<CommentPage>(
        await call("comments.list", member, { ...scope, parentId: null }),
      );
      const row = page.comments[0]!;
      await data(
        await call(
          "comments.delete",
          member,
          { ...scope, id: row.id, expectedUpdatedAt: row.updatedAt },
          true,
        ),
      );
      const activityPage = await data<IssueActivityPage>(await activity());
      assert.equal(
        activityPage.events.find((e) => e.entry.action === "deleted")!.comment,
        null,
      );
      assert.equal(activityPage.events.filter((e) => e.comment).length, 2);
      const removed = activityPage.events.find(
        (e) => e.comment?.id === root.id,
      )!;
      assert.deepEqual(removed.comment!.body, []);
      assert.deepEqual(removed.comment!.attachments, []);
      assert.ok(removed.comment!.deletedAt);
      assert.equal(
        activityPage.events.find((e) => e.comment?.id === reply.id)!.replyTo!
          .text,
        "Comment deleted",
      );
      assert.equal(
        activityPage.events.find((e) => e.entry.action === "deleted")!.entry
          .changes.body!.before instanceof Array,
        true,
      );
    },
  );
  await t.test(
    "cursor uses exact stored timestamps and prevents duplicate/missing events",
    async () => {
      const added: string[] = [];
      for (let n = 0; n < 56; n++) {
        const id = createId();
        added.push(id);
        await pool.query(
          "INSERT INTO issue_history(id,issue_id,entity_type,actor_user_id,action,changes,created_at) VALUES($1,$2,'issue',$3,'updated','{}', '2027-01-01 00:00:00.123456+00')",
          [id, issue.id, owner.id],
        );
      }
      let page = await data<IssueActivityPage>(await activity());
      assert.equal(page.events.length, 50);
      assert.ok(page.nextCursor);
      const firstIds = page.events.map((e) => e.entry.id);
      // New activity arriving between page loads must not shift the older-page boundary.
      await pool.query(
        "INSERT INTO issue_history(id,issue_id,entity_type,actor_user_id,action,changes,created_at) VALUES($1,$2,'issue',$3,'updated','{}','2028-01-01')",
        [createId(), issue.id, owner.id],
      );
      page = await data<IssueActivityPage>(
        await activity({ cursor: page.nextCursor }),
      );
      assert.equal(page.events.length, 12);
      assert.equal(page.nextCursor, null);
      const combined = [...firstIds, ...page.events.map((e) => e.entry.id)];
      assert.equal(new Set(combined).size, 62);
      for (const id of added) assert.ok(combined.includes(id));
    },
  );
  await t.test(
    "issue list previews use latest activity and preserve project access",
    async () => {
      const row = await data<IssueSummary>(
        await call(
          "issues.create",
          owner,
          { projectId: q.id, title: "Preview coverage" },
          true,
        ),
      );
      async function callList() {
        return call("issues.list", owner, { projectId: q.id });
      }
      const latest = async () =>
        (await data<IssueSummary[]>(await callList())).find(
          (i) => i.id === row.id,
        )!.lastActivity!;
      assert.equal((await latest()).preview, "Created issue");
      const add = async (
        entityType: string,
        action: string,
        changes: unknown,
        date: string,
      ) => {
        await pool.query(
          "INSERT INTO issue_history(id,issue_id,entity_type,actor_user_id,action,changes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            createId(),
            row.id,
            entityType,
            owner.id,
            action,
            JSON.stringify(changes),
            date,
          ],
        );
      };
      await add(
        "comment",
        "created",
        {
          body: {
            before: null,
            after: [{ type: "text", text: "Latest message" }],
          },
        },
        "2030-01-01T12:00:00Z",
      );
      assert.equal((await latest()).preview, "Latest message");
      assert.equal((await latest()).actorName, "owner");
      await add(
        "attachment",
        "created",
        { attachment: { before: null, after: { filename: "demo.mp4" } } },
        "2030-01-02T12:00:00Z",
      );
      assert.equal((await latest()).preview, "Video: demo.mp4");
      await add(
        "comment",
        "deleted",
        {
          body: {
            before: [{ type: "text", text: "Removed content" }],
            after: null,
          },
        },
        "2030-01-03T12:00:00Z",
      );
      assert.equal((await latest()).preview, "Comment deleted");
      assert.equal(
        (await call("issues.list", member, { projectId: q.id })).status,
        404,
      );
      assert.equal(
        (await call("issues.list", outsider, { projectId: q.id })).status,
        404,
      );
      assert.ok(
        !(
          await data<IssueSummary[]>(
            await call("issues.list", owner, { projectId: p.id }),
          )
        ).some((i) => i.id === row.id),
      );
    },
  );
  await t.test(
    "revoked access hides the whole feed; deleted issue keeps history readable",
    async () => {
      await data(
        await call(
          "issues.setDeleted",
          owner,
          {
            projectId: p.id,
            id: issue.id,
            expectedUpdatedAt: issue.updatedAt,
            deleted: true,
          },
          true,
        ),
      );
      const page = await data<IssueActivityPage>(await activity());
      assert.ok(page.events.length);
      await pool.query(
        "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
        [p.id, member.id],
      );
      assert.equal((await call("issues.activity", member, scope)).status, 404);
    },
  );
});
