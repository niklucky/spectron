import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkoutReview,
  processCommand,
} from "../../backend/src/agent-runs/runtime";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase, schema } from "@spectron/db";
import {
  createId,
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
  type GitAdapterFactory,
  type AgentRuntime,
} from "@spectron/backend";
import { and, eq } from "drizzle-orm";
import { createGitAdapterFactory } from "../../backend/src/git/provider";
import { reviewLocation, type ReviewDiff } from "../../backend/src/git/reviews";
import { validReviewFindings } from "../../backend/src/agent-runs/reviews";
const secret = "review-test-secret-with-at-least-32-characters";
const finding = {
  path: "src/a.ts",
  line: 2,
  side: "RIGHT" as const,
  explanation: "This loses the error check.",
  suggestedFix: "Retain the guard.",
};
const pull: GitPullRequest = {
  number: "7",
  url: "https://github.com/team/repo/pull/7",
  sourceBranch: "feature",
  targetBranch: "main",
  state: "open",
  draft: true,
  head: "a".repeat(40),
};
const diff: ReviewDiff = {
  pull,
  base: "b".repeat(40),
  start: "c".repeat(40),
  files: [
    {
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
      patch: "@@ -1,2 +1,2 @@\n context\n-old\n+new",
    },
  ],
};
test("review findings validate changed lines, renamed/deleted paths, and incomplete patches", () => {
  assert.ok(reviewLocation(diff, finding));
  assert.ok(reviewLocation(diff, { ...finding, side: "LEFT" }));
  assert.equal(reviewLocation(diff, { ...finding, line: 1 }), null);
  assert.equal(
    reviewLocation(
      {
        ...diff,
        files: [{ ...diff.files[0]!, patch: "@@ -1,2 +1,2 @@\n-old\n+new" }],
      },
      { ...finding, line: 1 },
    ),
    null,
  );
  assert.equal(
    reviewLocation(
      { ...diff, files: [{ ...diff.files[0]!, patch: "" }] },
      finding,
    ),
    null,
  );
  assert.ok(
    reviewLocation(
      { ...diff, files: [{ ...diff.files[0]!, oldPath: "old.ts" }] },
      { ...finding, path: "old.ts", side: "LEFT" },
    ),
  );
  assert.throws(() =>
    validReviewFindings([{ ...finding, path: "../outside" }]),
  );
  assert.throws(() => validReviewFindings([{ ...finding, line: 0 }]));
  assert.throws(() => validReviewFindings(undefined));
  assert.deepEqual(validReviewFindings([]), []);
});
for (const provider of ["github", "gitlab"] as const) {
  test(`${provider} review adapter pins diff refs and publishes provider-specific inline locations`, async () => {
    const github = provider === "github";
    const baseURL = github
      ? "https://github.com"
      : "https://gitlab.example.test";
    const repo = {
      externalId: "1",
      fullName: "team/repo",
      defaultBranch: "main",
      archived: false,
      cloneURL: `${baseURL}/team/repo.git`,
      webURL: `${baseURL}/team/repo`,
    };
    const payload = github
      ? {
          number: 7,
          head: { sha: pull.head, ref: "feature" },
          base: { sha: diff.base, ref: "main" },
          state: "open",
          draft: true,
        }
      : {
          iid: 7,
          sha: pull.head,
          source_branch: "feature",
          target_branch: "main",
          state: "opened",
          draft: true,
          diff_refs: {
            base_sha: diff.base,
            start_sha: diff.start,
            head_sha: pull.head,
          },
        };
    const posts: any[] = [];
    let pullReads = 0,
      moveBase = false;
    const adapter = createGitAdapterFactory(async (url, headers, options) => {
      assert.ok(github ? headers.Authorization : headers["PRIVATE-TOKEN"]);
      if (options?.method === "POST") {
        posts.push(options.body);
        return github ? { id: 99 } : { id: "thread", notes: [{ id: 99 }] };
      }
      if (url.pathname.endsWith("/files") || url.pathname.endsWith("/diffs"))
        return github
          ? [{ filename: finding.path, patch: diff.files[0]!.patch }]
          : [
              {
                old_path: finding.path,
                new_path: finding.path,
                diff: diff.files[0]!.patch,
              },
            ];
      if (
        url.pathname.endsWith("/comments") ||
        url.pathname.endsWith("/discussions")
      )
        return github
          ? [{ id: 99, body: "<!-- marker -->" }]
          : [{ notes: [{ id: 99, body: "<!-- marker -->" }] }];
      pullReads++;
      return github
        ? {
            ...payload,
            base: {
              ...payload.base,
              sha: moveBase && pullReads % 2 === 0 ? "d".repeat(40) : diff.base,
              repo: { watchers_count: pullReads, pushed_at: String(pullReads) },
            },
          }
        : payload;
    })({ provider, baseURL }, "fixture-token").reviews!;
    const loaded = await adapter.review(repo, "7");
    assert.equal(loaded.pull.head, pull.head);
    if (github) {
      moveBase = true;
      await assert.rejects(adapter.review(repo, "7"), /changed/);
      moveBase = false;
    }
    const sent = await adapter.publishFinding(
      repo,
      loaded,
      finding,
      "Finding\n<!-- marker -->",
    );
    assert.equal(sent.id, "99");
    assert.equal(posts.length, 1);
    if (github)
      assert.deepEqual(posts[0], {
        body: "Finding\n<!-- marker -->",
        commit_id: pull.head,
        path: finding.path,
        line: 2,
        side: "RIGHT",
      });
    else
      assert.deepEqual(posts[0].position, {
        position_type: "text",
        base_sha: diff.base,
        start_sha: diff.start,
        head_sha: pull.head,
        old_path: finding.path,
        new_path: finding.path,
        new_line: 2,
      });
    assert.equal(
      (await adapter.findFinding(repo, loaded.pull, "<!-- marker -->"))?.id,
      "99",
    );
    await assert.rejects(
      adapter.publishFinding(repo, loaded, { ...finding, line: 300 }, "bad"),
    );
    assert.equal(posts.length, 1);
    const renamed = {
      ...loaded,
      files: [{ ...loaded.files[0]!, oldPath: "old.ts", newPath: "new.ts" }],
    };
    await adapter.publishFinding(
      repo,
      renamed,
      { ...finding, path: "old.ts", side: "LEFT" },
      "Removed-line defect",
    );
    if (github) assert.equal(posts[1].path, "new.ts");
    else assert.equal(posts[1].position.old_line, 2);
  });
}
for (const provider of ["github", "gitlab"] as const)
  test(`${provider}: durable review execution, selection, authorization, explicit publication and uncertain recovery`, async (t) => {
    const url = new URL(
      process.env.TEST_DATABASE_URL ||
        "postgresql://spectron:spectron@127.0.0.1:5442/spectron",
    );
    const admin = createDatabase(url.toString()),
      databaseName = `test_reviews_${randomUUID().replaceAll("-", "")}`;
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
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
      .values({ id: projectId, name: "Reviews", key: "REV" });
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
      title: "Review this",
      description: "Preserve checks",
      stateId,
      authorId: owner,
    });
    const scope = { projectId, issueId };
    const ai = createAIService(db, secret);
    const connection = await ai.createConnection(owner, {
      provider: "openai",
      name: "Test",
      apiKey: "fake-key",
    });
    const agent = await ai.saveAgent(owner, {
      connectionId: connection.id,
      name: "Reviewer",
      avatar: null,
      model: "gpt-5.4",
      effort: "low",
      role: "Reviewer",
      instructions: "Review carefully",
    });
    await ai.setSharing(owner, {
      id: agent.id,
      revision: 1,
      projectId,
      visibility: "project",
      memberIds: [],
    });
    let currentDiff = structuredClone(diff),
      writes = 0,
      reviewReads = 0,
      lose = false,
      noEffect = false;
    const published = new Map<string, { id: string; url: string }>();
    const factory: GitAdapterFactory = (c) => ({
      actor: async () => ({ id: "1", login: "bot", name: "Bot", email: null }),
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
      reviews: {
        review: async () => {
          reviewReads++;
          return structuredClone(currentDiff);
        },
        findFinding: async (_repo, _pull, marker) =>
          published.get(marker) ?? null,
        publishFinding: async (_repo, _diff, _finding, body) => {
          writes++;
          const marker = /<!-- spectron-review:.*? -->/.exec(body)![0];
          const remote = {
            id: String(writes),
            url: `${pull.url}#discussion_r${writes}`,
          };
          if (!noEffect) published.set(marker, remote);
          if (lose || noEffect) throw new Error("Lost response");
          return remote;
        },
      },
    });
    const git = createGitService(db, secret, factory);
    const connectionGit = await git.createConnection(owner, projectId, {
      provider,
      baseURL:
        provider === "github"
          ? "https://github.com"
          : "https://gitlab.example.test",
      name: "Git",
      token: "fake-token",
    });
    const checked = await git.checkConnection(owner, {
      projectId,
      id: connectionGit.id,
      revision: connectionGit.revision,
    });
    const repo = await git.addRepository(owner, {
      projectId,
      id: connectionGit.id,
      revision: checked.connection.revision,
      fullName: "team/repo",
      externalId: "1",
    });
    const files = createFileService(db),
      runs = createAgentRunService(db, files, { secret, factory });
    const invoke = (): AgentInvocation => ({
      ...scope,
      requestId: createId(),
      agentId: agent.id,
      command: "review-code",
      repositoryIds: [repo.id],
      message: "Review the changes",
      fileIds: [],
    });
    await assert.rejects(runs.invoke(owner, invoke()), /no linked/);
    const workspaceId = createId();
    await db.insert(schema.agentWorkspace).values({
      id: workspaceId,
      ...scope,
      repositoryId: repo.id,
      branch: pull.sourceBranch,
      targetBranch: "main",
      pull,
    });
    assert.equal((await runs.reviewTargets(member, scope)).length, 1);
    await assert.rejects(runs.reviewTargets(outsider, scope));
    await assert.rejects(
      runs.invoke(owner, { ...invoke(), reviewWorkspaceId: createId() }),
      /Select/,
    );
    let result: AgentResult = {
      summary: "One defect",
      details: "Inspected changes",
      findings: [finding, { ...finding, explanation: "Another finding" }],
    };
    let preparations = 0;
    const runtime: AgentRuntime = {
      prepare: async (run) => {
        preparations++;
        return run.repositories.map((r) => ({
          ...r,
          commit: run.review!.pull.head,
        }));
      },
      turn: async () => result,
      cleanup: async () => {},
    };
    const worker = createAgentWorker(db, files, runtime, {
      aiSecret: secret,
      integrationSecret: secret,
      gitFactory: factory,
    });
    const finish = async () => {
      await worker.tick();
      await worker.settle();
    };
    const view = async (id: string) =>
      (await runs.list(owner, scope)).find((r) => r.id === id)!;
    const first = await runs.invoke(owner, invoke());
    await finish();
    const v = await view(first.id);
    assert.equal(v.state, "completed");
    assert.equal(v.review?.pull.head, pull.head);
    assert.equal(v.repositories[0]?.commit, pull.head);
    assert.equal(writes, 0);
    assert.equal(v.findings?.length, 2);
    const one = v.findings![0]!,
      two = v.findings![1]!;
    const ref = { ...scope, id: first.id };
    await assert.rejects(
      runs.publishFindings(member, { ...ref, findingIds: [one.id] }),
      /Only/,
    );
    await assert.rejects(
      runs.publishFindings(owner, { ...ref, findingIds: [one.id, createId()] }),
      /Finding/,
    );
    const edit = {
      ...ref,
      findingId: one.id,
      revision: one.revision,
      explanation: "Edited defect",
      suggestedFix: "Fix it",
      dismissed: false,
    };
    await runs.editFinding(owner, edit);
    await assert.rejects(runs.editFinding(owner, edit), /changed/);
    await runs.editFinding(owner, {
      ...edit,
      findingId: two.id,
      dismissed: true,
    });
    await Promise.all([
      runs.publishFindings(owner, { ...ref, findingIds: [one.id, two.id] }),
      runs.publishFindings(owner, { ...ref, findingIds: [one.id] }),
    ]);
    assert.equal(writes, 1);
    assert.equal((await view(first.id)).findings![0]!.state, "published");
    await runs.publishFindings(owner, { ...ref, findingIds: [one.id] });
    assert.equal(writes, 1);
    await assert.rejects(
      runs.editFinding(owner, { ...edit, revision: 3 }),
      /cannot be edited/,
    );
    await runs.editFinding(owner, { ...edit, findingId: two.id, revision: 2 });
    currentDiff.pull.head = "d".repeat(40);
    await runs.publishFindings(owner, { ...ref, findingIds: [two.id] });
    assert.equal((await view(first.id)).findings![1]!.state, "stale");
    assert.equal(writes, 1);
    currentDiff = structuredClone(diff);
    const lost = await runs.invoke(member, invoke());
    await finish();
    const lostRef = { ...scope, id: lost.id },
      lostId = (await view(lost.id)).findings![0]!.id;
    lose = true;
    await runs.publishFindings(member, { ...lostRef, findingIds: [lostId] });
    lose = false;
    assert.equal((await view(lost.id)).findings![0]!.state, "uncertain");
    await runs.publishFindings(owner, { ...lostRef, findingIds: [lostId] });
    assert.equal((await view(lost.id)).findings![0]!.state, "published");
    assert.equal(writes, 2);
    const unknownId = (await view(lost.id)).findings![1]!.id;
    noEffect = true;
    await runs.publishFindings(member, { ...lostRef, findingIds: [unknownId] });
    noEffect = false;
    await runs.publishFindings(member, { ...lostRef, findingIds: [unknownId] });
    assert.equal(writes, 3);
    assert.equal((await view(lost.id)).findings![1]!.state, "uncertain");
    const batch = await runs.invoke(owner, invoke());
    await finish();
    const readsBeforeBatch = reviewReads,
      writesBeforeBatch = writes;
    await runs.publishFindings(owner, {
      ...scope,
      id: batch.id,
      findingIds: (await view(batch.id)).findings!.map((f) => f.id),
    });
    assert.equal(reviewReads - readsBeforeBatch, 1);
    assert.equal(writes - writesBeforeBatch, 2);
    assert.ok(
      (await view(batch.id)).findings!.every((f) => f.state === "published"),
    );
    result = { summary: "No issues", details: "Checked", findings: [] };
    const empty = await runs.invoke(owner, invoke());
    await finish();
    assert.equal((await view(empty.id)).state, "completed");
    assert.equal((await view(empty.id)).findings!.length, 0);
    result = { summary: "Malformed", details: "Missing findings" };
    const malformed = await runs.invoke(owner, invoke());
    await finish();
    assert.equal((await view(malformed.id)).state, "failed");
    const stopped = await runs.invoke(owner, invoke());
    await runs.stop(owner, { ...scope, id: stopped.id });
    await finish();
    assert.equal((await view(stopped.id)).state, "stopped");
    const repo2 = await git.addRepository(owner, {
      projectId,
      id: connectionGit.id,
      revision: checked.connection.revision,
      fullName: "team/second",
      externalId: "2",
    });
    await db.insert(schema.agentWorkspace).values({
      id: createId(),
      ...scope,
      repositoryId: repo2.id,
      branch: "feature",
      targetBranch: "main",
      pull: { ...pull, number: "8" },
    });
    await assert.rejects(runs.invoke(owner, invoke()), /Select/);
    await assert.rejects(
      runs.invoke(owner, {
        ...invoke(),
        reviewWorkspaceId: workspaceId,
        repositoryIds: [repo2.id],
      }),
      /belonging/,
    );
    result = {
      summary: "Selected review",
      details: "No findings",
      findings: [],
    };
    const selected = await runs.invoke(owner, {
      ...invoke(),
      reviewWorkspaceId: workspaceId,
    });
    await finish();
    assert.equal((await view(selected.id)).review!.workspaceId, workspaceId);
    assert.equal(preparations, 6);
    assert.ok(
      !JSON.stringify(await runs.list(member, scope)).includes("fake-token"),
    );
  });

