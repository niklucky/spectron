# AI agents v1 — full live E2E acceptance

Prepared 2026-09-19. **Not yet executed.** The owner requested a fresh E2E session after separate styling/UX refinement. Read the specification and Stage 5 completion notes first. Fixture test results are supporting evidence, not a substitute for this matrix.

## Acceptance rules and evidence

Use dedicated test issues, branches and repositories with the intended GitHub and self-hosted GitLab integration identities. Coordinate which external repositories may receive test comments, pushes, closes and merges, and which AI connections may incur usage. Do not use a production PR as an accidental merge fixture.

For each case below, record: date, app commit/worktree state, provider/model/effort, relevant actor and permission, issue/run IDs, provider URLs, displayed and actual SHAs, observed UI/API/provider/container result, and pass/fail/blocked. Preserve useful screenshots and sanitized logs. Fix failures and rerun the affected case and regressions. Skipped, unavailable or mocked cases remain **blocked**, never passed. Do not copy keys, cookies or webhook secrets into evidence.

A passing case needs agreement between the UI and durable/provider state, including after refresh/restart. A passing workflow does not hide failed tests, unsupported inputs, pending writes, or an uncertain provider outcome.

## Environment and accounts

- [ ] Record `git status`, current HEAD, Docker image/OpenCode version, database migrations, server ports and relevant feature flags. Ensure the UX session's changes are present.
- [ ] Run `pnpm typecheck`, `pnpm build`, `pnpm test:git`, and `TEST_AGENT_DOCKER=true pnpm test:agent-runs`. Investigate every failure or skip before declaring acceptance.
- [ ] Use project owner, ordinary member, explicitly granted merge member, and outsider accounts. Include an agent owner different from the invoking member.
- [ ] Configure one GitHub repository and the actual self-hosted GitLab instance/version. Record effective repository/branch rules and the shared integration identity. Verify author name/email and commit attribution.
- [ ] Configure publicly/provider-reachable webhook endpoints with verified TLS, selected event types and matching secrets. Prove recovery also works with webhook delivery deliberately missed.
- [ ] Confirm connection failure messages for invalid/expired/revoked tokens, missing scopes, inaccessible repositories and unavailable Docker. No secrets appear in responses, browser state, logs or container config.

## AI provider matrix

For every required model family, use the exact configured IDs and every exposed supported effort value. Record the catalog's actual IDs rather than assuming a marketing label is an API ID. Verify connection check, model/effort selection, simple generation, tool use, structured result parsing, and a clear failure for unsupported model/effort combinations.

| Provider | Required coverage | Live status |
| --- | --- | --- |
| OpenAI | Supported selectable models and effort mappings; Responses/tool behavior | Pending |
| Anthropic | Supported selectable models and effort/thinking mappings; tool behavior | Pending |
| Z.ai | GLM-5.3 and GLM-5.3-flash, supported effort values | Pending |
| DeepSeek | DeepSeek V4 pro and DeepSeek V4 flash, supported effort values | Pending |

- [ ] Create, rename, edit, rotate a connection and delete only disposable fixtures. Verify secrets are never returned. Agent changes affect new runs while prior identities/configurations remain recorded.
- [ ] Agent avatar, role and instructions reach the new run. Private, selected-member and whole-project sharing work; removing membership/sharing revokes new work and blocks subsequent protected steps of active work.
- [ ] A shared agent uses its owner's AI connection, records its requester separately, and does not expose the owner's credential.

## Composer, context, and commands

- [ ] Ordinary human messages do not launch an agent. Agent mention alone runs repository-backed discussion. Command and agent selectors agree with typed mention/command behavior.
- [ ] One repository auto-selects; several preselect the default and allow an explicit subset. Mixed GitHub/GitLab selection works. Cross-project/stale/removed selections are rejected.
- [ ] Every command receives title, description, fields/status, prior conversation/plans, triggering request, repository instructions when present, and selected/issue attachments. Missing AGENTS.md does not block execution.
- [ ] Test supported image input, text/document attachment and unsupported content. The run retains files and discloses uninspected content honestly. Oversized context produces a useful error without a paid replay loop.
- [ ] Discussion, review-issue, create-plan and rewrite-issue can inspect code but cannot change the source even through a shell tool. Workspace notes remain writable.
- [ ] Rewrite preview shows current versus proposed values; it never applies itself. Explicit Apply succeeds once. An intervening issue edit triggers stale comparison and requires a refreshed, reviewed application.
- [ ] Context stays fixed during execution. Ordinary later comments do not silently enter the running prompt. Explicit steering is recorded as queued, then delivered once on a new turn.

## Execution lifecycle and recovery

- [ ] Observe queued → preparing → working → completed, needs-input, failed and stopped states, summaries, expandable details, accurate checks and bounded activity.
- [ ] Needs input resumes only after an explicit answer. It resumes after idle container removal using the saved session/workspace; nearby chat does not resume it.
- [ ] Stop while a tool and child process run. Verify the process tree/container stops, output/files persist, and no later publication or stale callback restarts work.
- [ ] Close/cancel/delete an issue with queued, active, waiting and idle runs; containers stop, queued work stays canceled after reopening, historical successful results remain successful, and external PR/MR state is unchanged.
- [ ] Restart API/worker during preparation, execution and provider publication. Expired claims fail visibly without replaying a paid turn; cleanup retry blocks unsafe ownership transfer.
- [ ] Verify long-running work is not removed for idle timeout. Verify container idle cleanup after completion, with durable results still readable.
- [ ] Verify redaction, network restrictions and credential proxy restrictions from inside the real runtime. A replacement agent cannot reuse the prior proxy/session identity.

