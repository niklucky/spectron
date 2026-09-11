import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId, type GitRepository } from "@spectron/shared";
import { createGitAdapterFactory } from "../../backend/src/git/provider";
import { createWritableGit } from "../../backend/src/agent-runs/writable-git";
import {
  createDockerAgentRuntime,
  processCommand,
} from "../../backend/src/agent-runs/runtime";
import type { Workspace } from "../../backend/src/agent-runs/workspaces";
import type { Run } from "../../backend/src/agent-runs/service";

test("command output preserves UTF-8 across stream chunks", async () => {
  assert.equal(
    await processCommand(process.execPath, [
      "-e",
      "process.stdout.write(Buffer.from([0xf0,0x9f])); setTimeout(() => process.stdout.write(Buffer.from([0x98,0x80])), 50)",
    ]),
    "😀",
  );
});

test("both providers find existing requests and create authenticated drafts with trusted links", async () => {
  for (const provider of ["github", "gitlab"] as const) {
    const github = provider === "github",
      baseURL = github ? "https://github.com" : "https://git.example/prefix";
    const repo = {
      externalId: "12",
      fullName: "owner/repo",
      webURL: `${baseURL}/owner/repo`,
      cloneURL: `${baseURL}/owner/repo.git`,
      archived: false,
      defaultBranch: "main",
    };
    let created = false;
    const response = {
      number: 3,
      iid: 3,
      title: "Draft: A change",
      state: github ? "open" : "opened",
      draft: true,
      source_branch: "spectron/work",
      target_branch: "main",
      sha: "a".repeat(40),
      head: { ref: "spectron/work", sha: "a".repeat(40) },
      base: { ref: "main" },
      html_url: "https://token@evil.test",
      web_url: "https://evil.test",
    };
    const adapter = createGitAdapterFactory(async (url, headers, options) => {
      assert.equal(
        headers[github ? "Authorization" : "PRIVATE-TOKEN"],
        github ? "Bearer secret" : "secret",
      );
      assert.equal(
        url.origin,
        github ? "https://api.github.com" : "https://git.example",
      );
      if (!options) {
        assert.equal(
          url.searchParams.get(github ? "head" : "source_branch"),
          github ? "owner:spectron/work" : "spectron/work",
        );
        assert.equal(
          url.searchParams.get(github ? "base" : "target_branch"),
          "main",
        );
        assert.equal(url.searchParams.get(github ? "state" : "scope"), "all");
        return created ? [response] : [];
      }
      assert.equal(options.method, "POST");
      assert.deepEqual(
        options.body,
        github
          ? {
              head: "spectron/work",
              base: "main",
              title: "A change",
              body: "Attribution",
              draft: true,
              maintainer_can_modify: false,
            }
          : {
              source_branch: "spectron/work",
              target_branch: "main",
              title: "Draft: A change",
              description: "Attribution",
              remove_source_branch: false,
            },
      );
      created = true;
      return response;
    })({ provider, baseURL }, "secret");
    assert.equal(await adapter.findPull!(repo, "spectron/work", "main"), null);
    const pull = await adapter.createDraft!(
      repo,
      {
        source: "spectron/work",
        target: "main",
        title: "A change",
        body: "Attribution",
      },
      AbortSignal.timeout(1000),
    );
    assert.equal(pull.draft, true);
    assert.equal(
      pull.url,
      `${baseURL}/owner/repo/${github ? "pull" : "-/merge_requests"}/3`,
    );
    assert.deepEqual(
      await adapter.findPull!(repo, "spectron/work", "main"),
      pull,
    );
    response.state = "closed";
    assert.equal(
      (await adapter.findPull!(repo, "spectron/work", "main"))!.state,
      "closed",
    );
  }
});

