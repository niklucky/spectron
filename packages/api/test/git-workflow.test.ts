import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import {
  createId,
  type GitActivity,
  type GitDiscussionData,
  type AgentInvocation,
  type AgentResult,
} from "@spectron/shared";
import {
  createAIService,
  createGitService,
  createGitWorkflow,
  createAgentRunService,
  createFileService,
  createAgentWorker,
  type GitAdapterFactory,
  type AgentRuntime,
} from "@spectron/backend";
import { eq } from "drizzle-orm";
const secret = "collaboration-test-secret-at-least-32-characters";
async function fixture(
  t: TestContext,
  provider: "github" | "gitlab" = "github",
) {
  const url = new URL(
    process.env.TEST_DATABASE_URL ||
      "postgresql://spectron:spectron@127.0.0.1:5442/spectron",
  );
  const admin = createDatabase(url.toString()),
    name = `test_workflow_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    await admin.pool.end();
  });
  await migrateDatabase(db);
  await migrateDatabase(db);
  const owner = createId(),
    member = createId(),
    outsider = createId(),
    projectId = createId(),
    issueId = createId(),
    stateId = createId();
  for (const id of [owner, member, outsider])
    await db.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
    });
  await db
    .insert(schema.project)
    .values({ id: projectId, name: "Collaboration", key: "COL" });
  await db.insert(schema.projectMember).values([
    { projectId, userId: owner, role: "owner" },
    { projectId, userId: member, role: "member" },
  ]);
  await db.insert(schema.issueState).values({
    id: stateId,
    projectId,
    name: "Open",
    trigger: "opened",
    position: 0,
    isDefault: true,
  });
  await db.insert(schema.issue).values({
    id: issueId,
    projectId,
    number: 1,
    title: "Change",
    description: "Keep behavior correct",
    stateId,
    authorId: owner,
  });
  const scope = { projectId, issueId },
    baseURL =
      provider === "github" ? "https://github.com" : "https://git.example.test";
  const remote: { activity: GitActivity; discussions: GitDiscussionData[] } = {
    activity: {
      pull: {
        number: "7",
        url: `${baseURL}/team/repo/${provider === "github" ? "pull" : "-/merge_requests"}/7`,
        sourceBranch: "feature",
        targetBranch: "main",
        head: "a".repeat(40),
        state: "open",
        draft: true,
      },
      title: "Change",
      providerId: "remote7",
      checks: [],
      commits: [],
      participants: [],
      reviewers: [],
      mergeable: false,
      mergeReason: "Draft",
      mergeMethods: ["merge", "squash"],
    },
    discussions: [
      {
        externalId: "thread1",
        replyId: "1",
        url: `${baseURL}/team/repo/pull/7#discussion_r1`,
        resolved: false,
        resolvable: true,
        path: "src/a.ts",
        line: 2,
        notes: [
          {
            id: "1",
            body: "Fix error handling",
            author: { name: "Reviewer", login: "reviewer" },
            url: `${baseURL}/comment/1`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ],
  };
  const state = {
    writes: 0,
    lose: false,
    noEffect: false,
    failSnapshot: false,
    onSnapshot: null as null | (() => Promise<void>),
  };
  const effect = () => {
    state.writes++;
    if (state.lose) throw new Error("Lost provider response with secret-token");
  };
  const factory: GitAdapterFactory = (c) => ({
    actor: async () => ({
      id: "1",
      login: "bot",
      name: "Bot",
      email: "bot@example.test",
    }),
    repositories: async () => ({ items: [], nextPage: null }),
    branch: async () => {},
    repository: async (fullName, externalId) => ({
      fullName,
      externalId,
      defaultBranch: "main",
      archived: false,
      cloneURL: `${c.baseURL}/${fullName}.git`,
      webURL: `${c.baseURL}/${fullName}`,
    }),
    findPull: async () => structuredClone(remote.activity.pull),
    createDraft: async () => structuredClone(remote.activity.pull),
    activity: {
      snapshot: async () => {
        if (state.failSnapshot)
          throw new Error("secret-token in unsafe upstream error");
        if (state.onSnapshot) {
          const f = state.onSnapshot;
          state.onSnapshot = null;
          await f();
        }
        return structuredClone(remote);
      },
      reply: async (_r, _p, _d, body) => {
        if (!state.noEffect)
          remote.discussions[0]!.notes.push({
            id: "new",
            body,
            author: { name: "Bot", login: "bot" },
            url: `${baseURL}/comment/new`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        effect();
        return "new";
      },
      resolve: async (_r, _p, _d, resolved) => {
        if (!state.noEffect) remote.discussions[0]!.resolved = resolved;
        effect();
      },
      ready: async () => {
        if (!state.noEffect) {
          remote.activity.pull.draft = false;
          remote.activity.mergeable = true;
          remote.activity.mergeReason = "Ready";
        }
        effect();
      },
      close: async () => {
        if (!state.noEffect) remote.activity.pull.state = "closed";
        effect();
      },
      merge: async (_r, a) => {
        assert.equal(a.pull.head, remote.activity.pull.head);
        if (!state.noEffect) remote.activity.pull.state = "merged";
        effect();
      },
    },
    reviews: {
      branchReview: async (repo, source, target) => ({
        sourceBranch: source,
        targetBranch: target,
        head: "a".repeat(40),
        base: "b".repeat(40),
        start: "b".repeat(40),
        url: repo.webURL,
        files: [
          {
            oldPath: "src/a.ts",
            newPath: "src/a.ts",
            patch: "@@ -1,2 +1,2 @@\n context\n-old\n+new",
          },
        ],
      }),
      review: async () => {
        throw new Error("unused");
      },
      findFinding: async () => null,
      publishFinding: async () => {
        throw new Error("No branch publication");
      },
    },
  });
  const git = createGitService(db, secret, factory),
    gc = await git.createConnection(owner, projectId, {
      provider,
      baseURL,
      name: "Git",
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
  await db
    .update(schema.gitConnection)
    .set({ commitAuthorName: "Bot", commitAuthorEmail: "bot@example.test" })
    .where(eq(schema.gitConnection.id, gc.id));
  const workspaceId = createId();
  await db.insert(schema.agentWorkspace).values({
    id: workspaceId,
    ...scope,
    repositoryId: repo.id,
    branch: "feature",
    targetBranch: "main",
    pull: remote.activity.pull,
  });
  const workflow = createGitWorkflow(db, secret, factory),
    ref = { ...scope, workspaceId };
  await workflow.refresh(owner, ref);
  const view = async () => (await workflow.list(owner, scope))[0]!;
  const ai = createAIService(db, secret);
  const connection = await ai.createConnection(owner, {
    provider: "openai",
    name: "First",
    apiKey: "first-key",
  });
  const secondConnection = await ai.createConnection(owner, {
    provider: "openai",
    name: "Second",
    apiKey: "second-key",
  });
  const agents: Awaited<ReturnType<typeof ai.saveAgent>>[] = [];
  for (const [i, c] of [connection, secondConnection].entries()) {
    const a = await ai.saveAgent(owner, {
      connectionId: c.id,
      name: `Agent ${i}`,
      avatar: null,
      model: "gpt-5.4",
      effort: "low",
      role: "Engineer",
      instructions: "Implement carefully",
    });
    await ai.setSharing(owner, {
      id: a.id,
      revision: 1,
      projectId,
      visibility: "project",
      memberIds: [],
    });
    agents.push(a);
  }
  const files = createFileService(db),
    runs = createAgentRunService(db, files, { secret, factory });
  const invocation = (): AgentInvocation => ({
    ...scope,
    requestId: createId(),
    agentId: agents[0]!.id,
    command: "implement",
    repositoryIds: [repo.id],
    message: "Implement",
    fileIds: [],
  });
  return {
    db,
    scope,
    ref,
    owner,
    member,
    outsider,
    workflow,
    view,
    state,
    remote,
    gc,
    repo,
    runs,
    agents,
    files,
    factory,
    invocation,
  };
}
for (const provider of ["github", "gitlab"] as const)
  test(`${provider}: synchronization, scoped drafts, duplicate delivery, lost responses, resolution and merge guards`, async (t) => {
    const f = await fixture(t, provider),
      {
        db,
        scope,
        ref,
        owner,
        member,
        outsider,
        workflow,
        view,
        state,
        remote,
      } = f;
    const thread = (await view()).discussions[0]!;
    await assert.rejects(workflow.list(outsider, scope));
    await workflow.refresh(member, ref);
    assert.equal((await view()).discussions.length, 1);
    const draft = await workflow.saveReply(member, {
      ...ref,
      discussionId: thread.id,
      body: "I will fix it",
    });
    await assert.rejects(
      workflow.saveReply(outsider, {
        ...ref,
        discussionId: thread.id,
        body: "bad",
      }),
    );
    await assert.rejects(
      workflow.saveReply(member, {
        ...ref,
        id: draft.id,
        discussionId: thread.id,
        revision: 99,
        body: "bad",
      }),
    );
    await workflow.saveReply(member, {
      ...ref,
      id: draft.id,
      discussionId: thread.id,
      revision: 1,
      body: "Fixed",
    });
    state.lose = true;
    const requestId = createId();
    await assert.rejects(
      workflow.publishReply(member, {
        ...ref,
        id: draft.id,
        revision: 2,
        requestId,
      }),
      /unconfirmed/,
    );
    state.lose = false;
    assert.equal((await view()).replies[0]!.state, "published");
    const operation = (await view()).operations[0]!;
    await workflow.reconcile(owner, { ...ref, id: operation.id });
    await workflow.publishReply(member, {
      ...ref,
      id: draft.id,
      revision: 2,
      requestId,
    });
    assert.equal(state.writes, 1);
    assert.equal((await view()).operations[0]!.state, "completed");
    const unknown = await workflow.saveReply(member, {
      ...ref,
      discussionId: thread.id,
      body: "Unknown send",
    });
    state.lose = true;
    state.noEffect = true;
    await assert.rejects(
      workflow.publishReply(member, {
        ...ref,
        id: unknown.id,
        revision: 1,
        requestId: createId(),
      }),
    );
    state.lose = false;
    state.noEffect = false;
    const unknownOp = (await view()).operations.at(-1)!;
    await workflow.reconcile(member, { ...ref, id: unknownOp.id, retry: true });
    assert.equal(state.writes, 2);
    assert.equal(
      (await view()).replies.find((r) => r.id === unknown.id)?.state,
      "uncertain",
    );
    await assert.rejects(
      workflow.publishReply(member, {
        ...ref,
        id: unknown.id,
        revision: 2,
        requestId: createId(),
      }),
      /uncertain/,
    );
    for (const kind of ["resolve", "reopen"] as const) {
      await workflow.act(member, {
        ...ref,
        kind,
        requestId: createId(),
        expectedHead: remote.activity.pull.head,
        discussionId: thread.id,
      });
      assert.equal((await view()).discussions[0]!.resolved, kind === "resolve");
    }
    await assert.rejects(
      workflow.act(member, {
        ...ref,
        kind: "ready",
        requestId: createId(),
        expectedHead: remote.activity.pull.head,
      }),
      /owners/,
    );
    await assert.rejects(
      workflow.setMergeGrant(member, {
        projectId: scope.projectId,
        userId: member,
        canMerge: true,
      }),
    );
    await assert.rejects(
      workflow.act(member, {
        ...ref,
        kind: "merge",
        requestId: createId(),
        expectedHead: remote.activity.pull.head,
        mergeMethod: "merge",
      }),
      /Can merge/,
    );
    await workflow.setMergeGrant(owner, {
      projectId: scope.projectId,
      userId: member,
      canMerge: true,
    });
    await assert.rejects(
      workflow.act(member, {
        ...ref,
        kind: "merge",
        requestId: createId(),
        expectedHead: remote.activity.pull.head,
        mergeMethod: "merge",
      }),
      /Draft/,
    );
    await workflow.act(owner, {
      ...ref,
      kind: "ready",
      requestId: createId(),
      expectedHead: remote.activity.pull.head,
    });
    assert.equal((await view()).pull.draft, false);
    const oldHead = remote.activity.pull.head;
    remote.activity.pull.head = "b".repeat(40);
    const before = state.writes;
    await assert.rejects(
      workflow.act(member, {
        ...ref,
        kind: "merge",
        requestId: createId(),
        expectedHead: oldHead,
        mergeMethod: "merge",
      }),
      /newer commit/,
    );
    assert.equal(state.writes, before);
    state.onSnapshot = async () =>
      workflow.setMergeGrant(owner, {
        projectId: scope.projectId,
        userId: member,
        canMerge: false,
      });
    await assert.rejects(
      workflow.act(member, {
        ...ref,
        kind: "merge",
        requestId: createId(),
        expectedHead: remote.activity.pull.head,
        mergeMethod: "merge",
      }),
      /Can merge/,
    );
    assert.equal(state.writes, before);
    const key = "webhook-secret-with-more-than-32-characters";
    await workflow.setWebhook(owner, {
      projectId: scope.projectId,
      connectionId: f.gc.id,
      secret: key,
    });
    const body = JSON.stringify({ untrusted: "payload", head: "evil" }),
      headers = new Headers(
        provider === "github"
          ? {
              "x-hub-signature-256": `sha256=${createHmac("sha256", key).update(body).digest("hex")}`,
              "x-github-delivery": "delivery-1",
            }
          : { "x-gitlab-token": key, "x-gitlab-event-uuid": "delivery-1" },
      );
    await assert.rejects(workflow.webhook(f.gc.id, new Headers(), body));
    await workflow.webhook(f.gc.id, headers, body);
    const [once] = await db
      .select()
      .from(schema.agentWorkspace)
      .where(eq(schema.agentWorkspace.id, ref.workspaceId));
    await workflow.webhook(f.gc.id, headers, body);
    const [twice] = await db
      .select()
      .from(schema.agentWorkspace)
      .where(eq(schema.agentWorkspace.id, ref.workspaceId));
    assert.equal(once!.syncVersion, twice!.syncVersion);
    assert.equal(twice!.pull!.head, remote.activity.pull.head);
    state.failSnapshot = true;
    await assert.rejects(workflow.refresh(owner, ref), /synchronize/);
    assert.ok(!(await view()).error?.includes("secret-token"));
    state.failSnapshot = false;
    await workflow.setMergeGrant(owner, {
      projectId: scope.projectId,
      userId: member,
      canMerge: true,
    });
    state.lose = true;
    await assert.rejects(
      workflow.act(member, {
        ...ref,
        kind: "merge",
        requestId: createId(),
        expectedHead: remote.activity.pull.head,
        mergeMethod: "merge",
      }),
      /unconfirmed/,
    );
    state.lose = false;
    const merge = (await view()).operations.at(-1)!;
    await workflow.reconcile(member, { ...ref, id: merge.id });
    assert.equal((await view()).operations.at(-1)!.state, "completed");
    assert.equal((await view()).pull.state, "merged");
    await assert.rejects(
      f.runs.invoke(owner, f.invocation()),
      /closed or merged/,
    );
  });

test("takeover waits for stopped tools, transfers one writer, uses new credentials, preserves feedback and prevents queued cancellation leaks", async (t) => {
  const f = await fixture(t),
    { db, owner, scope, ref, runs, agents, invocation } = f;
  const thread = (await f.view()).discussions[0]!,
    comments = [{ discussionId: thread.id, noteId: "1" }];
  const first = await runs.address(owner, {
    ...scope,
    requestId: createId(),
    agentId: agents[0]!.id,
    comments,
    message: "Fix reviewer comment",
  });
  const steering = await runs.address(owner, {
    ...scope,
    requestId: createId(),
    agentId: agents[0]!.id,
    comments,
    message: "Keep the API stable",
  });
  assert.equal(first.id, steering.id);
  await assert.rejects(
    runs.address(owner, {
      ...scope,
      requestId: createId(),
      agentId: agents[1]!.id,
      comments,
      message: "Fix",
    }),
    /Take over/,
  );
  // Simulate the first worker having an active tool process and a durable lease.
  await db
    .update(schema.agentRun)
    .set({
      state: "working",
      claim: "old-worker",
      leaseUntil: new Date(Date.now() + 60000),
      containerRetained: true,
      result: { summary: "In progress", details: "Saved edits" },
    })
    .where(eq(schema.agentRun.id, first.id));
  const next = await runs.takeover(owner, {
    ...scope,
    id: first.id,
    requestId: createId(),
    agentId: agents[1]!.id,
    message: "Finish carefully",
  });
  let cleaned = false,
    failCleanup = true,
    prepared = 0;
  const preparedKeys: string[] = [];
  const runtime: AgentRuntime = {
    prepare: async (run, config) => {
      assert.equal(cleaned, true);
      assert.equal(run.id, next.id);
      assert.equal(config.key, "second-key");
      preparedKeys.push(config.key);
      assert.equal((run.context.handoffSummary as any).agent, "Agent 0");
      assert.equal((run.context.feedbackComments as any[])[0].noteId, "1");
      prepared++;
      return run.repositories.map((r) => ({ ...r, commit: "a".repeat(40) }));
    },
    turn: async (_r, _p, _s, _a, _partial, accepted) => {
      await accepted();
      return {
        summary: "Addressed",
        details: "Checked",
        feedback: [
          {
            ...comments[0]!,
            status: "addressed",
            explanation: "Fixed",
            reply: "Fixed and verified",
          },
        ],
      };
    },
    cleanup: async (id) => {
      if (id === first.id) {
        if (failCleanup) throw new Error("Tool still alive");
        cleaned = true;
      }
    },
    writableGit: {
      paths: (id) => ({ root: id, git: id, tree: id }),
      prepare: async () => ({
        base: "a".repeat(40),
        head: "a".repeat(40),
        target: "a".repeat(40),
      }),
      commit: async () => "a".repeat(40),
      remote: async () => null,
      push: async () => {},
    },
  };
  const worker = createAgentWorker(db, f.files, runtime, {
    aiSecret: secret,
    integrationSecret: secret,
    gitFactory: f.factory,
  });
  await worker.tick();
  await worker.settle();
  assert.equal(prepared, 0);
  await db
    .update(schema.agentRun)
    .set({ leaseUntil: new Date(0) })
    .where(eq(schema.agentRun.id, first.id));
  await worker.tick();
  await worker.settle();
  assert.equal(prepared, 0);
  const [owned] = await db
    .select()
    .from(schema.agentWorkspace)
    .where(eq(schema.agentWorkspace.id, ref.workspaceId));
  assert.equal(owned!.ownerRunId, first.id);
  assert.equal(owned!.successorRunId, next.id);
  await assert.rejects(
    runs.invoke(owner, invocation()),
    /takeover|already owns/i,
  );
  failCleanup = false;
  await db
    .update(schema.agentRun)
    .set({ leaseUntil: new Date(0) })
    .where(eq(schema.agentRun.id, first.id));
  await worker.tick();
  await worker.settle();
  await worker.tick();
  await worker.settle();
  assert.equal(prepared, 1, JSON.stringify(await runs.list(owner, scope)));
  assert.deepEqual(preparedKeys, ["second-key"]);
  const list = await runs.list(owner, scope),
    replacement = list.find((r) => r.id === next.id)!;
  assert.equal(replacement.state, "completed", replacement.error ?? "");
  assert.equal(replacement.handoffFromId, first.id);
  assert.equal(replacement.result?.feedback?.[0]?.status, "addressed");
  assert.equal((await f.view()).writerRunId, null);
  assert.equal((await f.view()).replies[0]?.state, "draft");
  assert.equal((await f.view()).discussions[0]!.resolved, false);
  assert.equal(f.state.writes, 0);
  const pending = await runs.invoke(owner, invocation());
  const canceled = await runs.takeover(owner, {
    ...scope,
    id: pending.id,
    requestId: createId(),
    agentId: agents[1]!.id,
    message: "Continue",
  });
  await runs.stop(owner, { ...scope, id: canceled.id });
  await worker.tick();
  await worker.settle();
  assert.equal((await f.view()).writerRunId, null);
});

test("branch reviews pin source and comparison, keep editable local drafts and reject external publication", async (t) => {
  const f = await fixture(t);
  const args = {
    ...f.invocation(),
    command: "review-code" as const,
    reviewBranch: "feature",
  };
  await assert.rejects(
    f.runs.invoke(f.owner, { ...args, reviewBranch: "bad..branch" }),
    /valid Git branch/,
  );
  const run = await f.runs.invoke(f.owner, args);
  const runtime: AgentRuntime = {
    prepare: async (r) =>
      r.repositories.map((repo) => ({
        ...repo,
        commit: (r.context.branchReview as any).head,
      })),
    turn: async () => ({
      summary: "Defect",
      details: "Reviewed branch",
      findings: [
        {
          path: "src/a.ts",
          line: 2,
          side: "RIGHT",
          explanation: "Missing guard",
        },
      ],
    }),
    cleanup: async () => {},
  };
  const worker = createAgentWorker(f.db, f.files, runtime, {
    aiSecret: secret,
    integrationSecret: secret,
    gitFactory: f.factory,
  });
  await worker.tick();
  await worker.settle();
  const result = (await f.runs.list(f.owner, f.scope)).find(
    (r) => r.id === run.id,
  )!;
  assert.equal(result.state, "completed", result.error ?? "");
  assert.equal(result.review, null);
  assert.equal(result.branchReview?.head, "a".repeat(40));
  assert.equal(result.findings?.[0]?.state, "draft");
  const finding = result.findings![0]!;
  await f.runs.editFinding(f.owner, {
    ...f.scope,
    id: run.id,
    findingId: finding.id,
    revision: 1,
    explanation: "Edited guard finding",
    suggestedFix: "Restore guard",
    dismissed: false,
  });
  await assert.rejects(
    f.runs.publishFindings(f.owner, {
      ...f.scope,
      id: run.id,
      findingIds: [finding.id],
    }),
    /Branch review findings are local/,
  );
  assert.equal(f.state.writes, 0);
});

test("provider action retry fences an older slow dispatch before it can send", async (t) => {
  const f = await fixture(t);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    blocked = new Promise<void>((r) => (release = r));
  f.state.onSnapshot = async () => {
    entered();
    await blocked;
  };
  const original = f.workflow.act(f.owner, {
    ...f.ref,
    kind: "ready",
    requestId: createId(),
    expectedHead: f.remote.activity.pull.head,
  });
  const observed = original.catch((e) => e);
  await started;
  const operation = (await f.view()).operations[0]!;
  await f.db
    .update(schema.gitOperation)
    .set({ updatedAt: new Date(0) })
    .where(eq(schema.gitOperation.id, operation.id));
  await f.workflow.reconcile(f.owner, {
    ...f.ref,
    id: operation.id,
    retry: true,
  });
  release();
  await observed;
  assert.equal(f.state.writes, 1);
  assert.equal((await f.view()).operations[0]!.state, "completed");
  assert.equal((await f.view()).pull.draft, false);
});

test("feedback updates a ready request by returning it to draft before pushing and leaves failed checks visible", async (t) => {
  const f = await fixture(t);
  f.remote.activity.pull.draft = false;
  f.remote.activity.mergeable = true;
  await f.workflow.refresh(f.owner, f.ref);
  await f.db
    .update(schema.agentWorkspace)
    .set({ remoteCommit: "a".repeat(40), baseCommit: "a".repeat(40) })
    .where(eq(schema.agentWorkspace.id, f.ref.workspaceId));
  let drafted = false,
    pushed = false;
  const factory: GitAdapterFactory = (c, token) => {
    const adapter = f.factory(c, token);
    adapter.activity!.draft = async () => {
      drafted = true;
      f.remote.activity.pull.draft = true;
    };
    return adapter;
  };
  const run = await f.runs.invoke(f.owner, f.invocation());
  await assert.rejects(
    f.workflow.act(f.owner, {
      ...f.ref,
      kind: "close",
      requestId: createId(),
      expectedHead: "a".repeat(40),
    }),
    /writer/,
  );
  const runtime: AgentRuntime = {
    prepare: async (r) =>
      r.repositories.map((repo) => ({ ...repo, commit: "a".repeat(40) })),
    turn: async () => ({
      summary: "Partial fix",
      details: "A check failed; inspect before ready",
      verification: [
        { command: "test", outcome: "failed", details: "Fixture failure" },
      ],
    }),
    cleanup: async () => {},
    writableGit: {
      paths: (id) => ({ root: id, git: id, tree: id }),
      prepare: async () => ({
        base: "a".repeat(40),
        head: "a".repeat(40),
        target: "a".repeat(40),
      }),
      commit: async () => "c".repeat(40),
      remote: async () => f.remote.activity.pull.head,
      push: async (_w, _c, commit) => {
        assert.equal(drafted, true);
        assert.equal(f.remote.activity.pull.draft, true);
        pushed = true;
        f.remote.activity.pull.head = commit;
      },
    },
  };
  const worker = createAgentWorker(f.db, f.files, runtime, {
    aiSecret: secret,
    integrationSecret: secret,
    gitFactory: factory,
  });
  await worker.tick();
  await worker.settle();
  assert.equal(pushed, true);
  const row = (await f.runs.list(f.owner, f.scope)).find(
    (r) => r.id === run.id,
  )!;
  assert.equal(row.state, "completed", row.error ?? "");
  assert.equal(row.implementation?.[0]?.pull?.draft, true);
  assert.equal(row.result?.verification?.[0]?.outcome, "failed");
});
