import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createDatabase } from "@spectron/db";
import { createProjectService } from "@spectron/backend";
import { applicationIdPattern } from "@spectron/shared";

test("NanoID migration preserves legacy records, references and access", async (t) => {
  const connection = process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const name = `test_ids_${randomUUID().replaceAll("-", "")}`;
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
  const migration = async (file: string) => pool.query(await readFile(
    new URL(`../../db/migrations/${file}.sql`, import.meta.url), "utf8",
  ));
  for (const file of ["0000_auth", "0001_projects", "0002_project_logos", "0003_project_invitations"])
    await migration(file);
  await pool.query(`INSERT INTO users (id, name, email) VALUES ('legacy-user', 'Legacy', 'legacy@example.test')`);
  const projectId = randomUUID();
  const invitationId = randomUUID();
  await pool.query(`INSERT INTO projects (id, name, key) VALUES ($1, 'Legacy', 'LG')`, [projectId]);
  await pool.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, 'legacy-user', 'owner')`, [projectId]);
  await pool.query(`INSERT INTO project_invitations (id, project_id, email, invited_by, token_hash, expires_at) VALUES ($1, $2, 'invitee@example.test', 'legacy-user', 'retained-hash', now() + interval '7 days')`, [invitationId, projectId]);
  await pool.query("BEGIN");
  await migration("0004_material_harrier");
  await pool.query("COMMIT");
  await migration("0005_tricky_smiling_tiger");
  const service = createProjectService(db);
  assert.equal((await service.get("legacy-user", projectId)).id, projectId);
  assert.equal((await service.update("legacy-user", projectId, { name: "Still editable", key: "LG" })).name, "Still editable");
  const invitation = (await pool.query("SELECT * FROM project_invitations WHERE id = $1", [invitationId])).rows[0];
  assert.equal(invitation.project_id, projectId);
  assert.equal(invitation.token_hash, "retained-hash");
  await assert.rejects(pool.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ('missing-project', 'legacy-user', 'member')`), { code: "23503" });
  await assert.rejects(pool.query(`UPDATE project_invitations SET project_id = 'missing-project' WHERE id = $1`, [invitationId]), { code: "23503" });
  const created = await service.create("legacy-user", { name: "New", key: "NW" });
  assert.match(created.id, applicationIdPattern);
  assert.equal((await service.list("legacy-user")).length, 2);
});