test("protected Git workspaces preserve unfinished edits and push attributed commits without overwriting remote work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "spectron-implementation-")),
    remote = join(root, "remote.git"),
    seed = join(root, "seed");
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Seed",
    GIT_AUTHOR_EMAIL: "seed@example.test",
    GIT_COMMITTER_NAME: "Seed",
    GIT_COMMITTER_EMAIL: "seed@example.test",
  };
  await processCommand(
    "git",
    ["init", "--bare", "--initial-branch=main", remote],
    { env },
  );
  await processCommand("git", ["init", "--initial-branch=main", seed], { env });
  await writeFile(join(seed, "file.txt"), "Original\n");
  await processCommand("git", ["-C", seed, "add", "."], { env });
  await processCommand("git", ["-C", seed, "commit", "-m", "Initial"], { env });
  await processCommand("git", ["-C", seed, "push", remote, "main"], { env });
  const repo = {
    id: createId(),
    provider: "github",
    cloneURL: "https://fixture.example/owner/repo.git",
    targetBranch: "main",
  } as GitRepository;
  const credential = {
    repository: repo,
    token: "fixture-token",
    author: { name: "Integration User", email: "integration@example.test" },
  };
  const w = {
    id: createId(),
    branch: "spectron/fixture",
    targetBranch: "main",
    baseCommit: null,
    remoteCommit: null,
    pending: null,
  } as Workspace;
  let pushedArgs: string[] = [];
  const git = createWritableGit(
    { root },
    {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      command: async (command, args, options = {}) => {
        if (args.includes("push")) pushedArgs = args;
        // Only the network boundary maps to a local bare remote; all Git operations are real.
        return processCommand(
          command,
          [
            "-c",
            "protocol.file.allow=always",
            ...args.map((a) => (a === repo.cloneURL ? remote : a)),
          ],
          options,
        );
      },
    },
  );
  const signal = AbortSignal.timeout(30000);
  const prepared = await git.prepare(w, credential, signal);
  w.baseCommit = prepared.base;
  const p = git.paths(w.id);
  await assert.rejects(readFile(join(p.tree, ".git")));
  assert.ok(
    !(await readFile(join(p.git, "config"), "utf8")).includes("fixture-token"),
  );
  await writeFile(join(p.tree, "file.txt"), "Unfinished edit\n");
  await git.prepare(w, credential, signal);
  assert.equal(
    await readFile(join(p.tree, "file.txt"), "utf8"),
    "Unfinished edit\n",
  );
  // A cumulative target diff larger than the stdout budget must remain usable,
  // including non-ASCII text, without resetting unfinished implementation edits.
  const targetText = "Обновление 😀\n".repeat(100000);
  await writeFile(join(seed, "large.txt"), targetText);
  await processCommand("git", ["-C", seed, "add", "."], { env });
  await processCommand("git", ["-C", seed, "commit", "-m", "Advance target"], {
    env,
  });
  await processCommand("git", ["-C", seed, "push", remote, "main"], { env });
  const advanced = await git.prepare(w, credential, signal);
  assert.notEqual(advanced.target, prepared.base);
  const patch = await readFile(join(p.root, "target.patch"), "utf8");
  assert.ok(Buffer.byteLength(patch) > 2_000_000);
  assert.ok(patch.endsWith("+Обновление 😀\n"));
  assert.equal(patch.includes("�"), false);
  assert.equal(
    await readFile(join(p.tree, "file.txt"), "utf8"),
    "Unfinished edit\n",
  );
  await writeFile(join(p.tree, ".gitignore"), "node_modules/\n");
  await mkdir(join(p.tree, "node_modules", "dependency", ".git"), {
    recursive: true,
  });
  await writeFile(
    join(p.tree, "node_modules", "tracked.txt"),
    "Tracked dependency\n",
  );
  await processCommand(
    "git",
    [
      `--git-dir=${p.git}`,
      `--work-tree=${p.tree}`,
      "add",
      "-f",
      "--",
      "node_modules/tracked.txt",
    ],
    { env, cwd: p.tree },
  );
  await writeFile(
    join(p.tree, "node_modules", "tracked.txt"),
    "Updated tracked dependency\n",
  );
  await mkdir(join(p.tree, "nested", ".git"), { recursive: true });
  await assert.rejects(
    git.commit(w, credential, "Change", signal),
    /Git metadata/,
  );
  await rm(join(p.tree, "nested"), { recursive: true });
  const message =
    "Implement fixture\n\nSpectron-Agent: Dev senior\nSpectron-Requested-By: Nik\nSpectron-Issue: TEST-1\nSpectron-Run: fixture\n";
  const commit = await git.commit(w, credential, message, signal);
  assert.notEqual(commit, prepared.base);
  assert.equal(
    await processCommand(
      "git",
      [`--git-dir=${p.git}`, "show", `${commit}:node_modules/tracked.txt`],
      { env },
    ),
    "Updated tracked dependency\n",
  );
  assert.equal(
    await processCommand(
      "git",
      [
        `--git-dir=${p.git}`,
        "ls-tree",
        "-r",
        "--name-only",
        commit,
        "node_modules/dependency",
      ],
      { env },
    ),
    "",
  );
  const log = await processCommand(
    "git",
    [`--git-dir=${p.git}`, "log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B"],
    { env },
  );
  assert.match(log, /Integration User <integration@example.test>/);
  assert.match(log, /Spectron-Agent: Dev senior/);
  assert.equal(
    await git.commit(w, credential, "Do not duplicate", signal),
    commit,
  );
  await git.push(w, credential, commit, null, signal);
  assert.ok(pushedArgs.includes(`--force-with-lease=refs/heads/${w.branch}:`));
  assert.equal(await git.remote(w, credential, signal), commit);
  await git.push(w, credential, commit, null, signal); // Lost-response retry is a no-op.
  w.remoteCommit = commit;
  await writeFile(join(p.tree, "file.txt"), "Further edit\n");
  const newer = await git.commit(w, credential, "Further change", signal);
  // Someone else moved the branch in the interval; neither prepare nor push overwrites it.
  await processCommand(
    "git",
    [
      `--git-dir=${remote}`,
      "update-ref",
      `refs/heads/${w.branch}`,
      prepared.base,
    ],
    { env },
  );
  await assert.rejects(
    git.prepare(w, credential, signal),
    /remote working branch changed/,
  );
  await assert.rejects(
    git.push(w, credential, newer, commit, signal),
    /overwrite/,
  );
  assert.equal(
    await readFile(join(p.tree, "file.txt"), "utf8"),
    "Further edit\n",
  );
  // The saved expected remote can also be a known, divergent commit. This is
  // a reconciliation problem, not an authentication failure.
  await processCommand(
    "git",
    [
      `--git-dir=${remote}`,
      "update-ref",
      `refs/heads/${w.branch}`,
      advanced.target,
    ],
    { env },
  );
  pushedArgs = [];
  await assert.rejects(
    git.push(w, credential, newer, advanced.target, signal),
    /diverged.*reconcile/,
  );
  assert.deepEqual(pushedArgs, []);
  assert.equal(await git.remote(w, credential, signal), advanced.target);
});

