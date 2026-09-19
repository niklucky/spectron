import type {
  GitPullRequest,
  GitRemoteRepository,
  ReviewFindingInput,
} from "@spectron/shared";
import { IssueInputError } from "../issues";
export type ReviewDiff = {
  pull: GitPullRequest;
  base: string;
  start: string;
  files: { oldPath: string; newPath: string; patch: string }[];
};
export type ReviewPublication = { id: string; url: string };
export interface GitReviewAdapter {
  branchReview?(
    repo: GitRemoteRepository,
    source: string,
    target: string,
  ): Promise<
    Omit<
      import("@spectron/shared").BranchReview,
      "repositoryId" | "repositoryName"
    >
  >;
  review(repo: GitRemoteRepository, number: string): Promise<ReviewDiff>;
  findFinding(
    repo: GitRemoteRepository,
    pull: GitPullRequest,
    marker: string,
  ): Promise<ReviewPublication | null>;
  publishFinding(
    repo: GitRemoteRepository,
    diff: ReviewDiff,
    finding: ReviewFindingInput,
    body: string,
  ): Promise<ReviewPublication>;
}
// Only added/deleted lines with complete, internally consistent hunks are publishable.
// Missing/truncated/binary diffs fail closed, including provider size limits.
export function reviewLocation(
  diff: Pick<ReviewDiff, "files">,
  finding: ReviewFindingInput,
) {
  for (const file of diff.files) {
    if (
      (finding.side === "RIGHT" ? file.newPath : file.oldPath) !== finding.path
    )
      continue;
    let old = 0,
      next = 0,
      oldRemaining = 0,
      newRemaining = 0,
      active = false;
    let found = false;
    for (const line of file.patch.split("\n")) {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (h) {
        if (active && (oldRemaining || newRemaining)) return null;
        old = Number(h[1]);
        next = Number(h[3]);
        oldRemaining = Number(h[2] ?? 1);
        newRemaining = Number(h[4] ?? 1);
        active = true;
        continue;
      }
      if (!active || line.startsWith("\\")) continue;
      if (!oldRemaining && !newRemaining) {
        if (!line) continue;
        return null;
      }
      if (line.startsWith("+")) {
        if (finding.side === "RIGHT" && next === finding.line) found = true;
        next++;
        newRemaining--;
      } else if (line.startsWith("-")) {
        if (finding.side === "LEFT" && old === finding.line) found = true;
        old++;
        oldRemaining--;
      } else if (line.startsWith(" ")) {
        old++;
        next++;
        oldRemaining--;
        newRemaining--;
      } else return null;
      if (oldRemaining < 0 || newRemaining < 0) return null;
    }
    if (found && !oldRemaining && !newRemaining) return file;
  }
  return null;
}
export function reviewAdapter(options: {
  github: boolean;
  get: (
    path: string,
    options?: { method: "POST"; body: unknown },
  ) => Promise<unknown>;
  repoPath: (repo: GitRemoteRepository) => string;
  pull: (value: unknown, repo: GitRemoteRepository) => GitPullRequest;
}): GitReviewAdapter {
  const { github, get, repoPath, pull } = options;
  const obj = (v: unknown): Record<string, any> => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new Error("Invalid review response");
    return v as Record<string, any>;
  };
  const sha = (v: unknown) => {
    if (typeof v !== "string" || !/^[a-f0-9]{40,64}$/.test(v))
      throw new Error("Review revisions unavailable");
    return v;
  };
  const path = (v: unknown) => {
    if (
      typeof v !== "string" ||
      !v ||
      v.length > 4096 ||
      v.startsWith("/") ||
      v.split("/").includes("..") ||
      /[\x00-\x1f]/.test(v)
    )
      throw new Error("Invalid diff path");
    return v;
  };
  const endpoint = (repo: GitRemoteRepository, number: string) => {
    if (!/^[1-9]\d{0,19}$/.test(number))
      throw new Error("Invalid PR/MR number");
    return `${repoPath(repo)}/${github ? "pulls" : "merge_requests"}/${number}`;
  };
  async function pages(url: string) {
    const all: Record<string, any>[] = [];
    for (let page = 1; page <= 30; page++) {
      const rows = await get(`${url}?per_page=100&page=${page}`);
      if (!Array.isArray(rows) || rows.length > 100)
        throw new Error("Incomplete provider list");
      all.push(...rows.map(obj));
      if (rows.length < 100) return all;
    }
    throw new IssueInputError(
      "This PR/MR exceeds the review listing limit; locations cannot be verified.",
    );
  }
  const publication = (
    r: Record<string, any>,
    p: GitPullRequest,
  ): ReviewPublication => {
    const id = String(r.id);
    if (!/^\d+$/.test(id)) throw new Error("Invalid published comment ID");
    return { id, url: `${p.url}${github ? "#discussion_r" : "#note_"}${id}` };
  };
  return {
    async branchReview(repo, source, target) {
      const root = repoPath(repo);
      const resolve = async (branch: string) => {
        const r = obj(
          await get(
            `${root}/${github ? "branches" : "repository/branches"}/${encodeURIComponent(branch)}`,
          ),
        );
        return sha(github ? obj(r.commit).sha : obj(r.commit).id);
      };
      const head = await resolve(source),
        start = await resolve(target);
      const comparison = obj(
        await get(
          github
            ? `${root}/compare/${start}...${head}?per_page=1&page=1`
            : `${root}/repository/compare?${new URLSearchParams({ from: start, to: head, straight: "false" })}`,
        ),
      );
      const raw = github ? comparison.files : comparison.diffs;
      if (
        !Array.isArray(raw) ||
        raw.length >= (github ? 300 : 1000) ||
        comparison.compare_timeout ||
        comparison.overflow
      )
        throw new IssueInputError(
          "Branch diff exceeds provider limits. Review a smaller change.",
        );
      const base = sha(
        github
          ? obj(comparison.merge_base_commit).sha
          : obj(
              await get(
                `${root}/repository/merge_base?${new URLSearchParams([
                  ["refs[]", start],
                  ["refs[]", head],
                ])}`,
              ),
            ).id,
      );
      const files = raw.map((value) => {
        const f = obj(value);
        return {
          oldPath: path(
            github ? (f.previous_filename ?? f.filename) : f.old_path,
          ),
          newPath: path(github ? f.filename : f.new_path),
          patch:
            typeof (github ? f.patch : f.diff) === "string" &&
            !f.too_large &&
            !f.collapsed
              ? String(github ? f.patch : f.diff)
              : "",
        };
      });
      if (JSON.stringify(files).length > 150000)
        throw new IssueInputError("Branch diff is too large for a review run.");
      if ((await resolve(source)) !== head || (await resolve(target)) !== start)
        throw new IssueInputError(
          "Branches changed while loading the diff. Retry the review.",
        );
      return {
        sourceBranch: source,
        targetBranch: target,
        head,
        base,
        start,
        files,
        url: github
          ? `${repo.webURL}/compare/${start}...${head}`
          : `${repo.webURL}/-/compare/${start}...${head}`,
      };
    },
    async review(repo, number) {
      const url = endpoint(repo, number),
        before = obj(await get(url)),
        p = pull(before, repo);
      const files = await pages(`${url}/${github ? "files" : "diffs"}`);
      const after = obj(await get(url));
      if (
        pull(after, repo).head !== p.head ||
        JSON.stringify(before.diff_refs ?? before.base) !==
          JSON.stringify(after.diff_refs ?? after.base)
      )
        throw new IssueInputError(
          "The PR/MR changed while loading its diff. Retry the review.",
        );
      const base = sha(
        github ? obj(before.base).sha : obj(before.diff_refs).base_sha,
      );
      const start = sha(github ? base : obj(before.diff_refs).start_sha);
      if (!github && sha(obj(before.diff_refs).head_sha) !== p.head)
        throw new Error("Diff revision is not ready");
      const normalized = files.map((f) => ({
        oldPath: path(
          github ? (f.previous_filename ?? f.filename) : f.old_path,
        ),
        newPath: path(github ? f.filename : f.new_path),
        patch:
          typeof (github ? f.patch : f.diff) === "string" &&
          !f.too_large &&
          !f.collapsed
            ? String(github ? f.patch : f.diff)
            : "",
      }));
      if (JSON.stringify(normalized).length > 150_000)
        throw new IssueInputError(
          "The PR/MR diff is too large for a review run. Split the changes into smaller requests.",
        );
      return { pull: p, base, start, files: normalized };
    },
    async findFinding(repo, p, marker) {
      const rows = await pages(
        `${endpoint(repo, p.number)}/${github ? "comments" : "discussions"}`,
      );
      const notes = github
        ? rows
        : rows.flatMap((r) => (Array.isArray(r.notes) ? r.notes.map(obj) : []));
      const found = notes.filter(
        (r) => typeof r.body === "string" && r.body.includes(marker),
      );
      if (found.length > 1)
        throw new Error("Multiple publication markers found");
      return found[0] ? publication(found[0], p) : null;
    },
    async publishFinding(repo, diff, finding, body) {
      const file = reviewLocation(diff, finding);
      if (!file)
        throw new IssueInputError(
          "This finding is outside a verifiable changed line. Run a fresh review.",
        );
      const data = github
        ? {
            body,
            commit_id: diff.pull.head,
            path: file.newPath,
            line: finding.line,
            side: finding.side,
          }
        : {
            body,
            position: {
              position_type: "text",
              base_sha: diff.base,
              start_sha: diff.start,
              head_sha: diff.pull.head,
              old_path: file.oldPath,
              new_path: file.newPath,
              ...(finding.side === "RIGHT"
                ? { new_line: finding.line }
                : { old_line: finding.line }),
            },
          };
      const response = obj(
        await get(
          `${endpoint(repo, diff.pull.number)}/${github ? "comments" : "discussions"}`,
          { method: "POST", body: data },
        ),
      );
      return publication(
        github ? response : obj(response.notes?.[0]),
        diff.pull,
      );
    },
  };
}
