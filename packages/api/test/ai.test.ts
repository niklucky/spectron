import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase } from "@spectron/db";
import {
  createAuth,
  IssueInputError,
  createAIService,
} from "@spectron/backend";
import {
  aiCatalog,
  createId,
  type AIConnectionSummary,
  type AgentInput,
  type AgentSummary,
  type AgentIdentity,
  type AgentSharing,
} from "@spectron/shared";
import {
  createAICredentialCheck,
  decryptAIKey,
  encryptAIKey,
} from "../../backend/src/ai-credentials";
import { createAPI } from "../src/index";

const secret = "ai-test-only-encryption-secret-with-at-least-32-characters";
test("AI encryption authenticates the ciphertext and its owner/connection binding", () => {
  const key = "test-provider-secret";
  const encrypted = encryptAIKey(key, "owner:connection:provider", secret);
  assert.notEqual(
    encrypted,
    encryptAIKey(key, "owner:connection:provider", secret),
  );
  assert.ok(!encrypted.includes(key));
  assert.equal(
    decryptAIKey(encrypted, "owner:connection:provider", secret),
    key,
  );
  assert.throws(
    () => decryptAIKey(encrypted, "other:connection:provider", secret),
    /cannot be decrypted/,
  );
  assert.throws(
    () =>
      decryptAIKey(encrypted, "owner:connection:provider", `${secret}-changed`),
    /cannot be decrypted/,
  );
  const bytes = Buffer.from(encrypted.slice(3), "base64");
  bytes[15] = bytes[15]! ^ 1;
  assert.throws(
    () =>
      decryptAIKey(
        `v1:${bytes.toString("base64")}`,
        "owner:connection:provider",
        secret,
      ),
    /cannot be decrypted/,
  );
  assert.throws(() => encryptAIKey(key, "binding"), /AI_CREDENTIAL_SECRET/);
});

test("Provider checks use fixed URLs, correct auth, bounded requests and sanitized failures", async () => {
  for (const provider of aiCatalog) {
    const check = createAICredentialCheck(async (url, init) => {
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      const headers = new Headers(init?.headers);
      if (provider.id === "anthropic") {
        assert.equal(
          String(url),
          "https://api.anthropic.com/v1/models?limit=100",
        );
        assert.equal(headers.get("x-api-key"), "test-key");
        assert.equal(headers.get("anthropic-version"), "2023-06-01");
        assert.equal(headers.get("authorization"), null);
      } else assert.equal(headers.get("authorization"), "Bearer test-key");
      if (provider.id === "zai") {
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "glm-5.3-flash");
        assert.equal(body.max_tokens, 16);
        return Response.json({ choices: [{ message: {} }] });
      }
      assert.equal(init?.method, "GET");
      return Response.json({ data: [{ id: "model" }] });
    });
    await check(provider.id, "test-key");
  }
  for (const status of [401, 403, 429, 500, 302]) {
    await assert.rejects(
      createAICredentialCheck(async () => new Response("test-key", { status }))(
        "openai",
        "test-key",
      ),
      (error: Error) => !error.message.includes("test-key"),
    );
  }
  for (const body of [{ error: "test-key" }, { data: [] }, { data: "invalid" }])
    await assert.rejects(
      createAICredentialCheck(async () => Response.json(body))(
        "openai",
        "test-key",
      ),
      /could not complete/,
    );
  await assert.rejects(
    createAICredentialCheck(async () => {
      throw new Error("test-key");
    })("openai", "test-key"),
    /could not complete/,
  );
});

