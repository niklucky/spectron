import { createAPI } from "../src/index";
import { createAuth } from "@spectron/backend";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import {
  createId,
  agentRunPollDelay,
  type AgentInvocation,
  type AgentResult,
  type GitPullRequest,
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
  createTextParts,
  parseResult,
  redact,
} from "../../backend/src/agent-runs/runtime";
import { runPrompt } from "../../backend/src/agent-runs/worker";
import {
  modelLimits,
  promptByteBudget,
} from "../../backend/src/agent-runs/model-limits";
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

test("text part snapshots replace previous updates and preserve distinct parts", () => {
  const parts = createTextParts();
  assert.equal(parts.update("one", "A"), "A");
  assert.equal(parts.update("one", "AB"), "AB");
  assert.equal(parts.update("one", "ABC"), "ABC");
  assert.equal(parts.update("two", "Result"), "ABC\n\nResult");
  assert.equal(parts.update("two", "Final result"), "ABC\n\nFinal result");
});
test("polling stops when idle and model input budgets respect smaller windows", () => {
  assert.equal(agentRunPollDelay([]), null);
  assert.equal(
    agentRunPollDelay([{ state: "completed" }, { state: "failed" }]),
    null,
  );
  assert.equal(agentRunPollDelay([{ state: "needs_input" }]), 30000);
  assert.equal(agentRunPollDelay([{ state: "working" }]), 2000);
  const large = modelLimits({ provider: "openai", model: "gpt-5.6-sol" });
  const small = modelLimits({
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  });
  assert.ok(large.context > small.context);
  assert.ok(promptByteBudget(small) + small.output < small.context);
  const unknown = modelLimits({ provider: "zai", model: "unlisted" });
  assert.equal(unknown.context, 64000);
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
  const pulls = new Map<string, GitPullRequest>();
  let creates = 0,
    loseCreateResponse = false;
  const factory: GitAdapterFactory = (c) => ({
    findPull: async (_repo, source) => pulls.get(source) ?? null,
    createDraft: async (repo, input) => {
      creates++;
      const pull: GitPullRequest = {
        number: String(creates),
        url: `${repo.webURL}/pull/${creates}`,
        sourceBranch: input.source,
        targetBranch: input.target,
        state: "open",
        draft: true,
        head: "b".repeat(40),
      };
      pulls.set(input.source, pull);
      if (loseCreateResponse) {
        loseCreateResponse = false;
        throw new Error("Lost create response");
      }
      return pull;
    },
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
  let emitsAccepted = true;
  let prepares = 0,
    cleanups = 0,
    cleanupFails = false;
  const runtime: AgentRuntime = {
    prepare: async (run, config) => {
      prepares++;
      assert.equal(config.key, "fake-test-key");
      assert.ok(
        ["fake-git-token", "fake-gl-token"].includes(
          config.repositories[0]?.token ?? "",
        ),
      );
      return run.repositories.map((r) => ({ ...r, commit: "a".repeat(40) }));
    },
    turn: async (...args) => {
      if (emitsAccepted) await args[5]();
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
      assert.equal(
        result.state,
        "completed",
        JSON.stringify({
          error: result.error,
          outcomes: result.implementation,
        }),
      );
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
    "missing delivery acknowledgement never repeats a paid turn",
    async () => {
      const created = await runs.invoke(owner, args());
      await runs.instruct(owner, {
        ...scope,
        id: created.id,
        requestId: createId(),
        message: "Pending instruction",
      });
      let calls = 0;
      emitsAccepted = false;
      turn = async () => {
        calls++;
        return { summary: "Saved response", details: "Answer" };
      };
      try {
        await runToEnd();
      } finally {
        emitsAccepted = true;
      }
      const row = await view(created.id);
      assert.equal(calls, 1);
      assert.equal(row.state, "failed");
      assert.equal(row.inputs[0]!.state, "queued");
      assert.equal(row.result?.summary, "Saved response");
      assert.match(row.error!, /without confirming/);
    },
  );
  await t.test(
    "continuous steering pauses after ten turns for explicit resumption",
    async () => {
      const created = await runs.invoke(owner, args());
      let calls = 0;
      turn = async (row) => {
        calls++;
        await runs.instruct(owner, {
          ...scope,
          id: row.id,
          requestId: createId(),
          message: "Next instruction",
        });
        return { summary: "Result", details: "Answer" };
      };
      await runToEnd();
      const row = await view(created.id);
      assert.equal(calls, 10);
      assert.equal(row.state, "needs_input");
      assert.match(row.result!.question!, /10-turn limit/);
      assert.equal(row.inputs.filter((i) => i.state === "queued").length, 1);
      await runs.stop(owner, { ...scope, id: row.id });
      await worker.tick();
    },
  );
  await t.test(
    "closure cleans retained containers without changing successful results",
    async () => {
      const created = await runs.invoke(owner, args());
      turn = async () => ({ summary: "Success", details: "Answer" });
      await runToEnd();
      await db
        .update(schema.issue)
        .set({ stateId: states[1]! })
        .where(eq(schema.issue.id, issueId));
      let row = await view(created.id);
      assert.equal(row.state, "completed");
      assert.equal(row.error, null);
      assert.equal(row.stopRequested, true);
      for (let n = 0; n < 20; n++) await worker.tick();
      row = await view(created.id);
      assert.equal(row.containerRetained, false);
      assert.equal(row.error, null);
      await db
        .update(schema.issue)
        .set({ stateId: states[0]! })
        .where(eq(schema.issue.id, issueId));
    },
  );
  await t.test(
    "large historical results are bounded instead of locking out new runs",
    async () => {
      for (let i = 0; i < 6; i++) {
        const created = await runs.invoke(owner, args());
        await db
          .update(schema.agentRun)
          .set({
            state: "completed",
            result: { summary: "Older result", details: "x".repeat(500000) },
          })
          .where(eq(schema.agentRun.id, created.id));
      }
      const created = await runs.invoke(owner, args());
      const [row] = await db
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, created.id));
      assert.ok(JSON.stringify(row!.context.previous).length < 70000);
      assert.match(String(row!.context.historyNotice), /excerpts/);
      turn = async () => ({ summary: "Success", details: "Answer" });
      await runToEnd();
    },
  );
  await t.test(
    "worker shutdown reports interruption instead of a human Stop",
    async () => {
      const created = await runs.invoke(owner, args());
      let started!: () => void;
      const ready = new Promise<void>((resolve) => (started = resolve));
      turn = async (_row, _prompt, signal) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
        return { summary: "unused", details: "unused" };
      };
      const shuttingDown = createAgentWorker(db, files, runtime, {
        aiSecret: secret,
        integrationSecret: secret,
        gitFactory: factory,
      });
      const stop = shuttingDown.start();
      await shuttingDown.tick();
      await ready;
      await stop();
      const row = await view(created.id);
      assert.equal(row.state, "failed");
      assert.match(row.error!, /shutdown/);
    },
  );
  await t.test(
    "implementation drafts, one writer, interrupted publication and continuation",
    async (t) => {
      await db
        .update(schema.gitConnection)
        .set({ commitAuthorName: "Bot", commitAuthorEmail: "bot@example.test" })
        .where(eq(schema.gitConnection.id, gc.id));
      const remoteHeads = new Map<string, string>(),
        localHeads = new Map<string, string>();
      let changes = true,
        commits = 0,
        pushes = 0,
        losePushResponse = false;
      runtime.writableGit = {
        paths: (id) => ({ root: id, git: id, tree: id }),
        prepare: async (w) => {
          assert.equal(remoteHeads.get(w.id) ?? null, w.remoteCommit);
          return {
            base: "a".repeat(40),
            head: localHeads.get(w.id) ?? "a".repeat(40),
            target: "a".repeat(40),
          };
        },
        commit: async (w, c, message) => {
          assert.ok(c.author.name && c.author.email);
          assert.match(message, /Spectron-Agent: Senior/);
          assert.match(message, /Spectron-Requested-By: Owner/);
          assert.match(message, /Spectron-Issue: RUN-1/);
          if (!changes) return localHeads.get(w.id) ?? "a".repeat(40);
          const sha = (++commits).toString(16).padStart(40, "0");
          localHeads.set(w.id, sha);
          return sha;
        },
        remote: async (w) => remoteHeads.get(w.id) ?? null,
        push: async (w, _c, commit, expected) => {
          if (remoteHeads.get(w.id) === commit) return;
          assert.equal(remoteHeads.get(w.id) ?? null, expected);
          remoteHeads.set(w.id, commit);
          pushes++;
          if (losePushResponse) {
            losePushResponse = false;
            throw new Error("Lost push response");
          }
        },
      };
      const implement = () => ({ ...args(), command: "implement" as const });
      turn = async () => ({
        summary: "Implemented",
        details: "Checks unavailable in the fixture.",
        verification: [
          { command: "test", outcome: "not_run", details: "Fixture" },
        ],
      });
      const modelTurnBeforeRetry = turn;
      let modelCalls = 0;
      turn = async (...a) => {
        modelCalls++;
        return modelTurnBeforeRetry(...a);
      };
      await db
        .update(schema.gitConnection)
        .set({ commitAuthorEmail: "" })
        .where(eq(schema.gitConnection.id, gc.id));
      const originalRequest = "Implement input validation";
      const preparationFailed = await runs.invoke(owner, {
        ...implement(),
        message: originalRequest,
      });
      await runToEnd();
      assert.equal(modelCalls, 0);
      const failedView = await view(preparationFailed.id);
      assert.equal(failedView.state, "failed");
      assert.equal(failedView.canRetryPublication, false);
      assert.equal(failedView.retryMessage, originalRequest);
      assert.match(failedView.implementation![0]!.error!, /commit author/);
      await db
        .update(schema.gitConnection)
        .set({ commitAuthorEmail: "bot@example.test" })
        .where(eq(schema.gitConnection.id, gc.id));
      await assert.rejects(
        runs.invoke(owner, {
          ...implement(),
          continuationId: preparationFailed.id,
          publicationOnly: true,
        }),
        /no pending publication/,
      );
      assert.equal(
        (await db.select().from(schema.agentWorkspace))[0]!.ownerRunId,
        null,
      );
      // Simulate the completed no-op produced by the old retry button; recover its original request too.
      const [original] = await db
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, preparationFailed.id));
      const legacyId = createId();
      await db.insert(schema.agentRun).values({
        ...original!,
        id: legacyId,
        requestId: createId(),
        state: "completed",
        error: null,
        message: "Retry publishing saved implementation changes.",
        context: {
          ...original!.context,
          publicationOnly: true,
          continuationId: original!.id,
        },
      });
      await db
        .update(schema.agentWorkspace)
        .set({ lastRunId: legacyId })
        .where(eq(schema.agentWorkspace.lastRunId, original!.id));
      const legacyView = await view(legacyId);
      assert.equal(legacyView.canRetryPublication, false);
      assert.equal(legacyView.retryMessage, originalRequest);
      const initial = await runs.invoke(owner, {
        ...implement(),
        message: legacyView.retryMessage!,
        continuationId: legacyId,
      });
      await assert.rejects(runs.invoke(owner, implement()), /already owns/);
      assert.equal(
        (
          await runs.invoke(owner, {
            ...implement(),
            requestId: (
              await db
                .select()
                .from(schema.agentRun)
                .where(eq(schema.agentRun.id, initial.id))
            )[0]!.requestId,
          })
        ).id,
        initial.id,
      );
      await runToEnd();
      let result = await view(initial.id);
      assert.equal(
        result.state,
        "completed",
        JSON.stringify({
          error: result.error,
          outcomes: result.implementation,
        }),
      );
      assert.equal(result.containerRetained, false);
      assert.equal(modelCalls, 1);
      assert.equal(result.message, originalRequest);
      assert.equal(result.agent.id, agent.id);
      assert.equal(result.implementation![0]!.status, "published");
      assert.equal(creates, 1);
      assert.equal(pushes, 1);
      const workspaceId = result.implementation![0]!.workspaceId;
      assert.equal(
        (await db.select().from(schema.agentWorkspace))[0]!.ownerRunId,
        null,
      );
      const follow = await runs.invoke(owner, {
        ...implement(),
        continuationId: initial.id,
      });
      await runToEnd();
      assert.equal(
        (await view(follow.id)).implementation![0]!.workspaceId,
        workspaceId,
      );
      assert.equal(creates, 1);
      assert.equal(pushes, 2);

      losePushResponse = true;
      const lost = await runs.invoke(owner, implement());
      await runToEnd();
      assert.equal((await view(lost.id)).state, "failed");
      assert.ok((await db.select().from(schema.agentWorkspace))[0]!.pending);
      assert.equal((await view(lost.id)).canRetryPublication, true);
      const beforePushes = pushes;
      changes = false;
      const modelTurn = turn;
      turn = async () => {
        throw new Error("Publication retry must not call a model");
      };
      const retry = await runs.invoke(owner, {
        ...implement(),
        continuationId: lost.id,
        publicationOnly: true,
      });
      await runToEnd();
      assert.equal((await view(retry.id)).state, "completed");
      assert.equal((await view(retry.id)).canRetryPublication, false);
      assert.equal(pushes, beforePushes);
      assert.equal(creates, 1);
      turn = modelTurn;
      await assert.rejects(
        runs.invoke(owner, {
          ...implement(),
          continuationId: lost.id,
          publicationOnly: true,
        }),
        /Newer work/,
      );
      assert.equal(
        (await db.select().from(schema.agentWorkspace))[0]!.pending,
        null,
      );

      turn = async () => ({
        summary: "Need input",
        details: "Unfinished edits saved",
        question: "Which approach?",
      });
      const waiting = await runs.invoke(owner, implement());
      await runToEnd();
      assert.equal((await view(waiting.id)).state, "needs_input");
      await assert.rejects(runs.invoke(owner, implement()), /already owns/);
      await runs.instruct(owner, {
        ...scope,
        id: waiting.id,
        requestId: createId(),
        message: "Proceed",
      });
      turn = async () => ({
        summary: "Resumed",
        details: "Saved workspace restored",
      });
      await runToEnd();
      assert.equal((await view(waiting.id)).state, "completed");

      const stopped = await runs.invoke(owner, implement());
      turn = async (row) => {
        await runs.stop(owner, { ...scope, id: row.id });
        return { summary: "Late", details: "Must not publish" };
      };
      const before = pushes;
      await runToEnd();
      assert.equal((await view(stopped.id)).state, "stopped");
      assert.equal(pushes, before);
      assert.equal(
        (await db.select().from(schema.agentWorkspace))[0]!.ownerRunId,
        null,
      );

      await t.test(
        "queued implementation Stop releases ownership without a worker",
        async () => {
          const queued = await runs.invoke(owner, implement());
          await runs.stop(owner, { ...scope, id: queued.id });
          assert.equal((await view(queued.id)).state, "stopped");
          assert.equal(
            (await db.select().from(schema.agentWorkspace))[0]!.ownerRunId,
            null,
          );
          const replacement = await runs.invoke(owner, implement());
          await runs.stop(owner, { ...scope, id: replacement.id });
        },
      );
      await t.test(
        "blocked Git preparation allows heartbeat and Stop before any later writes",
        async () => {
          const originalPrepare = runtime.writableGit!.prepare;
          let entered!: () => void;
          const ready = new Promise<void>((resolve) => {
            entered = resolve;
          });
          let wasAborted = false;
          runtime.writableGit!.prepare = async (_w, _c, signal) => {
            entered();
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(resolve, 6000);
              signal.addEventListener(
                "abort",
                () => {
                  wasAborted = true;
                  clearTimeout(timeout);
                  reject(signal.reason);
                },
                { once: true },
              );
            });
            throw new Error("Git operation timed out without cancellation");
          };
          try {
            const blocked = await runs.invoke(owner, implement());
            const beforeCommits = commits,
              beforeModel = modelCalls;
            await worker.tick();
            await ready;
            const lease = async () =>
              (
                await db
                  .select()
                  .from(schema.agentRun)
                  .where(eq(schema.agentRun.id, blocked.id))
              )[0]!.leaseUntil!.getTime();
            const firstLease = await lease();
            await new Promise((resolve) => setTimeout(resolve, 1500));
            assert.ok(
              (await lease()) > firstLease,
              "heartbeat must advance while Git is blocked",
            );
            const start = Date.now();
            await runs.stop(owner, { ...scope, id: blocked.id });
            assert.ok(
              Date.now() - start < 1000,
              "Stop must not wait for the Git request",
            );
            await worker.settle();
            assert.equal(wasAborted, true);
            assert.equal((await view(blocked.id)).state, "stopped");
            assert.equal(commits, beforeCommits);
            assert.equal(modelCalls, beforeModel);
            assert.equal(pushes, before);
            assert.equal(
              (await db.select().from(schema.agentWorkspace))[0]!.ownerRunId,
              null,
            );
          } finally {
            runtime.writableGit!.prepare = originalPrepare;
            await worker.settle();
          }
        },
      );

      // A second provider/repository allows a lost creation response and an empty result independently.
      const gl = await git.createConnection(owner, projectId, {
        name: "GitLab",
        provider: "gitlab",
        baseURL: "https://gitlab.example.test",
        token: "fake-gl-token",
      });
      const glcheck = await git.checkConnection(owner, {
        projectId,
        id: gl.id,
        revision: gl.revision,
      });
      await db
        .update(schema.gitConnection)
        .set({ commitAuthorName: "Bot", commitAuthorEmail: "bot@example.test" })
        .where(eq(schema.gitConnection.id, gl.id));
      const glrepo = await git.addRepository(owner, {
        projectId,
        id: gl.id,
        revision: glcheck.connection.revision,
        fullName: "group/repo",
        externalId: "2",
      });
      const both = () => ({
        ...implement(),
        repositoryIds: [repo.id, glrepo.id],
      });
      const noChanges = await runs.invoke(owner, both());
      turn = async () => ({
        summary: "No changes",
        details: "No implementation required",
      });
      await runToEnd();
      assert.equal(
        (await view(noChanges.id)).implementation!.find(
          (o) => o.repositoryId === glrepo.id,
        )!.status,
        "unchanged",
      );
      assert.equal(creates, 1);
      changes = true;
      loseCreateResponse = true;
      const mixed = await runs.invoke(owner, both());
      await runToEnd();
      result = await view(mixed.id);
      assert.equal(result.state, "failed");
      assert.equal(
        result.implementation!.filter((o) => o.status === "failed").length,
        1,
      );
      assert.equal(
        result.implementation!.filter((o) => o.status === "published").length,
        1,
      );
      assert.equal(creates, 2);
      changes = false;
      const recover = await runs.invoke(owner, {
        ...both(),
        continuationId: mixed.id,
      });
      await runToEnd();
      assert.equal((await view(recover.id)).state, "completed");
      assert.equal(creates, 2);
      for (const pull of pulls.values()) pull.state = "merged";
      const closed = await runs.invoke(owner, implement());
      await runToEnd();
      assert.equal((await view(closed.id)).state, "failed");
      assert.equal(pushes, beforePushes + 2);
      await assert.rejects(runs.invoke(owner, implement()), /closed or merged/);
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
      const preview = await runs.previewRewrite(owner, {
        ...scope,
        id: stale.id,
      });
      assert.equal(preview.stale, true);
      assert.equal(
        preview.changes.find((c) => c.field === "title")?.current,
        "Human edit",
      );
      assert.equal(
        preview.changes.find((c) => c.field === "title")
          ?.changedSinceInvocation,
        true,
      );
      await db
        .update(schema.issue)
        .set({ title: "Newer edit", updatedAt: new Date(Date.now() + 2000) })
        .where(eq(schema.issue.id, issueId));
      await assert.rejects(
        runs.apply(owner, {
          ...scope,
          id: stale.id,
          expectedUpdatedAt: preview.expectedUpdatedAt,
        }),
        /changed/,
      );
      const fresh = await runs.previewRewrite(owner, {
        ...scope,
        id: stale.id,
      });
      await runs.apply(owner, {
        ...scope,
        id: stale.id,
        expectedUpdatedAt: fresh.expectedUpdatedAt,
      });
      assert.ok((await view(stale.id)).appliedAt);
    },
  );
});
