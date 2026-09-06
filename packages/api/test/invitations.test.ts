import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase } from "@spectron/db";
import {
  createAuth,
  createProjectService,
  createInvitationService,
  createInvitationEmailSender,
  type InvitationEmail,
} from "@spectron/backend";
import { applicationIdPattern, type ProjectSummary, type InvitationSummary } from "@spectron/shared";
import { createAPI } from "../src/index";

test("Project invitation lifecycle and archive", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_invitations_${randomUUID().replaceAll("-", "")}`;
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
  const emails: InvitationEmail[] = [];
  let failDelivery = false;
  const sendInvitationEmail = async (email: InvitationEmail) => {
    if (failDelivery) throw new Error("Provider unavailable");
    emails.push(email);
  };
  const api = createAPI(auth, { db, appURL: origin, sendInvitationEmail });
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
    const endpoint = `${origin}/api/trpc/${procedure}`;
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
  const project = await data<ProjectSummary>(
    await call("projects.create", owner, { name: "Spectron", key: "SP" }, true),
  );
  const input = { id: project.id, email: " INVITEE@example.test " };
  const token = () => emails.at(-1)!.url.split("#invite/")[1]!;
  let invitation: InvitationSummary;
  await t.test(
    "only owners can invite or list invitations; members can read the team",
    async () => {
      assert.equal(
        (await call("projects.invite", "", input, true)).status,
        401,
      );
      assert.equal(
        (await call("projects.invite", outsider, input, true)).status,
        404,
      );
      assert.equal(
        (await call("projects.invitations", outsider, { id: project.id }))
          .status,
        404,
      );
      assert.equal(
        (await call("projects.members", outsider, { id: project.id })).status,
        404,
      );
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            { ...input, email: "invalid" },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            { ...input, email: "owner@example.test" },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            input,
            true,
            "https://evil.example",
          )
        ).status,
        403,
      );
      assert.equal(emails.length, 0);
      invitation = await data<InvitationSummary>(
        await call("projects.invite", owner, input, true),
      );
      assert.equal(invitation.email, "invitee@example.test");
      assert.equal(invitation.status, "pending");
      assert.equal(emails[0]!.to, invitation.email);
      assert.equal(emails[0]!.projectName, "Spectron");
      assert.match(token(), /^[a-f0-9]{64}$/);
      const stored = (
        await pool.query(
          "SELECT token_hash FROM project_invitations WHERE id = $1",
          [invitation.id],
        )
      ).rows[0].token_hash;
      assert.notEqual(stored, token());
      assert.equal(stored.length, 64);
      assert.equal("tokenHash" in invitation, false);
      assert.equal(
        (await call("projects.invite", owner, input, true)).status,
        400,
      );
      assert.equal(emails.length, 1);
    },
  );
  const invitee = await register("invitee@example.test");
  await t.test(
    "a new account can accept only its own invitation, once",
    async () => {
      assert.equal(
        (await call("invitations.preview", "", { token: token() }, true))
          .status,
        401,
      );
      assert.equal(
        (await call("invitations.accept", outsider, { token: token() }, true))
          .status,
        400,
      );
      assert.equal(
        (
          await call(
            "invitations.accept",
            invitee,
            { token: "0".repeat(64) },
            true,
          )
        ).status,
        400,
      );
      const preview = await data<{ projectName: string }>(
        await call("invitations.preview", invitee, { token: token() }, true),
      );
      assert.equal(preview.projectName, "Spectron");
      const results = await Promise.all([
        call("invitations.accept", invitee, { token: token() }, true),
        call("invitations.accept", invitee, { token: token() }, true),
      ]);
      for (const response of results) assert.equal(response.status, 200);
      assert.equal(
        (await data<ProjectSummary[]>(await call("projects.list", invitee)))[0]!
          .role,
        "member",
      );
      assert.equal(
        (
          await data<unknown[]>(
            await call("projects.members", invitee, { id: project.id }),
          )
        ).length,
        2,
      );
      assert.equal(
        (
          await call(
            "projects.invite",
            invitee,
            { ...input, email: "next@example.test" },
            true,
          )
        ).status,
        404,
      );
      assert.equal(
        (await call("projects.invitations", invitee, { id: project.id }))
          .status,
        404,
      );
      assert.equal(
        (await call("projects.archive", invitee, { id: project.id }, true))
          .status,
        404,
      );
      assert.equal(
        (
          await call(
            "projects.cancelInvitation",
            invitee,
            { id: project.id, invitationId: invitation.id },
            true,
          )
        ).status,
        404,
      );
    },
  );
  await t.test(
    "cancellation and expiry invalidate tokens and allow new invitations",
    async () => {
      const sent = await data<InvitationSummary>(
        await call(
          "projects.invite",
          owner,
          { id: project.id, email: "outsider@example.test" },
          true,
        ),
      );
      assert.match(sent.id, applicationIdPattern);
      const cancelledToken = token();
      assert.equal(
        (
          await call(
            "projects.cancelInvitation",
            outsider,
            { id: project.id, invitationId: sent.id },
            true,
          )
        ).status,
        404,
      );
      await data(
        await call(
          "projects.cancelInvitation",
          owner,
          { id: project.id, invitationId: sent.id },
          true,
        ),
      );
      assert.equal(
        (
          await call(
            "invitations.accept",
            outsider,
            { token: cancelledToken },
            true,
          )
        ).status,
        400,
      );
      const expired = await data<InvitationSummary>(
        await call(
          "projects.invite",
          owner,
          { id: project.id, email: "outsider@example.test" },
          true,
        ),
      );
      const expiredToken = token();
      await pool.query(
        "UPDATE project_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [expired.id],
      );
      assert.equal(
        (
          await call(
            "invitations.accept",
            outsider,
            { token: expiredToken },
            true,
          )
        ).status,
        400,
      );
      const all = await data<InvitationSummary[]>(
        await call("projects.invitations", owner, { id: project.id }),
      );
      assert.equal(all.find((row) => row.id === expired.id)!.status, "expired");
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            { id: project.id, email: "outsider@example.test" },
            true,
          )
        ).status,
        200,
      );
      assert.notEqual(token(), expiredToken);
    },
  );
  await t.test(
    "delivery failure is visible, grants no access and can be retried",
    async () => {
      failDelivery = true;
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            { id: project.id, email: "failure@example.test" },
            true,
          )
        ).status,
        400,
      );
      failDelivery = false;
      const all = await data<InvitationSummary[]>(
        await call("projects.invitations", owner, { id: project.id }),
      );
      assert.equal(
        all.find((row) => row.email === "failure@example.test")!.status,
        "failed",
      );
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            { id: project.id, email: "failure@example.test" },
            true,
          )
        ).status,
        200,
      );
      await assert.rejects(
        createInvitationEmailSender(
          undefined,
          undefined,
        )({
          to: "nobody@example.test",
          url: "https://example.test",
          inviterName: "Test",
          projectName: "Test",
          invitationId: "test",
        }),
      );
    },
  );
  await t.test("concurrent duplicates send only one email", async () => {
    const before = emails.length;
    const result = await Promise.all([
      call(
        "projects.invite",
        owner,
        { id: project.id, email: "duplicate@example.test" },
        true,
      ),
      call(
        "projects.invite",
        owner,
        { id: project.id, email: "duplicate@example.test" },
        true,
      ),
    ]);
    assert.deepEqual(result.map((item) => item.status).sort(), [200, 400]);
    assert.equal(emails.length, before + 1);
  });
  await t.test(
    "archiving preserves data, cancels pending invitations and prevents new writes",
    async () => {
      await data(
        await call(
          "projects.invite",
          owner,
          { id: project.id, email: "member@example.test" },
          true,
        ),
      );
      const archivedToken = token();
      const result = await data<ProjectSummary>(
        await call("projects.archive", owner, { id: project.id }, true),
      );
      assert.equal(result.state, "archived");
      assert.equal(
        (await data<ProjectSummary[]>(await call("projects.list", owner)))[0]!
          .state,
        "archived",
      );
      assert.equal(
        (
          await call(
            "invitations.accept",
            member,
            { token: archivedToken },
            true,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "projects.invite",
            owner,
            { id: project.id, email: "other@example.test" },
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
            { id: project.id, name: "Edit", key: "ED" },
            true,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM project_members WHERE project_id = $1",
            [project.id],
          )
        ).rows[0].count,
        "2",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM project_invitations WHERE project_id = $1 AND status IN ('pending', 'sending')",
            [project.id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "archive during delivery prevents activation of the mailed token",
    async () => {
      const ownerId = (
        await pool.query(
          "SELECT id FROM users WHERE email = 'owner@example.test'",
        )
      ).rows[0].id;
      const pendingProject = await createProjectService(db).create(ownerId, {
        name: "Delivery race",
        key: "DR",
      });
      let release!: () => void;
      let started!: () => void;
      const delivery = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        started = resolve;
      });
      const service = createInvitationService(db, {
        appURL: origin,
        sendInvitationEmail: async () => {
          started();
          await delivery;
        },
      });
      const sending = service.invite(
        ownerId,
        pendingProject.id,
        "race@example.test",
      );
      await reached;
      await createProjectService(db).archive(ownerId, pendingProject.id);
      release();
      await assert.rejects(sending, /cancelled/);
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM project_invitations WHERE project_id = $1",
            [pendingProject.id],
          )
        ).rows[0].status,
        "cancelled",
      );
    },
  );
});

test("Resend invitation contains the recipient, acceptance link and idempotency key", async () => {
  const original = globalThis.fetch;
  let request:
    | { url: string; body: Record<string, unknown>; headers: Headers }
    | undefined;
  globalThis.fetch = async (input, init) => {
    request = {
      url: String(input),
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
    };
    return new Response(JSON.stringify({ id: "test-email" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await createInvitationEmailSender(
      "re_test_placeholder",
      "Spectron <auth@example.test>",
    )({
      to: "recipient@example.test",
      projectName: "Test project",
      inviterName: "Test owner",
      url: "https://workspace.example.test/#invite/test-token",
      invitationId: "test-invitation",
    });
    assert.ok(request);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.body.to, "recipient@example.test");
    assert.equal(request.body.from, "Spectron <auth@example.test>");
    assert.match(
      String(request.body.text),
      /https:\/\/workspace.example.test\/#invite\/test-token/,
    );
    assert.match(String(request.body.text), /7 days/);
    assert.equal(
      request.headers.get("idempotency-key"),
      "project-invitation/test-invitation",
    );
  } finally {
    globalThis.fetch = original;
  }
});