test("review checkout fetches both provider refs at the recorded commit and rejects changed heads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "spectron-review-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin"),
    checkout = join(root, "checkout");
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.test",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.test",
  };
  const git = (args: string[]) => processCommand("git", args, { env });
  await git(["init", "-b", "main", origin]);
  await writeFile(join(origin, "file.txt"), "base");
  await git(["-C", origin, "add", "."]);
  await git(["-C", origin, "commit", "-m", "Base"]);
  await git(["clone", origin, checkout]);
  await writeFile(join(origin, "file.txt"), "reviewed change");
  await git(["-C", origin, "commit", "-am", "Change"]);
  const head = (await git(["-C", origin, "rev-parse", "HEAD"])).trim();
  for (const provider of ["github", "gitlab"] as const) {
    await git([
      "-C",
      origin,
      "update-ref",
      provider === "github" ? "refs/pull/7/head" : "refs/merge-requests/7/head",
      head,
    ]);
    await checkoutReview(
      checkout,
      provider,
      { ...pull, head },
      env,
      AbortSignal.timeout(10000),
    );
    assert.equal(
      (await git(["-C", checkout, "rev-parse", "HEAD"])).trim(),
      head,
    );
    await assert.rejects(
      checkoutReview(
        checkout,
        provider,
        { ...pull, head: "f".repeat(40) },
        env,
        AbortSignal.timeout(10000),
      ),
      /changed before checkout/,
    );
  }
});
