import { createWritableGit, type WritableGit } from "./writable-git";
import {
  modelLimits,
  validateLimits,
  promptByteBudget,
  type ModelLimits,
} from "./model-limits";
import { startModelBridge } from "./model-bridge";
import {
  createCredentialProxy,
  providerBaseURLs,
  providerRequestError,
} from "./credential-proxy";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  cp,
  chmod,
  stat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import type {
  AgentIdentity,
  AgentResult,
  GitRepository,
} from "@spectron/shared";
import { resolveHost } from "../network/dns";
import { isPublicAddress } from "../project-logo/safe-fetch";
import type { Run } from "./service";
export type RepositoryCredential = {
  repository: GitRepository;
  token: string;
  author?: { name: string; email: string };
  connection?: {
    provider: GitRepository["provider"];
    baseURL: string;
    revision: number;
  };
};
export type RuntimePreparation = {
  key: string;
  repositories: RepositoryCredential[];
  preparationErrors?: Record<string, string>;
  writable?: { repositoryId: string; workspaceId: string }[];
  attachments: {
    id: string;
    filename: string;
    path: string;
    contentType: string;
  }[];
};
export interface AgentRuntime {
  writableGit?: WritableGit;
  prepare(
    run: Run,
    config: RuntimePreparation,
    signal: AbortSignal,
    activity: (message: string) => Promise<void>,
  ): Promise<Run["repositories"]>;
  turn(
    run: Run,
    prompt: string,
    signal: AbortSignal,
    activity: (message: string) => Promise<void>,
    partial: (text: string) => Promise<void>,
    accepted: () => Promise<void>,
  ): Promise<AgentResult>;
  cleanup(id: string): Promise<void>;
}
export function redact(text: string, secrets: string[]) {
  for (const value of secrets.filter(Boolean))
    for (const form of [
      value,
      encodeURIComponent(value),
      Buffer.from(value).toString("base64"),
    ])
      text = text.split(form).join("[redacted]");
  return text.replace(
    /(?:sk-[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9._-]{12,})/g,
    "[redacted]",
  );
}
// No shell interpolation and no command output in thrown errors (Git/SDK errors can contain credentials).
export function processCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    stdin?: string;
    lines?: (line: string) => void;
    maxBytes?: number;
    failureMessage?: string;
    acceptedExitCodes?: number[];
  } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    let startError = false;
    let output = "",
      bytes = 0,
      overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 2_000_000)) {
        overflow = true;
        child.kill("SIGKILL");
      } else output += decoder.write(chunk);
    });
    child.stderr.on("data", () => {});
    if (options.lines)
      createInterface({ input: child.stdout }).on("line", options.lines);
    // Wait for close even on cancellation so callers cannot release a workspace
    // while its Git process is still exiting.
    child.on("error", () => {
      startError = true;
    });
    child.on("close", (code) =>
      !startError &&
      !options.signal?.aborted &&
      !overflow &&
      code !== null &&
      (options.acceptedExitCodes ?? [0]).includes(code)
        ? resolvePromise(output + decoder.end())
        : reject(
            new Error(
              options.failureMessage ??
                `${command} failed. Check runtime availability and repository access.`,
            ),
          ),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin);
  });
}
export function openCodeConfig(
  agent: AgentIdentity,
  key: string,
  limits: ModelLimits = modelLimits(agent),
) {
  const provider = agent.provider;
  const baseURL = providerBaseURLs[provider];
  const npm =
    provider === "anthropic"
      ? "@ai-sdk/anthropic"
      : provider === "openai"
        ? "@ai-sdk/openai"
        : "@ai-sdk/openai-compatible";
  const options =
    agent.effort === null
      ? {}
      : provider === "anthropic"
        ? { effort: agent.effort, thinking: { type: "adaptive" } }
        : provider === "deepseek"
          ? {
              reasoningEffort:
                agent.effort === "none" ? undefined : agent.effort,
              thinking: {
                type: agent.effort === "none" ? "disabled" : "enabled",
              },
            }
          : provider === "zai"
            ? { reasoningEffort: agent.effort, thinking: { type: "enabled" } }
            : { reasoningEffort: agent.effort };
  return {
    $schema: "https://opencode.ai/config.json",
    model: `spectron/${agent.model}`,
    small_model: `spectron/${agent.model}`,
    enabled_providers: ["spectron"],
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    lsp: false,
    formatter: false,
    permission: {
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
      bash: "allow",
      external_directory: "allow",
      doom_loop: "deny",
    },
    provider: {
      spectron: {
        npm,
        name: provider,
        options: { apiKey: key, baseURL },
        models: {
          [agent.model]: {
            name: agent.model,
            modalities: {
              input: [
                "text",
                ...(["openai", "anthropic"].includes(provider)
                  ? ["image"]
                  : []),
              ],
              output: ["text"],
            },
            options,
            limit: limits,
          },
        },
      },
    },
    agent: {
      spectron: {
        mode: "primary",
        description: "Spectron repository assistant",
        prompt:
          "Follow the supplied Spectron system instructions. Source repositories are read-only. Do not use or disclose configuration credentials. Return the requested result JSON.",
      },
    },
    default_agent: "spectron",
  };
}
// CLI text events are snapshots of a part, not token deltas. Preserve order
// between parts while replacing updates of the same part.
export function createTextParts() {
  const parts = new Map<string, string>();
  return {
    update(id: string, text: string) {
      parts.set(id, text);
      return [...parts.values()].join("\n\n");
    },
  };
}
export function parseResult(text: string): AgentResult {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  try {
    const value = JSON.parse(clean) as Record<string, unknown>;
    if (
      typeof value.summary !== "string" ||
      typeof value.details !== "string" ||
      value.summary.length > 4000 ||
      value.details.length > 500_000
    )
      throw new Error();
    const result: AgentResult = {
      summary: value.summary,
      details: value.details,
    };
    if (
      typeof value.question === "string" &&
      value.question.trim() &&
      value.question.length <= 10000
    )
      result.question = value.question;
    if (Array.isArray(value.verification))
      result.verification = value.verification
        .slice(0, 100)
        .flatMap((v: unknown) => {
          if (!v || typeof v !== "object") return [];
          const check = v as Record<string, unknown>;
          return typeof check.command === "string" &&
            check.command.length <= 2000 &&
            typeof check.details === "string" &&
            check.details.length <= 10000 &&
            ["passed", "failed", "not_run"].includes(String(check.outcome))
            ? [
                {
                  command: check.command,
                  details: check.details,
                  outcome: check.outcome as "passed" | "failed" | "not_run",
                },
              ]
            : [];
        });
    if (value.rewrite && typeof value.rewrite === "object") {
      const rw = value.rewrite as Record<string, unknown>;
      // Only explicitly supported issue fields; never spread untrusted model objects into a mutation.
      if (
        typeof rw.title === "string" &&
        rw.title.trim() &&
        rw.title.length <= 255 &&
        typeof rw.description === "string" &&
        rw.description.length <= 1_000_000
      )
        result.rewrite = {
          title: rw.title.trim(),
          description: rw.description,
        };
      if (result.rewrite) {
        for (const key of [
          "priorityId",
          "assigneeId",
          "issueTypeId",
          "parentId",
        ] as const)
          if (
            rw[key] === null ||
            (typeof rw[key] === "string" && /^[A-Za-z0-9_-]{21}$/.test(rw[key]))
          )
            result.rewrite[key] = rw[key] as string | null;
        if (
          typeof rw.stateId === "string" &&
          /^[A-Za-z0-9_-]{21}$/.test(rw.stateId)
        )
          result.rewrite.stateId = rw.stateId;
        if (
          Array.isArray(rw.tagIds) &&
          rw.tagIds.length <= 100 &&
          rw.tagIds.every(
            (id) => typeof id === "string" && /^[A-Za-z0-9_-]{21}$/.test(id),
          )
        )
          result.rewrite.tagIds = rw.tagIds;
        if (
          rw.estimateTime === null ||
          (Number.isSafeInteger(rw.estimateTime) &&
            Number(rw.estimateTime) >= 0)
        )
          result.rewrite.estimateTime = rw.estimateTime as number | null;
        if (
          rw.fieldValues &&
          typeof rw.fieldValues === "object" &&
          !Array.isArray(rw.fieldValues)
        ) {
          const fields = Object.entries(rw.fieldValues);
          if (
            fields.length <= 100 &&
            fields.every(
              ([key, v]) =>
                /^[A-Za-z0-9_-]{21}$/.test(key) &&
                (v === null ||
                  typeof v === "number" ||
                  (typeof v === "string" && v.length <= 10000)),
            )
          )
            result.rewrite.fieldValues = Object.fromEntries(fields) as Record<
              string,
              string | number | null
            >;
        }
      }
    }
    return result;
  } catch {
    return { summary: "Agent response", details: text.slice(0, 500_000) };
  }
}
export function createDockerAgentRuntime(options: {
  root: string;
  image?: string;
  dns?: "system" | "cloudflare";
  privateOrigins?: string[];
}): AgentRuntime {
  const writableGit = createWritableGit(options);
  const root = resolve(options.root),
    image = options.image ?? "spectron-agent:1.18.30";
  const bridges = new Map<
    string,
    Awaited<ReturnType<typeof startModelBridge>>
  >();
  const secrets = new Map<string, string[]>();
  const proxies = new Map<
    string,
    Awaited<ReturnType<typeof createCredentialProxy>>
  >();
  const directory = (id: string) => {
    if (!/^[A-Za-z0-9_-]{21}$/.test(id)) throw new Error("Invalid run ID.");
    return join(root, id);
  };
  const name = (id: string) => `spectron-run-${id}`;
  const privateOrigins = new Set(
    (options.privateOrigins ?? []).map((url) => new URL(url).origin),
  );
  return {
    writableGit,
    async prepare(run, config, signal, activity) {
      const dir = directory(run.id);
      secrets.set(run.id, [
        config.key,
        ...config.repositories.map((r) => r.token),
      ]);
      await mkdir(join(dir, "repos"), { recursive: true, mode: 0o700 });
      await mkdir(join(dir, "attachments"), { recursive: true });
      await mkdir(join(dir, "work"), { recursive: true });
      await chmod(join(dir, "work"), 0o777);
      await mkdir(join(dir, "work", "notes"), { recursive: true });
      const continuationId = run.context?.continuationId;
      if (typeof continuationId === "string" && continuationId !== run.id) {
        const previous = join(directory(continuationId), "work", "notes");
        await cp(previous, join(dir, "work", "notes"), {
          recursive: true,
          dereference: false,
          force: false,
          errorOnExist: false,
        }).catch((error) => {
          if (error.code !== "ENOENT")
            throw new Error("Could not restore previous workspace notes.");
        });
      }
      const repositories: Run["repositories"] =
        run.command === "implement" ? [...run.repositories] : [];
      for (const { repository: repo, token } of config.repositories) {
        signal.throwIfAborted();
        await activity(`Preparing ${repo.fullName} at ${repo.targetBranch}.`);
        if (run.command === "implement") {
          const workspace = config.writable?.find(
            (w) => w.repositoryId === repo.id,
          );
          if (!workspace) throw new Error("Writable workspace unavailable.");
          continue;
        }
        const path = join(dir, "repos", repo.id);
        const existing = await readFile(
          join(dir, `${repo.id}.revision`),
          "utf8",
        ).catch(() => null);
        if (!existing) {
          const url = new URL(repo.cloneURL),
            hostname = url.hostname;
          const addresses = await resolveHost(
            hostname,
            signal,
            privateOrigins.has(url.origin)
              ? "system"
              : (options.dns ?? "system"),
          );
          if (
            !addresses.length ||
            (!privateOrigins.has(url.origin) &&
              addresses.some((a) => !isPublicAddress(a.address)))
          )
            throw new Error(
              "Repository host does not meet the configured Git network policy.",
            );
          const address =
            addresses.find((a) => a.family === 4) ?? addresses[0]!;
          const auth = Buffer.from(
            `${repo.provider === "github" ? "x-access-token" : "oauth2"}:${token}`,
          ).toString("base64");
          // A clean Git environment disables user helpers/hooks and URL rewriting. Credentials are environment-only.
          const env: NodeJS.ProcessEnv = {
            PATH: process.env.PATH,
            HOME: dir,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            GIT_CONFIG_COUNT: "4",
            GIT_CONFIG_KEY_0: "http.extraHeader",
            GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
            GIT_CONFIG_KEY_1: "http.followRedirects",
            GIT_CONFIG_VALUE_1: "false",
            GIT_CONFIG_KEY_2: "http.curloptResolve",
            GIT_CONFIG_VALUE_2: `${hostname}:${url.port || "443"}:${address.family === 6 ? `[${address.address}]` : address.address}`,
            GIT_CONFIG_KEY_3: "core.hooksPath",
            GIT_CONFIG_VALUE_3: "/dev/null",
          };
          await rm(path, { recursive: true, force: true });
          await processCommand(
            "git",
            [
              "-c",
              "protocol.allow=never",
              "-c",
              "protocol.https.allow=always",
              "clone",
              "--no-recurse-submodules",
              "--depth=1",
              "--single-branch",
              "--branch",
              repo.targetBranch,
              "--",
              repo.cloneURL,
              path,
            ],
            {
              env,
              signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
            },
          );
          const revision = (
            await processCommand("git", ["-C", path, "rev-parse", "HEAD"], {
              env,
              signal,
            })
          ).trim();
          if (!/^[a-f0-9]{40,64}$/.test(revision))
            throw new Error("Invalid repository revision.");
          await writeFile(join(dir, `${repo.id}.revision`), revision);
          repositories.push({ ...repo, commit: revision });
        } else repositories.push({ ...repo, commit: existing.trim() });
      }
      const attachments = [];
      for (const file of config.attachments) {
        const extension =
          (
            {
              "image/png": ".png",
              "image/jpeg": ".jpg",
              "image/webp": ".webp",
              "image/gif": ".gif",
            } as Record<string, string>
          )[file.contentType] ?? "";
        const native =
          !!extension &&
          ["openai", "anthropic"].includes(run.agent.provider) &&
          (await stat(file.path)).size <= 10 * 1024 * 1024;
        await cp(file.path, join(dir, "attachments", file.id + extension));
        attachments.push({
          id: file.id,
          filename: file.filename,
          contentType: file.contentType,
          path: `/attachments/${file.id}${extension}`,
          native,
          inspection: native
            ? "Passed as an image input to the model."
            : "Available as a file only. Report whether inspected; native model input is unsupported for this file/provider.",
        });
      }
      await writeFile(
        join(dir, "attachments", "manifest.json"),
        JSON.stringify(attachments),
      );
      bridges.get(run.id)?.close();
      bridges.delete(run.id);
      await proxies.get(run.id)?.close();
      const proxy = await createCredentialProxy(
        run.agent.provider,
        run.agent.model,
        config.key,
        options.dns,
      );
      proxies.set(run.id, proxy);
      const modelConfig = openCodeConfig(
        run.agent,
        proxy.token,
        run.context?.modelLimits
          ? validateLimits(run.context.modelLimits)
          : modelLimits(run.agent),
      );
      if (run.command === "implement")
        Object.assign(modelConfig.permission, {
          edit: "allow",
          write: "allow",
          apply_patch: "allow",
        });
      modelConfig.provider.spectron.options.baseURL =
        "http://127.0.0.1:4780/v1";
      await writeFile(
        join(dir, "config.json"),
        JSON.stringify({
          ...modelConfig,
          agent: {
            spectron: {
              ...modelConfig.agent.spectron,
              prompt:
                run.instructions +
                (run.command === "implement"
                  ? "\nWritable repository assistant. Implement and verify requested code changes. Spectron handles commits and draft PR/MR publication; do not alter Git metadata or attempt remote writes. Return requested JSON; never disclose credentials."
                  : "\nRead-only repository assistant. Return the requested JSON result; never disclose credentials."),
            },
          },
        }),
        { mode: 0o600 },
      );
      // Clear any old container before restoration; preserve the durable work directory.
      await processCommand("docker", ["rm", "-f", name(run.id)]).catch(
        () => {},
      );
      signal.throwIfAborted();
      await processCommand(
        "docker",
        [
          "run",
          "-d",
          "--name",
          name(run.id),
          "--label",
          "spectron.agent-run=true",
          "--network",
          "none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=128",
          "--memory=2g",
          "--cpus=2",
          "--user",
          run.command === "implement"
            ? `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`
            : "0:0",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=256m",
          ...(run.command === "implement"
            ? (config.writable ?? []).flatMap((w) => [
                "--mount",
                `type=bind,src=${writableGit.paths(w.workspaceId).tree},dst=/repos/${w.repositoryId}`,
                "--mount",
                `type=bind,src=${join(writableGit.paths(w.workspaceId).root, "target.patch")},dst=/targets/${w.repositoryId}.patch,readonly`,
              ])
            : [
                "--mount",
                `type=bind,src=${join(dir, "repos")},dst=/repos,readonly`,
              ]),
          "--mount",
          `type=bind,src=${join(dir, "attachments")},dst=/attachments,readonly`,
          "--mount",
          `type=bind,src=${join(dir, "work")},dst=/work`,
          "--mount",
          `type=bind,src=${join(dir, "config.json")},dst=/etc/opencode/opencode.json,readonly`,
          image,
        ],
        { signal },
      );
      bridges.set(run.id, await startModelBridge(name(run.id), proxy.port));
      return repositories;
    },
    async turn(run, prompt, signal, activity, partial, accepted) {
      const limits = run.context?.modelLimits
        ? validateLimits(run.context.modelLimits)
        : modelLimits(run.agent);
      if (
        Buffer.byteLength(prompt + run.instructions, "utf8") >
        promptByteBudget(limits)
      )
        throw new Error(
          "The prompt exceeds this model's input budget. Shorten the instructions or start a continuation with less context.",
        );
      const dir = directory(run.id);
      let session = await readFile(join(dir, "session"), "utf8").catch(
        () => "",
      );
      let text = "",
        lastText = "",
        error: string | undefined,
        started = false,
        persistenceFailed = false,
        chain = Promise.resolve();
      const secret = secrets.get(run.id) ?? [];
      const parts = createTextParts();
      const attachments = JSON.parse(
        await readFile(join(dir, "attachments", "manifest.json"), "utf8"),
      ) as { path: string; native: boolean; filename: string }[];
      const args = [
        "exec",
        "-i",
        name(run.id),
        "opencode",
        "run",
        "--pure",
        "--format",
        "json",
        "--agent",
        "spectron",
        ...(session ? ["--session", session.trim()] : []),
        ...attachments
          .filter((a) => a.native)
          .flatMap((a) => ["--file", a.path]),
      ];
      const proxy = proxies.get(run.id);
      proxy?.activate();
      try {
        await processCommand("docker", args, {
          signal,
          stdin: prompt,
          maxBytes: 8_000_000,
          failureMessage:
            "OpenCode execution failed. Check the agent runtime logs and container resources.",
          lines: (line) => {
            try {
              const e = JSON.parse(line);
              if (
                typeof e.sessionID === "string" &&
                /^ses_[A-Za-z0-9]+$/.test(e.sessionID)
              ) {
                session = e.sessionID;
                chain = chain.then(() =>
                  writeFile(join(dir, "session"), session),
                );
              }
              if (e.type === "step_start" && !started) {
                started = true;
                chain = chain.then(accepted);
              }
              if (e.type === "error") {
                const status = e.error?.data?.statusCode;
                error =
                  typeof status === "number" && status >= 400 && status <= 599
                    ? providerRequestError(status)
                    : "OpenCode reported an execution error. Check the agent runtime logs.";
              }
              if (e.type === "text" && typeof e.part?.text === "string") {
                lastText = redact(e.part.text, secret);
                text = parts.update(
                  typeof e.part.id === "string" ? e.part.id : "anonymous",
                  lastText,
                );
                chain = chain.then(() => partial(text.slice(0, 500_000)));
              }
              if (e.type === "tool_use" && typeof e.part?.tool === "string") {
                const tool = /^[a-z_]{1,40}$/.test(e.part.tool)
                  ? e.part.tool
                  : "tool";
                chain = chain.then(() => activity(`Using ${tool}.`));
              }
              chain = chain.catch(() => {
                persistenceFailed = true;
              });
            } catch {
              /* CLI diagnostics are never forwarded. */
            }
          },
        });
      } catch (failure) {
        if (!signal.aborted && (proxy?.lastError || error))
          throw new Error(proxy?.lastError || error);
        throw failure;
      } finally {
        proxy?.deactivate();
        await chain;
      }
      if (persistenceFailed)
        throw new Error(
          "Could not persist execution history. The workspace was retained for recovery.",
        );
      if (error) throw new Error(proxy?.lastError || error);
      if (!text.trim())
        throw new Error(
          "OpenCode returned no usable result. Check the configured model, effort, API key permissions, and quota.",
        );
      const result = parseResult(lastText || text);
      const unsupported = attachments.filter((a) => !a.native);
      if (unsupported.length)
        result.details +=
          "\n\nAttachment input: " +
          unsupported.length +
          " file(s) were provided on disk, without native multimodal input. See the response for what was actually inspected.";
      return result;
    },
    async cleanup(id) {
      bridges.get(id)?.close();
      bridges.delete(id);
      await proxies.get(id)?.close();
      proxies.delete(id);
      // docker rm -f stops the whole container, including shell/tool descendants.
      try {
        await processCommand("docker", ["rm", "-f", name(id)], {
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        // Distinguish a missing container from an unavailable daemon; never claim stopped on daemon failure.
        const names = await processCommand(
          "docker",
          ["ps", "-a", "--format", "{{.Names}}"],
          { signal: AbortSignal.timeout(10_000) },
        );
        if (names.split("\n").includes(name(id)))
          throw new Error(
            "Could not stop the agent container. Cleanup will retry.",
          );
      }
      await rm(join(directory(id), "config.json"), { force: true });
      secrets.delete(id);
    },
  };
}
