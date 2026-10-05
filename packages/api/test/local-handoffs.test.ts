import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import {
  createId,
  localAppLaunch,
  validGitOrigin,
  validLocalPath,
  type LocalHandoffView,
  type LocalHandoffDraft,
} from "@spectron/shared";
import { createAPI } from "../src/index";

test("local launch links encode prompts and workspaces, with an honest T3/long-text fallback", () => {
  const prompt = "Fix #42 & inspect screenshot\nПривет 🪐";
  const launch = localAppLaunch("codex", prompt, {
    path: "/Users/me/My Project",
    originUrl: "https://github.com/team/repo.git",
  });
  const url = new URL(launch.url);
  assert.equal(url.searchParams.get("prompt"), prompt);
  assert.equal(url.searchParams.get("path"), "/Users/me/My Project");
  assert.equal(url.searchParams.get("originUrl"), null);
  assert.equal(launch.prefilled, true);
  assert.equal(
    new URL(
      localAppLaunch("codex", prompt, {
        path: "",
        originUrl: "git@github.com:team/repo.git",
      }).url,
    ).searchParams.get("originUrl"),
    "git@github.com:team/repo.git",
  );
  assert.deepEqual(
    localAppLaunch("t3code", prompt, { path: "", originUrl: "" }),
    { url: "t3code://", prefilled: false },
  );
  const large = localAppLaunch("codex", "🪐".repeat(10000), {
    path: "",
    originUrl: "",
  });
  assert.equal(large.prefilled, false);
  assert.equal(large.url, "codex://threads/new");
  for (const path of [
    "/Users/me/repo",
    "C:\\code\\repo",
    "\\\\host\\share\\repo",
    "",
  ])
    assert.equal(validLocalPath(path), true);
  for (const path of ["~/repo", "../repo", "/repo\ncommand"])
    assert.equal(validLocalPath(path), false);
  assert.equal(validGitOrigin("https://token@github.com/team/repo.git"), false);
  assert.equal(validGitOrigin("ssh://git@github.com/team/repo.git"), true);
  assert.equal(validGitOrigin("javascript:alert(1)"), false);
});

