# Git connections and project repositories — Stage 2

Implemented 2026-09-10. Open **Project settings → Integrations → GitHub or GitLab**.

## Setup and acceptance walkthrough

1. Apply migration `0020_git_connections.sql` with `pnpm db:migrate`. It adds `git_connections` and `git_repositories` separately from Tracker integrations. The migration was applied to the existing local development database, preserving the Stage 1 configuration.
2. Git credentials use `INTEGRATION_SECRET`, falling back to `BETTER_AUTH_SECRET` in the API server. This must be stable and at least 32 characters. Changing it requires restoring the old secret or replacing saved Git tokens; the same integration secret also protects Jira credentials. `AI_CREDENTIAL_SECRET` is unchanged.
3. As a project owner, add a named GitHub or self-hosted GitLab connection. GitHub uses `https://github.com`; GitLab accepts an HTTPS instance URL, optional port, and installation subpath. The provider and instance URL are immutable after creation.
4. Click **Check connection** to identify the token's provider user. A successful check establishes authenticated user access, not push/PR permissions. Expired tokens, missing permissions, redirects, and network/TLS failures produce readable errors.
5. Edit the explicit **Commit author name/email** to match the provider account. Checks prefill fields when the provider exposes them. GitHub often hides its email; enter an associated email or the account's provider-issued private commit email in that case. Spectron does not request additional email-list permissions or claim to verify ownership of an entered email. Git authentication alone does not set commit authorship.
6. Click **Select repositories**, browse the paginated list, and add repositories. The server re-fetches each repository and verifies its default branch before saving. Empty repositories without a default branch must be initialized on the provider first. Archived repositories can be selected for later read-only use; future writers must recheck their status.
7. Add more connections, including multiple GitLab instances and mixed providers. The **Project repositories** list includes all providers. Edit each target branch and select a project default. Changes verify the branch on the provider before saving.

## Token permissions and connectivity

- GitHub personal access tokens: repository Metadata read for discovery and Contents read for branch checks. Select the intended repositories when creating a fine-grained token; organization approval/SSO restrictions may apply. Later pushes and PR creation require Contents and Pull requests write permissions; Stage 2 does not test these writes. Classic-token access depends on its scopes and organization policy.
- GitLab personal access token associated with the intended user: `read_api` for this stage's user/project/branch reads. The later Git/merge-request workflow needs `api` access. No remote commits, comments, branches, PRs, or MRs are created in this stage.
- If a VPN replaces public DNS answers with proxy addresses (for example `198.18.0.0/15`), set `GIT_PROVIDER_DNS=cloudflare` and restart the API. This uses encrypted public DNS while retaining IP validation, address pinning, and TLS verification. Explicitly allowlisted private origins always use system DNS. The local development environment uses this option.
- Private-network GitLab requires the server administrator to set `GITLAB_ALLOWED_PRIVATE_ORIGINS`, a comma-separated list of exact HTTPS origins, for example `https://gitlab.internal.example,https://gitlab.internal.example:8443`. Use origins without trailing slashes or installation paths. Other private/loopback destinations are blocked. Do not add untrusted origins.
- The server must resolve and reach the instance and trust its certificate. For an internal CA, provision `NODE_EXTRA_CA_CERTS` and restart the server; TLS verification is never disabled. Public instances need no private-network allowlist.
- Requests pin a validated DNS address, retain the original TLS server name and Host header, reject redirects, time out after 20 seconds, and bound responses to 2 MiB. Tokens are sent only in authorization headers. Raw provider/transport errors are not returned or logged.

Official references checked during implementation:

