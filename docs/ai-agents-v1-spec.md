# AI agents and Git workflow — v1 specification

Status: Stages 1–4 implemented; Stage 5 not started. See [Stage 1 notes](ai-agents-stage-1.md), [Stage 2 notes](ai-agents-stage-2.md), [Stage 3 notes](ai-agents-stage-3.md), and [Stage 4 notes](ai-agents-stage-4.md).
Last updated: 2026-09-11.

This document captures the decisions made with the project owner and is the handoff for future implementation sessions. The stages below are ordered, independently reviewable increments. Update their status and continuation notes as work lands. Technical suggestions are identified separately from agreed behavior.

## 1. Product objective and scope

The issue conversation is the place where people discuss requirements, invoke named AI agents, inspect progress, receive results, publish reviews, address feedback, and merge code.

The complete workflow is:

1. Create a personal AI connection and one or more agents.
2. Connect Git providers and repositories to a Spectron project.
3. Open an issue in Flow/chat and discuss its requirements.
4. Mention an agent, optionally select a command, and choose repositories.
5. Spectron assembles context and runs OpenCode in a container with the selected code.
6. Results appear in the issue chat with a summary and expandable Markdown details.
7. Implementation creates or updates a draft PR/MR.
8. Review findings are drafted in Spectron and published by a human.
9. External review activity flows back into the issue conversation.
10. People reply, resolve discussions, ask agents to make fixes, and merge from chat.

### Providers included in v1

| Integration | Required scope |
| --- | --- |
| OpenAI | Model selection from supported OpenAI models |
| Z.ai | GLM-5.3 and GLM-5.3-flash |
| DeepSeek | DeepSeek V4 pro and DeepSeek V4 flash |
| Anthropic | Model selection from supported Anthropic models |
| GitHub | Project repository connections, PRs, reviews, comments, checks, merge actions |
| Self-hosted GitLab | Configurable instance URL, project repository connections, MRs, reviews, comments, pipelines, merge actions |

These are product requirements, not a claim that compatibility has already been tested. During implementation, verify the exact provider IDs, model IDs, supported effort settings, and authentication against the pinned OpenCode version and current provider documentation. Do not silently substitute other model families.

### Explicitly deferred

- Autonomous PR/MR babysitting, repeated reviewer/fixer loops, their maximum iterations, budgets, and hard stop rules.
- Advanced execution environments: per-repository images, setup forms, service orchestration, and environment provisioning workflows.
- A warm repository-cache architecture or general-purpose container pool. Start with the simple lifecycle described below.
- An inline code diff/review editor in Spectron. Code review links open the provider; Spectron shows findings and file/line references.

Environment instructions should initially come from repository agent files where available. Do not make a custom environment configuration system a prerequisite for v1.

## 2. AI connections, agent identity, and sharing

### AI connection

A connection belongs to a user and contains a display name, provider, and encrypted API key. Several agents can reference the same connection. Credentials stay server-side and are never revealed to members invoking a shared agent.

### Agent

An agent belongs to its creator and contains:

- Name, such as “My helper”, “Dev junior”, “Dev senior”, or “Issue editor”.
- Uploaded avatar.
- AI connection reference.
- Model and model-supported effort level.
- Editable role/function string, such as Reviewer, Planner, or Developer.
- Configured instructions used as the agent's system prompt.
- Sharing configuration per project.

Agents participate naturally alongside people, with an AI badge. They have their own persistent identity; do not fabricate an authenticated human account for each agent. Role names describe behavior and defaults; they do not grant permissions.

Only the owner edits the agent and its AI connection in v1. An invocation records both the owner whose connection is used and the member who requested the work. Configuration is snapshotted for each run so subsequent agent edits do not rewrite execution history.

### Sharing

| Setting | Who may invoke the agent |
| --- | --- |
| Private, the default | Owner only |
| Selected members | Owner and explicitly selected members of the relevant project |
| Whole project | Owner and all current members of the selected project |

