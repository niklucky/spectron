# Chat invocation and basic agent execution — Stage 3

Implemented 2026-09-10. Stage 4 (implementation and PR/MR writes) remains next.

## Local setup and testing

The existing local API and app remain at `http://localhost:3105` and `http://localhost:5187`. Migrations `0021_agent_runs.sql` and `0022_agent_run_closure.sql` are applied, the pinned `spectron-agent:1.18.30` image is built, and `AGENT_RUNNER_ENABLED=true` is set in the ignored local `.env`. Existing accounts, connections, selected repositories, and issues are preserved. The persistent launchd services remain in use.

1. Open an issue in Chat/Flow. Ordinary comments remain human discussion.
2. Type `@` and choose an available agent, or use the Agent selector. Agent selection is explicit structured composer state; plain text that looks like a mention cannot invoke work by itself.
3. Type `/` or use Command to select Discuss code, `/review-issue`, `/rewrite-issue`, or `/create-plan`. Commands require an agent. Implementation and code review are deliberately unavailable until their stages.
4. The sole repository or project default is preselected. Select additional repository chips as needed. Add repositories in Project settings → Integrations when none are configured.
5. Send instructions. A durable run card appears with agent identity/AI badge, requester, command, repositories and checked-out revisions, activity, result, and expandable Markdown details.
6. During execution, Send instructions queues an explicit next session turn. Needs input has Reply and resume. Completed, stopped, or failed work has Continue, which creates a fresh run/container with current issue context and prior results, steering messages, and saved notes.
7. Rewrite results propose title/description and supported fields. Click Review and apply issue changes to compare current values with the proposal, then Apply reviewed changes. Applying is an atomic, authorized issue edit using the reviewed issue revision. Fields changed since invocation are marked. Concurrent edits after the comparison produce a conflict; Refresh comparison provides an explicit recovery path. Normal issue audit/export behavior is preserved.

## Deployment requirements

Run the API/worker on a host with Node 24, Git with `http.curloptResolve` support, the Docker CLI, and access to its Docker daemon. Build the runner with:

```sh
docker build -t spectron-agent:1.18.30 docker/agent-runner
```

Configuration:

- `AGENT_RUNNER_ENABLED=true` starts the durable worker scheduler independently of HTTP requests. It is opt-in; queued runs remain queued while the worker is offline.
- `AGENT_RUNNER_IMAGE` defaults to `spectron-agent:1.18.30`. OpenCode is pinned to npm version `1.18.30` in `docker/agent-runner/Dockerfile`.
- `AGENT_WORKSPACES_ROOT` is an absolute durable directory, defaulting to `data/agent-workspaces` in this checkout. It must be visible **at the same absolute path** to the Docker daemon. Keep it with database backups and restrict host access.
- `AGENT_IDLE_HOURS` defaults to **3**, allowed range 0.01–168. It begins only after Completed/Needs input; active work does not use an idle deadline.
- `AGENT_MODEL_LIMITS_JSON` optionally overrides `{context, output}` token limits by `provider/model`. Verified model windows are built in; unlisted models (currently GLM-5.3-flash) use a conservative 64k context / 8k output until configured. Limits are snapshotted into new runs.
- `AI_CREDENTIAL_SECRET`, `INTEGRATION_SECRET`/`BETTER_AUTH_SECRET`, `GIT_PROVIDER_DNS`, and `GITLAB_ALLOWED_PRIVATE_ORIGINS` retain their earlier meanings. Private GitLab uses system DNS; public Git and AI destinations can use the configured encrypted public DNS resolver.

The existing production `compose.yaml` does not automatically mount a Docker socket into the web API. A production runner host must be provisioned with the prerequisites above; mounting the Docker socket grants host-level execution authority. No environment-configuration UI, repository setup orchestration, or warm container pool is introduced.

GitLab needs repository clone permission (`read_repository`, or a token scope that includes it) in addition to the Stage 2 API reads. GitHub needs Contents read for the selected repository. No Git token is supplied to OpenCode, and this stage does not push branches, publish comments, or create PRs/MRs.

## Persistence and lifecycle

