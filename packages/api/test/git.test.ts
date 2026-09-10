import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth, createGitService, IssueInputError, type GitAdapterFactory } from "@spectron/backend";
import { createId, type GitConnectionSummary, type GitRepository, type GitRemoteRepository } from "@spectron/shared";
import { createAPI } from "../src/index";
import { encryptGitToken, decryptGitToken } from "../../backend/src/git/credentials";
import { createGitAdapterFactory, validateBranch } from "../../backend/src/git/provider";
import { createGitTransport, normalizeGitBaseURL, gitStatusError } from "../../backend/src/git/transport";
const secret = "git-test-only-encryption-secret-at-least-32-characters";

test("Git credentials are encrypted and bound to the project, creator and instance", () => {
  const ciphertext = encryptGitToken("test-token", "project:creator:instance", secret);
  assert.ok(!ciphertext.includes("test-token"));
  assert.notEqual(ciphertext, encryptGitToken("test-token", "project:creator:instance", secret));
  assert.equal(decryptGitToken(ciphertext, "project:creator:instance", secret), "test-token");
  assert.throws(() => decryptGitToken(ciphertext, "other:creator:instance", secret), /cannot be decrypted/);
  assert.throws(() => decryptGitToken(ciphertext, "project:creator:instance", secret + "changed"), /cannot be decrypted/);
  assert.throws(() => encryptGitToken("token", "binding"), /INTEGRATION_SECRET/);
  assert.throws(() => encryptGitToken("contains whitespace", "binding", secret), /without whitespace/);
});
test("Git transport rejects credential URLs, unapproved private networks and unsafe refs", async () => {
  for (const url of ["http://git.example", "https://u:token@git.example", "https://git.example?token=secret", "https://git.example#secret", "file:///etc/passwd"]) assert.throws(() => normalizeGitBaseURL("gitlab", url));
  assert.throws(() => normalizeGitBaseURL("github", "https://github.com.evil.test"));
  assert.equal(normalizeGitBaseURL("gitlab", "https://git.example/team/"), "https://git.example/team");
  await assert.rejects(createGitTransport()(new URL("https://127.0.0.1/api/v4/user"), {}), /GITLAB_ALLOWED_PRIVATE_ORIGINS/);
  await assert.rejects(createGitTransport(["https://127.0.0.1:1"])(new URL("https://127.0.0.1:1/api/v4/user"), { "PRIVATE-TOKEN": "secret-token" }), e => e instanceof Error && !e.message.includes("secret-token") && /Could not reach/.test(e.message));
  for (const branch of ["", "--help", "main\ncommand", "a..b", "a.lock", "a/.b", "a//b", "a@{b", "a b", "a\\b"]) assert.throws(() => validateBranch(branch));
  assert.equal(validateBranch("release/v1"), "release/v1");
  for (const status of [401, 403, 404, 429, 500, 302]) assert.ok(gitStatusError(status) instanceof IssueInputError);
});
test("Git DNS mode handles VPN answers without allowing private destinations", async () => {
  const modes: string[] = [];
  const transport = createGitTransport([], { dns: "cloudflare", resolve: async (_host, _signal, mode) => {
    modes.push(mode!); return [{ address: "198.18.0.50", family: 4 }];
  } });
  await assert.rejects(transport(new URL("https://api.github.com/user"), {}), e => e instanceof Error && e.message.startsWith("GitHub resolves") && !e.message.includes("GITLAB_ALLOWED_PRIVATE_ORIGINS"));
  assert.deepEqual(modes, ["cloudflare"]);
  const privateTransport = createGitTransport(["https://git.internal"], { dns: "cloudflare", resolve: async (_host, _signal, mode) => {
    modes.push(mode!); return [];
  } });
  await assert.rejects(privateTransport(new URL("https://git.internal/api/v4/user"), {}), /could not be resolved/);
  assert.deepEqual(modes, ["cloudflare", "system"]);
});
test("Both adapters use scoped authenticated endpoints, pagination and safe metadata", async () => {
  for (const provider of ["github", "gitlab"] as const) {
    const github = provider === "github", baseURL = github ? "https://github.com" : "https://git.example/team";
    const fullName = github ? "owner/repo" : "group/subgroup/repo";
    const remote = { id: 123, full_name: fullName, path_with_namespace: fullName, default_branch: "main", archived: false, clone_url: "https://token@evil.test/repo.git", http_url_to_repo: "https://token@evil.test/repo.git" };
    const calls: string[] = [];
    const adapter = createGitAdapterFactory(async (url, headers) => {
      calls.push(url.href);
      assert.equal(url.origin, github ? "https://api.github.com" : "https://git.example");
      assert.equal(headers[github ? "Authorization" : "PRIVATE-TOKEN"], github ? "Bearer private-token" : "private-token");
      if (url.pathname.endsWith("/user")) return { id: 7, login: "dev", username: "dev", name: "Developer", email: null, commit_email: "dev@git.example" };
      if (url.search) { assert.equal(url.searchParams.get("page"), "2"); assert.equal(url.searchParams.get("per_page"), "50"); if (!github) assert.equal(url.searchParams.get("membership"), "true"); return Array.from({ length: 50 }, () => remote); }
      if (url.pathname.includes("/branches/")) return { name: "release/v1", commit: { sha: "abc", id: "abc" } };
      return remote;
    })({ provider, baseURL }, "private-token");
    const actor = await adapter.actor(); assert.equal(actor.login, "dev"); assert.equal(actor.email, github ? null : "dev@git.example");
    const page = await adapter.repositories(2); assert.equal(page.nextPage, 3); assert.equal(page.items.length, 50);
    const repo = await adapter.repository(fullName, "123"); assert.equal(repo.cloneURL, `${baseURL}/${fullName}.git`); assert.ok(!JSON.stringify(repo).includes("token"));
    await adapter.branch(repo, "release/v1"); assert.ok(calls.at(-1)?.endsWith("release%2Fv1"));
    await assert.rejects(adapter.repository(fullName, "124"), /identity changed/);
    await assert.rejects(adapter.repository("../evil", "123"));
  }
  const failing = createGitAdapterFactory(async () => { throw new Error("private-token"); })({ provider: "github", baseURL: "https://github.com" }, "private-token");
  await assert.rejects(failing.actor(), e => e instanceof Error && !e.message.includes("private-token"));
  const redirect = createGitAdapterFactory(async () => { throw gitStatusError(302); })({ provider: "github", baseURL: "https://github.com" }, "token");
  await assert.rejects(redirect.actor(), /redirected/);
});

