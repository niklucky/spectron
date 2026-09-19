# Stage 5 completion — reviews, collaboration, and merge controls

Implemented 2026-09-19 on `codex/stage-5a-review-drafts`. Builds on the Stage 5A working changes and Stages 1–4. Migration `0025_git_collaboration.sql` is additive and applied to the existing local development database. Full live E2E acceptance is still pending by the owner's explicit plan; this is an implementation and focused-verification record.

## Behavior

- `/review-code` accepts a linked issue PR/MR or an explicit source branch in one selected repository. Branch comparisons pin head, target and merge-base commits. The read-only checkout must match the recorded head. Branch findings can be edited/dismissed locally; publishing requires a PR/MR review with verified provider locations.
- Each linked workspace has a current provider card in chat: source/target/head, draft/open/closed/merged status, checks/jobs/pipeline, commits, participants, reviewer decisions, and discussions. Historical run cards retain their execution-time outcomes.
- GitHub inline threads, issue comments, and submitted review summaries are synchronized; GitLab non-system discussion notes are synchronized. Thread and note IDs are preserved. Locally published replies become their provider notes, without a second published-draft card.
- Members can save replies, publish their own drafts, and Resolve/Reopen supported threads. Owners can edit/publish other members' drafts. Agent-produced replies belong to the requesting member and stay drafts until explicitly published. Edits use revision guards.
- Selected comments plus optional instructions go to the chosen agent. An active implementation by that agent receives recorded steering for its next turn. A different agent requires the explicit Take over action; receiving external activity never starts model execution.
- Take over is restricted to the requester or a project owner, uses all repositories of the active implementation, stops the prior execution, and waits for confirmed container/tool cleanup before ownership transfer. Cleanup failures retain the old writer reservation. Cancellation of a queued replacement clears the pending transfer.
- A replacement gets a new run/container/OpenCode session and its own decrypted credentials/configuration. Repository files, installed dependencies, uncommitted changes, saved `/work` artifacts outside OpenCode's `home`, selected attachments, instructions and comment context survive. The old OpenCode home, session file and runtime configuration do not transfer. Independent reviews remain separate read-only containers.
- Feedback results report addressed/unresolved comments; missing outcomes are explicitly unresolved. Replies for multiple selected notes in one thread are combined into one local draft. Fixing a comment never resolves its provider discussion automatically.
- Owners manage **Can merge** in Git settings. Owners can Mark ready/Close; owners and explicitly granted current members can Merge. All actions require an active project and open Spectron issue. Ready/Merge/Close are disabled while a writer owns the workspace.
- A merge re-fetches current provider state, checks the member's current grant, validates repository/connection revisions, verifies the displayed head, and submits that exact SHA to the provider merge endpoint. GitHub's merge state/review decision and GitLab's detailed merge state/approval result govern readiness. No admin bypass or delayed auto-merge is requested.
- Further implementation on an already-ready request returns it to draft before publishing changed code, retaining visible failed/unavailable verification outcomes. A lost draft-conversion response is reconciled from current provider state on explicit retry.

## Synchronization and recovery

`git/workflow.ts` provides the durable service. The server polls due workspaces in small batches every five seconds; open requests become due after five minutes. A single PR/MR metadata probe skips unchanged snapshots; full snapshots run at least hourly, on changed metadata, after a webhook, or on manual refresh. Provider errors back off for fifteen minutes. Closed/merged requests stop scheduled polling and remain refreshable manually or through webhooks. Refresh is explicit; a spinner corresponds to a real active sync lease. Deleted issues and archived projects are excluded from scheduled work.

Owners configure an encrypted webhook secret per Git connection in Git settings, then configure the displayed endpoint at the provider. GitHub uses an HMAC-SHA256 signature over the raw body; GitLab uses its shared secret header. Delivery IDs deduplicate callbacks. Payloads only mark relevant workspaces due; all displayed facts are re-fetched through the authenticated provider adapter. Missed webhooks recover through polling. A webhook arriving during a snapshot leaves another refresh due.

Human writes reserve a workspace operation and persist its actor, expected head, action and immutable payload before sending. Repeated request IDs do not issue new writes. Dispatch attempt IDs fence older slow requests after reconciliation. A lost response is shown as uncertain. Reconcile checks remote state; replies are never resent automatically or by Retry. An author or project owner may explicitly discard an uncertain local reply after another successful provider reconciliation. The hidden row and publication marker remain for delayed-response recovery; discarding neither resends nor removes a provider comment. Non-reply actions can be explicitly retried with their original head after a fresh check. A pending or uncertain state-changing action blocks a new writer until reconciled. Provider prose/credentials are not surfaced in generic transport failures.