- [GitHub authenticated repository listing](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user), [branch access](https://docs.github.com/en/rest/branches/branches#get-a-branch), [authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user). Adapter requests pin API version `2026-03-10`.
- [GitLab projects](https://docs.gitlab.com/api/projects/), [current user](https://docs.gitlab.com/api/users/#retrieve-the-current-user), [branches](https://docs.gitlab.com/api/branches/), [personal access token scopes](https://docs.gitlab.com/user/profile/personal_access_tokens/#personal-access-token-scopes).

## Persistence and authorization

- Connections belong to a Spectron project. Current project owners can create, edit, check, browse, and delete them. The creator is recorded; replacing a token records the replacing owner as its credential creator. Members invoke future work through the shared identity, not their own Git accounts.
- Tokens use versioned AES-256-GCM ciphertext authenticated against the project, connection, creator, provider, and instance. Tokens never appear in API metadata or clone URLs. Repo URLs are constructed from the validated instance/repository path, ignoring provider-supplied clone URLs that may contain credentials.
- Replacement resets the verified actor, check state, and commit author configuration. Existing repository associations remain, but subsequent remote operations use the replacement token and must verify access again. A failed check clears the verified actor. A rename or explicit author edit preserves the saved token.
- Connection and repository revisions reject stale changes. All project configuration writes serialize through project/membership locks. Operations that perform remote reads recheck ownership and relevant revisions before committing, so token replacement or owner revocation cannot authorize a delayed save.
- Repository IDs are provider-stable IDs, checked against freshly fetched metadata. Each selected repository belongs to exactly one project connection. A composite foreign key prevents cross-project connection assignment; the service also rejects duplicate repositories across connections to the same provider instance.
- The first repository becomes the project default. A partial unique index enforces at most one default; transactional add/remove/update logic ensures a nonempty project retains one. Removing the default promotes the oldest remaining repository. A connection cannot be deleted while repositories reference it.
- `git.repositories` returns selected, credential-free metadata to current members of an active project. Owners alone can browse the provider's unselected repository catalog or read/edit connection configuration. Unrelated/removed members and archived projects fail access checks.
- Backend `authorizeRepositories(userId, projectId, ids)` is the selection boundary for the future composer/runner. It rejects empty, duplicate, unknown, or cross-project selections. It validates current local access, not remote permissions; the runner must revalidate the latter when execution starts.

## Provider boundary and next stage

`packages/backend/src/git/provider.ts` defines `GitAdapter` and its factory: actor discovery, repository pages, repository-by-identity checks, and branch verification. HTTPS transport and credential encryption are separate modules. `service.ts` owns authorization and persistence. Browser contracts live in `packages/shared/src/git.ts`; tRPC procedures live under `git`.

Extend this adapter for branch/PR/MR writes and synchronization in the appropriate stages. There are no placeholder remote-write methods. Stage 3 must add a server-only runner credential/configuration boundary, recheck selected repo access, snapshot connection actor and explicit commit authorship, reject missing author fields for writable work, and supply temporary credentials independently of displayed clone URLs. Do not trust a historical successful check as authorization to clone or push.

Next: **Stage 3 — Chat invocation, context, and basic execution** in `ai-agents-v1-spec.md`. Containers, agent invocation, actual commits/contribution notes, PR/MR creation, reviews, synchronization, and merging remain deferred to their specified stages.

## Verification and limits

- Focused tests: `pnpm test:git` — 12 passing tests. Coverage includes encryption/binding, private-network rejection, safe URLs/refs, provider headers/pagination/metadata, authentication and CSRF, owner-only edits, mixed providers, duplicate/cross-project selection, composite FK enforcement, branch validation, defaults under concurrent edits/removal, stale revisions, expired credentials, replacement during checks, owner revocation during a provider request, and membership/archive revocation.
- Regression run: 36 passing Git, AI, Tracker, and Jira tests against newly created isolated PostgreSQL databases. Migration application is repeated in the Git test; fresh database creation and the local Stage 1 → Stage 2 upgrade both succeeded.
- Workspace typechecks and both production builds passed. Vite retains the existing warning about the main app bundle exceeding 500 kB.
- Internal-browser checks: actual project integration navigation and both provider forms; a temporary fixture using the real Git settings component verified whitespace validation, connection creation, failed/passed checks, identity display, multi-repository selection, author editing, branch/default changes, and default reassignment after removal. The fixture mocked provider interactions, never used real tokens, and was removed afterward.
- Initial implementation used mocked providers. During the DNS follow-up, saved connection identity checks passed against GitHub and both configured self-hosted GitLab instances using encrypted public DNS and verified TLS. Repository selection/clone/push permissions are not established by these identity checks; remote write operations remain outside this stage.

Key files: `packages/backend/src/git/*`, `packages/shared/src/git.ts`, `packages/db/src/schema.ts`, `packages/db/migrations/0020_git_connections.sql`, `packages/api/src/trpc/router.ts`, `packages/api/test/git.test.ts`, `apps/app/src/git-settings.tsx`, and the existing project integration overview/settings components.

- Follow-up: diagnosed local VPN DNS substitution affecting both GitHub and GitLab, added `GIT_PROVIDER_DNS`, reused the existing encrypted DNS resolver, and made address-policy errors provider-specific. Live identity checks passed for all three saved connections. Git plus project-logo regressions: 18 tests passed; workspace typechecks passed.

- User acceptance: confirmed Git is connected after the DNS fix.
