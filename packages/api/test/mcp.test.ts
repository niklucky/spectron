import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth, createOAuthAppService } from "@spectron/backend";
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
  // Client/consent management, OIDC logout, UserInfo and introspection are off.
  for (const [method, path] of [
    ["GET", "/api/auth/oauth2/userinfo"],
    ["GET", "/api/auth/oauth2/get-clients"],
    ["POST", "/api/auth/oauth2/create-client"],
    ["POST", "/api/auth/oauth2/delete-consent"],
    ["GET", "/api/auth/oauth2/get-consents"],
    ["POST", "/api/auth/oauth2/introspect"],
    ["GET", "/api/auth/oauth2/end-session"],
  ] as const)
    assert.equal(
      (await request(path, { method, headers: { origin, cookie: owner.cookie, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) })).status,
      404,
      path,
    );

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
  for (const extra of [
    { backchannel_logout_uri: "https://127.0.0.1.nip.io/logout" },
    { jwks_uri: "https://example.test/jwks.json", token_endpoint_auth_method: "private_key_jwt" },
  ]) {
    const refusedClient = await request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Fetches", redirect_uris: [redirectURI], token_endpoint_auth_method: "none", ...extra }),
    });
    assert.equal(refusedClient.status, 400, JSON.stringify(extra));
    assert.equal(((await refusedClient.json()) as { error: string }).error, "invalid_client_metadata");
  }

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

  await pool.query("UPDATE users SET email_verified = false WHERE id = $1", [member.id]);
  const unverifiedConsent = await request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { origin, cookie: member.cookie, "content-type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: (await consentFor(member)).query }),
  });
  assert.equal(unverifiedConsent.status, 403);
  assert.match(((await unverifiedConsent.json()) as { message: string }).message, /Verify your email/);
  // Cancelling still works, so the client hears access_denied.
  const unverifiedCancel = await decide(member, (await consentFor(member)).query, false);
  assert.equal(unverifiedCancel.searchParams.get("error"), "access_denied");
  await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [member.id]);
  // The SPA resumes a signed request for an existing session via /continue,
  // and the server re-verifies the signature.
  const signedLogin = login.search.slice(1);
  const resumed = await request("/api/auth/oauth2/continue", {
    method: "POST",
    headers: { origin, cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ created: true, oauth_query: signedLogin }),
  });
  assert.equal(resumed.status, 200);
  assert.match(((await resumed.json()) as { url: string }).url, /^\/oauth\/consent\?/);
  const forgedResume = await request("/api/auth/oauth2/continue", {
    method: "POST",
    headers: { origin, cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ created: true, oauth_query: signedLogin.replace("state=s1", "state=s2") }),
  });
  assert.equal(forgedResume.status, 400);
  // Signing in with the signed request resumes authorization as part of sign-in.
  const signIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: owner.email, password: "a long mcp test password", oauth_query: signedLogin }),
  });
  assert.equal(signIn.status, 200);
  assert.match(((await signIn.json()) as { url: string }).url, /^\/oauth\/consent\?/);

  // Login links resume through /api/oauth/resume, which verifies the signed
  // request and the session's freshness itself.
  const resume = (query: string, cookie?: string) =>
    request(`/api/oauth/resume?${query}`, { headers: cookie ? { cookie } : {} });
  const resumeTarget = (response: Response) => new URL(response.headers.get("location")!, origin);
  assert.equal(resumeTarget(await resume("client_id=x")).search, "?oauth_expired=1");
  assert.equal(resumeTarget(await resume(signedLogin.replace("state=s1", "state=s9"), owner.cookie)).search, "?oauth_expired=1");
  assert.equal(resumeTarget(await resume(signedLogin)).pathname, "/login");
  const resumed2 = resumeTarget(await resume(signedLogin, owner.cookie));
  assert.equal(resumed2.pathname, "/api/auth/oauth2/authorize");
  assert.equal(resumed2.searchParams.get("sig"), null);
  assert.equal(resumed2.searchParams.get("state"), "s1");
  // prompt=login needs a session created after the request was issued.
  const loginPrompt = authorize(owner, { prompt: "login" });
  const loginPage = new URL((await loginPrompt.response).headers.get("location")!, origin);
  assert.equal(loginPage.pathname, "/login");
  assert.equal(resumeTarget(await resume(loginPage.search.slice(1), owner.cookie)).pathname, "/login");
  const freshSignIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: owner.email, password: "a long mcp test password" }),
  });
  const freshCookie = freshSignIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const afterFresh = resumeTarget(await resume(loginPage.search.slice(1), freshCookie));
  assert.equal(afterFresh.pathname, "/api/auth/oauth2/authorize");
  assert.equal(afterFresh.searchParams.get("prompt"), null);
  // prompt=create: a session from a sign-up after the request satisfies it.
  const createPage = new URL((await authorize(null, { prompt: "create" }).response).headers.get("location")!, origin);
  const newcomer = await register("newcomer@example.test");
  const afterCreate = resumeTarget(await resume(createPage.search.slice(1), newcomer.cookie));
  assert.equal(afterCreate.pathname, "/api/auth/oauth2/authorize");
  assert.equal(afterCreate.searchParams.get("prompt"), null);

  const exchange = async (body: Record<string, string>, headers: Record<string, string> = {}) => {
    const r = await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(body),
    });
    return {
      status: r.status,
      body: (await r.json()) as { access_token?: string; refresh_token?: string; token_type?: string },
    };
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
      "read_file",
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
  const readBack = await mcp(access, "tools/call", { name: "read_file", arguments: { project: "SP", fileId: uploaded.id } });
  assert.deepEqual(readBack.message!.result.content, [{ type: "text", text: "agent notes\n" }]);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const image = await ok(access, "upload_file", { project: "SP", filename: "dot.png", contentBase64: png.toString("base64") });
  const imageBack = await mcp(access, "tools/call", { name: "read_file", arguments: { project: "SP", fileId: image.id } });
  assert.equal(imageBack.message!.result.content[0].type, "image");
  assert.equal(imageBack.message!.result.content[0].mimeType, "image/png");
  const notMine = await tool(access, "read_file", { project: "SP", fileId: "aaaaaaaaaaaaaaaaaaaaa" });
  assert.match((notMine as { error: string }).error, /^not_found:/);
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
  // A browser Origin must be Spectron's own; native clients send none.
  const fromElsewhere = await request("/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, origin: "https://evil.example", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(fromElsewhere.status, 403);
  const fromSpectron = await request("/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, origin, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(fromSpectron.status, 200);
  // Malformed credentials are a bad request, not a prompt to sign in.
  for (const authorization of ["Basic abc", "Bearer", "Token xyz"]) {
    const malformed = await request("/api/mcp", { method: "POST", headers: { authorization, "content-type": "application/json" }, body: "{}" });
    assert.equal(malformed.status, 400, authorization);
    assert.match(malformed.headers.get("www-authenticate") ?? "", /error="invalid_request"/);
  }

  // --- Isolation and token checks -------------------------------------------
  const outsiderTokens = await connect(outsider);
  const blocked = await tool(outsiderTokens.access_token, "get_issue", { issue: created.id });
  assert.match((blocked as { error: string }).error, /^not_found:/);
  assert.deepEqual((await ok(outsiderTokens.access_token, "search_issues")).issues, []);
  const forged = access.slice(0, -4) + (access.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal((await mcp(forged, "tools/list")).status, 401);
  // Tokens only act for verified accounts.
  await pool.query("UPDATE users SET email_verified = false WHERE id = $1", [outsider.id]);
  const unverifiedCall = await request("/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${outsiderTokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(unverifiedCall.status, 403);
  // Re-authorizing cannot fix this, so no Bearer challenge (RFC 6750 §3.1).
  assert.equal(unverifiedCall.headers.get("www-authenticate"), null);
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
  // A code issued before disconnecting must not be redeemable afterwards.
  const pending = authorize(owner);
  const pendingCode = new URL((await pending.response).headers.get("location")!).searchParams.get("code")!;
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
  // The token rotated a moment ago is inside the reuse window, but its cached
  // response was dropped on disconnect.
  const replayed = await exchange({
    grant_type: "refresh_token",
    refresh_token: ownerTokens.refresh_token,
    client_id: clientId,
    resource,
  });
  assert.notEqual(replayed.status, 200, JSON.stringify(replayed.body));
  // The database refuses refresh tokens without a live consent.
  await assert.rejects(
    pool.query(
      "INSERT INTO oauth_refresh_tokens (id, token, client_id, user_id, scopes, expires_at, created_at) VALUES ('rt-race', 'h', $1, $2, '{openid}', now() + interval '1 day', now())",
      [clientId, owner.id],
    ),
    /disconnected/,
  );
  // Reconnecting starts a new connection: tokens from the old one stay dead.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const reconnected = await connect(owner);
  assert.equal((await mcp(refreshed.body.access_token!, "tools/list")).status, 401);
  assert.equal((await mcp(access, "tools/list")).status, 401);
  assert.equal((await mcp(reconnected.access_token, "tools/list")).status, 200);
  const stalePending = await exchange({
    grant_type: "authorization_code",
    code: pendingCode,
    redirect_uri: redirectURI,
    client_id: clientId,
    code_verifier: pending.verifier,
    resource,
  });
  assert.notEqual(stalePending.status, 200, JSON.stringify(stalePending.body));
  // A late retry with a refresh token from the old connection must not wipe
  // the new connection's tokens.
  assert.notEqual(
    (await exchange({ grant_type: "refresh_token", refresh_token: ownerTokens.refresh_token, client_id: clientId, resource })).status,
    200,
  );
  const stillWorks = await exchange({
    grant_type: "refresh_token",
    refresh_token: reconnected.refresh_token,
    client_id: clientId,
    resource,
  });
  assert.equal(stillWorks.status, 200, JSON.stringify(stillWorks.body));
  // Tokens from the second of a disconnect are refused even if a reconnect
  // lands in that same second.
  const apps2 = createOAuthAppService(db);
  const { rows: [mark] } = await pool.query<{ at: Date }>(
    "SELECT disconnected_at AS at FROM oauth_disconnects WHERE user_id = $1 AND client_id = $2",
    [owner.id, clientId],
  );
  const second = Math.floor(mark!.at.getTime() / 1000);
  await pool.query("UPDATE oauth_consents SET created_at = $3 WHERE user_id = $1 AND client_id = $2", [
    owner.id,
    clientId,
    new Date(second * 1000),
  ]);
  assert.equal(await apps2.acceptsToken(owner.id, clientId, second), false);
  assert.equal(await apps2.acceptsToken(owner.id, clientId, second + 1), true);
  // The outsider's connection to the same client is untouched.
  assert.equal((await mcp(outsiderTokens.access_token, "tools/list")).status, 200);
  // Disconnecting someone else's app is a no-op.
  await trpc("oauthApps.disconnect", owner, { clientId });
  assert.equal((await mcp(outsiderTokens.access_token, "tools/list")).status, 200);

  // --- DPoP-bound tokens ------------------------------------------------------
  const { subtle } = globalThis.crypto;
  const keys = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y } = await subtle.exportKey("jwk", keys.publicKey);
  const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const dpopProof = async (htm: string, htu: string, accessToken?: string) => {
    const input = `${b64url({ typ: "dpop+jwt", alg: "ES256", jwk: { kty, crv, x, y } })}.${b64url({
      jti: randomUUID(),
      htm,
      htu,
      iat: Math.floor(Date.now() / 1000),
      ...(accessToken ? { ath: createHash("sha256").update(accessToken).digest("base64url") } : {}),
    })}`;
    const signature = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, Buffer.from(input)));
    return `${input}.${signature.toString("base64url")}`;
  };
  const dpopFlow = authorize(outsider);
  const dpopCode = new URL((await dpopFlow.response).headers.get("location")!).searchParams.get("code")!;
  const bound = await exchange(
    {
      grant_type: "authorization_code",
      code: dpopCode,
      redirect_uri: redirectURI,
      client_id: clientId,
      code_verifier: dpopFlow.verifier,
      resource,
    },
    { dpop: await dpopProof("POST", `${origin}/api/auth/oauth2/token`) },
  );
  assert.equal(bound.status, 200, JSON.stringify(bound.body));
  assert.equal(bound.body.token_type, "DPoP");
  const boundToken = bound.body.access_token!;
  const dpopCall = async (authorization: string, proof?: string) =>
    request("/api/mcp", {
      method: "POST",
      headers: {
        authorization,
        ...(proof ? { dpop: proof } : {}),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  const proof = await dpopProof("POST", resource, boundToken);
  assert.equal((await dpopCall(`DPoP ${boundToken}`, proof)).status, 200);
  // Proofs are single-use, bound to the token, and required (RFC 9449 §7.1).
  const challengeOf = async (response: Response) => {
    assert.equal(response.status, 401);
    return response.headers.get("www-authenticate") ?? "";
  };
  const proofChallenge = /^DPoP error="invalid_dpop_proof", algs="[^"]*ES256[^"]*", resource_metadata=/;
  assert.match(await challengeOf(await dpopCall(`DPoP ${boundToken}`, proof)), proofChallenge);
  assert.match(await challengeOf(await dpopCall(`DPoP ${boundToken}`)), proofChallenge);
  assert.match(
    await challengeOf(await dpopCall(`DPoP ${boundToken}`, await dpopProof("POST", resource, access))),
    proofChallenge,
  );
  // A bound token presented as a Bearer token is an invalid token, not a bad proof.
  assert.match(
    await challengeOf(await dpopCall(`Bearer ${boundToken}`, await dpopProof("POST", resource, boundToken))),
    /^Bearer error="invalid_token"/,
  );
  // Once disconnected, a DPoP-bound token is refused with a DPoP challenge.
  await trpc("oauthApps.disconnect", outsider, { clientId });
  assert.match(
    await challengeOf(await dpopCall(`DPoP ${boundToken}`, await dpopProof("POST", resource, boundToken))),
    /^DPoP error="invalid_token", algs=/,
  );

  // --- Personal access tokens work too --------------------------------------
  const pat = await trpc<{ token: string }>("apiTokens.create", member, { name: "Codex", expiresInDays: 30 });
  const viaToken = await ok(pat.token, "whoami");
  assert.equal(viaToken.userId, member.id);
  assert.equal(viaToken.via, "token:Codex");
  assert.equal((await ok(pat.token, "get_issue", { issue: "SP-1" })).title, "Wire up MCP");
  const badPat = await mcp("spk_not-a-real-token", "tools/list");
  assert.equal(badPat.status, 401);
});
