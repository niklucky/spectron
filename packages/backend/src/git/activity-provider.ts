import type {
  GitActivity,
  GitDiscussionData,
  GitNote,
  GitPerson,
  GitPullRequest,
  GitRemoteRepository,
} from "@spectron/shared";
import type { GitTransport } from "./transport";
import { IssueInputError } from "../issues";
export interface GitActivityAdapter {
  draft?(repo: GitRemoteRepository, pull: GitPullRequest): Promise<void>;
  snapshot(
    repo: GitRemoteRepository,
    number: string,
  ): Promise<{ activity: GitActivity; discussions: GitDiscussionData[] }>;
  reply(
    repo: GitRemoteRepository,
    pull: GitPullRequest,
    discussion: GitDiscussionData,
    body: string,
  ): Promise<string>;
  resolve(
    repo: GitRemoteRepository,
    pull: GitPullRequest,
    discussion: GitDiscussionData,
    resolved: boolean,
  ): Promise<void>;
  ready(repo: GitRemoteRepository, activity: GitActivity): Promise<void>;
  close(repo: GitRemoteRepository, activity: GitActivity): Promise<void>;
  merge(
    repo: GitRemoteRepository,
    activity: GitActivity,
    method: "merge" | "squash" | "rebase",
  ): Promise<void>;
}
// Provider prose/errors are never used as executable input or as trusted URLs.
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid provider metadata");
  return v as Record<string, any>;
};
const str = (v: unknown, max = 100000) => {
  if (typeof v !== "string" || v.length > max)
    throw new Error("Invalid provider metadata");
  return v;
};
const id = (v: unknown) => {
  const value = String(v);
  if (!/^[A-Za-z0-9_=-]{1,255}$/.test(value))
    throw new Error("Invalid provider ID");
  return value;
};
const person = (v: unknown): GitPerson => {
  const p = v ? object(v) : {};
  return {
    name: String(p.name || p.login || p.username || "Unknown").slice(0, 255),
    login: String(p.login || p.username || "").slice(0, 255),
  };
};
const stamp = (v: unknown) => {
  const d = new Date(String(v));
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid provider date");
  return d.toISOString();
};
const checkState = (v: unknown): GitActivity["checks"][number]["state"] =>
  ["success", "SUCCESS", "passed", "neutral", "skipped"].includes(String(v))
    ? "passed"
    : [
          "failure",
          "FAILURE",
          "ERROR",
          "failed",
          "cancelled",
          "timed_out",
          "action_required",
          "startup_failure",
        ].includes(String(v))
      ? "failed"
      : [
            "pending",
            "PENDING",
            "running",
            "queued",
            "in_progress",
            "created",
            "waiting_for_resource",
            "preparing",
            "scheduled",
          ].includes(String(v))
        ? "pending"
        : "unknown";