- `agent_runs` holds immutable agent/model/effort/instructions and initial issue/settings/people/comments/attachment references/prior results. AI connection IDs and private instructions are not returned by the presentation API.
- `agent_run_inputs` records explicit steering/resume inputs with independent request IDs and queued/delivered state. `agent_run_events` stores bounded, brief activity messages, not raw model reasoning or tool output dumps.
- Request IDs make invocation retries idempotent. Current project membership, agent sharing, repository scope, and issue lifecycle are checked again at invocation and execution. Only the requester or a project owner controls a run; steering also requires current agent access.
- Workers claim rows using PostgreSQL locks/`SKIP LOCKED`, a fencing token and a 60-second renewable lease. Each worker processes up to two executions. The heartbeat checks cancellation/lease ownership every second, while full authorization runs every 15 seconds and at each new turn. Worker shutdown, lease loss, and heartbeat failures are reported as interruptions, distinct from a member Stop. Missing leases trigger container cleanup and a failed/interrupted result; uncertain paid executions are never silently replayed.
- An issue-update database trigger records cancellation when the issue is finished, cancelled, or deleted. Reopening before the next worker poll cannot resurrect queued work. Stop/closure prevents late results from replacing the stopped state.
- Docker removal stops the container and shell/tool descendants. Cleanup errors remain explicit and retry; successful cleanup does not discard partial output or durable workspace files.
- Read-only checkouts, revision markers, attachments, notes, and OpenCode session data survive container removal. Needs input reconstructs a container and continues its stored session. A new independent continuation uses a fresh session and checkout; only `/work/notes` is carried forward, alongside durable issue context/results. It does not inherit an old agent's runtime configuration or credentials.
- Idle cleanup removes the container and temporary configuration. Durable workspace directories are retained for recovery; automatic deletion/retention of historical disk artifacts is not part of this stage. An operator can remove historical directories once recovery is no longer needed, but removing a waiting run's directory loses its OpenCode session and notes.

## Execution and credentials

The host clones selected branches using a clean Git environment, no global credential helpers, disabled hooks/submodule recursion, HTTPS-only protocol, no redirects, and a validated/pinned DNS address. Git credentials are process-environment configuration, never URL fields or persisted clone settings. Each actual checkout revision is recorded before model execution.

Containers mount source and attachments read-only, including against shell writes. They have no Docker socket or application/database mounts, a read-only root filesystem, dropped capabilities, no privilege escalation, and CPU/memory/process limits. OpenCode state and notes have a separate writable directory. It starts outside the checkouts with administrator-owned configuration and `--pure`; repository `opencode.json`/plugins cannot replace runtime permissions. The model is instructed to read applicable `AGENTS.md` files as repository guidance.

The creator's **real AI key stays in the worker process**. A per-run credential proxy injects it only into fixed HTTPS generation endpoints for the snapshotted provider/model. OpenCode receives a random capability token, useful only while its turn is executing. Inactive requests, other models, non-generation endpoints and unauthenticated requests are rejected. The proxy pins public DNS, verifies TLS, rejects redirects, bounds request/response sizes, and sanitizes upstream errors. It closes on cleanup. The host gateway binds only to `127.0.0.1`. The container uses `--network none`, with no host gateway, LAN access or internet egress. A loopback relay inside the container carries bounded generation-only requests/responses over an attached Docker stdin/stdout channel to the host gateway. Git remains host-side. Runtime package downloads and network-dependent tools are unavailable; dependencies must already be in the image. The selected provider still receives the authorized model context; the relay does not make repository text private from that provider.

Provider HTTP errors are translated into safe messages for authentication, permissions, model availability, quota/rate limits, and known invalid parameters; raw provider prose is never forwarded. OpenCode failures retain the provider diagnosis rather than being mislabeled as Docker failures.

The pinned CLI emits JSON events; `step_start` is the observed delivery boundary. Steering never interrupts an active shell tool: Spectron waits for the current CLI invocation to exit, then starts another `opencode run --session <id>` in the same container. Only then does the input become delivered. This behavior was exercised with the actual runtime, not inferred from the asynchronous server API. If a successful turn does not acknowledge pending instructions, its result is retained and execution fails visibly without repeating the paid request. Ten consecutive session turns pause at Needs input for explicit resumption. Take over remains Stage 5C.

## Results, attachments and limits

- Prompt context includes issue fields/status, settings for field names/IDs, current people, comments through the trigger, earlier results and explicit inputs, agent instructions, command guidance, repository paths and optional `AGENTS.md`, plus attachment files/metadata.
- Standard PNG/JPEG/WebP/GIF files up to 10 MB each are passed as native image input for OpenAI/Anthropic. Other attachments/providers receive files and a manifest; the result discloses lack of native multimodal input and must state what was actually inspected. Audio/video/PDF native model input is not enabled.
- Structured results support summary, Markdown details, a Needs input question, and a rewrite proposal. Free-form responses remain visible; invalid proposals have no Apply action. The final text part is used as the result so preliminary assistant narration does not corrupt a later JSON proposal.
- Apply supports title, description, priority, assignee, issue type, parent, state, tags, estimate, and custom field values. Unknown fields are discarded and all supported values still pass the existing issue service's project-aware validation.
- Prior context includes at most 10 result excerpts (1,000-character summaries, 4,000-character details) and 20 steering excerpts, with a disclosure in the prompt; oldest history is omitted first when necessary. Full results remain in chat.
- Context windows are model-specific. UTF-8 prompt bytes, including instructions and command text, are bounded to half the input capacity after reserving output, capped at 2 MB. This conservative text allowance leaves room for tool schemas, native images and repository reads; it is not a tokenizer estimate. Output stays capped at 16,384 tokens for verified models.
- Current limits: model-dependent initial context, 100 MB total attachment files, 32 MB proxy request/response, bounded CLI output, 300 brief activity events, 5-minute clone timeout, and a 20-minute per-provider-request timeout. These are bounded-resource limits, not an idle timeout for active tools. Oversize/unavailable inputs fail visibly.
- Run cards poll every two seconds while queued/preparing/working, every 30 seconds for Needs input, and stop polling when idle; focus, local mutations, and issue revision changes refresh them. Activity is persisted in durable storage; activity is streamed from CLI events into storage, rather than a raw token stream in the browser.

