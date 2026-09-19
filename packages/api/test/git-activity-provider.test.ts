import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitAdapterFactory } from "../../backend/src/git/provider";
for (const provider of ["github", "gitlab"] as const)
  test(`${provider}: activity, thread actions, allowed merge methods and exact-head API contract`, async () => {
    const github = provider === "github",
      baseURL = github
        ? "https://github.com"
        : "https://git.example.test/prefix";
    const repo = {
      externalId: "12",
      fullName: "team/repo",
      webURL: `${baseURL}/team/repo`,
      cloneURL: `${baseURL}/team/repo.git`,
      defaultBranch: "main",
      archived: false,
    };
    const head = "a".repeat(40),
      date = "2026-09-19T00:00:00Z";
    let status = "CLEAN",
      glstatus = "mergeable",
      approved = true,
      shiftHead = false;
    const raw = {
      id: 7,
      node_id: "PR7",
      number: 7,
      iid: 7,
      title: github ? "WIP: Change" : "Change",
      state: github ? "open" : "opened",
      draft: false,
      head: { sha: head, ref: "feature" },
      base: { sha: "b".repeat(40), ref: "main" },
      sha: head,
      source_branch: "feature",
      target_branch: "main",
      user: { login: "author" },
      author: { username: "author" },
      requested_reviewers: [{ login: "requested" }],
      reviewers: [{ username: "reviewer" }],
      head_pipeline: { id: 8, status: "success" },
      has_conflicts: false,
      blocking_discussions_resolved: true,
    };
    let reads = 0;
    const writes: { path: string; method: string; body: any }[] = [];
    const transport: Parameters<typeof createGitAdapterFactory>[0] = async (
      url,
      headers,
      options,
    ) => {
      assert.ok(github ? headers.Authorization : headers["PRIVATE-TOKEN"]);
      const p = url.pathname;
      if (!options) reads++;
      if (p === "/graphql") {
        const body = options!.body as any,
          q = body.query as string;
        if (q.startsWith("mutation")) {
          writes.push({ path: p, method: options!.method!, body });
          return { data: { done: true } };
        }
        if (q.includes("reviewThreads"))
          return {
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    pageInfo: { hasNextPage: false },
                    nodes: [
                      {
                        id: "thread1",
                        isResolved: false,
                        viewerCanResolve: true,
                        viewerCanUnresolve: true,
                        path: "src/a.ts",
                        line: 2,
                        comments: {
                          pageInfo: { hasNextPage: false },
                          nodes: [
                            {
                              databaseId: 9,
                              body: "Check this",
                              createdAt: date,
                              updatedAt: date,
                              author: { login: "reviewer" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          };
        return {
          data: {
            repository: {
              mergeCommitAllowed: true,
              squashMergeAllowed: true,
              rebaseMergeAllowed: false,
              pullRequest: {
                id: "PR7",
                headRefOid: head,
                mergeStateStatus: status,
                reviewDecision: approved ? "APPROVED" : "REVIEW_REQUIRED",
                commits: {
                  nodes: [
                    { commit: { statusCheckRollup: { state: "SUCCESS" } } },
                  ],
                },
              },
            },
          },
        };
      }
      if (options) {
        writes.push({ path: p, method: options.method!, body: options.body });
        return p.endsWith("/merge")
          ? github
            ? { merged: true }
            : { state: "merged" }
          : { id: 10 };
      }
      if (p.endsWith("/check-runs"))
        return {
          total_count: 1,
          check_runs: [
            {
              id: 11,
              name: "Unit tests",
              status: "completed",
              conclusion: "success",
            },
          ],
        };
      if (p.endsWith("/statuses"))
        return [
          { context: "build", state: "success" },
          { context: "build", state: "failure" },
        ];
      if (p.endsWith("/issues/7/comments"))
        return [
          {
            id: 12,
            body: "General comment",
            created_at: date,
            updated_at: date,
            user: { login: "human" },
          },
        ];
      if (p.endsWith("/reviews"))
        return [
          {
            id: 13,
            body: "Looks good",
            submitted_at: date,
            user: { login: "reviewer" },
            state: "APPROVED",
          },
          {
            id: 16,
            body: "Follow-up",
            submitted_at: date,
            user: { login: "reviewer" },
            state: "COMMENTED",
          },
          {
            id: 14,
            body: "Unsubmitted",
            submitted_at: null,
            user: { login: "reviewer" },
            state: "PENDING",
          },
        ];
      if (p.endsWith("/discussions"))
        return [
          {
            id: "thread1",
            notes: [
              {
                id: 9,
                body: "Check this",
                created_at: date,
                updated_at: date,
                author: { username: "reviewer" },
                resolvable: true,
                resolved: false,
                position: { new_path: "src/a.ts", new_line: 2 },
              },
              { id: 15, body: "system note", system: true },
            ],
          },
        ];
      if (p.endsWith("/approvals"))
        return {
          approvals_left: approved ? 0 : 1,
          approved_by: [{ user: { username: "reviewer" } }],
        };
      if (p.endsWith("/jobs"))
        return [{ id: 11, name: "Unit tests", status: "success" }];
      if (p.endsWith("/projects/12")) return { squash_option: "always" };
      if (p.endsWith("/commits"))
        return [
          {
            sha: head,
            id: head,
            commit: { message: "Change", author: { name: "Author" } },
            message: "Change",
            author_name: "Author",
          },
        ];
      assert.ok(p.endsWith("/pulls/7") || p.endsWith("/merge_requests/7"), p);
      const result = { ...raw, detailed_merge_status: glstatus };
      if (shiftHead) {
        result.sha = "b".repeat(40);
        result.head = { ...raw.head, sha: "b".repeat(40) };
      }
      return result;
    };
    const adapter = createGitAdapterFactory(transport)(
      { provider, baseURL },
      "secret",
    ).activity!;
    const snapshot = await adapter.snapshot(repo, "7");
    assert.equal(snapshot.activity.mergeable, true);
    assert.equal(snapshot.activity.pull.draft, false);
    const beforeProbe = reads;
    assert.equal(
      await adapter.probe!(repo, "7"),
      snapshot.activity.providerVersion,
    );
    assert.equal(reads - beforeProbe, 1);
    assert.equal(snapshot.activity.commits.length, 1);
    assert.ok(
      snapshot.activity.checks.some(
        (c) => c.name === "Unit tests" && c.state === "passed",
      ),
    );
    assert.ok(
      snapshot.activity.reviewers.some(
        (r) => r.login === "reviewer" && r.state === "APPROVED",
      ),
    );
    assert.equal(snapshot.discussions[0]!.notes.length, 1);
    assert.ok(
      snapshot.activity.participants.some((p) => p.login === "reviewer"),
    );
    assert.ok(
      !snapshot.discussions.some((d) =>
        d.notes.some((n) => n.body === "Unsubmitted"),
      ),
    );
    if (!github) assert.deepEqual(snapshot.activity.mergeMethods, ["squash"]);
    await adapter.reply(
      repo,
      snapshot.activity.pull,
      snapshot.discussions[0]!,
      "Explicit reply",
    );
    await adapter.resolve(
      repo,
      snapshot.activity.pull,
      snapshot.discussions[0]!,
      true,
    );
    await adapter.resolve(
      repo,
      snapshot.activity.pull,
      snapshot.discussions[0]!,
      false,
    );
    await adapter.draft!(repo, snapshot.activity.pull);
    const beforeReady = writes.length;
    await adapter.ready(repo, {
      ...snapshot.activity,
      title: "Draft: Stale title",
    });
    assert.equal(writes.length, beforeReady);
    raw.draft = true;
    raw.title = "Draft: Renamed change";
    await adapter.ready(repo, {
      ...snapshot.activity,
      title: "Draft: Stale title",
    });
    await adapter.close(repo, snapshot.activity);
    await adapter.merge(repo, snapshot.activity, "squash");
    const merged = writes.at(-1)!;
    assert.equal(merged.method, "PUT");
    assert.equal(merged.body.sha, head);
    assert.equal(
      github ? merged.body.merge_method : merged.body.squash,
      github ? "squash" : true,
    );
    assert.equal(merged.body.merge_when_pipeline_succeeds, undefined);
    assert.ok(
      writes[0]!.path.endsWith(
        github
          ? "/pulls/7/comments/9/replies"
          : "/merge_requests/7/discussions/thread1/notes",
      ),
    );
    if (github) {
      assert.ok(
        writes.some((w) => w.body.query?.includes("unresolveReviewThread")),
      );
      assert.ok(
        writes.some((w) =>
          w.body.query?.includes("markPullRequestReadyForReview"),
        ),
      );
    } else {
      assert.ok(writes.some((w) => w.body.resolved === false));
      assert.ok(writes.some((w) => w.body.title === "Renamed change"));
    }
    status = "BLOCKED";
    glstatus = "ci_still_running";
    assert.equal((await adapter.snapshot(repo, "7")).activity.mergeable, false);
    status = "CLEAN";
    glstatus = "mergeable";
    approved = false;
    assert.equal((await adapter.snapshot(repo, "7")).activity.mergeable, false);
    await assert.rejects(
      adapter.merge(repo, { ...snapshot.activity, mergeable: false }, "squash"),
    );
    if (github) {
      approved = true;
      shiftHead = true;
      await assert.rejects(adapter.snapshot(repo, "7"), /changed/);
    }
  });
for (const provider of ["github", "gitlab"] as const)
  test(`${provider}: branch comparison uses immutable commits and detects moved branches`, async () => {
    const github = provider === "github",
      baseURL = github ? "https://github.com" : "https://git.example.test";
    const repo = {
      externalId: "12",
      fullName: "team/repo",
      webURL: `${baseURL}/team/repo`,
      cloneURL: `${baseURL}/team/repo.git`,
      defaultBranch: "main",
      archived: false,
    };
    const head = "a".repeat(40),
      base = "b".repeat(40);
    let sourceReads = 0,
      moved = false;
    const adapter = createGitAdapterFactory(async (url) => {
      if (url.pathname.includes("/branches/")) {
        const source = url.pathname.endsWith("/feature");
        if (source) sourceReads++;
        const sha = source
          ? moved && sourceReads > 1
            ? "c".repeat(40)
            : head
          : base;
        return { commit: { sha, id: sha } };
      }
      if (url.pathname.endsWith("/merge_base")) return { id: base };
      const patch = "@@ -1 +1 @@\n-old\n+new";
      if (github) {
        assert.ok(url.pathname.endsWith(`${base}...${head}`));
        return {
          merge_base_commit: { sha: base },
          files: [{ filename: "src/a.ts", patch }],
        };
      }
      assert.equal(url.searchParams.get("to"), head);
      assert.equal(url.searchParams.get("from"), base);
      return {
        diffs: [{ old_path: "src/a.ts", new_path: "src/a.ts", diff: patch }],
        compare_timeout: false,
      };
    })({ provider, baseURL }, "secret").reviews!;
    const diff = await adapter.branchReview!(repo, "feature", "main");
    assert.equal(diff.head, head);
    assert.equal(diff.base, base);
    assert.equal(diff.files.length, 1);
    sourceReads = 0;
    moved = true;
    await assert.rejects(
      adapter.branchReview!(repo, "feature", "main"),
      /changed/,
    );
  });