test(
  "writable Docker source survives container removal while Git metadata and credentials stay outside",
  { skip: process.env.TEST_AGENT_DOCKER !== "true", timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "spectron-write-container-")),
      id = createId(),
      workspaceId = createId(),
      repoId = createId();
    const runtime = createDockerAgentRuntime({ root });
    const p = runtime.writableGit!.paths(workspaceId);
    await mkdir(p.tree, { recursive: true });
    await mkdir(p.git);
    await writeFile(join(p.git, "protected"), "protected");
    await writeFile(join(p.root, "target.patch"), "Target unchanged");
    await writeFile(join(p.tree, "file.txt"), "Before");
    const repo = {
      id: repoId,
      fullName: "fixture/repo",
      targetBranch: "main",
      projectId: createId(),
      connectionId: createId(),
      provider: "github",
      externalId: "1",
      webURL: "https://github.com/fixture/repo",
      cloneURL: "https://github.com/fixture/repo.git",
      defaultBranch: "main",
      archived: false,
      isDefault: true,
      revision: 1,
    } satisfies GitRepository;
    const run = {
      id,
      command: "implement",
      repositories: [repo],
      instructions: "Implement fixture",
      agent: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        effort: "none",
      },
      context: {},
    } as Run;
    const config = {
      key: "not-a-real-key",
      repositories: [{ repository: repo, token: "not-a-real-git-token" }],
      writable: [{ repositoryId: repoId, workspaceId }],
      attachments: [],
    };
    t.after(async () => {
      await runtime.cleanup(id);
      await rm(root, { recursive: true, force: true });
    });
    const prepare = () =>
      runtime.prepare(run, config, AbortSignal.timeout(30000), async () => {});
    await prepare();
    await processCommand("docker", [
      "exec",
      `spectron-run-${id}`,
      "node",
      "-e",
      `const fs=require('fs'); fs.writeFileSync('/repos/${repoId}/file.txt','Unfinished'); if(fs.existsSync(${JSON.stringify(p.git)})) process.exit(1);`,
    ]);
    const cfg = await readFile(join(root, id, "config.json"), "utf8");
    assert.equal(JSON.parse(cfg).permission.edit, "allow");
    assert.ok(!cfg.includes(config.key));
    assert.ok(!cfg.includes(config.repositories[0]!.token));
    // Exercise a real OpenCode edit against a local deterministic provider, without paid model calls.
    const modelConfig = JSON.parse(cfg);
    modelConfig.provider.spectron.options.baseURL = "http://127.0.0.1:4781/v1";
    await writeFile(join(root, id, "config.json"), JSON.stringify(modelConfig));
    await writeFile(
      join(root, id, "work", "provider.cjs"),
      `
    const http=require('http');
    http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      const input=JSON.parse(body), done=input.messages.some(m=>m.role==='tool');
      res.writeHead(200,{'content-type':'text/event-stream'});
      const delta=done ? {role:'assistant',content:JSON.stringify({summary:'Implemented',details:'Created generated.txt using the write tool.'})}
        : {role:'assistant',tool_calls:[{index:0,id:'write_fixture',type:'function',function:{name:'write',arguments:JSON.stringify({filePath:'/repos/${repoId}/generated.txt',content:'Written by OpenCode'})}}]};
      for(const [d,finish] of [[delta,null],[{},done?'stop':'tool_calls']]) res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'deepseek-v4-flash',choices:[{index:0,delta:d,finish_reason:finish}]})+'\\n\\n');
      res.end('data: [DONE]\\n\\n');
    });}).listen(4781,'127.0.0.1');
  `,
    );
    await processCommand("docker", [
      "exec",
      "-d",
      `spectron-run-${id}`,
      "node",
      "/work/provider.cjs",
    ]);
    const activity: string[] = [];
    const response = await runtime.turn(
      run,
      "Create generated.txt in the repository.",
      AbortSignal.timeout(40000),
      async (s) => {
        activity.push(s);
      },
      async () => {},
      async () => {},
    );
    assert.equal(response.summary, "Implemented");
    assert.ok(activity.includes("Using write."));
    assert.equal(
      await readFile(join(p.tree, "generated.txt"), "utf8"),
      "Written by OpenCode",
    );
    await runtime.cleanup(id);
    assert.equal(
      await readFile(join(p.tree, "file.txt"), "utf8"),
      "Unfinished",
    );
    await prepare();
    assert.equal(
      (
        await processCommand("docker", [
          "exec",
          `spectron-run-${id}`,
          "cat",
          `/repos/${repoId}/file.txt`,
        ])
      ).trim(),
      "Unfinished",
    );
    assert.equal(await readFile(join(p.git, "protected"), "utf8"), "protected");
  },
);
