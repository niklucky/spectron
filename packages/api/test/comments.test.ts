import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import {
  createId,
  commentText,
  commentDraftText,
  commentBodyFromText,
  moveMentionRanges,
  type CommentBody,
  type CommentPage,
  type IssueSummary,
  type ProjectSummary,
  type CommentSummary,
} from "@spectron/shared";
import { createAPI } from "../src/index";

test("Threaded comments, mentions, files and history", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_comments_${randomUUID().replaceAll("-", "")}`;
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

  const first = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: p.id, title: "Discussion" },
      true,
    ),
  );
  const second = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: p.id, title: "Other issue" },
      true,
    ),
  );
  const foreign = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: q.id, title: "Other project" },
      true,
    ),
  );
  const scope = { projectId: p.id, issueId: first.id };
  const body = (text: string): CommentBody => [{ type: "text", text }];
  const create = async (
    text: string,
    parentId: string | null = null,
    actor = owner,
    extra: Record<string, unknown> = {},
  ) =>
    data<{ id: string }>(
      await call(
        "comments.create",
        actor,
        { ...scope, parentId, body: body(text), files: [], ...extra },
        true,
      ),
    );
  const list = async (parentId: string | null = null) =>
    data<CommentPage>(
      await call("comments.list", owner, { ...scope, parentId }),
    );
  const get = async (id: string, parentId: string | null = null) =>
    (await list(parentId)).comments.find((c) => c.id === id)!;
  const update = (
    row: CommentSummary,
    extra: Record<string, unknown>,
    actor = owner,
  ) =>
    call(
      "comments.update",
      actor,
      {
        ...scope,
        id: row.id,
        expectedUpdatedAt: row.updatedAt,
        body: row.body,
        files: row.attachments.map((f) => ({
          projectId: f.projectId,
          projectFileId: f.projectFileId,
        })),
        ...extra,
      },
      true,
    );
  let root: CommentSummary, child: CommentSummary;
  const foreignParent = await create("Foreign", null, owner, {
    projectId: q.id,
    issueId: foreign.id,
  });
  await t.test(
    "validates auth, origin, content and immutable same-issue parenting",
    async () => {
      assert.equal(
        (await call("comments.list", null, { ...scope, parentId: null }))
          .status,
        401,
      );
      assert.equal(
        (await call("comments.list", outsider, { ...scope, parentId: null }))
          .status,
        404,
      );
      assert.equal(
        (
          await call(
            "comments.create",
            outsider,
            { ...scope, parentId: null, body: body("No"), files: [] },
            true,
          )
        ).status,
        404,
      );
      for (const extra of [
        { body: body(" ") },
        { authorId: outsider.id },
        { parentId: foreignParent.id },
        { issueId: foreign.id },
        { body: [{ type: "html", text: "<script/>" }] },
      ])
        assert.notEqual(
          (
            await call(
              "comments.create",
              owner,
              {
                ...scope,
                parentId: null,
                body: body("Hello"),
                files: [],
                ...extra,
              },
              true,
            )
          ).status,
          200,
        );
      assert.equal(
        (
          await call(
            "comments.create",
            owner,
            { ...scope, parentId: null, body: body("No"), files: [] },
            true,
            "https://evil.test",
          )
        ).status,
        403,
      );
      root = await get((await create("Start here")).id);
      child = await get((await create("Reply", root.id, member)).id, root.id);
      assert.equal((await get(root.id)).replyCount, 1);
      assert.equal((await list()).comments.length, 1);
      assert.equal(child.authorId, member.id);
      assert.equal(
        (await update(child, { body: body("Owner cannot rewrite") }, owner))
          .status,
        404,
      );
      assert.equal((await update(root, { parentId: child.id })).status, 400);
      await assert.rejects(
        pool.query("UPDATE issue_comments SET parent_id=$1 WHERE id=$2", [
          foreignParent.id,
          root.id,
        ]),
        { code: "23503" },
      );
      await assert.rejects(
        pool.query("UPDATE issue_comments SET issue_id=$1 WHERE id=$2", [
          second.id,
          child.id,
        ]),
        { code: "23503" },
      );
    },
  );
  await t.test(
    "derives mention IDs, canonicalizes labels and retains removed relations",
    async () => {
      const mention = {
        type: "mention",
        userId: member.id,
        label: "Spoofed name",
      };
      await data(
        await update(root, {
          body: [mention, { type: "text", text: " and " }, mention],
        }),
      );
      root = await get(root.id);
      assert.equal(commentText(root.body), "@member and @member");
      let records = (
        await pool.query("SELECT * FROM comment_mentions WHERE comment_id=$1", [
          root.id,
        ])
      ).rows;
      assert.equal(records.length, 1);
      assert.equal(records[0].user_id, member.id);
      assert.equal(
        (await update(root, { body: [{ ...mention, userId: outsider.id }] }))
          .status,
        400,
      );
      await data(await update(root, { body: body("Mention removed") }));
      root = await get(root.id);
      records = (
        await pool.query("SELECT * FROM comment_mentions WHERE comment_id=$1", [
          root.id,
        ])
      ).rows;
      assert.ok(records[0].deleted_at);
      await data(await update(root, { body: [mention] }));
      root = await get(root.id);
      const restored = (
        await pool.query("SELECT * FROM comment_mentions WHERE comment_id=$1", [
          root.id,
        ])
      ).rows;
      assert.equal(restored.length, 1);
      assert.equal(restored[0].id, records[0].id);
      assert.equal(restored[0].deleted_at, null);
      assert.equal(
        (
          await update(
            { ...root, updatedAt: first.createdAt },
            { body: body("Stale") },
          )
        ).status,
        409,
      );
    },
  );
  const f = createId(),
    source = createId();
  await t.test(
    "saves attachment-only comments and reuses files across accessible projects atomically",
    async () => {
      await pool.query(
        "INSERT INTO files(id,uploaded_by,storage_key,filename,status,size_bytes) VALUES($1,$2,$3,'shared.txt','ready',10)",
        [f, owner.id, `2026-09-06/${f}.bin`],
      );
      await pool.query(
        "INSERT INTO project_files(id,project_id,file_id) VALUES($1,$2,$3)",
        [source, q.id, f],
      );
      const fileRef = { projectId: q.id, projectFileId: source };
      assert.equal(
        (
          await call(
            "comments.create",
            member,
            { ...scope, parentId: null, body: [], files: [fileRef] },
            true,
          )
        ).status,
        404,
      );
      const created = await create("", null, owner, {
        body: [],
        files: [fileRef, fileRef],
      });
      const row = await get(created.id);
      assert.equal(row.attachments.length, 1);
      assert.equal(row.attachments[0]!.projectId, p.id);
      assert.equal(row.attachments[0]!.id, f);
      await data(
        await update(row, { body: body("Removed attachment"), files: [] }),
      );
      const links = (
        await pool.query(
          "SELECT * FROM comment_attachments WHERE comment_id=$1",
          [row.id],
        )
      ).rows;
      assert.equal(links.length, 1);
      assert.ok(links[0].deleted_at);
      const edited = await get(row.id);
      await data(
        await update(edited, {
          files: [
            {
              projectId: p.id,
              projectFileId: row.attachments[0]!.projectFileId,
            },
          ],
        }),
      );
      const restored = (
        await pool.query(
          "SELECT * FROM comment_attachments WHERE comment_id=$1",
          [row.id],
        )
      ).rows;
      assert.equal(restored.length, 1);
      assert.equal(restored[0].id, links[0].id);
      assert.equal(restored[0].deleted_at, null);
      await assert.rejects(
        pool.query(
          "UPDATE comment_attachments SET project_file_id=$1 WHERE id=$2",
          [source, restored[0].id],
        ),
        { code: "23503" },
      );
      assert.equal(
        (await pool.query("SELECT deleted_at FROM files WHERE id=$1", [f]))
          .rows[0].deleted_at,
        null,
      );
    },
  );
  await t.test(
    "history failure rolls back body, mentions, attachment removal and cross-project sharing",
    async () => {
      const before = await get(root.id),
        count = (await pool.query("SELECT count(*) FROM issue_comments"))
          .rows[0].count;
      await pool.query(
        "CREATE FUNCTION reject_comment_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test history failure'; END $$; CREATE TRIGGER reject_comment_history BEFORE INSERT ON issue_history FOR EACH ROW EXECUTE FUNCTION reject_comment_history();",
      );
      assert.equal(
        (await update(before, { body: body("Rolled back") })).status,
        500,
      );
      const newFile = createId(),
        newSource = createId();
      await pool.query(
        "INSERT INTO files(id,uploaded_by,storage_key,filename,status) VALUES($1,$2,$3,'atomic.txt','ready')",
        [newFile, owner.id, `2026-09-06/${newFile}.bin`],
      );
      await pool.query(
        "INSERT INTO project_files(id,project_id,file_id) VALUES($1,$2,$3)",
        [newSource, q.id, newFile],
      );
      assert.equal(
        (
          await call(
            "comments.create",
            owner,
            {
              ...scope,
              parentId: root.id,
              body: [{ type: "mention", userId: member.id, label: "member" }],
              files: [{ projectId: q.id, projectFileId: newSource }],
            },
            true,
          )
        ).status,
        500,
      );
      assert.equal(
        (await pool.query("SELECT count(*) FROM issue_comments")).rows[0].count,
        count,
      );
      assert.deepEqual((await get(root.id)).body, before.body);
      assert.equal(
        (
          await pool.query(
            "SELECT * FROM project_files WHERE project_id=$1 AND file_id=$2",
            [p.id, newFile],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT deleted_at FROM comment_mentions WHERE comment_id=$1",
            [root.id],
          )
        ).rows[0].deleted_at,
        null,
      );
      await pool.query(
        "DROP TRIGGER reject_comment_history ON issue_history; DROP FUNCTION reject_comment_history()",
      );
    },
  );
  await t.test(
    "soft deletion preserves a reply tree, original content and actor history",
    async () => {
      assert.equal(
        (
          await call(
            "comments.delete",
            member,
            { ...scope, id: root.id, expectedUpdatedAt: root.updatedAt },
            true,
          )
        ).status,
        404,
      );
      await data(
        await call(
          "comments.delete",
          owner,
          { ...scope, id: root.id, expectedUpdatedAt: root.updatedAt },
          true,
        ),
      );
      const deleted = await get(root.id);
      assert.ok(deleted.deletedAt);
      assert.deepEqual(deleted.body, []);
      assert.equal(deleted.replyCount, 1);
      assert.equal((await get(child.id, root.id)).body[0]!.type, "text");
      assert.equal(
        (
          await pool.query("SELECT body FROM issue_comments WHERE id=$1", [
            root.id,
          ])
        ).rows[0].body[0].type,
        "mention",
      );
      const another = await create("Reply to deleted parent", root.id);
      assert.ok(await get(another.id, root.id));
      await data(
        await call(
          "comments.delete",
          owner,
          { ...scope, id: child.id, expectedUpdatedAt: child.updatedAt },
          true,
        ),
      );
      const history = (
        await pool.query(
          "SELECT * FROM issue_history WHERE entity_id=$1 AND action='deleted'",
          [child.id],
        )
      ).rows[0];
      assert.equal(history.actor_user_id, owner.id);
      assert.equal(
        (
          await pool.query("SELECT author_id FROM issue_comments WHERE id=$1", [
            child.id,
          ])
        ).rows[0].author_id,
        member.id,
      );
      assert.equal((await update(deleted, { body: body("No") })).status, 404);
    },
  );
  await t.test(
    "cursor pagination isolates siblings and handles tied timestamps without duplicates",
    async () => {
      const parent = await create("Pagination parent");
      const stamp = new Date("2026-09-06T12:00:00.000Z");
      for (let i = 0; i < 24; i++)
        await pool.query(
          "INSERT INTO issue_comments(id,project_id,issue_id,parent_id,author_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
          [
            createId(),
            p.id,
            first.id,
            parent.id,
            owner.id,
            JSON.stringify(body(`Reply ${i}`)),
            stamp,
          ],
        );
      const firstPage = await list(parent.id);
      assert.equal(firstPage.comments.length, 20);
      assert.ok(firstPage.nextCursor);
      const next = await data<CommentPage>(
        await call("comments.list", owner, {
          ...scope,
          parentId: parent.id,
          cursor: firstPage.nextCursor,
        }),
      );
      assert.equal(next.comments.length, 4);
      assert.equal(next.nextCursor, null);
      assert.equal(
        new Set([...firstPage.comments, ...next.comments].map((c) => c.id))
          .size,
        24,
      );
    },
  );
  await t.test(
    "deleted issues and archived projects remain readable but reject comment writes",
    async () => {
      await data(
        await call(
          "issues.setDeleted",
          owner,
          {
            projectId: p.id,
            id: first.id,
            expectedUpdatedAt: first.updatedAt,
            deleted: true,
          },
          true,
        ),
      );
      assert.equal(
        (await call("comments.list", member, { ...scope, parentId: null }))
          .status,
        200,
      );
      assert.equal(
        (
          await call(
            "comments.create",
            owner,
            { ...scope, parentId: null, body: body("No"), files: [] },
            true,
          )
        ).status,
        400,
      );
      await data(await call("projects.archive", owner, { id: q.id }, true));
      assert.equal(
        (
          await call(
            "comments.create",
            owner,
            {
              projectId: q.id,
              issueId: foreign.id,
              parentId: null,
              body: body("No"),
              files: [],
            },
            true,
          )
        ).status,
        400,
      );
      const page = await data<CommentPage>(
        await call("comments.list", owner, {
          projectId: q.id,
          issueId: foreign.id,
          parentId: null,
        }),
      );
      assert.equal(page.comments[0]!.canEdit, false);
    },
  );
});

test("mention editor preserves IDs through surrounding edits and drops edited mentions", () => {
  const body: CommentBody = [
    { type: "text", text: "Hello " },
    { type: "mention", userId: "same-name-id", label: "Jane Doe" },
    { type: "text", text: "!" },
  ];
  const draft = commentDraftText(body);
  assert.deepEqual(commentBodyFromText(draft.text, draft.mentions), body);
  const text = "Hi! " + draft.text,
    ranges = moveMentionRanges(draft.text, text, draft.mentions);
  assert.equal(ranges[0]!.start, draft.mentions[0]!.start + 4);
  assert.equal(commentBodyFromText(text, ranges)[1]!.type, "mention");
  assert.equal(
    moveMentionRanges(
      draft.text,
      draft.text.replace("Jane", "Janet"),
      draft.mentions,
    ).length,
    0,
  );
  assert.equal(moveMentionRanges(draft.text, "", draft.mentions).length, 0);
  assert.equal(commentBodyFromText("@Jane Doe", [])[0]!.type, "text");
});