test("AI account endpoints, credential replacement and project-specific sharing", async (t) => {
  const connectionURL =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_ai_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connectionURL);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connectionURL);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
  });
  await migrateDatabase(db);
  // Applying the journal twice must be safe.
  await migrateDatabase(db);
  const origin = "http://localhost:5173";
  const auth = createAuth(db, {
    appURL: origin,
    secret,
    sendResetEmail: async () => {},
  });
  const checkedKeys: string[] = [];
  let onCheck: () => Promise<void> = async () => {};
  const api = createAPI(auth, {
    db,
    appURL: origin,
    aiSecret: secret,
    aiCredentialCheck: async (_provider, key) => {
      checkedKeys.push(key);
      await onCheck();
    },
  });
  async function register(label: string) {
    const response = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: label,
        email: `${label}@example.test`,
        password: "a-long-test-only-password",
      }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const user = (
      await pool.query("SELECT id FROM users WHERE email = $1", [
        `${label}@example.test`,
      ])
    ).rows[0];
    return { cookie, id: user.id as string };
  }
  const owner = await register("owner"),
    member = await register("member"),
    other = await register("other"),
    outsider = await register("outsider");
  async function call(
    procedure: string,
    cookie: string,
    input?: unknown,
    mutation = false,
    status = 200,
    requestOrigin: string | null = origin,
  ) {
    const endpoint = `${origin}/api/trpc/${procedure.includes(".") ? procedure : `ai.${procedure}`}`;
    const response = await api.request(
      mutation
        ? endpoint
        : `${endpoint}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: {
          cookie,
          "content-type": "application/json",
          ...(requestOrigin ? { origin: requestOrigin } : {}),
        },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
    assert.equal(response.status, status, await response.clone().text());
    const body = (await response.json()) as { result?: { data: unknown } };
    return body.result?.data;
  }
  const createProject = (label: string) =>
    call(
      "projects.create",
      owner.cookie,
      { name: label, key: label },
      true,
    ) as Promise<{ id: string }>;
  const p1 = await createProject("PA"),
    p2 = await createProject("PB");
  for (const p of [p1, p2])
    for (const u of [member, other])
      await pool.query(
        "INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,'member')",
        [p.id, u.id],
      );
  let c: AIConnectionSummary;
  let a: AgentSummary;
  let secondAgent: AgentSummary;
  const agents = () => call("agents", owner.cookie) as Promise<AgentSummary[]>;
  const available = (u: typeof owner, p = p1) =>
    call("available", u.cookie, { projectId: p.id }) as Promise<
      AgentIdentity[]
    >;
  const fields = (): AgentInput => ({
    name: "Dev senior",
    connectionId: c.id,
    model: "deepseek-v4-pro",
    effort: "high",
    role: "Developer",
    instructions: "Private system instructions",
    avatar: null,
  });
  const setShare = async (
    visibility: "private" | "selected" | "project",
    p = p1,
    memberIds: string[] = [],
  ) => {
    await call(
      "setSharing",
      owner.cookie,
      {
        id: a.id,
        revision: a.revision,
        projectId: p.id,
        visibility,
        memberIds,
      },
      true,
    );
    a = (await agents()).find((v) => v.id === a.id)!;
  };
  await t.test(
    "authentication, input validation, CSRF and fail-closed encryption",
    async () => {
      await call("connections", "", undefined, false, 401);
      await call("catalog", "", undefined, false, 401);
      await call(
        "createConnection",
        owner.cookie,
        { name: "x", provider: "unknown", apiKey: "key" },
        true,
        400,
      );
      for (const apiKey of ["", "contains space", "line\nbreak"])
        await call(
          "createConnection",
          owner.cookie,
          { name: "x", provider: "openai", apiKey },
          true,
          400,
        );
      await call(
        "createConnection",
        owner.cookie,
        { name: "x", provider: "openai", apiKey: "key", ownerId: member.id },
        true,
        400,
      );
      await call(
        "createConnection",
        owner.cookie,
        { name: "x", provider: "openai", apiKey: "key" },
        true,
        403,
        "https://evil.example",
      );
      await call(
        "createConnection",
        owner.cookie,
        { name: "x", provider: "openai", apiKey: "key" },
        true,
        403,
        null,
      );
      await assert.rejects(
        createAIService(db).createConnection(owner.id, {
          name: "x",
          provider: "openai",
          apiKey: "key",
        }),
        /AI_CREDENTIAL_SECRET/,
      );
      assert.equal(
        (await pool.query("SELECT count(*) FROM ai_connections")).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "keys are encrypted and absent from all API summaries",
    async () => {
      c = (await call(
        "createConnection",
        owner.cookie,
        {
          name: "DeepSeek account",
          provider: "deepseek",
          apiKey: "original-test-secret",
        },
        true,
      )) as AIConnectionSummary;
      assert.equal(c.checkStatus, "untested");
      assert.equal(c.ownerId, owner.id);
      assert.ok(!JSON.stringify(c).includes("original-test-secret"));
      const stored = (
        await pool.query(
          "SELECT encrypted_key FROM ai_connections WHERE id=$1",
          [c.id],
        )
      ).rows[0].encrypted_key;
      assert.ok(stored.startsWith("v1:"));
      assert.ok(!stored.includes("original-test-secret"));
      assert.deepEqual(await call("connections", member.cookie), []);
      await call(
        "updateConnection",
        member.cookie,
        {
          id: c.id,
          revision: c.revision,
          name: "Stolen",
          apiKey: "stolen-key",
        },
        true,
        404,
      );
      await call(
        "deleteConnection",
        member.cookie,
        { id: c.id, revision: c.revision },
        true,
        404,
      );
      await call(
        "checkConnection",
        member.cookie,
        { id: c.id, revision: c.revision },
        true,
        404,
      );
      assert.equal(checkedKeys.length, 0);
    },
  );
  await t.test(
    "several agents, independent AI identity, sanitized avatar, model and effort validation",
    async () => {
      const userCount = (await pool.query("SELECT count(*) FROM users")).rows[0]
        .count;
      const avatar = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>').toString("base64")}`;
      const first = (await call(
        "createAgent",
        owner.cookie,
        { ...fields(), avatar },
        true,
      )) as { id: string };
      const second = (await call(
        "createAgent",
        owner.cookie,
        { ...fields(), name: "Issue editor", role: "Custom role" },
        true,
      )) as { id: string };
      a = (await agents()).find((v) => v.id === first.id)!;
      secondAgent = (await agents()).find((v) => v.id === second.id)!;
      assert.equal(a.kind, "agent");
      assert.equal(a.ownerName, "owner");
      assert.ok(a.avatar?.startsWith("data:image/png;base64,"));
      assert.equal(
        (await pool.query("SELECT count(*) FROM users")).rows[0].count,
        userCount,
      );
      for (const patch of [
        { effort: "medium" },
        { effort: null },
        { model: "gpt-5.6-sol" },
        { avatar: "https://example.test/avatar.png" },
      ])
        await call(
          "createAgent",
          owner.cookie,
          { ...fields(), ...patch },
          true,
          400,
        );
      await call("createAgent", member.cookie, fields(), true, 404);
      assert.deepEqual(await call("agents", member.cookie), []);
      await call(
        "updateAgent",
        member.cookie,
        { ...fields(), id: a.id, revision: a.revision },
        true,
        404,
      );
      await call(
        "deleteAgent",
        member.cookie,
        { id: a.id, revision: a.revision },
        true,
        404,
      );
      await call("sharing", member.cookie, { id: a.id }, false, 404);
      await call(
        "deleteConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
        400,
      );
    },
  );
  await t.test(
    "owner edits persist and stale agent forms cannot overwrite them",
    async () => {
      const oldRevision = a.revision;
      await call(
        "updateAgent",
        owner.cookie,
        {
          ...fields(),
          id: a.id,
          revision: oldRevision,
          role: "Senior developer",
          effort: "max",
          instructions: "Updated instructions",
          avatar: null,
        },
        true,
      );
      a = (await agents()).find((v) => v.id === a.id)!;
      assert.equal(a.role, "Senior developer");
      assert.equal(a.effort, "max");
      assert.equal(a.instructions, "Updated instructions");
      assert.equal(a.avatar, null);
      await call(
        "updateAgent",
        owner.cookie,
        { ...fields(), id: a.id, revision: oldRevision },
        true,
        409,
      );
      const restarted = createAIService(db, secret);
      assert.equal(
        (await restarted.agents(owner.id)).find((v) => v.id === a.id)
          ?.instructions,
        "Updated instructions",
      );
    },
  );
  await t.test(
    "key replacement propagates once, blank omission preserves it, stale edits/checks cannot overwrite",
    async () => {
      await call(
        "checkConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
      );
      c = (await call(
        "updateConnection",
        owner.cookie,
        {
          id: c.id,
          revision: c.revision,
          name: c.name,
          apiKey: "replacement-test-secret",
        },
        true,
      )) as AIConnectionSummary;
      assert.equal(c.checkStatus, "untested");
      assert.equal(c.checkedAt, null);
      await call(
        "updateConnection",
        owner.cookie,
        {
          id: c.id,
          revision: c.revision - 1,
          name: "stale",
          apiKey: "bad-key",
        },
        true,
        409,
      );
      await call(
        "checkConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
      );
      assert.deepEqual(checkedKeys, [
        "original-test-secret",
        "replacement-test-secret",
      ]);
      c = (await call(
        "updateConnection",
        owner.cookie,
        { id: c.id, revision: c.revision, name: "Renamed" },
        true,
      )) as AIConnectionSummary;
      assert.equal(c.checkStatus, "passed");
      assert.deepEqual(
        (await agents()).map((v) => v.connectionId),
        [c.id, c.id],
      );
      onCheck = async () => {
        c = (await call(
          "updateConnection",
          owner.cookie,
          {
            id: c.id,
            revision: c.revision,
            name: c.name,
            apiKey: "latest-test-secret",
          },
          true,
        )) as AIConnectionSummary;
      };
      await call(
        "checkConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
        409,
      );
      assert.equal(
        ((await call("connections", owner.cookie)) as AIConnectionSummary[])[0]!
          .checkStatus,
        "untested",
      );
      onCheck = async () => {
        throw new IssueInputError(
          "The provider rejected this key or its permissions.",
        );
      };
      const failed = (await call(
        "checkConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
      )) as { connection: AIConnectionSummary };
      assert.equal(failed.connection.checkStatus, "failed");
      onCheck = async () => {};
    },
  );
  await t.test(
    "private, selected and whole-project discovery has no secrets or instructions",
    async () => {
      assert.equal((await available(owner)).length, 2);
      assert.deepEqual(await available(member), []);
      assert.deepEqual(await call("sharing", owner.cookie, { id: a.id }), []);
      await setShare("selected", p1, [member.id]);
      const shared = await available(member);
      assert.equal(shared.length, 1);
      assert.equal(shared[0]!.id, a.id);
      for (const field of [
        "connectionId",
        "instructions",
        "encryptedKey",
        "apiKey",
      ])
        assert.ok(!(field in shared[0]!));
      assert.deepEqual(await available(other), []);
      assert.deepEqual(await available(member, p2), []);
      await setShare("project", p2);
      assert.equal((await available(other, p2)).length, 1);
      assert.deepEqual(await available(other, p1), []);
      const grants = (await call("sharing", owner.cookie, {
        id: a.id,
      })) as AgentSharing[];
      assert.equal(grants.length, 2);
      await call(
        "available",
        outsider.cookie,
        { projectId: p1.id },
        false,
        404,
      );
      await call(
        "setSharing",
        member.cookie,
        {
          id: a.id,
          revision: a.revision,
          projectId: p1.id,
          visibility: "project",
          memberIds: [],
        },
        true,
        404,
      );
      for (const ids of [[outsider.id], [owner.id], []])
        await call(
          "setSharing",
          owner.cookie,
          {
            id: a.id,
            revision: a.revision,
            projectId: p1.id,
            visibility: "selected",
            memberIds: ids,
          },
          true,
          400,
        );
      await call(
        "setSharing",
        owner.cookie,
        {
          id: a.id,
          revision: a.revision - 1,
          projectId: p1.id,
          visibility: "private",
          memberIds: [],
        },
        true,
        409,
      );
      await setShare("private", p2);
      assert.deepEqual(await available(other, p2), []);
    },
  );
  await t.test(
    "reading sharing does not wait for an agent write lock",
    async () => {
      const client = await pool.connect();
      let pending: Promise<AgentSharing[]> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM ai_agents WHERE id=$1 FOR UPDATE", [
          a.id,
        ]);
        pending = createAIService(db, secret).sharing(owner.id, a.id);
        const sharing = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error("Sharing read waited for the agent write lock."),
                ),
              2000,
            );
          }),
        ]);
        assert.deepEqual(sharing, [
          { projectId: p1.id, visibility: "selected", memberIds: [member.id] },
        ]);
      } finally {
        clearTimeout(timeout);
        await client.query("ROLLBACK");
        client.release();
        await pending?.catch(() => {});
      }
    },
  );
  await t.test(
    "membership removal revokes grants permanently; owner removal revokes project sharing",
    async () => {
      await pool.query(
        "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
        [p1.id, member.id],
      );
      await call("available", member.cookie, { projectId: p1.id }, false, 404);
      assert.deepEqual(await call("sharing", owner.cookie, { id: a.id }), []);
      await pool.query(
        "INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,'member')",
        [p1.id, member.id],
      );
      assert.deepEqual(await available(member), []);
      assert.deepEqual(await call("sharing", owner.cookie, { id: a.id }), []);
      // The editor can save the effective Private state without selecting a replacement member.
      await setShare("private", p1);
      assert.deepEqual(await call("sharing", owner.cookie, { id: a.id }), []);
      await setShare("project", p1);
      assert.equal((await available(member)).length, 1);
      await pool.query(
        "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
        [p1.id, owner.id],
      );
      assert.deepEqual(await available(member), []);
      await pool.query(
        "INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,'owner')",
        [p1.id, owner.id],
      );
      assert.deepEqual(await available(member), []);
      await setShare("project", p1);
      await pool.query("UPDATE projects SET state='archived' WHERE id=$1", [
        p1.id,
      ]);
      await call("available", member.cookie, { projectId: p1.id }, false, 404);
    },
  );
  await t.test(
    "all required providers enforce catalog choices including no-effort models",
    async () => {
      for (const provider of aiCatalog) {
        const pc = (await call(
          "createConnection",
          owner.cookie,
          {
            name: provider.name,
            provider: provider.id,
            apiKey: "provider-test-key",
          },
          true,
        )) as AIConnectionSummary;
        for (const model of provider.models) {
          await call(
            "createAgent",
            owner.cookie,
            {
              ...fields(),
              connectionId: pc.id,
              model: model.id,
              effort: model.defaultEffort,
            },
            true,
          );
          const badEffort = model.efforts.includes("none") ? null : "none";
          await call(
            "createAgent",
            owner.cookie,
            {
              ...fields(),
              connectionId: pc.id,
              model: model.id,
              effort: badEffort,
            },
            true,
            400,
          );
        }
      }
    },
  );
  await t.test(
    "deleting agents revokes sharing, retains identity, and releases the connection",
    async () => {
      await call(
        "deleteAgent",
        owner.cookie,
        { id: a.id, revision: a.revision },
        true,
      );
      await call(
        "deleteAgent",
        owner.cookie,
        { id: secondAgent.id, revision: secondAgent.revision },
        true,
      );
      await call(
        "updateAgent",
        owner.cookie,
        { ...fields(), id: a.id, revision: a.revision },
        true,
        404,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM ai_agent_shares WHERE agent_id=$1",
            [a.id],
          )
        ).rows[0].count,
        "0",
      );
      await call(
        "deleteConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
      );
      const tombstone = (
        await pool.query(
          "SELECT name,connection_id,deleted_at FROM ai_agents WHERE id=$1",
          [a.id],
        )
      ).rows[0];
      assert.equal(tombstone.name, "Dev senior");
      assert.equal(tombstone.connection_id, null);
      assert.ok(tombstone.deleted_at);
      await call(
        "checkConnection",
        owner.cookie,
        { id: c.id, revision: c.revision },
        true,
        404,
      );
      await call("sharing", owner.cookie, { id: createId() }, false, 404);
    },
  );
});
