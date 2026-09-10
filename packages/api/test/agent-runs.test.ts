import { createAPI } from "../src/index";
import { createAuth } from "@spectron/backend";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import {
  createId,
  type AgentInvocation,
  type AgentResult,
} from "@spectron/shared";
import {
  createAIService,
  createGitService,
  createFileService,
  createAgentRunService,
  createAgentWorker,
  createIssueService,
  type AgentRuntime,
  type GitAdapterFactory,
} from "@spectron/backend";
import { eq } from "drizzle-orm";
import {
  openCodeConfig,
  parseResult,
  redact,
} from "../../backend/src/agent-runs/runtime";
import { runPrompt } from "../../backend/src/agent-runs/worker";
const secret = "agent-run-test-secret-at-least-32-characters";

test("result parsing accepts only supported rewrite fields and redacts credentials", () => {
  assert.deepEqual(
    parseResult(
      '{"summary":"Plan", "details":"Details", "rewrite":{"title":"Title","description":"Description","stateId":"evil","projectId":"evil"}}',
    ),
    {
      summary: "Plan",
      details: "Details",
      rewrite: { title: "Title", description: "Description" },
    },
  );
  assert.equal(parseResult("Plain text").details, "Plain text");
  assert.equal(
    parseResult('{"summary":"x","details":"y","question":"?"}').question,
    "?",
  );
  assert.equal(
    redact("token-secret " + Buffer.from("token-secret").toString("base64"), [
      "token-secret",
    ]),
    "[redacted] [redacted]",
  );
});