test("Git project API, identity, defaults, authorization and concurrency", async t => {
  const adminURL = process.env.TEST_DATABASE_URL || "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const admin = createDatabase(adminURL), databaseName = `test_git_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(adminURL); url.pathname = `/${databaseName}`;
  const { db, pool } = createDatabase(url.toString());
  t.after(async () => { await pool.end(); await admin.pool.query(`DROP DATABASE "${databaseName}"`); await admin.pool.end(); });
  await migrateDatabase(db); await migrateDatabase(db);
  const origin = "http://localhost:5173", auth = createAuth(db, { appURL: origin, secret, sendResetEmail: async () => {} });
  let calls = 0, expired = false, block: (() => Promise<void>) | null = null;
  const fakeFactory: GitAdapterFactory = (connection, token) => {
    const remote = (id: string): GitRemoteRepository => ({ externalId: id, fullName: `team/repo${id}`, defaultBranch: id === "99" ? null : "main", archived: false, webURL: `${connection.baseURL}/team/repo${id}`, cloneURL: `${connection.baseURL}/team/repo${id}.git` });
    async function request() { calls++; if (expired) throw gitStatusError(401); if (block) await block(); }
    return {
      actor: async () => { await request(); return { id: token === "replacement" ? "2" : "1", login: token === "replacement" ? "replacement-user" : "provider-user", name: "Provider User", email: "provider@example.test" }; },
      repositories: async () => { await request(); return { items: [remote("1"), remote("2")], nextPage: null }; },
      repository: async (_fullName, id) => { await request(); if (id === "404") throw gitStatusError(404); return remote(id); },
      branch: async (_repo, name) => { await request(); if (name === "missing") throw gitStatusError(404); },
    };
  };
  const api = createAPI(auth, { db, appURL: origin, integrationSecret: secret, gitAdapterFactory: fakeFactory });
  async function register(label: string) {
    const response = await api.request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: label, email: `${label}@example.test`, password: "a-long-test-only-password" }) });
    assert.equal(response.status, 200);
    return { cookie: response.headers.getSetCookie().map(v => v.split(";")[0]).join("; "), id: (await pool.query("SELECT id FROM users WHERE email=$1", [`${label}@example.test`])).rows[0].id as string };
  }
  const owner = await register("owner"), member = await register("member"), outsider = await register("outsider");
  async function call(procedure: string, cookie: string, input: unknown, mutation = false, status = 200, requestOrigin: string | null = origin) {
    const endpoint = `${origin}/api/trpc/${procedure.includes(".") ? procedure : `git.${procedure}`}`;
    const response = await api.request(mutation ? endpoint : `${endpoint}?input=${encodeURIComponent(JSON.stringify(input))}`, { method: mutation ? "POST" : "GET", headers: { cookie, "content-type": "application/json", ...(requestOrigin ? { origin: requestOrigin } : {}) }, ...(mutation ? { body: JSON.stringify(input) } : {}) });
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as { result?: { data: unknown } }).result?.data;
  }
  const p1 = (await call("projects.create", owner.cookie, { name: "Git one", key: "GONE" }, true)) as { id: string };
  const p2 = (await call("projects.create", owner.cookie, { name: "Git two", key: "GTWO" }, true)) as { id: string };
  await pool.query("INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,'member')", [p1.id, member.id]);
  const projectId = p1.id;
  const ref = (v: { id: string; revision: number }) => ({ projectId, id: v.id, revision: v.revision });
  const connectionList = () => call("connections", owner.cookie, { projectId }) as Promise<GitConnectionSummary[]>;
  const repositories = () => call("repositories", owner.cookie, { projectId }) as Promise<GitRepository[]>;
  const create = (provider: "github" | "gitlab") => call("createConnection", owner.cookie, { projectId, provider, name: provider, baseURL: provider === "github" ? "https://github.com" : "https://git.example/team", token: "original-secret" }, true) as Promise<GitConnectionSummary>;
  const check = async (c: GitConnectionSummary) => (await call("checkConnection", owner.cookie, ref(c), true) as { connection: GitConnectionSummary }).connection;
  let gh: GitConnectionSummary, gl: GitConnectionSummary;
  await t.test("authentication, owner-only configuration, CSRF, input and encryption", async () => {
    await call("connections", "", { projectId }, false, 401);
    for (const u of [member, outsider]) await call("connections", u.cookie, { projectId }, false, 404);
    const input = { projectId, provider: "github", name: "Git", baseURL: "https://github.com", token: "original-secret" };
    await call("createConnection", member.cookie, input, true, 404);
    await call("createConnection", owner.cookie, input, true, 403, "https://evil.test");
    await call("createConnection", owner.cookie, input, true, 403, null);
    await call("createConnection", owner.cookie, { ...input, creatorId: outsider.id }, true, 400);
    await call("createConnection", owner.cookie, { ...input, baseURL: "https://evil.test" }, true, 400);
    await call("createConnection", owner.cookie, { ...input, name: " " }, true, 400);
    await assert.rejects(createGitService(db).createConnection(owner.id, projectId, { ...input, provider: "github" }), /INTEGRATION_SECRET/);
    gh = await create("github"); gl = await create("gitlab");
    assert.equal(gh.checkStatus, "untested"); assert.equal(gh.creatorId, owner.id);
    const saved = (await pool.query("SELECT encrypted_token FROM git_connections WHERE id=$1", [gh.id])).rows[0].encrypted_token;
    assert.ok(!saved.includes("original-secret")); assert.ok(!JSON.stringify(await connectionList()).includes("original-secret"));
    assert.equal(calls, 0);
  });
  await t.test("identity checks, author configuration and scoped metadata", async () => {
    await call("browse", owner.cookie, { ...ref(gh), page: 1 }, false, 400);
    gh = await check(gh); gl = await check(gl);
    assert.equal(gh.actor?.login, "provider-user"); assert.equal(gh.commitAuthorName, "Provider User"); assert.equal(gh.commitAuthorEmail, "provider@example.test");
    const input = { ...ref(gh), name: "GitHub developer", commitAuthorName: "Explicit Author", commitAuthorEmail: "private@users.noreply.github.com" };
    gh = await call("updateConnection", owner.cookie, input, true) as GitConnectionSummary;
    gh = await check(gh); assert.equal(gh.commitAuthorName, "Explicit Author");
    await call("updateConnection", owner.cookie, { ...input, ...ref(gh), commitAuthorName: "bad\nname" }, true, 400);
    const before = calls;
    await call("browse", member.cookie, { ...ref(gh), page: 1 }, false, 404);
    await call("browse", owner.cookie, { ...ref(gh), projectId: p2.id, page: 1 }, false, 404);
    await call("deleteConnection", member.cookie, ref(gh), true, 404);
    await call("checkConnection", member.cookie, ref(gh), true, 404);
    assert.equal(calls, before);
    const page = await call("browse", owner.cookie, { ...ref(gh), page: 1 }); assert.ok(!JSON.stringify(page).includes("original-secret"));
  });
  await t.test("mixed providers, real branch validation, duplicate and cross-project selection", async () => {
    const add = (c: GitConnectionSummary, id: string, status = 200) => call("addRepository", owner.cookie, { ...ref(c), fullName: `team/repo${id}`, externalId: id }, true, status);
    await add(gh, "1"); await add(gl, "1"); await add(gh, "2");
    const rows = await repositories(); assert.equal(rows.length, 3); assert.equal(rows.filter(r => r.isDefault).length, 1); assert.equal(rows[0]!.targetBranch, "main");
    await add(gh, "1", 400); await add(gh, "99", 400); await add(gh, "404", 400);
    const duplicateConnection = await check(await create("github"));
    await add(duplicateConnection, "1", 400);
    await call("deleteConnection", owner.cookie, ref(duplicateConnection), true);
    await call("addRepository", owner.cookie, { ...ref(gh), projectId: p2.id, fullName: "team/repo3", externalId: "3" }, true, 404);
    await call("deleteConnection", owner.cookie, ref(gh), true, 400);
    assert.equal((await call("repositories", member.cookie, { projectId }) as GitRepository[]).length, 3);
    await call("repositories", outsider.cookie, { projectId }, false, 404);
    const service = createGitService(db, secret, fakeFactory);
    assert.equal((await service.authorizeRepositories(member.id, projectId, [rows[0]!.id])).length, 1);
    await assert.rejects(service.authorizeRepositories(owner.id, p2.id, [rows[0]!.id]), /outside this project/);
    await assert.rejects(service.authorizeRepositories(member.id, projectId, [createId()]), /outside this project/);
    assert.ok(!JSON.stringify(await repositories()).includes("encryptedToken"));
    // Composite FK rejects connection selection across projects even outside the service.
    await assert.rejects(pool.query("INSERT INTO git_repositories(id,project_id,connection_id,external_id,full_name,web_url,clone_url,target_branch) VALUES ($1,$2,$3,'9','team/repo9','https://github.com/team/repo9','https://github.com/team/repo9.git','main')", [createId(), p2.id, gh.id]), /foreign key/);
  });
  await t.test("default changes serialize; stale writes and invalid branches cannot overwrite settings", async () => {
    let rows = await repositories();
    const second = rows[1]!;
    await call("updateRepository", member.cookie, { ...ref(second), targetBranch: "release/v1", isDefault: true }, true, 404);
    await call("updateRepository", owner.cookie, { ...ref(second), targetBranch: "missing", isDefault: true }, true, 400);
    await call("updateRepository", owner.cookie, { ...ref(second), targetBranch: "release/v1", isDefault: true }, true);
    rows = await repositories(); assert.equal(rows.find(r => r.isDefault)?.id, second.id); assert.equal(rows[1]!.targetBranch, "release/v1");
    await call("updateRepository", owner.cookie, { ...ref(second), targetBranch: "main", isDefault: true }, true, 409);
    await call("updateRepository", owner.cookie, { ...ref(rows[1]!), targetBranch: "main", isDefault: false }, true, 400);
    const service = createGitService(db, secret, fakeFactory);
    await Promise.all([service.updateRepository(owner.id, { ...ref(rows[0]!), targetBranch: "main", isDefault: true }), service.updateRepository(owner.id, { ...ref(rows[2]!), targetBranch: "main", isDefault: true })]);
    rows = await repositories(); assert.equal(rows.filter(r => r.isDefault).length, 1);
    const currentDefault = rows.find(r => r.isDefault)!;
    await call("removeRepository", owner.cookie, ref(currentDefault), true);
    rows = await repositories(); assert.equal(rows.filter(r => r.isDefault).length, 1);
  });
  await t.test("expired credentials, replacement and delayed checks do not report stale identity", async () => {
    expired = true;
    const failed = await call("checkConnection", owner.cookie, ref(gh), true) as { connection: GitConnectionSummary; message: string };
    gh = failed.connection; assert.equal(gh.checkStatus, "failed"); assert.equal(gh.actor, null); assert.match(failed.message, /rejected/);
    expired = false;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
    block = async () => { entered(); await waiting; };
    const oldCheck = call("checkConnection", owner.cookie, ref(gh), true, 409);
    await started;
    gh = await call("updateConnection", owner.cookie, { ...ref(gh), name: gh.name, token: "replacement", commitAuthorName: gh.commitAuthorName, commitAuthorEmail: gh.commitAuthorEmail }, true) as GitConnectionSummary;
    release(); await oldCheck; block = null;
    assert.equal(gh.actor, null); assert.equal(gh.commitAuthorName, ""); assert.equal(gh.commitAuthorEmail, ""); assert.equal(gh.checkStatus, "untested");
    gh = await check(gh); assert.equal(gh.actor?.login, "replacement-user");
    assert.equal((await repositories()).every(r => [gh.id, gl.id].includes(r.connectionId)), true);
  });
  await t.test("owner revocation during a remote request prevents the pending save", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    block = async () => { entered(); await waiting; };
    const pending = call("addRepository", owner.cookie, { ...ref(gl), fullName: "team/repo8", externalId: "8" }, true, 404);
    await started;
    try {
      await pool.query("UPDATE project_members SET role='member' WHERE project_id=$1 AND user_id=$2", [projectId, owner.id]);
      release(); await pending;
      assert.equal((await pool.query("SELECT count(*) FROM git_repositories WHERE external_id='8'")).rows[0].count, "0");
    } finally {
      release(); block = null;
      await pool.query("UPDATE project_members SET role='owner' WHERE project_id=$1 AND user_id=$2", [projectId, owner.id]);
    }
  });
  await t.test("revoked membership and archived projects remove repository access", async () => {
    const service = createGitService(db, secret, fakeFactory), rows = await repositories();
    await pool.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [projectId, member.id]);
    await assert.rejects(service.authorizeRepositories(member.id, projectId, [rows[0]!.id]), /Project not found/);
    await call("repositories", member.cookie, { projectId }, false, 404);
    while ((await repositories()).length) await call("removeRepository", owner.cookie, ref((await repositories())[0]!), true);
    assert.equal((await repositories()).length, 0);
    await call("deleteConnection", owner.cookie, ref(gh), true); await call("deleteConnection", owner.cookie, ref(gl), true);
    assert.deepEqual(await connectionList(), []);
    await pool.query("UPDATE projects SET state='archived' WHERE id=$1", [projectId]);
    await call("repositories", owner.cookie, { projectId }, false, 404);
    await call("connections", owner.cookie, { projectId }, false, 404);
  });
});
