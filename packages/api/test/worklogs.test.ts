import {
  parseHumanWorklogDuration,
  humanWorklogDurationInput,
} from "@spectron/shared";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import type {
  ProjectSummary,
  IssueSummary,
  WorklogPage,
  WorklogSummary,
} from "@spectron/shared";
import { createAPI } from "../src/index";
test("Human worklogs and transactional history", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_worklogs_${randomUUID().replaceAll("-", "")}`;
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

  const i = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: p.id, title: "Work" },
      true,
    ),
  );
  const scope = { projectId: p.id, issueId: i.id };
  const draft = {
    ...scope,
    workerUserId: member.id,
    startedAt: "2026-09-07T12:30:00+03:00",
    durationSeconds: 5401,
    description: "Implementation",
  };
  async function callResponse() {
    return call("worklogs.list", owner, { ...scope, includeDeleted: true });
  }
  const entries = async () => data<WorklogPage>(await callResponse());
  const get = async (id: string) =>
    (await entries()).entries.find((r) => r.id === id)!;
  let row: WorklogSummary;
  await t.test(
    "auth, scope, duration validation and worker/recorder attribution",
    async () => {
      assert.equal((await call("worklogs.list", null, scope)).status, 401);
      assert.equal((await call("worklogs.list", outsider, scope)).status, 404);
      for (const extra of [
        { durationSeconds: 0 },
        { durationSeconds: -1 },
        { durationSeconds: 0.1 },
        { durationSeconds: 2147483648 },
        { workerUserId: outsider.id },
        { recordedBy: member.id },
        { startedAt: "invalid" },
        { projectId: q.id },
      ])
        assert.notEqual(
          (await call("worklogs.create", owner, { ...draft, ...extra }, true))
            .status,
          200,
        );
      assert.equal(
        (await call("worklogs.create", owner, draft, true, "https://evil.test"))
          .status,
        403,
      );
      const created = await data<{ id: string }>(
        await call("worklogs.create", owner, draft, true),
      );
      row = await get(created.id);
      assert.equal(row.workerUserId, member.id);
      assert.equal(row.recordedBy, owner.id);
      assert.equal(row.startedAt, "2026-09-07T09:30:00.000Z");
      assert.equal(row.durationSeconds, 5401);
      await assert.rejects(
        pool.query("UPDATE issue_worklogs SET duration_seconds=0 WHERE id=$1", [
          row.id,
        ]),
        { code: "23514" },
      );
      await assert.rejects(
        pool.query("UPDATE issue_worklogs SET project_id=$1 WHERE id=$2", [
          q.id,
          row.id,
        ]),
        { code: "23503" },
      );
    },
  );
  const update = (r: WorklogSummary, description: string) =>
    call(
      "worklogs.update",
      member,
      { ...draft, id: r.id, expectedUpdatedAt: r.updatedAt, description },
      true,
    );
  await t.test(
    "concurrent edits conflict and preserve original recorder",
    async () => {
      const results = await Promise.all([
        update(row, "First edit"),
        update(row, "Second edit"),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      row = await get(row.id);
      assert.equal(row.recordedBy, owner.id);
      const history = (
        await pool.query(
          "SELECT * FROM issue_history WHERE entity_id=$1 ORDER BY created_at",
          [row.id],
        )
      ).rows;
      assert.equal(history.length, 2);
      assert.equal(history[1].actor_user_id, member.id);
      assert.equal(history[1].changes.description.before, "Implementation");
    },
  );
  await t.test("audit failure rolls back edits and deletion", async () => {
    await pool.query(
      "CREATE FUNCTION reject_worklog_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER reject_worklog_history BEFORE INSERT ON issue_history FOR EACH ROW EXECUTE FUNCTION reject_worklog_history()",
    );
    assert.equal((await update(row, "Rolled back")).status, 500);
    assert.equal(
      (
        await call(
          "worklogs.setDeleted",
          owner,
          {
            ...scope,
            id: row.id,
            expectedUpdatedAt: row.updatedAt,
            deleted: true,
          },
          true,
        )
      ).status,
      500,
    );
    assert.deepEqual(await get(row.id), row);
    await pool.query(
      "DROP TRIGGER reject_worklog_history ON issue_history; DROP FUNCTION reject_worklog_history()",
    );
  });
  await t.test(
    "soft removal and restore retain attribution, values and deletion actor",
    async () => {
      await data(
        await call(
          "worklogs.setDeleted",
          member,
          {
            ...scope,
            id: row.id,
            expectedUpdatedAt: row.updatedAt,
            deleted: true,
          },
          true,
        ),
      );
      row = await get(row.id);
      assert.ok(row.deletedAt);
      assert.equal(
        (await data<WorklogPage>(await call("worklogs.list", owner, scope)))
          .entries.length,
        0,
      );
      assert.equal((await update(row, "No")).status, 400);
      await data(
        await call(
          "worklogs.setDeleted",
          owner,
          {
            ...scope,
            id: row.id,
            expectedUpdatedAt: row.updatedAt,
            deleted: false,
          },
          true,
        ),
      );
      row = await get(row.id);
      assert.equal(row.deletedAt, null);
      assert.equal(row.durationSeconds, 5401);
      assert.equal(row.recordedBy, owner.id);
      assert.equal(
        (
          await pool.query(
            "SELECT actor_user_id FROM issue_history WHERE entity_id=$1 AND action='deleted'",
            [row.id],
          )
        ).rows[0].actor_user_id,
        member.id,
      );
    },
  );
  await t.test(
    "cursor pages preserve all overlapping manual entries",
    async () => {
      for (let n = 0; n < 22; n++)
        await data(await call("worklogs.create", owner, draft, true));
      const page = await entries();
      assert.equal(page.entries.length, 20);
      assert.ok(page.nextCursor);
      const second = await data<WorklogPage>(
        await call("worklogs.list", owner, {
          ...scope,
          includeDeleted: true,
          cursor: page.nextCursor,
        }),
      );
      assert.equal(second.entries.length, 3);
      assert.equal(
        new Set([...page.entries, ...second.entries].map((r) => r.id)).size,
        23,
      );
    },
  );
  await t.test(
    "deleted issues and archived projects reject changes while retaining reads",
    async () => {
      await data(
        await call(
          "issues.setDeleted",
          owner,
          {
            projectId: p.id,
            id: i.id,
            expectedUpdatedAt: i.updatedAt,
            deleted: true,
          },
          true,
        ),
      );
      assert.equal(
        (await call("worklogs.create", owner, draft, true)).status,
        400,
      );
      assert.equal((await call("worklogs.list", member, scope)).status, 200);
      const other = await data<IssueSummary>(
        await call(
          "issues.create",
          owner,
          { projectId: q.id, title: "Archive" },
          true,
        ),
      );
      await data(await call("projects.archive", owner, { id: q.id }, true));
      assert.equal(
        (
          await call(
            "worklogs.create",
            owner,
            {
              ...draft,
              projectId: q.id,
              issueId: other.id,
              workerUserId: owner.id,
            },
            true,
          )
        ).status,
        400,
      );
    },
  );
});

test("human duration input uses numeric groups, including mistyped separators", () => {
  for (const [input, seconds] of [
    ["1h 35m", 5700],
    ["30", 1800],
    ["1h30m", 5400],
    ["1n20m", 4800],
    ["1d 2h 30m", 95400],
    ["1h", 60],
    ["120", 7200],
    ["2h0m", 7200],
    ["0 45", 2700],
  ] as const)
    assert.equal(parseHumanWorklogDuration(input), seconds, input);
  for (const input of [
    "",
    "hours",
    "0",
    "-30",
    "1.5h",
    "1 2 3 4",
    "999999999999999999999999",
  ])
    assert.throws(() => parseHumanWorklogDuration(input), Error, input);
  for (const seconds of [60, 1800, 3600, 5400, 86400, 95400])
    assert.equal(
      parseHumanWorklogDuration(humanWorklogDurationInput(seconds)),
      seconds,
    );
});
