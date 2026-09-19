# Review drafts — Stage 5A

Implemented 2026-09-11. Stages 5B–5D remain separate work.

## Try it locally

App: `http://localhost:5187`; API/worker: `http://localhost:3105`. Migration `0024_agent_review_drafts.sql` is applied to the existing `spectron_ai_stage1_7e7d` development database. The previous worktree had been removed; its `.env` and saved workspaces were restored from `/Users/nikita/.codex/worktree-backups/spectron-7e7d-20260911` into the current worktree. The original backup remains intact. All three Git connection credentials and the AI credential decrypt successfully; existing sessions, projects, issues, and run history are preserved. No credential rotation or external write was performed during setup.

1. Open an issue with a linked PR/MR, choose an agent and `/review-code`, and enter review instructions. A single linked request is selected automatically; multiple requests require choosing one. The selection determines the repository. For an issue without a linked request, use `/implement` first. Standalone branch reviews and importing arbitrary external requests are not included in 5A.
2. The worker loads the current PR/MR and diff revisions, fetches its provider head ref, and verifies that checkout matches the recorded commit. The review runs in its own read-only container, independently of any active implementation workspace. A changed ref before checkout fails visibly and requires a new review.
3. Completed findings stay local. Each card shows path, line, old/new side, explanation, suggested fix if supplied, and status. Edit/Save, Dismiss, and Restore draft update local records. Publication is disabled while an editor has unsaved changes. A successful review with an explicit empty findings array displays “No actionable findings”; malformed structured results fail instead of implying a clean review.
4. Select findings and click **Publish selected**, or click **Publish all** for all current drafts. Dismissed, stale, or already published findings are excluded. The requester or a current project owner may edit/publish; other members can read. This authority is independent of the shared Git token and does not grant merge authority.
5. Published findings link to their provider comments. **Reconcile publication** checks an uncertain attempt for its original comment. It does not send another copy. Continue starts a new review against the current revision, retaining the original review and its publication history.

The internal browser was left on MKS-3 with Dev senior, `/review-code`, and the issue’s GitHub PR #1 selected. No new model request was submitted.

## Revision and publication behavior

- `agent_runs.review` stores the selected request and reviewed head. Private `context.reviewDiff` stores base/start/head revisions and diff patches. `agent_review_findings` stores immutable locations, editable text, version, state, publisher ID, remote ID/link, and publication errors. Findings are inserted transactionally with completed execution; a stopped or failed run cannot publish partial model prose.
- Structured findings are bounded to 100 per run, with 20,000 characters each for explanation and suggested fix. Only complete, verifiable added/deleted lines are publishable. Context-only locations, missing/binary/truncated patches, and invalid references stay visible as stale/unverifiable. Diffs exceeding 150,000 JSON characters fail clearly; existing model input budgets also apply.
- Provider metadata is read around diff loading to detect revision changes. Before **each** publication, the service reloads current metadata and diff. A changed head, base/start revision, source/target branch, closed/merged request, or unverified location marks the finding stale. It never guesses a new location or automatically carries a finding to another commit. A fresh review is required.
- GitHub uses inline review comments with `commit_id`, path, line, and side; renamed-file comments use the provider’s current diff filename even for the old side. GitLab uses MR discussions with base/start/head SHAs, old/new paths, and the applicable old/new line. These are explicit individual comments/discussions, not an approval or request-changes review event.
- Publication validates the whole selection before effects, then processes findings individually. Current project membership, requester/owner authority, open issue, repository settings, and connection revision are rechecked before the attempt. A durable state transition claims each finding before network I/O, preventing concurrent double sends. Editing uses optimistic versions and cannot race publication.
- Each attempt has a stable hidden marker and recorded publisher. If the response or local save is lost, the next explicit action searches paginated provider comments/discussions for that marker. A found comment becomes published. An absent/unverifiable response remains **uncertain** and is never blindly sent again, including after restart or a crash before dispatch. This conservative behavior can require checking the provider and writing a fresh finding/review manually if an attempt definitely never arrived. It favors avoiding duplicate remote comments over automatic retry availability.
- A provider revision can still change after the last check; the write carries the reviewed commit/diff SHAs, so it stays anchored to that revision or is rejected. An already-started remote request may finish after Stop/closure/access removal; subsequent writes recheck authorization. Published effects are recorded honestly.
- No incoming review synchronization, discussion replies/resolution, feedback fixing, handoff, merge actions, or autonomous monitoring are added in 5A.

Provider contracts were checked against [GitHub review comments](https://docs.github.com/en/rest/pulls/comments), [GitLab discussions](https://docs.gitlab.com/api/discussions/), and [GitLab merge request diffs](https://docs.gitlab.com/api/merge_requests/).

## Verification

- `pnpm test:agent-runs`: **32 passed**, three opt-in Docker tests skipped in the final default run. New tests cover both providers’ inline request contracts, renamed/deleted paths, incomplete diffs, fixed Git head-ref checkout using real temporary repositories, selection and cross-repository rejection, local-only results, editing versions, dismissal, owner/requester checks, concurrent and repeated publication, stale heads, uncertain/lost responses, zero findings, malformed output, and cancellation. Each provider’s service flow runs against an isolated PostgreSQL database.
- `TEST_AGENT_DOCKER=true pnpm test:agent-runs`: **34 passed** earlier in the session, including all three actual Docker/OpenCode tests. The subsequently added real Git review-ref test passed in the final default suite. These use deterministic local model fixtures, with no paid requests.
- `pnpm test:git`: **14 passed**.
- All workspace typechecks and production builds passed. The existing app bundle-size warning remains (approximately 622 kB), as do sandbox cache-write warnings from Turbo.
- Browser: verified `/review-code` and automatic selection of MKS-3’s linked PR in the actual issue composer; verified edit/save, disabled publication during editing, dismissal/restoration, selection, published links, and stale presentation in a temporary local component fixture. Fixture files and its tab were removed.
- Live review generation and new GitHub/GitLab inline comment writes remain **untested**. Existing credential decryption and browser session restoration were verified without exposing secrets. No external review comments or paid model calls were made.

Main files: shared agent-run contracts; `packages/backend/src/agent-runs/{reviews,service,worker,runtime,prompt}.ts`; `packages/backend/src/git/{reviews,provider}.ts`; run API routes; issue composer and `review-drafts.tsx`; migration `0024_agent_review_drafts.sql`; `packages/api/test/agent-reviews.test.ts`.

Next: user acceptance and PR review, then Stage 5B — activity and discussions, preserving publication IDs and deduplication markers when incoming synchronization is added.