export function activityAdapter({
  github,
  get,
  repoPath,
  pull,
}: {
  github: boolean;
  get: (
    path: string,
    options?: Parameters<GitTransport>[2],
  ) => Promise<unknown>;
  repoPath: (repo: GitRemoteRepository) => string;
  pull: (value: unknown, repo: GitRemoteRepository) => GitPullRequest;
}): GitActivityAdapter {
  const endpoint = (repo: GitRemoteRepository, n: string) => {
    if (!/^[1-9]\d{0,19}$/.test(n)) throw new Error("Invalid request number");
    return `${repoPath(repo)}/${github ? "pulls" : "merge_requests"}/${n}`;
  };
  async function pages(url: string) {
    const out: Record<string, any>[] = [];
    for (let p = 1; p <= 100; p++) {
      const value = await get(
        `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${p}`,
      );
      if (!Array.isArray(value)) throw new Error("Incomplete provider list");
      out.push(...value.map(object));
      if (value.length < 100) return out;
    }
    throw new IssueInputError(
      "Provider activity exceeds the synchronization limit. Open the provider to inspect all activity.",
    );
  }
  async function gql(query: string, variables: Record<string, unknown>) {
    const response = object(
      await get("/graphql", { method: "POST", body: { query, variables } }),
    );
    if (response.errors || !response.data)
      throw new IssueInputError(
        "GitHub could not complete this action. Check token permissions and current repository rules.",
      );
    return object(response.data);
  }
  const noteFields = "databaseId body createdAt updatedAt author { login }";
  async function ghThreads(repo: GitRemoteRepository, number: string) {
    const [owner, name] = repo.fullName.split("/");
    const threads: GitDiscussionData[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const data = await gql(
        `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved viewerCanResolve viewerCanUnresolve path line originalLine comments(first:100){pageInfo{hasNextPage endCursor} nodes{${noteFields}}}}}}}}`,
        { owner, name, number: Number(number), after: cursor },
      );
      const connection = object(data.repository?.pullRequest?.reviewThreads);
      if (!Array.isArray(connection.nodes))
        throw new Error("Missing review threads");
      for (const raw of connection.nodes) {
        const t = object(raw);
        const comments = [...t.comments.nodes];
        let nc = t.comments.pageInfo;
        for (let p = 0; nc.hasNextPage; p++) {
          if (p >= 100) throw new Error("Review discussion is too large");
          const more = await gql(
            `query($id:ID!,$after:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{${noteFields}}}}}}`,
            { id: id(t.id), after: nc.endCursor },
          );
          comments.push(...more.node.comments.nodes);
          nc = more.node.comments.pageInfo;
        }
        if (!comments.length) continue;
        const url = `${repo.webURL}/pull/${number}#discussion_r${id(comments[0].databaseId)}`;
        threads.push({
          externalId: id(t.id),
          replyId: id(comments[0].databaseId),
          url,
          resolved: t.isResolved === true,
          resolvable: t.isResolved
            ? t.viewerCanUnresolve === true
            : t.viewerCanResolve === true,
          path: typeof t.path === "string" ? t.path : null,
          line: t.line ?? t.originalLine ?? null,
          notes: comments.map((c) => ({
            id: id(c.databaseId),
            author: person(c.author),
            body: str(c.body),
            url: `${repo.webURL}/pull/${number}#discussion_r${id(c.databaseId)}`,
            createdAt: stamp(c.createdAt),
            updatedAt: stamp(c.updatedAt),
          })),
        });
      }
      if (!connection.pageInfo.hasNextPage) return threads;
      cursor = str(connection.pageInfo.endCursor);
    }
    throw new Error("Too many review threads");
  }
  return {
    async snapshot(repo, number) {
      const url = endpoint(repo, number),
        raw = object(await get(url)),
        p = pull(raw, repo);
      let discussions: GitDiscussionData[],
        checks: GitActivity["checks"],
        reviewers: GitActivity["reviewers"],
        mergeable: boolean,
        mergeReason: string,
        methods: GitActivity["mergeMethods"],
        providerId: string;
      if (github) {
        const [owner, name] = repo.fullName.split("/");
        const data = await gql(
          "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number:$number){id headRefOid mergeStateStatus reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}",
          { owner, name, number: Number(number) },
        );
        const gp = object(data.repository?.pullRequest);
        if (gp.headRefOid !== p.head)
          throw new IssueInputError(
            "PR changed during refresh. Refresh again.",
          );
        providerId = id(gp.id);
        const check = gp.commits?.nodes?.[0]?.commit?.statusCheckRollup;
        checks = check
          ? [
              {
                name: "Checks and commit statuses",
                state: checkState(check.state),
                url: `${p.url}/checks`,
              },
            ]
          : [];
        const checkRuns: Record<string, any>[] = [];
        for (let page = 1; page <= 100; page++) {
          const batch = object(
            await get(
              `${repoPath(repo)}/commits/${p.head}/check-runs?per_page=100&page=${page}`,
            ),
          );
          if (!Array.isArray(batch.check_runs))
            throw new Error("Incomplete check runs");
          checkRuns.push(...batch.check_runs.map(object));
          if (checkRuns.length >= Number(batch.total_count)) break;
          if (!batch.check_runs.length || page === 100)
            throw new Error("Incomplete check runs");
        }
        checks.push(
          ...checkRuns.map((c) => ({
            name: str(c.name, 4096),
            state: checkState(c.conclusion ?? c.status),
            url: `${p.url}/checks?check_run_id=${id(c.id)}`,
          })),
        );
        const statuses = await pages(
          `${repoPath(repo)}/commits/${p.head}/statuses`,
        );
        const latestStatuses = new Map<string, GitActivity["checks"][number]>();
        for (const status of statuses) {
          const name = str(status.context, 4096);
          if (!latestStatuses.has(name))
            latestStatuses.set(name, {
              name,
              state: checkState(status.state),
              url: `${repo.webURL}/commit/${p.head}/checks`,
            });
        }
        checks.push(...latestStatuses.values());
        mergeable =
          gp.mergeStateStatus === "CLEAN" &&
          gp.reviewDecision !== "CHANGES_REQUESTED" &&
          gp.reviewDecision !== "REVIEW_REQUIRED" &&
          !p.draft &&
          p.state === "open";
        mergeReason = mergeable
          ? "Provider reports merge requirements satisfied"
          : `Provider merge status: ${String(gp.mergeStateStatus ?? "UNKNOWN")}; review: ${String(gp.reviewDecision ?? "not required")}`;
        methods = [];
        if (data.repository.mergeCommitAllowed) methods.push("merge");
        if (data.repository.squashMergeAllowed) methods.push("squash");
        if (data.repository.rebaseMergeAllowed) methods.push("rebase");
        discussions = await ghThreads(repo, number);
        const comments = await pages(
          `${repoPath(repo)}/issues/${number}/comments`,
        );
        for (const n of comments)
          discussions.push({
            externalId: `issue-${id(n.id)}`,
            replyId: `issue-${id(n.id)}`,
            url: `${p.url}#issuecomment-${id(n.id)}`,
            resolved: false,
            resolvable: false,
            path: null,
            line: null,
            notes: [
              {
                id: `issue-${id(n.id)}`,
                author: person(n.user),
                body: str(n.body),
                url: `${p.url}#issuecomment-${id(n.id)}`,
                createdAt: stamp(n.created_at),
                updatedAt: stamp(n.updated_at),
              },
            ],
          });
        const reviews = await pages(`${url}/reviews`);
        const byLogin = new Map<string, GitActivity["reviewers"][number]>();
        for (const r of reviews) {
          const u = person(r.user);
          if (r.state !== "PENDING")
            byLogin.set(u.login, { ...u, state: String(r.state) });
        }
        for (const r of raw.requested_reviewers ?? []) {
          const u = person(r);
          byLogin.set(u.login, { ...u, state: "REQUESTED" });
        }
        reviewers = [...byLogin.values()];
        for (const r of reviews.filter(
          (r) => r.body?.trim() && r.state !== "PENDING" && r.submitted_at,
        ))
          discussions.push({
            externalId: `review-${id(r.id)}`,
            replyId: `issue-review-${id(r.id)}`,
            url: `${p.url}#pullrequestreview-${id(r.id)}`,
            resolved: false,
            resolvable: false,
            path: null,
            line: null,
            notes: [
              {
                id: `review-${id(r.id)}`,
                author: person(r.user),
                body: str(r.body),
                url: `${p.url}#pullrequestreview-${id(r.id)}`,
                createdAt: stamp(r.submitted_at),
                updatedAt: stamp(r.submitted_at),
              },
            ],
          });
      } else {
        providerId = id(raw.id);
        const rows = await pages(`${url}/discussions`);
        discussions = rows.flatMap((t) => {
          const notes = (t.notes ?? []).filter((n: any) => !n.system);
          if (!notes.length) return [];
          const n = notes[0],
            root = `${p.url}#note_${id(n.id)}`;
          return [
            {
              externalId: id(t.id),
              replyId: id(t.id),
              url: root,
              resolved:
                notes.filter((n: any) => n.resolvable).length > 0 &&
                notes
                  .filter((n: any) => n.resolvable)
                  .every((n: any) => n.resolved === true),
              resolvable: notes.some((n: any) => n.resolvable === true),
              path: n.position?.new_path ?? n.position?.old_path ?? null,
              line: n.position?.new_line ?? n.position?.old_line ?? null,
              notes: notes.map((n: any) => ({
                id: id(n.id),
                body: str(n.body),
                author: person(n.author),
                url: `${p.url}#note_${id(n.id)}`,
                createdAt: stamp(n.created_at),
                updatedAt: stamp(n.updated_at),
              })),
            },
          ];
        });
        checks = raw.head_pipeline
          ? [
              {
                name: "Pipeline",
                state: checkState(raw.head_pipeline.status),
                url: `${repo.webURL}/-/pipelines/${id(raw.head_pipeline.id)}`,
              },
            ]
          : [];
        reviewers = (raw.reviewers ?? []).map((r: any) => ({
          ...person(r),
          state: "REQUESTED",
        }));
        if (raw.head_pipeline) {
          const jobs = await pages(
            `${repoPath(repo)}/pipelines/${id(raw.head_pipeline.id)}/jobs`,
          );
          checks.push(
            ...jobs.map((j) => ({
              name: str(j.name, 4096),
              state: checkState(j.status),
              url: `${repo.webURL}/-/jobs/${id(j.id)}`,
            })),
          );
        }
        const approvals = object(await get(`${url}/approvals`));
        for (const entry of approvals.approved_by ?? []) {
          const u = person(entry.user);
          const existing = reviewers.find((r) => r.login === u.login);
          if (existing) existing.state = "APPROVED";
          else reviewers.push({ ...u, state: "APPROVED" });
        }
        const project = object(await get(repoPath(repo)));
        methods =
          project.squash_option === "always"
            ? ["squash"]
            : project.squash_option === "never"
              ? ["merge"]
              : ["merge", "squash"];
        // GitLab's detailed status includes approval, pipeline, conflict, and discussion requirements.
        mergeable =
          raw.detailed_merge_status === "mergeable" &&
          Number(approvals.approvals_left ?? 0) === 0 &&
          !p.draft &&
          p.state === "open" &&
          raw.has_conflicts !== true &&
          raw.blocking_discussions_resolved !== false;
        mergeReason = mergeable
          ? "Provider reports merge requirements satisfied"
          : `Provider merge status: ${String(raw.detailed_merge_status ?? "unknown")}`;
      }
      const commits = (await pages(`${url}/commits`)).map((c) => ({
        sha: str(github ? c.sha : c.id, 64),
        message: str(github ? c.commit?.message : c.message, 50000),
        author: String(
          github ? (c.commit?.author?.name ?? "") : (c.author_name ?? ""),
        ).slice(0, 255),
      }));
      const participants = new Map<string, GitPerson>();
      for (const u of [
        person(raw.user ?? raw.author),
        ...(raw.assignees ?? []).map(person),
        ...reviewers,
        ...discussions.flatMap((t) => t.notes.map((n) => n.author)),
      ])
        participants.set(u.login || u.name, u);
      const after = pull(await get(url), repo);
      if (
        after.head !== p.head ||
        after.state !== p.state ||
        after.draft !== p.draft ||
        after.targetBranch !== p.targetBranch
      )
        throw new IssueInputError(
          "PR/MR changed during refresh. Refresh again.",
        );
      return {
        activity: {
          pull: p,
          title: str(raw.title, 4096),
          providerId,
          checks,
          commits,
          participants: [...participants.values()],
          reviewers,
          mergeable,
          mergeReason,
          mergeMethods: methods,
        },
        discussions,
      };
    },
    async reply(repo, p, discussion, body) {
      const value = object(
        await get(
          github
            ? discussion.replyId.startsWith("issue-")
              ? `${repoPath(repo)}/issues/${p.number}/comments`
              : `${endpoint(repo, p.number)}/comments/${id(discussion.replyId)}/replies`
            : `${endpoint(repo, p.number)}/discussions/${id(discussion.externalId)}/notes`,
          { method: "POST", body: { body } },
        ),
      );
      return `${github && discussion.replyId.startsWith("issue-") ? "issue-" : ""}${id(value.id)}`;
    },
    async resolve(repo, p, discussion, resolved) {
      if (!discussion.resolvable)
        throw new IssueInputError(
          "This provider discussion cannot be resolved with the current identity.",
        );
      if (github)
        await gql(
          `mutation($id:ID!){${resolved ? "resolveReviewThread" : "unresolveReviewThread"}(input:{threadId:$id}){thread{id isResolved}}}`,
          { id: discussion.externalId },
        );
      else
        await get(
          `${endpoint(repo, p.number)}/discussions/${id(discussion.externalId)}`,
          { method: "PUT", body: { resolved } },
        );
    },
    async draft(repo, p) {
      const raw = object(await get(endpoint(repo, p.number))),
        current = pull(raw, repo);
      if (current.state !== "open" || current.head !== p.head)
        throw new IssueInputError(
          "PR/MR changed before returning it to draft.",
        );
      if (current.draft) return;
      if (github)
        await gql(
          "mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{id isDraft}}}",
          { id: id(raw.node_id) },
        );
      else
        await get(endpoint(repo, p.number), {
          method: "PUT",
          body: { title: `Draft: ${str(raw.title, 4096)}` },
        });
    },
    async ready(repo, activity) {
      if (github)
        await gql(
          "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id isDraft}}}",
          { id: activity.providerId },
        );
      else
        await get(endpoint(repo, activity.pull.number), {
          method: "PUT",
          body: { title: activity.title.replace(/^(Draft:|WIP:)\s*/i, "") },
        });
    },
    async close(repo, activity) {
      await get(endpoint(repo, activity.pull.number), {
        method: github ? "PATCH" : "PUT",
        body: github ? { state: "closed" } : { state_event: "close" },
      });
    },
    async merge(repo, activity, method) {
      if (!activity.mergeable || !activity.mergeMethods.includes(method))
        throw new IssueInputError(activity.mergeReason);
      const result = object(
        await get(`${endpoint(repo, activity.pull.number)}/merge`, {
          method: "PUT",
          body: github
            ? { sha: activity.pull.head, merge_method: method }
            : {
                sha: activity.pull.head,
                squash: method === "squash",
                should_remove_source_branch: false,
              },
        }),
      );
      if (github ? result.merged !== true : result.state !== "merged")
        throw new IssueInputError(
          "The provider did not confirm a completed merge. Refresh the PR/MR.",
        );
    },
  };
}