There is no autonomous model loop or automatic retry of paid execution. Existing external branch divergence protection remains: a changed remote working branch preserves local work and requires explicit reconciliation rather than overwriting it. Source and target changes are checked independently of chat rendering.

## Integration setup

- GitHub token: repository metadata/contents access; Contents and Pull requests write for pushes, reviews, draft conversion, and request actions; Issues write for general PR conversation replies; Checks read for check-run details. Organization/branch rules still apply. Webhook subscriptions: pull requests, pull request reviews, review comments, issue comments, pushes, check runs/suites, statuses.
- GitLab token: `api` for collaboration and writes, with repository/branch privileges for the integration identity. Webhook subscriptions: merge requests, comments, pushes, pipelines and jobs. The receiver must be reachable by the self-hosted instance; local polling works without public webhook reachability.
- Use the same random secret (32–255 characters) in Spectron and the provider webhook configuration. Saving a secret does not create the provider webhook automatically.
- Current local app: `http://localhost:5187`; API: `http://127.0.0.1:3105`. Start with `pnpm dev:api` and `pnpm dev:app` after `pnpm db:migrate`. Docker must be running for model execution. Existing `.env` and saved data remain in this worktree and are ignored by Git.

## Verification performed

- Full agent suite with `TEST_AGENT_DOCKER=true pnpm test:agent-runs`: 46 passed, zero skipped, including the PR review regressions.
- `pnpm test:git`: 14 passed.
- `pnpm typecheck`: all seven packages passed. `pnpm build`: both production apps passed; the existing large-bundle warning remains.
- Isolated PostgreSQL tests cover migration/reapplication, scoped access, reply revision conflicts, duplicate webhook delivery, unknown replies without resends, Resolve/Reopen, grant changes during requests, stale-head merge refusal, ambiguous merge recovery, superseded slow dispatch, one writer, cleanup failure, fresh replacement credentials, canceled takeover, local branch findings, and ready-to-draft publication with failed-check reporting.
- PR review regressions also cover GitHub WIP titles, GitLab current-title readiness, approval followed by a comment-only review, unrelated repository metadata changes, one diff read for a publication batch, patch-free run lists, invalid model feedback after successful publication, polling/backoff, and uncertain draft discard with late marker recovery.
- Both provider contract suites cover activity, discussion/approval/check metadata, reply/resolve/reopen/ready/close/merge requests, exact SHA payloads, merge method restrictions, and immutable branch comparisons with moved-branch rejection.
- Actual local Git and Docker/OpenCode fixtures verify protected Git metadata, source read-only/writable separation, stopped descendants, dependencies/unfinished edits/artifacts surviving a handoff, fresh replacement state, and absence of real credentials in mounts/configs. Fixtures use a deterministic local model endpoint; no paid calls or external writes were made for these tests.
- Browser smoke on the existing MKS-3 issue loaded the live GitHub PR with three checks, expandable details, correct disabled merge state, a cancellable action confirmation pinned to the displayed SHA, and PR/branch review controls. This was read-only provider verification, not full live E2E.

## UX session handoff

Keep behavior contracts intact while refining layout, labels, icons and spacing. Current surfaces:

| Surface | Files |
| --- | --- |
| Current provider cards, discussions, replies, feedback selection, merge confirmation and action recovery | `packages/frontend/src/components/feature/task/git-activity.tsx`, `agent-runs.css` |
| Takeover controls, comment outcomes, execution/handoff history | `packages/frontend/src/components/feature/task/agent-run-card.tsx` |
| PR/branch review selection | `packages/frontend/src/components/feature/task/issue-comments.tsx` |
| Review findings and explicit publication | `packages/frontend/src/components/feature/task/review-drafts.tsx` |
| Placement in chat | `packages/frontend/src/components/feature/task/issue-chat.tsx` |
| Merge grants and webhook setup | `apps/app/src/git-collaboration-settings.tsx`, `git-settings.tsx` |
| Browser-safe behavior contracts and app wiring | `packages/shared/src/{agent-runs,git-workflow}.ts`, `apps/app/src/app.tsx` |

Preserve disabled-state reasons, errors, draft/save/publish distinctions, explicit takeover, stale revision recovery, and the commit displayed in merge confirmation. Do not relabel fixture coverage as live acceptance. The next full test session is specified in [the E2E checklist](ai-agents-e2e-checklist.md).

Provider references consulted: [GitHub pull request API](https://docs.github.com/en/rest/pulls/pulls), [GitHub GraphQL mutations](https://docs.github.com/en/graphql/reference/mutations), [GitHub comparisons](https://docs.github.com/en/rest/commits/commits), [GitLab merge requests](https://docs.gitlab.com/api/merge_requests/), [GitLab discussions](https://docs.gitlab.com/api/discussions/), [GitLab branch comparisons](https://docs.gitlab.com/api/repositories/).