Sharing is project-specific: the same agent can be shared with everyone in one project and selected developers in another. Invocation permission does not grant project or repository access. Check the invoking member's current project access and the selected repositories independently. Leaving a project removes access through its sharing grants.

## 3. Git connections and attribution

Project owners configure Git connections and select one or more repositories. A project can use GitHub and GitLab together. GitLab requires its self-hosted instance URL. Choose a project default repository and a default target branch for each repository, initially the repository's existing default branch.

With one repository, the composer selects it automatically. With several, the project default is preselected and the user can select multiple repositories. Every selected repository must belong to the issue's project integration scope.

### Identity

- GitLab: the owner will create an access token associated with a specific user. Remote comments and MR activity use that identity; configure Git commit authorship to match it.
- GitHub: the connection creator's credentials are used and comments, commits, and PR activity are on their behalf.
- This is a shared integration identity. Invoking members do not need to provide a personal Git token for every run.
- The token authenticates operations; commit author configuration must be set explicitly rather than assumed to follow from authentication.

Commits include a contribution note naming the agent and requester, with issue and run references. Agreed example:

```text
Implement issue validation

Spectron-Issue: SPC-123
Spectron-Agent: Dev senior
Spectron-Requested-By: Nikita
Spectron-Run: <run-id>
```

PR/MR descriptions also identify the agent and requesting member and link to the issue and run. Record attribution per contribution so a later handoff does not erase the original agent's work.

Each repository has its own working branch and PR/MR. A multi-repository run groups these in chat and exposes per-repository success or failure; do not imply an atomic cross-repository merge.

## 4. Composer and commands

- Ordinary messages are human discussion and do not invoke agents.
- `@` opens the available-agent picker, filtered by sharing/access.
- `/` selects a command. A mention without a command starts discussion with repository access.
- Selected repositories appear as editable chips.
- An explicit mention or agent action creates work; merely receiving external comments does not start autonomous work.
- “Send instructions” addresses an existing run automatically.

| Invocation | Behavior | Source access |
| --- | --- | --- |
| `@Agent <message>` | Discuss using issue context and repository code | Read-only |
| `/review-issue` | Find unclear requirements, missing cases, and questions | Read-only |
| `/rewrite-issue` | Propose improved title, description, and fields; show an Apply action | Read-only |
| `/create-plan` | Produce an implementation plan and verification approach | Read-only |
| `/implement` | Implement, run applicable checks, push a branch, and create/update a draft PR/MR | Writable |
| `/review-code` | Review the selected branch or PR/MR against requirements and code instructions | Read-only |

“Ask agent to address” is also a writable action for selected review comments. Whether it additionally has a slash-command alias can be decided during implementation.

Read-only means the agent cannot modify the source checkout; writable space for OpenCode state, notes, and temporary files remains available. Discussion and planning always have code available. Do not introduce a code-free chat path as the default agent behavior.

## 5. Context supplied to every invocation

| Input | Included content |
| --- | --- |
| Issue | Title, description, populated fields, and current status |
| Comments | Conversation through the triggering message, including earlier agent results and agreed plans |
| Attachments | Files made available in the container; model input where supported |
| Agent instructions | Configured system prompt |
| Repository instructions | Applicable `AGENTS.md` and related instructions in each selected repository, when present |
| Command instructions | Task-specific instructions for the selected command, if any |
| Triggering message | The immediate user request |

Repository instructions are optional. Load `AGENTS.md` when present and continue if absent. Advanced environment decisions remain deferred, with repository agent files the intended starting point for setup guidance.

Unsupported attachments may be a no-op for a model: retain their files/metadata and disclose that they were not inspected. Never describe an unsupported attachment as understood. Long conversations can be summarized, preserving the latest request, agreed requirements, and relevant plans/results.

Snapshot the initial context and checked-out commit for each repository when work starts. Ordinary later comments do not silently change active work. Explicit steering messages are additional recorded inputs and are the deliberate exception to this snapshot rule.

Spectron/container permissions apply independently of prompt text. Issue content, repository files, attachments, and role names cannot grant extra access.

