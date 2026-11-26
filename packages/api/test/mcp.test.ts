import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth } from "@spectron/backend";
import type { ProjectSummary } from "@spectron/shared";
import { createAPI } from "../src/index";

test("MCP server: OAuth discovery, sign-in, consent, tools and disconnect", async (t) => {
  const connection = process.env.TEST_DATABASE_URL || "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_mcp_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const root = await mkdtemp(join(tmpdir(), "spectron-mcp-test-"));
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await migrateDatabase(db);
  const origin = "http://localhost:5173";
  const resource = `${origin}/api/mcp`;
  const auth = createAuth(db, {
    appURL: origin,
    secret: "mcp-integration-test-secret-with-32-characters",
    sendResetEmail: async () => {},
    sendMagicLinkEmail: async () => {},
    sendVerificationEmail: async () => {},
  });
  const api = createAPI(auth, { db, appURL: origin, fileStorage: { root, maxBytes: 4 * 1024 * 1024 } });
  const request = (path: string, init: RequestInit = {}) => api.request(`${origin}${path}`, init);

  const register = async (email: string) => {
    const r = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: email.split("@")[0], email, password: "a long mcp test password" }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { user: { id: string } };
    return { id: body.user.id, email, cookie: r.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") };
  };
  const trpc = async <T>(procedure: string, actor: { cookie: string }, input?: unknown, mutation = true) => {
    const r = await request(
      `/api/trpc/${procedure}${mutation ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { origin, cookie: actor.cookie, "content-type": "application/json" },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as { result: { data: T } }).result.data;
  };
  const owner = await register("owner@example.test");
  const member = await register("member@example.test");
  const outsider = await register("outsider@example.test");
  await pool.query("UPDATE users SET email_verified = true");
  const project = await trpc<ProjectSummary>("projects.create", owner, { name: "Spectron", key: "SP" });
  await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member')", [
    project.id,
    member.id,
  ]);

  // --- Discovery -----------------------------------------------------------
  const anonymous = await request("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(anonymous.status, 401);
  const challenge = anonymous.headers.get("www-authenticate") ?? "";
  const metadataURL = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  assert.equal(metadataURL, `${origin}/.well-known/oauth-protected-resource/api/mcp`);
  const protectedResource = await request(new URL(metadataURL!).pathname);
  assert.equal(protectedResource.status, 200);
  assert.equal(protectedResource.headers.get("access-control-allow-origin"), "*");
  const prm = (await protectedResource.json()) as { resource: string; authorization_servers: string[] };
  assert.equal(prm.resource, resource);
  assert.deepEqual(prm.authorization_servers, [`${origin}/api/auth`]);
  const asMetadata = (await (await request("/.well-known/oauth-authorization-server/api/auth")).json()) as Record<
    string,
    unknown
  >;
  assert.equal(asMetadata.authorization_endpoint, `${origin}/api/auth/oauth2/authorize`);
  assert.equal(asMetadata.registration_endpoint, `${origin}/api/auth/oauth2/register`);
  assert.equal(asMetadata.client_id_metadata_document_supported, true);
  assert.deepEqual(asMetadata.code_challenge_methods_supported, ["S256"]);
  // Unrelated well-known paths are not answered by the auth server.
  assert.notEqual((await request("/.well-known/security.txt")).status, 200);
  // The JWT plugin's session-token endpoint is disabled: only OAuth issues JWTs.
  assert.equal((await request("/api/auth/token", { headers: { cookie: owner.cookie } })).status, 404);

  // --- Dynamic registration, sign-in redirect, consent, token -------------
  const redirectURI = "http://127.0.0.1:33418/callback";
  const registered = await request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Agent",
      redirect_uris: [redirectURI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.equal(registered.status, 201, await registered.clone().text());
  const clientId = ((await registered.json()) as { client_id: string }).client_id;

  const authorize = (actor: { cookie: string } | null, extra: Record<string, string> = {}) => {
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectURI,
      scope: "openid profile email offline_access",
      state: "s1",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource,
      ...extra,
    });
    return {
      verifier,
      response: request(`/api/auth/oauth2/authorize?${query}`, { headers: actor ? { cookie: actor.cookie } : {} }),
    };
  };
  const signedOut = await authorize(null).response;
  assert.equal(signedOut.status, 302);
  const login = new URL(signedOut.headers.get("location")!, origin);
  assert.equal(login.pathname, "/login");
  assert.ok(login.searchParams.get("sig"));
  assert.equal(login.searchParams.get("client_id"), clientId);

  const consentFor = async (actor: { cookie: string }) => {
    const flow = authorize(actor);
    const response = await flow.response;
    assert.equal(response.status, 302);
    const consent = new URL(response.headers.get("location")!, origin);
    assert.equal(consent.pathname, "/oauth/consent");
    return { verifier: flow.verifier, query: consent.search.slice(1) };
  };
  const decide = async (actor: { cookie: string }, query: string, accept: boolean) => {
    const r = await request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { origin, cookie: actor.cookie, "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: query }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    return new URL(((await r.json()) as { url: string }).url);
  };
  // The consent page shows the client's public details to the signed-in person.
  const publicClient = await request(`/api/auth/oauth2/public-client?client_id=${clientId}`, {
    headers: { cookie: owner.cookie },
  });
  assert.equal(((await publicClient.json()) as { client_name: string }).client_name, "Test Agent");

  const denied = await decide(owner, (await consentFor(owner)).query, false);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("code"), null);
  // A tampered signed query is refused.
  const tampered = (await consentFor(owner)).query.replace("state=s1", "state=evil");
  const refused = await request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { origin, cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: tampered }),
  });
  assert.notEqual(refused.status, 200);

  const exchange = async (body: Record<string, string>) => {
    const r = await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    return { status: r.status, body: (await r.json()) as { access_token?: string; refresh_token?: string } };
  };
  const connect = async (actor: { cookie: string }) => {
    const flow = await consentFor(actor);
    const callback = await decide(actor, flow.query, true);
    assert.equal(callback.origin + callback.pathname, redirectURI);
    assert.equal(callback.searchParams.get("state"), "s1");
    const tokens = await exchange({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: redirectURI,
      client_id: clientId,
      code_verifier: flow.verifier,
      resource,
    });
    assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
    return tokens.body as { access_token: string; refresh_token: string };
  };
  const ownerTokens = await connect(owner);
  const claims = JSON.parse(Buffer.from(ownerTokens.access_token.split(".")[1]!, "base64url").toString());
  assert.equal(claims.sub, owner.id);
  assert.ok((claims.aud as string[]).includes(resource));
  // Once consented, a new authorization skips the consent page.
  const again = await authorize(owner).response;
  assert.equal(new URL(again.headers.get("location")!).origin + new URL(again.headers.get("location")!).pathname, redirectURI);

  // --- MCP calls -------------------------------------------------------------
  let nextId = 1;
  const mcp = async (token: string, method: string, params?: unknown) => {
    const r = await request("/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
    });
    const text = await r.text();
    if (r.status !== 200) return { status: r.status, text };
    const data = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
    return { status: 200, text, message: JSON.parse(data!) as { result?: any; error?: any } };
  };
  const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const r = await mcp(token, "tools/call", { name, arguments: args });
    assert.equal(r.status, 200, r.text);
    const result = r.message!.result as { isError?: boolean; content: { text: string }[]; structuredContent?: any };
    return result.isError ? { error: result.content[0]!.text } : { value: result.structuredContent };
  };
  const ok = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const r = await tool(token, name, args);
    assert.ok("value" in r, `${name} failed: ${(r as { error: string }).error}`);
    return r.value;
  };
  const access = ownerTokens.access_token;
  const initialized = await mcp(access, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(initialized.status, 200, initialized.text);
  assert.equal(initialized.message!.result.serverInfo.name, "spectron");
  assert.match(initialized.message!.result.instructions, /Spectron key/);
  const listed = await mcp(access, "tools/list");
  assert.deepEqual(
    (listed.message!.result.tools as { name: string }[]).map((tool) => tool.name).sort(),
    [
      "add_comment",
      "create_issue",
      "get_issue",
      "get_project",
      "list_attachments",
      "list_comments",
      "list_projects",
      "search_issues",
      "update_issue",
      "upload_file",
      "whoami",
    ],
  );
  const searchTool = (listed.message!.result.tools as { name: string; inputSchema: any; annotations: any }[]).find(
    (tool) => tool.name === "search_issues",
  )!;
  assert.equal(searchTool.annotations.readOnlyHint, true);
  assert.ok(searchTool.inputSchema.properties.dueBefore);

  const whoami = await ok(access, "whoami");
  assert.equal(whoami.userId, owner.id);
  assert.equal(whoami.via, `oauth:${clientId}`);
  assert.deepEqual(whoami.projects.map((p: { key: string }) => p.key), ["SP"]);
  const detail = await ok(access, "get_project", { project: "SP" });
  assert.ok(detail.statuses.some((s: { name: string }) => s.name === "In progress"));

  const created = await ok(access, "create_issue", {
    project: "SP",
    title: "Wire up MCP",
    priority: "High",
    assignee: member.email,
    dueAt: "2026-12-20",
  });
  assert.equal(created.key, "SP-1");
  assert.equal(created.assignee.id, member.id);
  assert.equal(created.dueAt, "2026-12-20T00:00:00.000Z");
  const moved = await ok(access, "update_issue", { issue: "SP-1", status: "In progress" });
  assert.equal(moved.status.name, "In progress");
  const noChange = await tool(access, "update_issue", { issue: "SP-1" });
  assert.match((noChange as { error: string }).error, /at least one field/);
  const badStatus = await tool(access, "update_issue", { issue: "SP-1", status: "Shipped" });
  assert.match((badStatus as { error: string }).error, /^invalid_input: Unknown status "Shipped"/);
  const found = await ok(access, "search_issues", {
    statusCategory: ["in_progress"],
    dueBefore: "2027-01-01",
    sort: "due",
  });
  assert.deepEqual(found.issues.map((i: { key: string }) => i.key), ["SP-1"]);
  const notFound = await tool(access, "get_issue", { issue: "SP-404" });
  assert.match((notFound as { error: string }).error, /^not_found:/);
  const invalidArgs = await mcp(access, "tools/call", { name: "get_issue", arguments: { issue: 42 } });
  assert.equal(invalidArgs.message!.result.isError, true);
  assert.match(invalidArgs.message!.result.content[0].text, /expected string/);

  const uploaded = await ok(access, "upload_file", {
    issue: "SP-1",
    filename: "notes.txt",
    contentBase64: Buffer.from("agent notes\n").toString("base64"),
  });
  assert.equal(uploaded.filename, "notes.txt");
  assert.equal(uploaded.sizeBytes, 12);
  const attachments = await ok(access, "list_attachments", { issue: "SP-1" });
  assert.deepEqual(attachments.attachments.map((a: { id: string }) => a.id), [uploaded.id]);
  const loose = await ok(access, "upload_file", {
    project: "SP",
    filename: "log.txt",
    contentBase64: Buffer.from("log").toString("base64"),
  });
  const empty = await tool(access, "upload_file", { issue: "SP-1", filename: "e.txt", contentBase64: "====" });
  assert.match((empty as { error: string }).error, /empty/);
  const comment = await ok(access, "add_comment", {
    issue: "SP-1",
    body: `Picking this up <@${member.email}>`,
    attachments: [loose.id],
  });
  assert.equal(comment.body, `Picking this up <@${member.id}>`);
  assert.deepEqual(comment.attachments.map((a: { filename: string }) => a.filename), ["log.txt"]);
  const comments = await ok(access, "list_comments", { issue: "SP-1" });
  assert.deepEqual(comments.comments.map((c: { id: string }) => c.id), [comment.id]);
  const history = await pool.query("SELECT actor_user_id FROM issue_history WHERE issue_id = $1", [created.id]);
  assert.ok(history.rows.every((row) => row.actor_user_id === owner.id));

  // Oversized bodies are refused before parsing.
  const huge = await request("/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: "x".repeat(6 * 1024 * 1024),
  });
  assert.equal(huge.status, 413);

  // --- Isolation and token checks -------------------------------------------
  const outsiderTokens = await connect(outsider);
  const blocked = await tool(outsiderTokens.access_token, "get_issue", { issue: created.id });
  assert.match((blocked as { error: string }).error, /^not_found:/);
  assert.deepEqual((await ok(outsiderTokens.access_token, "search_issues")).issues, []);
  const forged = access.slice(0, -4) + (access.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal((await mcp(forged, "tools/list")).status, 401);
  // Tokens only act for verified accounts.
  await pool.query("UPDATE users SET email_verified = false WHERE id = $1", [outsider.id]);
  assert.equal((await mcp(outsiderTokens.access_token, "tools/list")).status, 403);
  await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [outsider.id]);

  // --- Refresh and disconnect -----------------------------------------------
  const refreshed = await exchange({
    grant_type: "refresh_token",
    refresh_token: ownerTokens.refresh_token,
    client_id: clientId,
    resource,
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.equal((await mcp(refreshed.body.access_token!, "tools/list")).status, 200);
  const apps = await trpc<{ clientId: string; name: string }[]>("oauthApps.list", owner, undefined, false);
  assert.deepEqual(apps.map((app) => [app.clientId, app.name]), [[clientId, "Test Agent"]]);
  await trpc("oauthApps.disconnect", owner, { clientId });
  assert.deepEqual(await trpc("oauthApps.list", owner, undefined, false), []);
  const cutOff = await mcp(refreshed.body.access_token!, "tools/list");
  assert.equal(cutOff.status, 401);
  const afterDisconnect = await exchange({
    grant_type: "refresh_token",
    refresh_token: refreshed.body.refresh_token!,
    client_id: clientId,
    resource,
  });
  assert.notEqual(afterDisconnect.status, 200);
  // The outsider's connection to the same client is untouched.
  assert.equal((await mcp(outsiderTokens.access_token, "tools/list")).status, 200);
  // Disconnecting someone else's app is a no-op.
  await trpc("oauthApps.disconnect", owner, { clientId });
  assert.equal((await mcp(outsiderTokens.access_token, "tools/list")).status, 200);

  // --- Personal access tokens work too --------------------------------------
  const pat = await trpc<{ token: string }>("apiTokens.create", member, { name: "Codex", expiresInDays: 30 });
  const viaToken = await ok(pat.token, "whoami");
  assert.equal(viaToken.userId, member.id);
  assert.equal(viaToken.via, "token:Codex");
  assert.equal((await ok(pat.token, "get_issue", { issue: "SP-1" })).title, "Wire up MCP");
  const badPat = await mcp("spk_not-a-real-token", "tools/list");
  assert.equal(badPat.status, 401);
});