## Verification and continuation

- Final Stage 3 suite: **22 passed**, including real Docker/OpenCode and credential-proxy checks. Workspace typechecks and both production builds passed; the app retains its existing large-bundle warning.
- Focused service/API tests cover route startup, auth/CSRF, sharing and repository scope, snapshots and safe views, invocation retries, explicit queued/delivered steering, Needs input after container cleanup, closure followed by reopening, Stop, revoked membership, partial failures, stale leases, cleanup retry, and atomic/stale rewrite Apply.
- A real Docker/OpenCode test uses a deterministic **local test provider**. It exercises repository reads through OpenCode's actual read tool, rejects shell writes to mounted source, streams results, verifies same-session steering, stops descendant processes, resumes after container removal, and verifies the outgoing OpenAI/Anthropic/Z.ai/DeepSeek model and effort request formats. It also verifies credential-proxy reachability, the absence of the real key from container configuration, fresh-session restoration of notes, native image delivery, blocked network egress, and streamed model traffic over the Docker process relay.
- Separate proxy tests check inactive, unauthorized, wrong-model, and non-generation requests, POST forwarding and streamed responses through a local upstream, and safe classification of provider errors. The Docker test also verifies API errors survive a nonzero OpenCode exit.
- AI/Git/issues/comments regressions: **44 passed**.
- Actual internal-browser checks use the real composer and card components in a temporary fixture: agent/command pickers, repository selection, sending, Needs input/resume, Markdown details, and explicit rewrite Apply. The existing project page also loads successfully. Fixture files/tabs are removed afterward; no real issue or paid run is created for UI testing.
- A real clone of the configured GitLab `sa/detector` repository at `main` succeeded, revision `eb06daef0a1c782ccdf5b72f198b83744ef1b453`. The temporary clone/container was removed. A short live OpenCode generation with the saved OpenAI GPT-5.6 Sol/high connection succeeded after correcting the credential proxy to forward POST requests. GitHub clone remains untested. Request-format tests do not establish entitlement to every catalog model or its live behavior.

Run checks with `pnpm test:agent-runs`; include Docker with `TEST_AGENT_DOCKER=true pnpm test:agent-runs`. Ordinary tests never require a paid model call. Run workspace typechecks/builds for changes.

Main files: `packages/backend/src/agent-runs/*`, `packages/shared/src/agent-runs.ts`, migration `0021_agent_runs.sql`, `packages/api/src/trpc/router.ts`, `packages/api/src/server.ts`, chat/composer/run-card components, and `packages/api/test/agent-*.test.ts`.

The project owner confirmed a successful live issue review. After the PR fixes, a short live OpenAI/OpenCode test also passed with networking disabled, and the browser comparison/explicit Apply flow was verified using a temporary fixture. Next: PR review, then **Stage 4 — implementation and draft PR/MR creation**. Add writable recoverable workspaces, branch ownership, contribution attribution, pushes, draft PR/MR creation/continuation, and durable reconciliation. Keep autonomous babysitting and advanced environments deferred.

Official runtime references checked: [OpenCode CLI](https://opencode.ai/docs/cli/), [configuration](https://opencode.ai/docs/config/), and [pinned provider transformation source](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/provider/transform.ts).


PR review follow-up: migration `0022_agent_run_closure.sql` preserves errors/results on completed runs while still cleaning retained containers and repairs the earlier closure-only alert. New regressions cover missing delivery events, the ten-turn boundary, bounded history, shutdown reasons, text-part snapshots, stale rewrite recovery, polling cadence, and network isolation.

Model window sources checked 2026-09-10: [OpenAI model catalog](https://developers.openai.com/api/docs/models), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [Claude model overview](https://platform.claude.com/docs/en/models/overview), [DeepSeek model specifications](https://api-docs.deepseek.com/quick_start/pricing/), and [GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3). A GLM-5.3-flash-specific window was not established from official documentation, so it uses the conservative fallback above.
