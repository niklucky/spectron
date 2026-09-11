import type { GitActor, GitPage, GitProvider, GitRemoteRepository, GitPullRequest } from "@spectron/shared";
import { IssueInputError } from "../issues";
import { createGitTransport, normalizeGitBaseURL, type GitTransport } from "./transport";

// The only provider boundary exposed to the service. Later branch/PR/sync
// operations belong on this adapter; no provider requests belong in the UI.
export interface GitAdapter {
  findPull?(repository: GitRemoteRepository, source: string, target: string): Promise<GitPullRequest | null>;
  createDraft?(repository: GitRemoteRepository, input: { source: string; target: string; title: string; body: string }, signal: AbortSignal): Promise<GitPullRequest>;
  actor(): Promise<GitActor>;
  repositories(page: number): Promise<GitPage<GitRemoteRepository>>;
  repository(fullName: string, externalId: string): Promise<GitRemoteRepository>;
  branch(repository: GitRemoteRepository, name: string): Promise<void>;
}
export type GitAdapterFactory = (connection: { provider: GitProvider; baseURL: string }, token: string) => GitAdapter;
const text = (value: unknown, max = 1024): string => {
  if (typeof value !== "string" || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid provider metadata");
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider response");
  return value as Record<string, unknown>;
};
const remoteId = (value: unknown) => { const id = String(value); if (!/^[1-9]\d{0,19}$/.test(id)) throw new Error("Invalid provider ID"); return id; };
export function validateRepositoryPath(value: string, provider: GitProvider) {
  const parts = value.split("/");
  if (value.length > 1024 || parts.length < 2 || (provider === "github" && parts.length !== 2) || parts.some(p => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === "." || p === ".."))
    throw new IssueInputError("Invalid repository path. Choose a repository from the connection.");
  return parts.map(encodeURIComponent).join("/");
}
export function validateBranch(value: string) {
  if (!value || value.length > 255 || /[\x00-\x20\x7f~^:?*\[\\]/.test(value) || value.includes("..") || value.includes("@{") || value === "@" || value.startsWith("-") || value.endsWith(".") || value.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".lock")))
    throw new IssueInputError("Enter a valid Git branch name.");
  return value;
}
export function createGitAdapterFactory(transport: GitTransport = createGitTransport()): GitAdapterFactory {
  return (connection, token) => {
    const base = normalizeGitBaseURL(connection.provider, connection.baseURL);
    const github = connection.provider === "github";
    const api = github ? "https://api.github.com" : `${base}/api/v4`;
    async function get(path: string, options?: Parameters<GitTransport>[2]) {
      return transport(new URL(api + path), github
        ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" }
        : { "PRIVATE-TOKEN": token, Accept: "application/json" }, options);
    }
    function repository(value: unknown): GitRemoteRepository {
      const r = record(value), fullName = text(github ? r.full_name : r.path_with_namespace);
      const path = validateRepositoryPath(fullName, connection.provider);
      const defaultBranch = r.default_branch ? validateBranch(text(r.default_branch, 255)) : null;
      // Construct credential-free URLs using the trusted instance and validated
      // repository path. Never persist provider clone URLs or temporary tokens.
      return { externalId: remoteId(r.id), fullName, webURL: `${base}/${path}`, cloneURL: `${base}/${path}.git`,
        defaultBranch, archived: r.archived === true || r.disabled === true };
    }
    const repoPath = (repo: GitRemoteRepository) => github ? `/repos/${validateRepositoryPath(repo.fullName, "github")}` : `/projects/${remoteId(repo.externalId)}`;
    async function safe<T>(action: () => Promise<T>): Promise<T> {
      try { return await action(); }
      catch (error) { if (error instanceof IssueInputError) throw error; throw new IssueInputError("The Git provider returned an invalid response or could not be reached. Retry the connection check."); }
    }
    function pull(value: unknown, repo: GitRemoteRepository): GitPullRequest {
      const r = record(value), number = remoteId(github ? r.number : r.iid);
      const head = github ? record(r.head) : r;
      const target = github ? record(r.base) : r;
      const sha = text(github ? head.sha : r.sha, 64);
      if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error("Invalid revision");
      return { number, url: `${base}/${validateRepositoryPath(repo.fullName, connection.provider)}/${github ? "pull" : "-/merge_requests"}/${number}`,
        sourceBranch: validateBranch(text(github ? head.ref : r.source_branch)),
        targetBranch: validateBranch(text(github ? target.ref : r.target_branch)), head: sha,
        state: r.merged_at || r.state === "merged" ? "merged" : ["open", "opened"].includes(String(r.state)) ? "open" : "closed",
        draft: r.draft === true || r.work_in_progress === true || /^(Draft:|WIP:)/i.test(String(r.title)),
      };
    }
    return {
      findPull: (repo, source, target) => safe(async () => {
        validateBranch(source); validateBranch(target);
        const query = new URLSearchParams(github
          ? { state: "all", head: `${repo.fullName.split("/")[0]}:${source}`, base: target, per_page: "100" }
          : { scope: "all", source_branch: source, target_branch: target, per_page: "100" });
        const rows = await get(`${repoPath(repo)}/${github ? "pulls" : "merge_requests"}?${query}`);
        if (!Array.isArray(rows) || rows.length >= 100) throw new Error("Ambiguous pull request list");
        const matches = rows.map(r => pull(r, repo)).filter(r => r.sourceBranch === source && r.targetBranch === target);
        if (matches.length > 1) throw new IssueInputError("Multiple PRs/MRs use this branch. Resolve them on the provider before continuing.");
        return matches[0] ?? null;
      }),
      createDraft: (repo, input, signal) => safe(async () => {
        validateBranch(input.source); validateBranch(input.target); signal.throwIfAborted();
        return pull(await get(`${repoPath(repo)}/${github ? "pulls" : "merge_requests"}`, { method: "POST", signal,
          body: github ? { head: input.source, base: input.target, title: input.title, body: input.body, draft: true, maintainer_can_modify: false }
            : { source_branch: input.source, target_branch: input.target, title: `Draft: ${input.title}`, description: input.body, remove_source_branch: false },
        }), repo);
      }),
      actor: () => safe(async () => {
        const r = record(await get("/user"));
        const id = remoteId(r.id), login = text(github ? r.login : r.username, 255);
        const email = github ? r.email : r.commit_email || r.email;
        return { id, login, name: text(r.name || login, 255), email: typeof email === "string" && email.length <= 254 && /^[^\s<>@]+@[^\s<>@]+$/.test(email) ? email : null };
      }),
      repositories: page => safe(async () => {
        if (!Number.isInteger(page) || page < 1 || page > 10000) throw new IssueInputError("Invalid repository page.");
        const rows = await get(github ? `/user/repos?per_page=50&page=${page}&sort=full_name&direction=asc` : `/projects?membership=true&per_page=50&page=${page}&order_by=id&sort=asc`);
        if (!Array.isArray(rows) || rows.length > 50) throw new Error();
        return { items: rows.map(repository), nextPage: rows.length === 50 ? page + 1 : null };
      }),
      repository: (fullName, externalId) => safe(async () => {
        const path = validateRepositoryPath(fullName, connection.provider);
        const repo = repository(await get(github ? `/repos/${path}` : `/projects/${remoteId(externalId)}`));
        if (repo.externalId !== externalId) throw new IssueInputError("The repository identity changed. Reload the repository list.");
        return repo;
      }),
      branch: (repo, name) => safe(async () => {
        validateBranch(name);
        const r = record(await get(`${repoPath(repo)}${github ? "/branches/" : "/repository/branches/"}${encodeURIComponent(name)}`));
        if (r.name !== name) throw new IssueInputError("The target branch changed. Reload and select its current name.");
        const commit = record(r.commit);
        text(github ? commit.sha : commit.id, 128);
      }),
    };
  };
}