test("personal local agents, immutable handoffs, scoped file links, expiry and revocation over HTTP", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_handoffs_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const root = await mkdtemp(join(tmpdir(), "spectron-handoff-test-"));
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await migrateDatabase(db);
  await migrateDatabase(db);
  const origin = "http://localhost:5173";
  const auth = createAuth(db, {
    appURL: origin,
    secret: "local-handoff-test-secret-at-least-32-characters",
    sendResetEmail: async () => {},
    sendMagicLinkEmail: async () => {},
    sendVerificationEmail: async () => {},
  });
  // No provider keys or connection configuration is required for local agents.
  const api = createAPI(auth, {
    db,
    appURL: origin,
    fileStorage: { root, maxBytes: 1024 },
  });
  async function register(name: string) {
    const response = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email: `${name}@example.test`,
        password: "a long handoff test password",
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  }
  const owner = await register("owner"),
    member = await register("member"),
    outsider = await register("outsider");
  async function call<T>(
    procedure: string,
    actor: typeof owner,
    input: unknown,
    mutation = false,
    status = 200,
  ): Promise<T> {
    const response = await api.request(
      `${origin}/api/trpc/${procedure}${mutation ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: {
          origin,
          cookie: actor.cookie,
          "content-type": "application/json",
        },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as { result?: { data: T } }).result
      ?.data as T;
  }
  const project = await call<{ id: string }>(
    "projects.create",
    owner,
    { name: "Local work", key: "LOCAL" },
    true,
  );
  const another = await call<{ id: string }>(
    "projects.create",
    owner,
    { name: "Private work", key: "OTHER" },
    true,
  );
  await db
    .insert(schema.projectMember)
    .values({ projectId: project.id, userId: member.id, role: "member" });
  const issue = await call<{ id: string }>(
    "issues.create",
    owner,
    {
      projectId: project.id,
      title: "Launch local work",
      description: "Keep the existing behavior.",
    },
    true,
  );
  const agentInput = {
    name: "My Codex",
    localApp: "codex",
    connectionId: null,
    avatar: null,
    model: "",
    effort: null,
    role: "Developer",
    instructions: "Run the relevant checks.",
  };
  const agent = await call<{ id: string }>(
    "ai.createAgent",
    owner,
    agentInput,
    true,
  );
  const t3 = await call<{ id: string }>(
    "ai.createAgent",
    owner,
    { ...agentInput, name: "My T3 Code", localApp: "t3code" },
    true,
  );
  const agents = await call<{ id: string; revision: number; provider: null }[]>(
    "ai.agents",
    owner,
    undefined,
  );
  assert.equal(agents.length, 2);
  assert.equal(agents[0]!.provider, null);
  assert.equal(
    (await call<unknown[]>("ai.available", member, { projectId: project.id }))
      .length,
    0,
  );
  assert.equal(
    (await call<unknown[]>("ai.available", owner, { projectId: project.id }))
      .length,
    2,
  );
  await call(
    "ai.setSharing",
    owner,
    {
      id: agent.id,
      revision: agents[0]!.revision,
      projectId: project.id,
      visibility: "project",
      memberIds: [],
    },
    true,
    400,
  );
  const scope = { projectId: project.id, issueId: issue.id };
  await call(
    "comments.create",
    member,
    {
      ...scope,
      parentId: null,
      body: [{ type: "text", text: "Agreed: keep the keyboard shortcut." }],
      files: [],
    },
    true,
  );
  async function upload(projectId: string, filename: string) {
    const response = await api.request(
      `${origin}/api/files/upload?projectId=${projectId}&filename=${filename}`,
      {
        method: "POST",
        headers: { origin, cookie: owner.cookie },
        body: "attachment contents",
      },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()) as { projectFileId: string };
  }
  const file = await upload(project.id, "notes.txt"),
    privateFile = await upload(another.id, "private.txt"),
    unrelated = await upload(project.id, "unrelated.txt");
  const input = {
    ...scope,
    requestId: createId(),
    agentId: agent.id,
    command: "implement",
    repositoryId: null,
    message: "Please fix this issue.",
    fileIds: [file.projectFileId],
  };
  await call("handoffs.create", member, input, true, 404);
  await call("handoffs.create", outsider, input, true, 404);
  await call(
    "handoffs.create",
    owner,
    { ...input, fileIds: [privateFile.projectFileId] },
    true,
    404,
  );
  const [first, duplicate] = await Promise.all([
    call<LocalHandoffView>("handoffs.create", owner, input, true),
    call<LocalHandoffView>("handoffs.create", owner, input, true),
  ]);
  assert.equal(first.id, duplicate.id);
  const flow = await call<
    { id: string; lastActivity: { preview: string; createdAt: string } }[]
  >("issues.list", owner, { projectId: project.id });
  const activity = flow.find((row) => row.id === issue.id)!.lastActivity;
  assert.equal(activity.preview, "Passing work to My Codex");
  assert.equal(activity.createdAt, first.createdAt);
  assert.equal(
    (await pool.query("SELECT count(*) FROM agent_runs")).rows[0].count,
    "0",
  );
  const ref = { ...scope, id: first.id };
  const draft = await call<LocalHandoffDraft>("handoffs.draft", owner, ref);
  assert.match(draft.summary, /Please fix this issue/);
  assert.match(draft.summary, /keyboard shortcut/);
  assert.match(draft.summary, /Run the relevant checks/);
  await call("comments.create", member, {
    ...scope,
    parentId: null,
    body: [{ type: "text", text: "Later comment after handoff" }],
    files: [],
  }, true);
  const afterComment = await call<
    { id: string; lastActivity: { preview: string } }[]
  >("issues.list", owner, { projectId: project.id });
  assert.equal(afterComment.find(row => row.id === issue.id)!.lastActivity.preview, "Later comment after handoff");
  assert.equal((await call<LocalHandoffDraft>("handoffs.draft", owner, ref)).summary, draft.summary);
  await call("handoffs.draft", member, ref, false, 404);
  const publicList = await call<LocalHandoffView[]>(
    "handoffs.list",
    member,
    scope,
  );
  assert.equal(publicList.length, 1);
  assert.doesNotMatch(
    JSON.stringify(publicList),
    /token|summary|fileToken|originUrl/,
  );
  await call("handoffs.list", outsider, scope, false, 404);
  await call("handoffs.markLaunch", member, ref, true, 404);
  await call("handoffs.markLaunch", owner, ref, true);
  assert.ok(
    (await call<LocalHandoffView[]>("handoffs.list", owner, scope))[0]!
      .launchRequestedAt,
  );
  const fileURL = draft.summary.match(
    /\]\((http[^\s)]+\/api\/files\/[^\s)]+)\)/,
  )![1]!;
  let response = await api.request(fileURL);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "attachment contents");
  assert.equal(response.headers.get("cache-control"), "no-store");
  response = await api.request(fileURL, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  response = await api.request(fileURL, { headers: { range: "bytes=0-4" } });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "attac");
  assert.equal(
    (
      await api.request(
        fileURL.replace(file.projectFileId, unrelated.projectFileId),
      )
    ).status,
    404,
  );
  const invalid = new URL(fileURL);
  invalid.searchParams.set("token", "0".repeat(64));
  assert.equal((await api.request(invalid.toString())).status, 404);
  await db
    .update(schema.localHandoff)
    .set({ filesExpireAt: new Date(Date.now() - 1) })
    .where(eq(schema.localHandoff.id, first.id));
  assert.equal((await api.request(fileURL)).status, 404);
  await db
    .update(schema.localHandoff)
    .set({ filesExpireAt: new Date(Date.now() + 86400000) })
    .where(eq(schema.localHandoff.id, first.id));
  await call("handoffs.revokeFiles", owner, ref, true);
  assert.equal((await api.request(fileURL)).status, 404);
  assert.doesNotMatch(
    (await call<LocalHandoffDraft>("handoffs.draft", owner, ref)).summary,
    /token=/,
  );
  const t3Handoff = await call<LocalHandoffView>(
    "handoffs.create",
    owner,
    { ...input, requestId: createId(), agentId: t3.id },
    true,
  );
  assert.equal(t3Handoff.application, "t3code");
  const t3Ref = { ...scope, id: t3Handoff.id },
    t3Draft = await call<LocalHandoffDraft>("handoffs.draft", owner, t3Ref);
  await db
    .update(schema.issue)
    .set({ title: "Changed after handoff" })
    .where(eq(schema.issue.id, issue.id));
  assert.equal(
    (await call<LocalHandoffDraft>("handoffs.draft", owner, t3Ref)).summary,
    t3Draft.summary,
  );
  const t3URL = t3Draft.summary.match(
    /\]\((http[^\s)]+\/api\/files\/[^\s)]+)\)/,
  )![1]!;
  await pool.query(
    "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
    [project.id, owner.id],
  );
  assert.equal((await api.request(t3URL)).status, 404);
  await call("handoffs.draft", owner, t3Ref, false, 404);
});