## Implementation — repeat for both Git providers

- [ ] Implement a small actual change, run available project checks, and create exactly one attributed commit/working branch/draft PR or MR with issue/run links.
- [ ] A no-change execution creates no empty request. Partial edits and failed/unavailable checks are reported honestly; draft state is retained.
- [ ] Continue on the existing workspace/branch/request; saved uncommitted files and dependency trees survive. Target-branch changes are made visible to the agent.
- [ ] Continue after marking ready: new changed code returns the request to draft before pushing, and verification results remain accurate.
- [ ] Mixed-repository execution displays independent success/failure, with no claim of atomic publication or merge.
- [ ] Reject concurrent writers, externally advanced/diverged working branches, removed authorization and changed credentials. Preserve recoverable local work.
- [ ] Inject lost push/create responses. Explicit publication-only retry reconciles the original branch/request, does not duplicate it, and performs no new model call. Ordinary retry still uses the original implementation request.

## Review drafts — repeat for both Git providers

- [ ] Review an explicit source branch without a PR/MR, against the configured target. Record fixed head/target/merge-base commits. Branch findings are editable/dismissible and remain local.
- [ ] A single linked request selects automatically; several offer the right picker. The separate read-only checkout matches the pinned provider head and does not stop or modify the writer's workspace.
- [ ] Findings contain useful file/line, explanation and optional fix; an empty review has a clear no-findings result.
- [ ] Edit, dismiss, restore, select, Publish selected and Publish all. Verify provider locations for added/deleted lines and renamed files. Unsupported/binary/truncated locations cannot be silently published.
- [ ] Move the source or target after review, close/merge the request, or edit a draft concurrently. Verify stale guards and useful recovery rather than misplaced or duplicated comments.
- [ ] Inject ambiguous publication; repeated reconciliation finds the original comment or remains uncertain, never sends it twice. Verify who may edit/publish another member's findings.

## Provider activity and discussions — repeat for both Git providers

- [ ] Card shows real draft/open/closed/merged state, source/target/head, check/pipeline/job statuses, commits, participants, reviewer decisions and unresolved discussions. Spinner ends when actual synchronization ends.
- [ ] Add/edit/remove provider notes, request/change/submit a review, update checks and push a commit. Webhooks update the card; a deliberately missed delivery recovers by polling.
- [ ] Duplicate/reordered deliveries and a delivery during synchronization do not duplicate notes or lose a newer refresh. Bad signatures/tokens are rejected without applying payload data.
- [ ] Write and edit a local reply; it remains local until Publish. Published text appears in the correct original provider thread under the integration identity, with the requester retained in Spectron's action history.
- [ ] Refresh/restart after publishing; the reply appears once. On lost response, Reconcile finds the sent note or stays uncertain without resending.
- [ ] Resolve and Reopen real inline threads in both directions, including an outside provider change. Unsupported thread operations and provider permission failures remain explicit.

## Feedback and handoffs

- [ ] Select several real notes, ask an idle agent to address them, and verify fixes/checks update the existing request. Addressed/unresolved outcomes correspond to the selection; missing outcomes are unresolved.
- [ ] Select notes while the same agent is working. They enter its next turn once, with queued/delivered state, and do not create a second writer.
- [ ] Asking another agent does not silently stop the writer. Use explicit Take over; observe old tools stop before the new writer starts.
- [ ] Verify unfinished code, installed repository dependencies, saved artifacts/notes and attachments survive the handoff. Verify a fresh model session/configuration/key, a useful handoff summary, and preserved contribution attribution.
- [ ] Simulate failed cleanup, worker restart during handoff, cancellation of the replacement, inaccessible replacement credentials and project/agent permission revocation. No overlapping writers or abandoned reservations.
- [ ] Run an independent review while implementation runs. It has its own read-only container and does not inherit writer authority.
- [ ] Proposed replies stay drafts; edit/publish explicitly. Fixes alone do not resolve external discussions. No background reviewer/fixer loop starts from incoming notes.

## Ready, merge, close — repeat for both Git providers

- [ ] Only owners manage merge grants. Ordinary members cannot merge through the shared integration token; explicitly granted current members can. Test grant revocation during a pending action.
- [ ] Mark ready and Close are explicit owner actions with visible confirmation/recovery and actor attribution. Active writers block state-changing actions until cleanup completes.
- [ ] Required checks pending/failing, required approval missing/withdrawn, unresolved required threads, conflicts and protected-branch restrictions disable or reject merge. Test provider-side permission denial too.
- [ ] Show commit A in confirmation, push commit B externally, then confirm. The action refuses to merge unseen B, refreshes, and requires a new deliberate action.
- [ ] Merge each provider-supported configured method and verify the exact submitted SHA, resulting provider state and local audit. No automatic/delayed merge is enabled.
- [ ] Inject a lost ready/resolve/close/merge response; reconcile safely. A slow superseded dispatch cannot issue a second write after retry.
- [ ] Merging/closing externally updates the card but does not close the Spectron issue. Closed/merged requests reject further implementation until the intended explicit recovery path is taken.

## Completion gate

- [ ] All required cases have live evidence for both Git providers and the complete AI model/effort matrix.
- [ ] No unresolved critical/major bugs, unexamined skipped tests, hidden uncertain writes or credentials in artifacts.
- [ ] UX refinement remains functional at the intended viewport sizes, with keyboard access to composer, review editing, replies, takeover and confirmation/recovery controls.
- [ ] Record final tested commit/worktree state, remaining deliberate v1 deferrals, and links to evidence in the spec's continuation notes.