## 6. Runs, containers, and persistence

### Default lifecycle

1. Create a durable run record and queue the invocation.
2. Create a fresh container containing OpenCode and the selected repository checkouts.
3. Configure the selected model, effort, instructions, execution permissions, and temporary credentials.
4. Execute and stream user-facing activity into the run card.
5. Persist the result, relevant execution history, repository revisions, and workspace changes needed for continuation.
6. Mark execution complete independently of container lifetime.
7. Retain the idle container for a configurable few hours, then stop and clean it up.

The exact idle duration has not been selected. “Inactivity” means the agent has finished and humans have not resumed work. A long-running tool or quiet execution is not inactivity. Needs-input work must preserve its resumable state; the exact waiting-container retention policy can be set with the runner implementation.

New independent invocations and ordinary follow-ups after completion start fresh containers, even if an earlier idle container remains retained for inspection/recovery. Preserve continuity in durable conversation, plans, and workspace state rather than relying on a container surviving for days.

Implementation follow-ups use the existing working branch and preserve saved unfinished changes. Planning normally targets the selected target branch; reviewing a PR/MR uses its revision. Keep files fixed during an invocation. If the target changed since planning, implementation checks the plan against those changes.

### Active steering and handoff exceptions

The final agreed behavior allows reuse of an active workspace in these cases:

| Situation | Behavior |
| --- | --- |
| Same agent is running | Record and send selected comments/instructions to its active session; show Queued until incorporated |
| Explicit Take over with another agent | Stop old execution and tools, preserve workspace, start a new OpenCode session with the replacement agent |
| Independent review by another agent | Separate container; do not silently stop the developer |
| Previous container has stopped | Fresh container restored from persisted work/context |

A handoff preserves dependencies, unfinished edits, and available test artifacts. The new session receives its own configuration and credentials, the issue context, and a handoff summary describing completed work, remaining work, and current workspace state. Never assume credentials/settings from agent 1 are valid for agent 2.

There is one active writer per workspace and PR/MR branch, including across different containers. Confirm old execution and its tools have stopped before transferring ownership. The old agent's attribution remains in history. Invoking another agent alone does not imply Take over.

OpenCode's asynchronous message and abort APIs are useful building blocks, but their behavior during active tool execution must be verified in the pinned runtime. Do not promise immediate steering without confirming when it is consumed.

### Stop and issue closure

- Stop in chat cancels active execution, preserves available output and changes, and stops the associated container.
- Cancelling or closing an issue cancels active executions and stops all containers associated with it, including idle ones.
- Persist enough state for recovery before removing a workspace when possible; report preservation failures explicitly.
- Stop/closure must also prevent queued work or late callbacks from restarting execution or creating new remote writes.
- Closing the Spectron issue does not implicitly close or merge its external PRs/MRs; those have explicit actions.

## 7. Run presentation in chat

Use one run card per invocation, updated as work progresses. Steering attaches to the active card; handoffs visibly record the agent change and retain execution history.

| State | Presentation |
| --- | --- |
| Queued | Agent, requested action, repositories, waiting status |
| Preparing | Preparation progress |
| Working | Brief activity updates and controls |
| Needs input | Agent question and an explicit reply/resume action |
| Completed | Summary, expandable Markdown details, verification results, PR/MR links |
| Failed | Reason, partial results, and retry/continue where applicable |
| Stopped | Cancellation reason, partial results, and continuation where applicable |

Controls during active work include Send instructions, Stop, and Take over. Detailed logs are expandable and do not flood the conversation. Do not expose credentials in logs or results.

An explicit answer to a Needs input question resumes waiting work, using a fresh container if the original no longer exists. Nearby human conversation does not automatically resume the agent.

## 8. Implementation and PR/MR creation

`/implement` pushes a working branch and automatically creates a draft PR/MR. There is no extra “Create PR/MR” approval step and no inline code diff view in Spectron.

