import {
  mkdir,
  rename,
  rm,
  readFile,
  writeFile,
  stat,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GitRepository } from "@spectron/shared";
import { resolveHost } from "../network/dns";
import { isPublicAddress } from "../project-logo/safe-fetch";
import { processCommand } from "./runtime";
import type { Workspace } from "./workspaces";
export type WriteCredential = {
  repository: GitRepository;
  token: string;
  author: { name: string; email: string };
};
export function createWritableGit(
  options: {
    root: string;
    dns?: "system" | "cloudflare";
    privateOrigins?: string[];
  },
  dependencies: {
    command?: typeof processCommand;
    resolve?: typeof resolveHost;
  } = {},
) {
  const command = dependencies.command ?? processCommand;
  const resolveDNS = dependencies.resolve ?? resolveHost;
  const origins = new Set(
    (options.privateOrigins ?? []).map((v) => new URL(v).origin),
  );
  function paths(id: string) {
    if (!/^[A-Za-z0-9_-]{21}$/.test(id))
      throw new Error("Invalid workspace ID.");
    const root = join(resolve(options.root), "workspaces", id);
    return { root, git: join(root, "git"), tree: join(root, "source") };
  }
  async function environment(
    c: WriteCredential,
    signal: AbortSignal,
    network = false,
  ) {
    const values: Record<string, string> = {
      "core.hooksPath": "/dev/null",
      "core.fsmonitor": "false",
      "core.attributesFile": "/dev/null",
      "commit.gpgsign": "false",
      "protocol.allow": "never",
      "protocol.https.allow": "always",
      "http.followRedirects": "false",
      "credential.helper": "",
    };
    if (network) {
      const url = new URL(c.repository.cloneURL);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Invalid repository URL.");
      const addresses = await resolveDNS(
        url.hostname,
        signal,
        origins.has(url.origin) ? "system" : (options.dns ?? "system"),
      );
      if (
        !addresses.length ||
        (!origins.has(url.origin) &&
          addresses.some((a) => !isPublicAddress(a.address)))
      )
        throw new Error(
          "Repository host does not meet the configured Git network policy.",
        );
      const a = addresses.find((a) => a.family === 4) ?? addresses[0]!;
      values["http.curloptResolve"] =
        `${url.hostname}:${url.port || "443"}:${a.family === 6 ? `[${a.address}]` : a.address}`;
      values["http.extraHeader"] =
        `Authorization: Basic ${Buffer.from(`${c.repository.provider === "github" ? "x-access-token" : "oauth2"}:${c.token}`).toString("base64")}`;
    }
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: "/nonexistent",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: String(Object.keys(values).length),
      GIT_AUTHOR_NAME: c.author.name,
      GIT_AUTHOR_EMAIL: c.author.email,
      GIT_COMMITTER_NAME: c.author.name,
      GIT_COMMITTER_EMAIL: c.author.email,
    };
    Object.entries(values).forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = k;
      env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    return env;
  }
  async function git(
    w: Workspace,
    c: WriteCredential,
    args: string[],
    signal: AbortSignal,
    network = false,
    stdin?: string,
  ) {
    const p = paths(w.id);
    return command(
      "git",
      [
        "--literal-pathspecs",
        `--git-dir=${p.git}`,
        `--work-tree=${p.tree}`,
        ...args,
      ],
      {
        cwd: p.tree,
        env: await environment(c, signal, network),
        signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
        ...(stdin === undefined ? {} : { stdin }),
        failureMessage:
          "Git operation failed. Check repository write permissions and branch rules; saved changes are retained.",
      },
    );
  }
  const revision = (s: string) => {
    const v = s.trim();
    if (!/^[a-f0-9]{40,64}$/.test(v)) throw new Error("Invalid Git revision.");
    return v;
  };
  async function remote(w: Workspace, c: WriteCredential, signal: AbortSignal) {
    const output = await git(
      w,
      c,
      ["ls-remote", "--refs", c.repository.cloneURL, `refs/heads/${w.branch}`],
      signal,
      true,
    );
    return output.trim() ? revision(output.split(/\s/)[0]!) : null;
  }
  return {
    paths,
    async prepare(w: Workspace, c: WriteCredential, signal: AbortSignal) {
      const p = paths(w.id);
      const exists = await stat(join(p.root, "ready")).then(
        () => true,
        () => false,
      );
      if (!exists) {
        // Only an unpublished, never-initialized workspace can be rebuilt. A missing established workspace is data loss.
        if (w.baseCommit || w.pending || w.remoteCommit)
          throw new Error(
            "Saved workspace files are missing. Restore them from backup before continuing.",
          );
        const temp = p.root + ".preparing";
        await mkdir(join(resolve(options.root), "workspaces"), {
          recursive: true,
          mode: 0o700,
        });
        await rm(temp, { recursive: true, force: true });
        await mkdir(temp, { mode: 0o700 });
        await command(
          "git",
          [
            "clone",
            "--bare",
            "--template=",
            "--single-branch",
            "--branch",
            w.targetBranch,
            "--",
            c.repository.cloneURL,
            join(temp, "git"),
          ],
          {
            env: await environment(c, signal, true),
            signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
            failureMessage:
              "Could not clone the implementation repository. Check repository access.",
          },
        );
        await mkdir(join(temp, "source"));
        await rm(p.root, { recursive: true, force: true });
        await rename(temp, p.root);
        await git(w, c, ["config", "core.bare", "false"], signal);
        await git(
          w,
          c,
          ["symbolic-ref", "HEAD", `refs/heads/${w.branch}`],
          signal,
        );
        const base = revision(
          await git(
            w,
            c,
            ["rev-parse", `refs/heads/${w.targetBranch}`],
            signal,
          ),
        );
        await git(w, c, ["update-ref", `refs/heads/${w.branch}`, base], signal);
        await git(w, c, ["read-tree", "HEAD"], signal);
        await git(w, c, ["checkout-index", "--all", "--force"], signal);
        await writeFile(join(p.root, "ready"), base, { mode: 0o600 });
      }
      const base = revision(await readFile(join(p.root, "ready"), "utf8"));
      const head = revision(await git(w, c, ["rev-parse", "HEAD"], signal));
      const actual = await remote(w, c, signal);
      if (actual !== w.remoteCommit)
        throw new Error(
          "The remote working branch changed. Saved edits were retained; reconcile the branch before continuing.",
        );
      // Fetch the target without changing the active source tree or its unfinished edits.
      await git(
        w,
        c,
        [
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          c.repository.cloneURL,
          `refs/heads/${w.targetBranch}`,
        ],
        signal,
        true,
      );
      const target = revision(
        await git(w, c, ["rev-parse", "FETCH_HEAD"], signal),
      );
      await writeFile(
        join(p.root, "target.patch"),
        target === base
          ? "Target branch unchanged.\n"
          : await git(
              w,
              c,
              [
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                `${base}..${target}`,
                "--",
              ],
              signal,
            ),
        { mode: 0o600 },
      );
      return { base, head, target };
    },
    async commit(
      w: Workspace,
      c: WriteCredential,
      message: string,
      signal: AbortSignal,
    ) {
      const before = revision(await git(w, c, ["rev-parse", "HEAD"], signal));
      const directories = [paths(w.id).tree];
      let entries = 0;
      while (directories.length) {
        const directory = directories.pop()!;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (++entries > 500000)
            throw new Error(
              "Workspace exceeds the file limit; remove generated files before publishing.",
            );
          if (entry.name.toLowerCase() === ".git")
            throw new Error(
              "Repository contains agent-created Git metadata. Remove nested .git entries before publishing.",
            );
          if (entry.isDirectory())
            directories.push(join(directory, entry.name));
        }
      }
      // Source is untrusted; protected Git metadata lives outside every container mount.
      await git(w, c, ["add", "--all", "--", "."], signal);
      const tree = revision(await git(w, c, ["write-tree"], signal));
      const previousTree = revision(
        await git(w, c, ["rev-parse", "HEAD^{tree}"], signal),
      );
      if (tree === previousTree) return before;
      const commit = revision(
        await git(
          w,
          c,
          ["commit-tree", tree, "-p", before],
          signal,
          false,
          message,
        ),
      );
      await git(
        w,
        c,
        ["update-ref", `refs/heads/${w.branch}`, commit, before],
        signal,
      );
      return commit;
    },
    remote,
    async push(
      w: Workspace,
      c: WriteCredential,
      commit: string,
      expected: string | null,
      signal: AbortSignal,
    ) {
      revision(commit);
      const actual = await remote(w, c, signal);
      if (actual === commit) return;
      if (actual !== expected)
        throw new Error(
          "The remote working branch changed. Refusing to overwrite newer remote work.",
        );
      if (actual)
        await git(
          w,
          c,
          ["merge-base", "--is-ancestor", actual, commit],
          signal,
        );
      signal.throwIfAborted();
      // Explicit lease closes the race after ls-remote; ancestry above disallows destructive rewrites.
      await git(
        w,
        c,
        [
          "push",
          "--porcelain",
          `--force-with-lease=refs/heads/${w.branch}:${expected ?? ""}`,
          c.repository.cloneURL,
          `${commit}:refs/heads/${w.branch}`,
        ],
        signal,
        true,
      );
    },
  };
}
export type WritableGit = ReturnType<typeof createWritableGit>;