test("durable agent runs, permissions, snapshots, steering, cancellation and recovery", async (t) => {
  const admin = createDatabase(
    process.env.TEST_DATABASE_URL ||
      "postgresql://spectron:spectron@127.0.0.1:5442/spectron",
  );
  const databaseName = `test_runs_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(
    process.env.TEST_DATABASE_URL ||
      "postgresql://spectron:spectron@127.0.0.1:5442/spectron",
  );
  url.pathname = `/${databaseName}`;
  const { db, pool } = createDatabase(url.toString());
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${databaseName}"`);
    await admin.pool.end();
  });
  await migrateDatabase(db);
  await migrateDatabase(db);
  const owner = createId(),
    member = createId(),
    outsider = createId(),
    projectId = createId(),
    otherProject = createId();
  for (const [id, name] of [
    [owner, "Owner"],
    [member, "Member"],
    [outsider, "Outsider"],
  ])
    await db.insert(schema.user).values({
      id: id!,
      name: name!,
      email: `${id}@example.test`,
      emailVerified: true,
    });
  for (const [id, key] of [
    [projectId, "RUN"],
    [otherProject, "OTHER"],
  ])
    await db.insert(schema.project).values({ id: id!, name: key!, key: key! });
  await db.insert(schema.projectMember).values([
    { projectId, userId: owner, role: "owner" },
    { projectId, userId: member, role: "member" },
    { projectId: otherProject, userId: owner, role: "owner" },
  ]);
  const states = [createId(), createId(), createId()];
  for (const [i, trigger] of ["opened", "finished", "cancelled"].entries())
    await db.insert(schema.issueState).values({
      id: states[i]!,
      projectId,
      name: trigger,
      trigger: trigger as "opened",
      position: i,
      isDefault: i === 0,
    });
  const issueId = createId();
  await db.insert(schema.issue).values({
    id: issueId,
    projectId,
    number: 1,
    title: "Original",
    description: "Initial requirements",
    stateId: states[0]!,
    authorId: owner,
  });
  const scope = { projectId, issueId };
  const ai = createAIService(db, secret),
    connection = await ai.createConnection(owner, {
      provider: "openai",
      name: "Test connection",
      apiKey: "fake-test-key",
    });
  const agent = await ai.saveAgent(owner, {
    connectionId: connection.id,
    name: "Senior",
    avatar: null,
    model: "gpt-5.4",
    effort: "low",
    role: "Developer",
    instructions: "Private instructions",
  });
  const factory: GitAdapterFactory = (c) => ({
    actor: async () => ({ id: "1", login: "bot", name: "Bot", email: null }),
    repositories: async () => ({ items: [], nextPage: null }),
    repository: async (fullName, externalId) => ({
      fullName,
      externalId,
      defaultBranch: "main",
      archived: false,
      webURL: `${c.baseURL}/${fullName}`,
      cloneURL: `${c.baseURL}/${fullName}.git`,
    }),
    branch: async () => {},
  });
  const git = createGitService(db, secret, factory),
    gc = await git.createConnection(owner, projectId, {
      name: "Git",
      provider: "github",
      baseURL: "https://github.com",
      token: "fake-git-token",
    });
  const checked = await git.checkConnection(owner, {
    projectId,
    id: gc.id,
    revision: gc.revision,
  });
  const repo = await git.addRepository(owner, {
    projectId,
    id: gc.id,
    revision: checked.connection.revision,
    fullName: "team/repo",
    externalId: "1",
  });
  const files = createFileService(db),
    runs = createAgentRunService(db, files);
  const args = (): AgentInvocation => ({
    ...scope,
    requestId: createId(),
    agentId: agent.id,
    command: "create-plan",
    repositoryIds: [repo.id],
    message: "Plan this",
    fileIds: [],
  });
  let turn: AgentRuntime["turn"] = async () => ({
    summary: "Plan ready",
    details: "Read repo/file.ts; no checks run.",
  });
  let prepares = 0,
    cleanups = 0,
    cleanupFails = false;
  const runtime: AgentRuntime = {
    prepare: async (run, config) => {
      prepares++;
      assert.equal(config.key, "fake-test-key");
      assert.equal(config.repositories[0]?.token, "fake-git-token");
      return run.repositories.map((r) => ({ ...r, commit: "a".repeat(40) }));
    },
    turn: async (...args) => {
      await args[5]();
      return turn(...args);
    },
    cleanup: async () => {
      cleanups++;
      if (cleanupFails) throw new Error("Docker unavailable");
    },
  };
  const worker = createAgentWorker(db, files, runtime, {
    aiSecret: secret,
    integrationSecret: secret,
    gitFactory: factory,
  });
  const runToEnd = async () => {
    await worker.tick();
    await worker.settle();
  };
  const view = async (id: string) =>
    (await runs.list(owner, scope)).find((r) => r.id === id)!;
  await t.test(
    "run routes start, require authentication, and enforce same-origin mutations",
    async () => {
      const origin = "http://localhost:5173";
      const api = createAPI(
        createAuth(db, {
          appURL: origin,
          secret,
          sendResetEmail: async () => {},
        }),
        { db, appURL: origin },
      );
      assert.equal((await api.request("/api/health")).status, 200);
      assert.equal(
        (
          await api.request(
            "/api/trpc/runs.list?input=" +
              encodeURIComponent(JSON.stringify(scope)),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await api.request("/api/trpc/runs.invoke", {
            method: "POST",
            headers: {
              origin: "https://evil.test",
              "content-type": "application/json",
            },
            body: JSON.stringify(args()),
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "sharing and repository scope checked on invocation; safe views and immutable snapshot",
    async () => {
      await assert.rejects(runs.invoke(member, args()), /available/);
      await assert.rejects(runs.invoke(outsider, args()), /not found/);
      await assert.rejects(
        runs.invoke(owner, { ...args(), repositoryIds: [createId()] }),
        /outside/,
      );
      await assert.rejects(
        runs.invoke(owner, { ...args(), issueId: createId() }),
        /not found/,
      );
      await ai.setSharing(owner, {
        id: agent.id,
        revision: 1,
        projectId,
        visibility: "project",
        memberIds: [],
      });
      const request = args(),
        created = await runs.invoke(member, request);
      assert.equal((await runs.invoke(member, request)).id, created.id);
      const [stored] = await db
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, created.id));
      assert.equal(
        (stored!.context.issue as { title: string }).title,
        "Original",
      );
      await db
        .update(schema.issue)
        .set({ title: "Later requirements" })
        .where(eq(schema.issue.id, issueId));
      await db
        .update(schema.aiAgent)
        .set({ instructions: "Later instructions" })
        .where(eq(schema.aiAgent.id, agent.id));
      assert.equal(stored!.instructions, "Private instructions");
      await runToEnd();
      const result = await view(created.id);
      assert.equal(result.state, "completed");
      assert.equal(result.repositories[0]?.commit, "a".repeat(40));
      assert.ok(
        !JSON.stringify(await runs.list(member, scope)).includes(
          "instructions",
        ),
      );
      assert.ok(!JSON.stringify(result).includes("fake-test-key"));
      await assert.rejects(runs.list(outsider, scope));
      await assert.rejects(
        runs.stop(member, {
          ...scope,
          id: (await runs.invoke(owner, args())).id,
        }),
        /requester/,
      );
      await runToEnd();
    },
  );
  await t.test(
    "explicit steering queues until the next turn; ordinary comments are excluded",
    async () => {
      const created = await runs.invoke(owner, args());
      let turns = 0;
      turn = async (run, prompt) => {
        turns++;
        if (turns === 1) {
          await runs.instruct(owner, {
            ...scope,
            id: run.id,
            requestId: createId(),
            message: "Also cover concurrency",
          });
          assert.equal((await view(run.id)).inputs[0]?.state, "queued");
          await db.insert(schema.issueComment).values({
            projectId,
            issueId,
            authorId: member,
            body: [
              {
                type: "text",
                text: "Do not silently include this later comment",
              },
            ],
          });
        } else {
          assert.ok(prompt.includes("Also cover concurrency"));
          assert.ok(
            !prompt.includes("Do not silently include this later comment"),
          );
        }
        return { summary: "Plan", details: "Details" };
      };
      await runToEnd();
      assert.equal(turns, 2);
      assert.equal((await view(created.id)).inputs[0]?.state, "delivered");
    },
  );
  await t.test(
    "needs input survives idle container removal and resumes explicitly",
    async () => {
      turn = async () => ({
        summary: "Clarification",
        details: "Need a decision",
        question: "Which format?",
      });
      const created = await runs.invoke(owner, args());
      await runToEnd();
      assert.equal((await view(created.id)).state, "needs_input");
      await db
        .update(schema.agentRun)
        .set({ idleUntil: new Date(0) })
        .where(eq(schema.agentRun.id, created.id));
      await worker.tick();
      assert.equal((await view(created.id)).containerRetained, false);
      assert.equal((await view(created.id)).state, "needs_input");
      await runs.instruct(owner, {
        ...scope,
        id: created.id,
        requestId: createId(),
        message: "JSON",
      });
      turn = async (_run, prompt) => {
        assert.ok(prompt.includes("JSON"));
        return { summary: "Done", details: "Resumed with saved context" };
      };
      const before = prepares;
      await runToEnd();
      assert.equal(prepares, before + 1);
      assert.equal((await view(created.id)).state, "completed");
    },
  );
  await t.test(
    "closure blocks queued work even after reopening; Stop and removed membership prevent work",
    async () => {
      const created = await runs.invoke(owner, args()),
        before = prepares;
      await db
        .update(schema.issue)
        .set({ stateId: states[1]! })
        .where(eq(schema.issue.id, issueId));
      await assert.rejects(runs.invoke(owner, args()), /Reopen/);
      await db
        .update(schema.issue)
        .set({ stateId: states[0]! })
        .where(eq(schema.issue.id, issueId));
      for (let i = 0; i < 8; i++) await worker.tick();
      assert.equal((await view(created.id)).state, "stopped");
      assert.equal(prepares, before);
      const stopped = await runs.invoke(owner, args());
      await runs.stop(owner, { ...scope, id: stopped.id });
      await runToEnd();
      assert.equal((await view(stopped.id)).state, "stopped");
      const removed = await runs.invoke(member, args());
      await db
        .delete(schema.projectMember)
        .where(eq(schema.projectMember.userId, member));
      await runToEnd();
      assert.equal((await view(removed.id)).state, "failed");
    },
  );
  await t.test(
    "failure retains partial results and expired claims fail without paid replay",
    async () => {
      turn = async (_row, _prompt, _signal, _activity, partial) => {
        await partial("Partial analysis");
        throw new Error("Controlled execution failure");
      };
      const failed = await runs.invoke(owner, args());
      await runToEnd();
      assert.equal((await view(failed.id)).result?.details, "Partial analysis");
      assert.equal((await view(failed.id)).state, "failed");
      const orphan = await runs.invoke(owner, args());
      await db
        .update(schema.agentRun)
        .set({
          state: "working",
          claim: "old-worker",
          leaseUntil: new Date(0),
          containerRetained: true,
        })
        .where(eq(schema.agentRun.id, orphan.id));
      const before = prepares;
      await worker.tick();
      assert.equal((await view(orphan.id)).state, "failed");
      assert.equal(prepares, before);
      const continuation = await runs.invoke(owner, {
        ...args(),
        continuationId: failed.id,
      });
      turn = async () => ({ summary: "Continued", details: "Fresh work" });
      await runToEnd();
      assert.equal((await view(continuation.id)).state, "completed");
    },
  );
  await t.test(
    "active work ignores idle deadlines; stopping fences late output and cleanup failures retry",
    async () => {
      const concurrent = createAgentWorker(db, files, runtime, {
        aiSecret: secret,
        integrationSecret: secret,
        gitFactory: factory,
      });
      const created = await runs.invoke(owner, args());
      turn = async (row) => {
        await db
          .update(schema.agentRun)
          .set({ idleUntil: new Date(0) })
          .where(eq(schema.agentRun.id, row.id));
        const before = cleanups;
        await concurrent.tick();
        assert.equal(cleanups, before);
        await runs.stop(owner, { ...scope, id: row.id });
        return { summary: "Late result must not win", details: "Late" };
      };
      await runToEnd();
      assert.equal((await view(created.id)).state, "stopped");
      assert.notEqual(
        (await view(created.id)).result?.summary,
        "Late result must not win",
      );
      const cleanup = await runs.invoke(owner, args());
      turn = async () => {
        throw new Error("Preparation failure");
      };
      cleanupFails = true;
      await runToEnd();
      assert.equal((await view(cleanup.id)).containerRetained, true);
      assert.match((await view(cleanup.id)).error!, /cleanup failed/);
      cleanupFails = false;
      await concurrent.tick();
      assert.equal((await view(cleanup.id)).containerRetained, false);
    },
  );
  await t.test(
    "rewrite requires explicit Apply and rejects stale issue revisions",
    async () => {
      turn = async () => ({
        summary: "Rewrite",
        details: "Improved",
        rewrite: { title: "Better title", description: "Better description" },
      });
      const rewrite = await runs.invoke(owner, {
        ...args(),
        command: "rewrite-issue",
      });
      await runToEnd();
      assert.notEqual(
        (await pool.query("SELECT title FROM issues WHERE id=$1", [issueId]))
          .rows[0].title,
        "Better title",
      );
      await runs.apply(owner, { ...scope, id: rewrite.id });
      assert.equal((await view(rewrite.id)).appliedAt !== null, true);
      const stale = await runs.invoke(owner, {
        ...args(),
        command: "rewrite-issue",
      });
      await runToEnd();
      await db
        .update(schema.issue)
        .set({ title: "Human edit", updatedAt: new Date(Date.now() + 1000) })
        .where(eq(schema.issue.id, issueId));
      await assert.rejects(
        runs.apply(owner, { ...scope, id: stale.id }),
        /changed/,
      );
    },
  );
});