- Follow-up work on the same implementation updates the existing branch and PR/MR.
- Results include a concise change summary, checks actually run and their outcomes, unresolved problems, expandable Markdown details, and the linked PR/MR card.
- Do not create an empty PR/MR when execution fails before producing usable changes.
- For partial changes or failed checks, report the actual condition and retain draft status; never imply readiness or passing checks.
- Track branch/push/create outcomes durably so retries do not duplicate PRs/MRs or overwrite newer remote work.

## 9. Review drafts and external discussions

### `/review-code`

Automatically choose the issue's PR/MR when there is one; offer a picker when there are several. Record the reviewed commit and compare changes against issue requirements and repository instructions.

Findings arrive as drafts in Spectron, not automatically as provider comments. Each finding includes file/line references, explanation, and a suggested fix when available. Users can edit, dismiss, select, Publish selected, or Publish all.

Publication sends findings to the appropriate provider review locations. Track publication state to prevent duplicates. Before publishing after the PR/MR changes, revalidate locations/applicability and flag outdated or unverifiable findings rather than silently placing them on unrelated lines.

### PR/MR activity card

Maintain an updating card with:

- Provider link, colored branch/status icon, source and target branches.
- Draft/open/merged/closed state.
- Pipeline/check status.
- Commits, participants/collaborators, reviewers, and unresolved discussions.
- Spinner during actual loading or activity, not perpetually while a PR/MR is open.

External review comments appear in the issue conversation with links to the original threads. Webhooks plus reconciliation are the proposed mechanism for recovering missed updates. Preserve external IDs and avoid echoing locally published replies back as duplicate comments.

### Reply, Resolve, Reopen, and Ask agent to address

- A human writes a reply in Spectron and explicitly publishes it to the original provider thread.
- Resolve and Reopen synchronize the discussion state with GitHub/GitLab, subject to provider support and permissions.
- Ask agent to address sends selected comments and optional instructions to an agent.
- If that agent is already running on the relevant writable work, steer it. A different agent can take over explicitly, using the handoff rules above.
- Otherwise start writable work on the existing PR/MR branch, apply fixes, run applicable checks, and push updates.
- The agent reports addressed and unresolved findings. Its proposed external replies stay in Spectron for human publication.
- Agent fixes alone do not automatically resolve external discussions.

## 10. Ready, merge, and close actions

The PR/MR card has Mark ready, Merge, and Close actions. Merge remains a human action in v1; agents may push changes but do not inherit merge authority.

- Project owners may merge and can explicitly grant Can merge to selected members.
- Spectron checks this permission independently of the shared provider token's capabilities.
- Current provider checks, approvals, conflicts, and branch rules govern merge availability.
- Before merging, verify that the current remote commit matches the commit presented to the user. Refresh on change instead of merging unseen changes.
- Provider permission or API failures are shown honestly; a shared token is not a reason to bypass rules.
- Closing or merging the external PR/MR does not automatically close the Spectron issue in v1 unless a later explicit product decision adds that behavior.

## 11. Implementation guidance and existing foundations

These are starting points, not a locked database or API design. Re-inspect current code before implementing; some existing README descriptions lag the implementation.

| Area | Existing location / guidance |
| --- | --- |
| Database | `packages/db/src/schema.ts`; explicit Drizzle migrations |
| Business logic | `packages/backend/src`; keep authorization and orchestration server-side |
| API | `packages/api/src/trpc/router.ts` and `packages/api/src/server.ts` |
| Browser-safe contracts | `packages/shared/src` |
| Chat/composer | `packages/frontend/src/components/feature/task/issue-chat.tsx`, `issue-comments.tsx`, `message-composer.tsx` |
| Account UI | `packages/frontend/src/components/feature/account` |
| Project integration UI | `apps/app/src/project-integration-settings.tsx` and frontend project components |
| Activity/comments/files | Existing backend services in `activity.ts`, `comments.ts`, `files.ts` |
| Durable integration work | Existing patterns in `packages/backend/src/integrations/export-sync.ts` and related files |

Existing comments have human/external author references; agent identity and attribution need deliberate schema/contracts changes. The existing `project_integrations` table is Tracker-specific despite its generic name. Do not force Git connections into that schema without a deliberate migration/design.

