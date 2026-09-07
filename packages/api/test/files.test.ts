import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth, createFileService } from "@spectron/backend";
import {
  applicationIdPattern,
  type FilePage,
  type IssueAttachmentSummary,
  type IssueSummary,
  type ProjectFileSummary,
  type ProjectSummary,
} from "@spectron/shared";
import { createAPI } from "../src/index";

test("File uploads, reusable attachments and authorized delivery", async (t) => {
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_files_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  const root = await mkdtemp(join(tmpdir(), "spectron-files-test-"));
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await migrateDatabase(db);
  const origin = "http://localhost:5173";
  const auth = createAuth(db, {
    appURL: origin,
    secret: "file-integration-test-secret-with-32-characters",
    sendResetEmail: async () => {},
  });
  const api = createAPI(auth, {
    db,
    appURL: origin,
    fileStorage: { root, maxBytes: 1024 },
  });
  const register = async (email: string) => {
    const r = await api.request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: email.split("@")[0],
        email,
        password: "a long file test password",
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
    actor: typeof owner,
    input?: unknown,
    mutation = false,
  ) =>
    api.request(
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
  const data = async <T>(r: Response): Promise<T> => {
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as { result: { data: T } }).result.data;
  };
  const p = await data<ProjectSummary>(
    await call("projects.create", owner, { name: "First", key: "FI" }, true),
  );
  const q = await data<ProjectSummary>(
    await call("projects.create", owner, { name: "Second", key: "SE" }, true),
  );
  await pool.query(
    "INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'member'),($3,$4,'member')",
    [p.id, member.id, q.id, outsider.id],
  );
  const first = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: p.id, title: "First" },
      true,
    ),
  );
  const second = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: p.id, title: "Second" },
      true,
    ),
  );
  const other = await data<IssueSummary>(
    await call(
      "issues.create",
      owner,
      { projectId: q.id, title: "Other" },
      true,
    ),
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dWQAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = (
    filename: string,
    bytes: Uint8Array,
    cookie = owner.cookie,
    projectId = p.id,
    requestOrigin = origin,
  ) =>
    api.request(
      `${origin}/api/files/upload?${new URLSearchParams({ filename, projectId })}`,
      {
        method: "POST",
        headers: { origin: requestOrigin, cookie, "content-type": "image/png" },
        body: Buffer.from(bytes),
      },
    );
  const get = (
    f: ProjectFileSummary,
    actor = owner,
    headers: Record<string, string> = {},
    method = "GET",
  ) =>
    api.request(`${origin}/api/files/${f.projectId}/${f.projectFileId}`, {
      method,
      headers: { cookie: actor.cookie, ...headers },
    });
  const attachments = async (row: IssueSummary) =>
    data<IssueAttachmentSummary[]>(
      await call("files.attachments", owner, {
        projectId: row.projectId,
        issueId: row.id,
      }),
    );
  const link = (row: IssueSummary, f: ProjectFileSummary, actor = owner) =>
    call(
      "files.link",
      actor,
      {
        projectId: row.projectId,
        issueId: row.id,
        sourceProjectId: f.projectId,
        projectFileId: f.projectFileId,
      },
      true,
    );
  let uploaded: ProjectFileSummary;
  await t.test(
    "validates access before writing and detects actual file types",
    async () => {
      assert.equal((await upload("file.png", png, "")).status, 401);
      assert.equal(
        (await upload("file.png", png, outsider.cookie)).status,
        404,
      );
      assert.equal(
        (await upload("file.png", png, owner.cookie, p.id, "https://evil.test"))
          .status,
        403,
      );
      assert.equal((await upload("", png)).status, 400);
      assert.equal(
        (await upload("large.bin", new Uint8Array(2048))).status,
        413,
      );
      const r = await upload("../../тест.png", png);
      assert.equal(r.status, 201, await r.clone().text());
      uploaded = (await r.json()) as ProjectFileSummary;
      assert.match(uploaded.id, applicationIdPattern);
      assert.equal(uploaded.filename, "тест.png");
      assert.equal(uploaded.contentType, "image/png");
      assert.equal(uploaded.sizeBytes, png.length);
      const stored = (
        await pool.query("SELECT * FROM files WHERE id = $1", [uploaded.id])
      ).rows[0];
      assert.match(
        stored.storage_key,
        /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{21}\.png$/,
      );
      assert.deepEqual(await readFile(join(root, stored.storage_key)), png);
      assert.equal(stored.status, "ready");
      const html = await upload(
        "fake.png",
        Buffer.from("<html><script>alert(1)</script></html>"),
      );
      const fake = (await html.json()) as ProjectFileSummary;
      assert.equal(fake.contentType, "application/octet-stream");
      const download = await get(fake);
      assert.match(
        download.headers.get("content-disposition")!,
        /^attachment;/,
      );
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    },
  );
  await t.test(
    "new issues attach uploaded files atomically and reject foreign files",
    async () => {
      const created = await data<IssueSummary>(
        await call(
          "issues.create",
          owner,
          {
            projectId: p.id,
            title: "With attachments",
            description: "**Details**",
            projectFileIds: [uploaded.projectFileId, uploaded.projectFileId],
          },
          true,
        ),
      );
      const linked = await attachments(created);
      assert.equal(linked.length, 1);
      assert.equal(linked[0]!.id, uploaded.id);
      assert.equal(created.description, "**Details**");
      const before = await data<IssueSummary[]>(
        await call("issues.list", owner, { projectId: q.id }),
      );
      const rejected = await call(
        "issues.create",
        owner,
        {
          projectId: q.id,
          title: "Must not be created",
          projectFileIds: [uploaded.projectFileId],
        },
        true,
      );
      assert.equal(rejected.status, 400);
      const after = await data<IssueSummary[]>(
        await call("issues.list", owner, { projectId: q.id }),
      );
      assert.equal(after.length, before.length);
      const history = await pool.query(
        "SELECT * FROM issue_history WHERE issue_id = $1 AND entity_type = 'attachment'",
        [created.id],
      );
      assert.equal(history.rows.length, 1);
    },
  );
  await t.test(
    "downloads, ranges and private cache revalidation require membership",
    async () => {
      const r = await get(uploaded, member);
      assert.equal(r.status, 200);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
      assert.equal(r.headers.get("cache-control"), "private, no-cache");
      assert.match(r.headers.get("content-disposition")!, /filename\*=UTF-8''/);
      assert.equal(
        (
          await get(uploaded, member, {
            "if-none-match": r.headers.get("etag")!,
          })
        ).status,
        304,
      );
      const range = await get(uploaded, member, { range: "bytes=2-7" });
      assert.equal(range.status, 206);
      assert.deepEqual(
        Buffer.from(await range.arrayBuffer()),
        png.subarray(2, 8),
      );
      assert.equal(
        range.headers.get("content-range"),
        `bytes 2-7/${png.length}`,
      );
      const suffix = await get(uploaded, member, { range: "bytes=-4" });
      assert.equal(suffix.status, 206);
      assert.deepEqual(
        Buffer.from(await suffix.arrayBuffer()),
        png.subarray(-4),
      );
      assert.equal(
        (await get(uploaded, member, { range: "bytes=9999-" })).status,
        416,
      );
      assert.equal(
        (await get(uploaded, member, { range: "bytes=-0" })).status,
        416,
      );
      assert.equal(
        (
          await get(uploaded, member, {
            range: "bytes=0-1",
            "if-range": '"old"',
          })
        ).status,
        200,
      );
      const head = await get(uploaded, member, {}, "HEAD");
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      assert.equal(
        (
          await get(uploaded, outsider, {
            "if-none-match": r.headers.get("etag")!,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await api.request(
            `${origin}/api/files/${uploaded.projectId}/${uploaded.projectFileId}`,
          )
        ).status,
        401,
      );
      await pool.query(
        "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
        [p.id, member.id],
      );
      assert.equal(
        (
          await get(uploaded, member, {
            "if-none-match": r.headers.get("etag")!,
          })
        ).status,
        404,
      );
      await pool.query(
        "INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'member')",
        [p.id, member.id],
      );
    },
  );
  await t.test(
    "reuses one physical file with isolated, idempotent links and retained removal history",
    async () => {
      const results = await Promise.all([
        link(first, uploaded),
        link(first, uploaded),
      ]);
      for (const r of results) assert.equal(r.status, 200);
      await data(await link(second, uploaded));
      assert.equal((await attachments(first)).length, 1);
      assert.equal((await attachments(second)).length, 1);
      assert.equal((await link(other, uploaded, member)).status, 404);
      assert.equal((await link(other, uploaded, outsider)).status, 404);
      await data(await link(other, uploaded));
      assert.equal((await attachments(other))[0]!.id, uploaded.id);
      const association = (await attachments(first))[0]!;
      const before = (
        await pool.query("SELECT updated_at FROM issues WHERE id = $1", [
          first.id,
        ])
      ).rows[0].updated_at;
      await data(
        await call(
          "files.unlink",
          member,
          {
            projectId: p.id,
            issueId: first.id,
            attachmentId: association.attachmentId,
          },
          true,
        ),
      );
      assert.equal((await attachments(first)).length, 0);
      assert.equal((await attachments(second)).length, 1);
      assert.equal((await get(uploaded)).status, 200);
      assert.equal(
        (
          await pool.query("SELECT updated_at FROM issues WHERE id = $1", [
            first.id,
          ])
        ).rows[0].updated_at.toISOString(),
        before.toISOString(),
      );
      await data(await link(first, uploaded));
      assert.equal(
        (await attachments(first))[0]!.attachmentId,
        association.attachmentId,
      );
      const audit = (
        await pool.query(
          "SELECT action FROM issue_history WHERE issue_id = $1 AND entity_type = 'attachment' ORDER BY created_at",
          [first.id],
        )
      ).rows.map((r) => r.action);
      assert.deepEqual(audit, ["created", "deleted", "restored"]);
      const page = await data<FilePage>(
        await call("files.library", outsider, { search: "тест", offset: 0 }),
      );
      assert.equal(page.files.length, 1);
      assert.equal(page.files[0]!.projectId, q.id);
      await assert.rejects(
        pool.query(
          "UPDATE issue_attachments SET project_id = $1 WHERE id = $2",
          [q.id, association.attachmentId],
        ),
        { code: "23503" },
      );
    },
  );
  await t.test(
    "attachment changes roll back if audit storage fails",
    async () => {
      const bytes = await upload("rollback.txt", Buffer.from("retained"));
      const f = (await bytes.json()) as ProjectFileSummary;
      await pool.query(
        `CREATE FUNCTION reject_file_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER reject_file_history BEFORE INSERT ON issue_history FOR EACH ROW EXECUTE FUNCTION reject_file_history();`,
      );
      assert.equal((await link(first, f)).status, 500);
      assert.equal(
        (await attachments(first)).some((a) => a.id === f.id),
        false,
      );
      await pool.query(
        "DROP TRIGGER reject_file_history ON issue_history; DROP FUNCTION reject_file_history()",
      );
      assert.equal((await get(f)).status, 200);
    },
  );
  await t.test(
    "failed streaming uploads retain partial data and remain unavailable",
    async () => {
      const service = createFileService(db, { root, maxBytes: 16 });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(8));
          c.enqueue(new Uint8Array(32));
          c.close();
        },
      });
      await assert.rejects(
        service.upload(owner.id, p.id, "partial.bin", body),
        /limit/,
      );
      const failed = (
        await pool.query("SELECT * FROM files WHERE filename = 'partial.bin'")
      ).rows[0];
      assert.equal(failed.status, "failed");
      assert.ok((await readdir(join(root, ".pending"))).includes(failed.id));
      const page = await service.library(owner.id, { offset: 0 });
      assert.equal(
        page.files.some((f) => f.id === failed.id),
        false,
      );
    },
  );
  await t.test(
    "Nginx offload stays internal and soft-deleted records revoke delivery",
    async () => {
      const nginx = createAPI(auth, {
        db,
        appURL: origin,
        fileStorage: { root, delivery: "nginx" },
      });
      const path = `${origin}/api/files/${uploaded.projectId}/${uploaded.projectFileId}`;
      const r = await nginx.request(path, {
        headers: { cookie: owner.cookie },
      });
      assert.equal(r.status, 200);
      assert.match(
        r.headers.get("x-accel-redirect")!,
        /^\/_protected_files\/\d{4}-\d{2}-\d{2}\//,
      );
      assert.equal(await r.text(), "");
      await pool.query(
        "UPDATE project_files SET deleted_at = now() WHERE id = $1",
        [uploaded.projectFileId],
      );
      assert.equal((await get(uploaded)).status, 404);
      assert.equal((await attachments(first)).length, 0);
      const otherFile = (await attachments(other))[0]!;
      assert.equal((await get(otherFile, outsider)).status, 200);
      await pool.query("UPDATE files SET deleted_at = now() WHERE id = $1", [
        uploaded.id,
      ]);
      assert.equal((await get(otherFile, outsider)).status, 404);
      const stored = (
        await pool.query("SELECT storage_key FROM files WHERE id = $1", [
          uploaded.id,
        ])
      ).rows[0];
      assert.equal(
        (await stat(join(root, stored.storage_key))).size,
        png.length,
      );
    },
  );
  await t.test(
    "archived projects and deleted issues reject attachment changes",
    async () => {
      const response = await upload("archive.txt", Buffer.from("keep"));
      const f = (await response.json()) as ProjectFileSummary;
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
      assert.equal((await link(first, f)).status, 400);
      await data(await call("projects.archive", owner, { id: p.id }, true));
      assert.equal((await upload("no.txt", Buffer.from("no"))).status, 400);
      assert.equal((await link(second, f)).status, 400);
      assert.equal((await get(f)).status, 200);
    },
  );
});
