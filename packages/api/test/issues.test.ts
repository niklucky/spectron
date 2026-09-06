import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth, createIssueService } from "@spectron/backend";
import {
  applicationIdPattern,
  type IssueSummary,
  type IssueSettings,
  type ProjectSummary,
  type IssueHistoryEntry,
} from "@spectron/shared";
import { createAPI } from "../src/index";

test("Persistent issues, workflow configuration and audit integrity", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_issues_${randomUUID().replaceAll("-", "")}`;
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
  let settings = await data<IssueSettings>(
    await call("issues.settings", owner, { projectId: p.id }),
  );
  const otherSettings = await data<IssueSettings>(
    await call("issues.settings", owner, { projectId: q.id }),
  );
  let first: IssueSummary;
  const create = async (title: string, extra: Record<string, unknown> = {}) =>
    data<IssueSummary>(
      await call(
        "issues.create",
        owner,
        { projectId: p.id, title, ...extra },
        true,
      ),
    );
  const update = async (
    row: IssueSummary,
    fields: Record<string, unknown>,
    actor = owner,
  ) =>
    data<IssueSummary>(
      await call(
        "issues.update",
        actor,
        {
          projectId: row.projectId,
          id: row.id,
          expectedUpdatedAt: row.updatedAt,
          ...fields,
        },
        true,
      ),
    );
  const deletion = async (row: IssueSummary, deleted: boolean) =>
    data<IssueSummary>(
      await call(
        "issues.setDeleted",
        owner,
        {
          projectId: row.projectId,
          id: row.id,
          expectedUpdatedAt: row.updatedAt,
          deleted,
        },
        true,
      ),
    );

  await t.test(
    "defaults, authorization, validation and isolated concurrent numbering",
    async () => {
      assert.equal(settings.states.length, 5);
      assert.equal(settings.priorities.length, 4);
      assert.equal(settings.states.filter((s) => s.isDefault).length, 1);
      assert.equal(
        (await call("issues.list", null, { projectId: p.id })).status,
        401,
      );
      assert.equal(
        (await call("issues.list", outsider, { projectId: p.id })).status,
        404,
      );
      assert.equal(
        (
          await call(
            "issues.create",
            outsider,
            { projectId: p.id, title: "No" },
            true,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: " " },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: "No", authorId: outsider.id },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: "No" },
            true,
            "https://evil.test",
          )
        ).status,
        403,
      );
      const created = await Promise.all(
        Array.from({ length: 6 }, (_, i) => create(`Issue ${i}`)),
      );
      assert.deepEqual(
        created.map((i) => i.number).sort((a, b) => a - b),
        [1, 2, 3, 4, 5, 6],
      );
      first = created.find((i) => i.number === 1)!;
      assert.match(first.id, applicationIdPattern);
      assert.equal(first.key, "SP-1");
      assert.equal(first.assigneeId, null);
      assert.equal(first.authorId, owner.id);
      assert.equal(
        (await create("Other project", { projectId: q.id })).key,
        "MKS-1",
      );
      assert.equal(
        (
          await data<IssueSummary[]>(
            await call("issues.list", member, { projectId: p.id }),
          )
        ).length,
        6,
      );
    },
  );
  await t.test(
    "rejects foreign states, priorities, parents and assignees",
    async () => {
      const other = await create("Other", { projectId: q.id });
      for (const fields of [
        { stateId: otherSettings.states[0]!.id },
        { priorityId: otherSettings.priorities[0]!.id },
        { parentId: other.id },
        { assigneeId: outsider.id },
      ]) {
        assert.equal(
          (
            await call(
              "issues.update",
              owner,
              {
                projectId: p.id,
                id: first.id,
                expectedUpdatedAt: first.updatedAt,
                ...fields,
              },
              true,
            )
          ).status,
          400,
        );
      }
      await assert.rejects(
        pool.query("UPDATE issues SET state_id = $1 WHERE id = $2", [
          otherSettings.states[0]!.id,
          first.id,
        ]),
        { code: "23503" },
      );
      await assert.rejects(
        pool.query("UPDATE issues SET parent_id = $1 WHERE id = $2", [
          other.id,
          first.id,
        ]),
        { code: "23503" },
      );
    },
  );
  await t.test(
    "members can edit, history is atomic and stale writes conflict",
    async () => {
      const old = first;
      first = await update(
        first,
        {
          description: "Persistent description",
          assigneeId: member.id,
          priorityId: settings.priorities[0]!.id,
        },
        member,
      );
      assert.equal(
        (
          await call(
            "issues.update",
            owner,
            {
              projectId: p.id,
              id: first.id,
              expectedUpdatedAt: old.updatedAt,
              title: "Stale",
            },
            true,
          )
        ).status,
        409,
      );
      const entries = await data<IssueHistoryEntry[]>(
        await call("issues.history", member, { projectId: p.id, id: first.id }),
      );
      assert.equal(entries.length, 2);
      assert.equal(entries[1]!.actorUserId, member.id);
      assert.deepEqual(entries[1]!.changes.description, {
        before: "",
        after: "Persistent description",
      });
      const unchanged = await update(first, { title: first.title });
      assert.equal(unchanged.updatedAt, first.updatedAt);
      await assert.rejects(
        pool.query("DELETE FROM issue_history WHERE issue_id = $1", [first.id]),
        /append-only/,
      );
      await assert.rejects(
        pool.query(
          "UPDATE issue_history SET action = 'deleted' WHERE issue_id = $1",
          [first.id],
        ),
        /append-only/,
      );
      assert.equal(
        (
          await call("issues.history", outsider, {
            projectId: p.id,
            id: first.id,
          })
        ).status,
        404,
      );
      assert.equal(
        (await call("issues.history", owner, { projectId: q.id, id: first.id }))
          .status,
        404,
      );
      await pool.query(
        `CREATE FUNCTION reject_test_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER reject_test_history BEFORE INSERT ON issue_history FOR EACH ROW EXECUTE FUNCTION reject_test_history();`,
      );
      const countBefore = (
        await pool.query("SELECT issue_counter FROM projects WHERE id = $1", [
          p.id,
        ])
      ).rows[0].issue_counter;
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: "Rolled back" },
            true,
          )
        ).status,
        500,
      );
      assert.equal(
        (
          await call(
            "issues.update",
            owner,
            {
              projectId: p.id,
              id: first.id,
              expectedUpdatedAt: first.updatedAt,
              title: "Rolled back",
            },
            true,
          )
        ).status,
        500,
      );
      assert.equal(
        (
          await pool.query("SELECT issue_counter FROM projects WHERE id = $1", [
            p.id,
          ])
        ).rows[0].issue_counter,
        countBefore,
      );
      assert.equal(
        (await pool.query("SELECT title FROM issues WHERE id = $1", [first.id]))
          .rows[0].title,
        first.title,
      );
      await pool.query(
        "DROP TRIGGER reject_test_history ON issue_history; DROP FUNCTION reject_test_history()",
      );
    },
  );
  await t.test(
    "parent trees cannot cycle and deletion preserves children and numbering",
    async () => {
      let child = await create("Child", { parentId: first.id });
      assert.equal(
        (
          await call(
            "issues.update",
            owner,
            {
              projectId: p.id,
              id: first.id,
              expectedUpdatedAt: first.updatedAt,
              parentId: child.id,
            },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
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
          )
        ).status,
        400,
      );
      child = await deletion(child, true);
      assert.ok(child.deletedAt);
      first = await deletion(first, true);
      assert.equal(
        (
          await call(
            "issues.setDeleted",
            owner,
            {
              projectId: p.id,
              id: child.id,
              expectedUpdatedAt: child.updatedAt,
              deleted: false,
            },
            true,
          )
        ).status,
        400,
      );
      first = await deletion(first, false);
      child = await deletion(child, false);
      assert.equal(child.parentId, first.id);
      assert.equal((await create("After deletion")).number, child.number + 1);
      const a = await create("A"),
        b = await create("B");
      const cycle = await Promise.all([
        call(
          "issues.update",
          owner,
          {
            projectId: p.id,
            id: a.id,
            expectedUpdatedAt: a.updatedAt,
            parentId: b.id,
          },
          true,
        ),
        call(
          "issues.update",
          owner,
          {
            projectId: p.id,
            id: b.id,
            expectedUpdatedAt: b.updatedAt,
            parentId: a.id,
          },
          true,
        ),
      ]);
      assert.deepEqual(cycle.map((r) => r.status).sort(), [200, 400]);
    },
  );
  await t.test(
    "owner-configured defaults, retained deleted options and immutable prefixes",
    async () => {
      const input = {
        projectId: p.id,
        kind: "state",
        name: "Discussion",
        position: 0,
        color: null,
        trigger: "opened",
        isDefault: true,
      };
      assert.equal(
        (await call("issues.saveOption", member, input, true)).status,
        404,
      );
      assert.equal(
        (
          await call(
            "issues.saveOption",
            owner,
            { ...input, trigger: "finished" },
            true,
          )
        ).status,
        400,
      );
      const added = await data<{ id: string }>(
        await call("issues.saveOption", owner, input, true),
      );
      assert.equal((await create("Default state")).stateId, added.id);
      assert.equal(
        (
          await call(
            "issues.deleteOption",
            owner,
            { projectId: p.id, kind: "state", id: added.id },
            true,
          )
        ).status,
        400,
      );
      await data(
        await call(
          "issues.saveOption",
          owner,
          { ...input, id: added.id, name: "Open for discussion" },
          true,
        ),
      );
      const priority = settings.priorities[0]!;
      await data(
        await call(
          "issues.deleteOption",
          owner,
          { projectId: p.id, kind: "priority", id: priority.id },
          true,
        ),
      );
      first = await update(first, {
        title: "Still editable",
        priorityId: priority.id,
      });
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: "No", priorityId: priority.id },
            true,
          )
        ).status,
        400,
      );
      await data(
        await call(
          "issues.deleteOption",
          owner,
          { projectId: p.id, kind: "state", id: first.stateId },
          true,
        ),
      );
      first = await update(first, {
        description: "Retained state",
        stateId: first.stateId,
      });
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: "No", stateId: first.stateId },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "projects.update",
            owner,
            { id: p.id, name: "Spectron", key: "NEW" },
            true,
          )
        ).status,
        400,
      );
      settings = await data<IssueSettings>(
        await call("issues.settings", owner, { projectId: p.id }),
      );
      assert.equal(settings.states.filter((s) => s.isDefault).length, 1);
      assert.ok(
        settings.priorities.find((s) => s.id === priority.id)!.deletedAt,
      );
      assert.equal(
        (await createIssueService(db).list(owner.id, p.id)).find(
          (i) => i.id === first.id,
        )!.description,
        "Retained state",
      );
    },
  );
  await t.test(
    "archive retains readable issues and history but blocks writes",
    async () => {
      await data(await call("projects.archive", owner, { id: p.id }, true));
      assert.equal(
        (await call("issues.list", member, { projectId: p.id })).status,
        200,
      );
      assert.equal(
        (
          await call("issues.history", member, {
            projectId: p.id,
            id: first.id,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "issues.create",
            owner,
            { projectId: p.id, title: "No" },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
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
          )
        ).status,
        400,
      );
    },
  );
});