Suggested persistent concepts: AI connection, agent, per-project sharing grants, Git connection, project repository, run/context snapshot, run inputs/events, execution attempts/handoffs, recoverable workspace state, linked PR/MR, draft finding/publication, external discussion mapping, and merge grants.

Keep the execution worker separate from HTTP request lifetimes. Use durable claims and reconcile uncertain remote effects rather than blindly repeating creates or publications. Enforce read-only source access outside the prompt; disabling OpenCode's edit tool alone is insufficient if its shell can still write.

Useful official references, to recheck at implementation time:

- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode server and sessions](https://opencode.ai/docs/server/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [GitLab webhook events](https://docs.gitlab.com/user/project/integrations/webhook_events/)
- [GitLab merge request API](https://docs.gitlab.com/api/merge_requests/)
- [GitHub REST API](https://docs.github.com/en/rest)

## 12. Implementation stages and acceptance criteria

**Stages 1–4 are implemented**; Stage 5 is **not started**. Each stage should include appropriate migrations, browser-safe contracts, UI, authorization, error states, and focused verification. Do not implement later stages merely to make an earlier stage look complete.

### Stage 1 — AI connections and agents

- [x] Personal AI connection CRUD, encryption, validation, and safe credential replacement.
- [x] Agent CRUD with avatar, model, supported effort, role, instructions, and owner identity.
- [x] Private / selected members / whole project sharing per project.
- [x] Provider/model configuration for all four required AI providers.
- [x] Agent identities usable by future mentions/results without human authentication accounts.

Acceptance: create several agents from one connection; rotate its key once; owner-only editing holds; authorized project members can discover shared agents without reading credentials; unrelated or removed members cannot. Unsupported model/effort combinations fail clearly. Real provider smoke checks require configured credentials; mark untested combinations explicitly.

### Stage 2 — Git connections and project repositories

Depends on existing project membership; can build on Stage 1's credential patterns.

- [x] Owner-managed GitHub and self-hosted GitLab token connections, connection tests, and repository selection.
- [x] Multiple repositories and mixed providers per project; project default repository and per-repository target branch.
- [x] Provider actor identity and explicit commit author configuration.
- [x] Repository authorization and browser-safe metadata contracts.
- [x] Provider adapter boundaries for later branches, PR/MR actions, and synchronization.

Acceptance: connect each provider, list/select only repositories available through the connection, persist defaults, and prevent non-owner configuration changes and cross-project selection. Handle expired tokens and unreachable GitLab instances. Do not expose tokens in clone URLs shown to users or in logs.

### Stage 3 — Chat invocation, context, and basic execution

Depends on Stages 1–2. First end-to-end deliverable: mention an agent, inspect code, and receive a planning/discussion result in chat.

- [x] Agent/command pickers and repository chips in the existing composer.
- [x] Durable runs, context snapshots, worker, simple container provisioning, and temporary configuration.
- [x] Read-only discussion, review-issue, rewrite-issue with Apply, and create-plan.
- [x] Run cards, brief streamed updates, expandable results/logs, and Needs input/resume.
- [x] Result/workspace persistence, idle cleanup, Stop, and issue cancellation/closure cleanup.
- [x] Explicit same-agent steering, with queued/delivered state based on verified OpenCode behavior.

Acceptance: a repository-backed discussion survives page reloads; only explicit agent actions invoke work; required context is supplied; unsupported attachments are disclosed; read-only sources remain unchanged; cancelled/closed issues cannot launch queued work; active work is not killed by the idle policy. Demonstrate continuation after container removal and truthful partial-failure results. No environment configuration UI is required.

### Stage 4 — Implementation and draft PR/MR creation

Depends on Stage 3.

- [x] Writable execution and recoverable unfinished changes.
- [x] Branch creation, contribution notes, pushes, and automatic draft PR/MR creation for both providers.
- [x] Existing-branch/PR/MR continuation and one-writer enforcement.
- [x] Summary, verification outcomes, Markdown details, and basic linked PR/MR cards.
- [x] Per-repository outcomes for multi-repository runs and reconciliation of uncertain remote writes.

Acceptance: implement an issue and create a correctly attributed draft PR/MR; a follow-up updates the same work; retries do not duplicate it; unfinished changes survive recovery; concurrent writers cannot collide; failed work does not produce an empty PR/MR. No inline diff viewer or separate create approval is introduced.

### Stage 5 — Reviews, collaboration, and merge controls

Depends on Stage 4. Deliver in these substeps to keep changes reviewable:

- [ ] **5A — Review drafts:** review-code, PR/MR selection, reviewed revision, editable/dismissible findings, explicit publish selected/all, stale finding checks, publication tracking.
- [ ] **5B — Activity and discussions:** updating provider cards, incoming comments, webhook/reconciliation deduplication, explicit reply publishing, Resolve/Reopen.
- [ ] **5C — Address feedback and handoffs:** selected-comment fixes, active steering, explicit Take over, stopped-tool verification, fresh agent session in preserved workspace, separate review containers, draft external replies.
- [ ] **5D — Merge controls:** owner-managed Can merge grants, Mark ready/Merge/Close actions, current provider requirements, displayed-commit verification, action attribution.

Acceptance: findings remain local until published; repeated sync/publish does not duplicate comments; stale references are flagged; resolving/reopening round-trips to the provider; a replacement agent continues unfinished work without concurrent writers or leaked prior credentials; agent replies await human publication; unauthorized members cannot merge through the creator's token; newer remote commits prevent an unseen merge. Exercise both Git providers.

### Validation expectations across stages

Use focused service/API tests with isolated PostgreSQL and mocked provider boundaries where appropriate. Verify durable behavior under retries, cancellation, authorization changes, and ambiguous remote outcomes. Use a controlled runner or container fixture for lifecycle and workspace tests, plus a small real Docker/OpenCode smoke test when the environment permits. Check the actual chat/settings UX for each stage.

Run applicable repository checks (including typecheck/build for code changes). Do not require live paid API calls in ordinary tests or claim provider compatibility from mocks alone. Record any unavailable real-integration checks in continuation notes.

## 13. Decisions remaining for implementation

The product flow above is agreed. Resolve these bounded details when their stage needs them, without reopening settled scope:

- Exact supported model IDs/effort mappings and pinned OpenCode image/version.
- Credential validation, storage/key rotation details, and self-hosted GitLab connectivity.
- Durable run event format, worker claim/recovery mechanism, and workspace checkpoint storage.
- Exact idle retention duration and the retention treatment of Needs input.
- How OpenCode consumes steering during a running tool and how child processes are fully stopped for handoff.
- Fine-grained authorization for Stop/Take over, publishing reviews, Resolve/Reopen, Mark ready, and Close; owner-managed Can merge is already agreed.
- Provider/version-specific review locations, discussion capabilities, webhook setup, and reconciliation cadence.

Do not resolve these by adding autonomous babysitting or a repository environment configuration system to v1.

## 14. Next-session handoff

Current state: Stages 1–4 are implemented. `/implement` uses durable writable workspaces, attributed commits, guarded pushes, automatic draft PR/MR creation, existing-branch continuation, and per-repository chat outcomes. Publication-only retries reconcile saved work without another model call. See [Stage 4 notes](ai-agents-stage-4.md) for setup, recovery, verification, and remaining live-provider checks. The local migration is applied and the persistent app/worker is running.

Recommended next action: **user acceptance and PR review**, then **Stage 5A — Review drafts**. Keep provider activity/discussions in 5B, feedback fixes and takeover in 5C, and merge controls in 5D.

Suggested continuation request:

> Read `docs/ai-agents-v1-spec.md` and the Stage 4 implementation notes, then implement Stage 5A — review drafts. Preserve the agreed v1 scope: review-code, PR/MR selection, reviewed revisions, editable/dismissible findings, explicit publication, stale finding checks, and durable publication tracking.

After each implementation session, record:

- Completed stage/substeps and relevant files or migrations.
- Verification performed and any live integrations not tested.
- Remaining work or concrete blockers.
- The next bounded implementation step.

### Continuation notes

- User acceptance check: created/updated an OpenAI connection, passed its connection check with a new key, and created an agent. Model generation and OpenCode execution remain untested. Stage 1 is ready for review.

- 2026-09-10: Created this specification from the product discussion. All implementation stages remain not started. Environment configuration and autonomous babysitting remain deferred.

- 2026-09-10: Implemented Stage 1 end to end. Migration `0019_ai_agents.sql`; account menu → AI connections & agents; encrypted personal connections, owner-managed agents with avatar/model/effort/instructions, per-project sharing and safe discovery. Focused isolated-PostgreSQL tests, all workspace typechecks, production builds, and a browser create/share/member-discovery walkthrough passed. Set `AI_CREDENTIAL_SECRET` and apply the migration to use this in an existing environment. All real provider/model/effort combinations and OpenCode execution remain untested; no paid calls were made. Next: Stage 2. Details: [Stage 1 notes](ai-agents-stage-1.md).

- 2026-09-10: Implemented Stage 2: owner-managed encrypted GitHub/self-hosted GitLab connections, identity checks, explicit commit author fields, provider repository discovery and branch validation, mixed-provider selection, project/default-target settings, scoped metadata/authorization, and provider adapter boundaries. Migration `0020_git_connections.sql` applied locally. Isolated-database regressions, typechecks, builds, and browser settings checks passed. Real provider tokens, clone/push operations, and self-hosted connectivity remain untested. Next: Stage 3. Details: [Stage 2 notes](ai-agents-stage-2.md).

- Stage 2 follow-up: local VPN DNS substituted proxy addresses for GitHub and GitLab. Added `GIT_PROVIDER_DNS=cloudflare` with shared encrypted DNS resolution, preserved network/TLS restrictions, and enabled it locally. Identity checks now pass for GitHub and both configured self-hosted GitLab instances. Repository operations and remote writes remain separately unverified.

- 2026-09-10: Implemented Stage 3 end to end. Migration `0021_agent_runs.sql`; agent/command composer controls and repository chips; durable snapshots, inputs and run cards; OpenCode 1.18.30 Docker worker with read-only source, host-side AI credential proxy, results, rewrite Apply, queued steering, stop/closure cleanup, idle retention and restored continuation. Isolated database/API tests, real Docker/OpenCode tests with local provider fixtures, browser component walkthroughs, and a real selected GitLab clone were exercised. A live OpenCode connection test succeeded after fixing POST forwarding in the credential proxy; the project owner also confirmed a successful issue review. Next: PR review, then Stage 4. Details: [Stage 3 notes](ai-agents-stage-3.md).

- Stage 3 PR review follow-up: guarded unacknowledged steering and capped consecutive turns; preserved successful results during closure cleanup (migration `0022_agent_run_closure.sql`); bounded history and model-specific prompt capacity; isolated run containers with networking disabled and a loopback gateway over Docker process I/O; added rewrite comparison/revision recovery; reduced idle polling and authorization frequency; distinguished interruptions from user stops. All 22 Stage 3 tests, workspace typechecks, and production builds passed; isolated live model generation and browser comparison/Apply were verified.

- 2026-09-11: Implemented Stage 4. Migration `0023_agent_implementations.sql`; durable writable per-issue/repository workspaces and writer reservations; host-side attributed Git commits and leased pushes; automatic GitHub draft PR/GitLab draft MR creation; continuation, lost-response reconciliation, publication-only retry, and per-repository chat cards/check outcomes. All 26 agent tests (including real Docker/OpenCode and Git fixtures), 14 Git regressions, workspace typechecks, and production builds passed. Browser composer/cards/retry were checked; persistent servers are running. Live provider pushes and PR/MR creation remain untested. Next: user acceptance/PR review, then Stage 5A. Details: [Stage 4 notes](ai-agents-stage-4.md).
