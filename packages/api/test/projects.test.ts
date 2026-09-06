import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth, createProjectService } from "@spectron/backend";
import type { ProjectSummary } from "@spectron/shared";
import { createAPI } from "../src/index";

test("Project tRPC endpoints and membership isolation", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_projects_${randomUUID().replaceAll("-", "")}`;
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
    secret: "project-integration-test-secret-with-32-characters",
    sendResetEmail: async () => {},
  });
  const api = createAPI(auth, { db, appURL: origin });
  const register = async (email: string) => {
    const response = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test developer",
        email,
        password: "a long project test password",
      }),
    });
    assert.equal(response.status, 200);
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };
  const owner = await register("owner@example.test");
  const outsider = await register("outsider@example.test");
  const member = await register("member@example.test");
  const call = (
    procedure: string,
    cookie: string,
    input?: unknown,
    mutation = false,
    requestOrigin: string | null = origin,
  ) => {
    const endpoint = `${origin}/api/trpc/projects.${procedure}`;
    const headers = {
      cookie,
      "content-type": "application/json",
      ...(requestOrigin ? { origin: requestOrigin } : {}),
    };
    return api.request(
      mutation
        ? endpoint
        : `${endpoint}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers,
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
  };
  const data = async <T>(response: Response): Promise<T> => {
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { result: { data: T } }).result.data;
  };
  let project: ProjectSummary;
  await t.test(
    "requires login and leaves new accounts without projects",
    async () => {
      assert.equal((await call("list", "")).status, 401);
      assert.equal(
        (await call("create", "", { name: "Test", key: "TE" }, true)).status,
        401,
      );
      assert.deepEqual(await data(await call("list", owner)), []);
      assert.equal(
        (await pool.query("SELECT count(*) FROM projects")).rows[0].count,
        "0",
      );
    },
  );
  await t.test("creates a project and owner membership together", async () => {
    project = await data<ProjectSummary>(
      await call(
        "create",
        owner,
        { name: " Spectron ", key: " sp ", url: "spectron.example" },
        true,
      ),
    );
    assert.equal(project.name, "Spectron");
    assert.equal(project.key, "SP");
    assert.equal(project.role, "owner");
    assert.equal(project.url, "https://spectron.example/");
    assert.equal(project.logo, null);
    assert.equal(
      (await data<ProjectSummary[]>(await call("list", owner)))[0]!.id,
      project.id,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT role FROM project_members WHERE project_id = $1",
          [project.id],
        )
      ).rows[0].role,
      "owner",
    );
    const before = (await pool.query("SELECT count(*) FROM projects")).rows[0]
      .count;
    await assert.rejects(
      createProjectService(db).create("missing-user", {
        name: "Rollback",
        key: "RB",
        url: "spectron.example",
      }),
    );
    assert.equal(
      (await pool.query("SELECT count(*) FROM projects")).rows[0].count,
      before,
    );
  });
  await t.test(
    "lists only memberships and hides other users' projects",
    async () => {
      assert.deepEqual(await data(await call("list", outsider)), []);
      assert.equal(
        (await call("get", outsider, { id: project.id })).status,
        404,
      );
      assert.equal(
        (
          await call(
            "update",
            outsider,
            { id: project.id, name: "Stolen", key: "ST", url: null },
            true,
          )
        ).status,
        404,
      );
      const another = await data<ProjectSummary>(
        await call(
          "create",
          outsider,
          { name: project.name, key: project.key },
          true,
        ),
      );
      assert.notEqual(another.id, project.id);
      assert.equal(
        (await data<ProjectSummary[]>(await call("list", owner))).length,
        1,
      );
    },
  );
  await t.test(
    "members can read joined projects; only owners can update",
    async () => {
      const memberId = (
        await pool.query(
          "SELECT id FROM users WHERE email = 'member@example.test'",
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')",
        [project.id, memberId],
      );
      assert.equal(
        (await data<ProjectSummary[]>(await call("list", member)))[0]!.role,
        "member",
      );
      assert.equal(
        (
          await data<ProjectSummary>(
            await call("get", member, { id: project.id }),
          )
        ).name,
        "Spectron",
      );
      assert.equal(
        (
          await call(
            "update",
            member,
            { id: project.id, name: "No", key: "NO" },
            true,
          )
        ).status,
        404,
      );
      const updated = await data<ProjectSummary>(
        await call(
          "update",
          owner,
          {
            id: project.id,
            name: "Spectron team",
            key: "SP",
            url: "https://spectron.example/team",
            logo: null,
          },
          true,
        ),
      );
      assert.equal(updated.name, "Spectron team");
      assert.equal(updated.url, "https://spectron.example/team");
      assert.equal(updated.logo, null);
      const restarted = createAPI(auth, { db, appURL: origin });
      const response = await restarted.request(
        `${origin}/api/trpc/projects.list`,
        { headers: { cookie: member } },
      );
      assert.equal(
        (await data<ProjectSummary[]>(response))[0]!.name,
        "Spectron team",
      );
    },
  );
  await t.test("validates fields and rejects ownership spoofing", async () => {
    for (const input of [
      { name: " ", key: "SP" },
      { name: "x".repeat(81), key: "SP" },
      { name: "Name", key: "1!" },
      { name: "Name", key: "SP", url: "javascript:alert(1)" },
      { name: "Name", key: "SP", url: "https://user:secret@example.com" },
      { name: "Name", key: "SP", logo: "https://example.com/logo.png" },
      { name: "Name", key: "SP", logo: "data:image/png;base64,aW52YWxpZA==" },
      { name: "Name", key: "SP", userId: "other" },
    ]) {
      assert.equal((await call("create", owner, input, true)).status, 400);
    }
    assert.equal((await call("get", owner, { id: "invalid" })).status, 400);
    assert.equal((await call("get", owner, { id: randomUUID() })).status, 404);
  });
  await t.test("persists uploaded logos and allows removing them", async () => {
    const logo = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>').toString("base64")}`;
    const created = await data<ProjectSummary>(
      await call(
        "create",
        owner,
        { name: "Logo project", key: "LP", url: "example.com", logo },
        true,
      ),
    );
    assert.ok(created.logo?.startsWith("data:image/png;base64,"));
    const stored = (
      await pool.query("SELECT url, logo FROM projects WHERE id = $1", [
        created.id,
      ])
    ).rows[0];
    assert.equal(stored.logo, created.logo);
    assert.equal(stored.url, "https://example.com/");
    assert.equal(
      (await data<ProjectSummary>(await call("get", owner, { id: created.id })))
        .logo,
      created.logo,
    );
    const removed = await data<ProjectSummary>(
      await call(
        "update",
        owner,
        {
          id: created.id,
          name: created.name,
          key: created.key,
          url: null,
          logo: null,
        },
        true,
      ),
    );
    assert.equal(removed.logo, null);
    assert.equal(removed.url, null);
    assert.equal(
      (await call("discoverLogo", "", { url: "https://example.com" }, true))
        .status,
      401,
    );
    assert.equal(
      (await call("discoverLogo", owner, { url: "javascript:alert(1)" }, true))
        .status,
      400,
    );
    assert.deepEqual(
      await data(
        await call("discoverLogo", owner, { url: "http://127.0.0.1" }, true),
      ),
      { logo: null },
    );
  });
  await t.test(
    "rejects cross-origin or origin-less writes and revoked sessions",
    async () => {
      const input = { name: "Forged", key: "FG" };
      assert.equal(
        (await call("create", owner, input, true, "https://evil.example"))
          .status,
        403,
      );
      assert.equal(
        (await call("create", owner, input, true, null)).status,
        403,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM projects WHERE name = 'Forged'",
          )
        ).rows[0].count,
        "0",
      );
      const response = await call("list", owner);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await api.request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: { origin, cookie: owner, "content-type": "application/json" },
        body: "{}",
      });
      assert.equal((await call("list", owner)).status, 401);
    },
  );
});
