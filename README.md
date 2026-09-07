# Spectron

An open source workspace for development teams, designed for self-hosting.

The planned scope includes tasks, AI agents, Jira and Yandex Tracker, GitHub issues/actions/pull requests, self-hosted GitLab, chats, and calls. These are product directions, not implemented features.

## Repository structure

```text
apps/
  app/          Main web application; current focus
  web/          Public single-page website
  desktop/      Reserved for Electron or Tauri
  mobile/       Reserved for React Native
packages/
  frontend/     Shared UI, features, and design tokens
  backend/      Business logic and integration services
  api/          REST and tRPC transport boundary
  db/           Database access, schema, and migrations
  shared/       Environment-independent types and utilities
```

## Boundaries

Web applications consume `frontend` and `shared`. `frontend` must remain independent of server code. Future API clients should expose browser-safe contracts without importing server implementations.

Server routes in `api` call business logic in `backend`; `backend` uses `db` for persistence. `shared` must not depend on apps, browser APIs, server runtimes, or database clients.

Desktop and mobile are placeholders. Shared web components are not assumed to work in React Native.

## Development

Use Node.js 24 and pnpm 9.15.0 (the version pinned in `package.json`).

```sh
pnpm install
cp .env.example .env
# Set BETTER_AUTH_SECRET in .env using: openssl rand -base64 32
pnpm compose:up
pnpm db:migrate
pnpm dev
```

`compose:up` starts Postgres 17 Alpine and waits for it to be healthy. `compose:down` stops it and preserves the database volume. Local Postgres uses `127.0.0.1:5442` to avoid an existing database on 5432; change `POSTGRES_PORT` and `DATABASE_URL` together if needed.

The main app uses the port from `APP_URL` (default http://localhost:5173), the API listens on 127.0.0.1:3001, and the public page uses http://localhost:5174. Open the exact `APP_URL`: auth validates the origin, including hostname and port. The current local preview can use `APP_URL=http://127.0.0.1:5175`.

`pnpm dev` starts all three services. Alternatively run `pnpm dev:api` and `pnpm dev:app` in separate terminals. `pnpm dev:web` runs just the public page. The API and migration runner load the root `.env`; shell environment variables take precedence. Resend and database credentials stay on the server.

```sh
pnpm db:generate  # Generate a migration after editing the schema
pnpm db:migrate   # Apply committed migrations
pnpm typecheck
pnpm build
pnpm test:auth
pnpm test:projects
pnpm test:issues
pnpm test:files
pnpm test:comments
pnpm test:files:nginx  # Requires Docker
```

Auth tests create and drop a disposable database on local Postgres, send no real emails, and leave application data alone. To use another development Postgres, set `TEST_DATABASE_URL` to a connection whose role can create databases. Tests cover registration, login, profile persistence, sign-out, origin checks, password resets, token expiry/concurrent reuse, session revocation, and persistent rate limits.

Both web apps use React and Vite. pnpm manages workspaces; Turborepo schedules tasks. Internal packages export TypeScript source. The Node API uses Hono, Better Auth, and Drizzle with `pg`.

## Authentication

Registration signs the user in immediately. Login sessions are stored in Postgres and carried by HttpOnly, SameSite cookies; HTTPS uses Secure cookies. Passwords use Better Auth’s scrypt hashing with a 12–128 character policy. Reset links expire after 30 minutes, are single-use, and revoke all sessions when redeemed. Reset identifiers are hashed in the database. Rate limits are stored in Postgres, including stricter limits on login, registration, and password reset requests.

Add `RESEND_API_KEY` and `EMAIL_FROM` in `.env`, then restart the API to enable reset emails. The sender must belong to a [verified Resend domain](https://resend.com/docs/send-with-nodejs). Without email configuration, registration and login work; reset email delivery failures are reported in server logs. Reset requests always show the same public response whether the email exists or delivery fails. Tokens and provider response bodies are not logged.

The current flow uses [Better Auth email/password authentication](https://better-auth.com/docs/authentication/email-password). Registration is open and does not require email verification yet. Team invitations, permissions, and provider logins can be added later. Issues now persist in Postgres. Files and reusable issue attachments also persist. Threaded comments, mentions and comment attachments are implemented; manual human worklogs are implemented.

| Method | Endpoint                           | Purpose                                           |
| ------ | ---------------------------------- | ------------------------------------------------- |
| POST   | `/api/auth/sign-up/email`          | Register: `name`, `email`, `password`             |
| POST   | `/api/auth/sign-in/email`          | Login: `email`, `password`                        |
| POST   | `/api/auth/sign-out`               | Revoke the current session                        |
| GET    | `/api/auth/get-session`            | Get current session, or `null`                    |
| GET    | `/api/me`                          | Authenticated user; returns 401 without a session |
| POST   | `/api/auth/update-user`            | Update profile: `name`                            |
| POST   | `/api/auth/request-password-reset` | Send reset email: `email`, `redirectTo`           |
| GET    | `/api/auth/reset-password/:token`  | Validate email link and redirect to the form      |
| POST   | `/api/auth/reset-password`         | Set password: `token`, `newPassword`              |

POST JSON with `Content-Type: application/json` and the app’s `Origin`. Browser clients send cookies with same-origin requests. `redirectTo` should be `${APP_URL}/reset-password`. The React client is browser-only; server auth code stays in `backend`, HTTP routing in `api`, and schema/migrations in `db`.

## Projects

Projects and project memberships persist in Postgres. Each project has a string ID, name, issue prefix, optional website URL and logo, and timestamps. The creator becomes an owner in the same transaction. Owners and members can read projects; only owners can update them. Project names and prefixes may repeat across projects because IDs, rather than names, identify them.

The authenticated tRPC API lives at `/api/trpc`:

| Procedure         | Type     | Input                                        |
| ----------------- | -------- | -------------------------------------------- |
| `projects.list`   | Query    | None; lists the current user's memberships   |
| `projects.get`    | Query    | `{ id }`                                     |
| `projects.create` | Mutation | `{ name, key, url?, logo? }`                 |
| `projects.update` | Mutation | `{ id, name, key, url?, logo? }`; owner only |

Names are trimmed and limited to 80 characters. Issue prefixes are normalized to uppercase and accept 2–10 letters/numbers, starting with a letter. Colors are `blue`, `slate`, or `sand`. Mutations require an exact `Origin` match with `APP_URL`. Membership checks use the authenticated session; callers cannot select an acting user or assign themselves ownership.

The app loads projects after login and refreshes them when the window regains focus. Accounts without memberships see a skippable first-project modal. Skipping is remembered in browser session storage for the current login session; it creates no project or membership. "New project" remains in the sidebar. Invitations are a later feature; projects joined through memberships already appear in the same list.

The project form discovers logos from HTML icon links (including Apple touch icons) and falls back to `/favicon.ico`. `projects.discoverLogo` is an authenticated mutation accepting `{ url }` and returning `{ logo: string | null }`. Users can upload an image instead or remove the suggested icon. Uploads take priority over pending lookups. PNG, JPEG, WebP, GIF, SVG and ICO are supported, up to 2 MB and 16 million pixels; the backend converts logos to static PNGs up to 128×128 and stores them in Postgres. No upload volume is needed.

Website downloads allow only public HTTP(S) addresses on ports 80/443, validate each redirect, pin DNS, and limit response size and duration. For private sites, upload a logo. DNS defaults to the system resolver. If a VPN returns synthetic proxy addresses, `PROJECT_LOGO_DNS=cloudflare` opts into sending website hostnames to Cloudflare’s encrypted DNS instead; private addresses remain blocked.

New projects start with empty task lists. Issue creation, editing, grouping, soft deletion, and history persist in Postgres. Project links use `#project/<project-id>` and survive reloads; Flow uses `#flow`. The old mock project/task list is no longer used.

`pnpm test:projects` uses a disposable database to test creation, transaction rollback, isolation, member/owner permissions, validation, origin checks, session revocation, and persistence. Browser code imports only the tRPC router type from `@spectron/api/router`; server implementations are not bundled into the UI.

## Docker

`compose.local.yml` runs just local development infrastructure. `compose.yaml` runs the complete stack: Postgres, a one-off migration service, API, app, and public web page.

For deployment, set a strong `POSTGRES_PASSWORD`, a generated `BETTER_AUTH_SECRET`, the public HTTPS `APP_URL`, and Resend settings in `.env`, then:

```sh
docker compose up --build -d
```

Put a TLS reverse proxy in front of the app on port 8080. The public page is on 8081. Production auth requires HTTPS. The app’s Nginx forwards `/api` to the private API container; neither the API nor Postgres publishes a host port. Migrations must succeed before the API starts. Database volumes persist across `down`.

`TRUST_PROXY=true` is set only for this private API deployment, where Nginx overwrites `X-Real-IP`. Do not enable it on a directly exposed API. With an additional TLS proxy, configure Nginx’s real-IP module for that proxy’s specific addresses to retain per-client rate limits; otherwise clients share that proxy’s quota. In local development the API uses the socket address.

## Next steps

Worklog totals, comment notifications, broader team permissions, integrations, and agent execution remain to be implemented.

An open source license still needs to be selected before public distribution.

### Project settings and invitations

Each sidebar project has an options menu for Settings and Archive. Settings reuses the creation form under General, with a Members section for email invitations, team members, and invitation history. Owners can edit, invite, cancel pending invitations, and archive. Members can view the project and its member list. More granular permissions are deferred.

Archiving sets `projects.state = archived`, keeps the project and memberships, removes it from active navigation and Flow, and cancels pending invitations. Archived projects remain available through the project API; restoration UI is not implemented yet.

Invitations are delivered using the existing `RESEND_API_KEY` and `EMAIL_FROM`. Links use `APP_URL`; set it to a reachable public HTTPS origin when inviting people from other devices (the local development URL only works on this machine). Tokens expire after seven days, are stored hashed, and require a signed-in account with the matching invited email. The invitation survives switching between login and registration. Acceptance is explicit and transactional; retries do not duplicate membership. Delivery failures appear in invitation history and can be retried by creating a fresh invitation. Duplicate pending invitations are rejected; up to 50 invitations per project per hour are allowed.

Additional authenticated tRPC procedures:

| Procedure                   | Type                     | Input                              |
| --------------------------- | ------------------------ | ---------------------------------- |
| `projects.archive`          | Mutation                 | `{ id }`                           |
| `projects.members`          | Query                    | `{ id }`                           |
| `projects.invitations`      | Query                    | `{ id }`; owner only               |
| `projects.invite`           | Mutation                 | `{ id, email }`; owner only        |
| `projects.cancelInvitation` | Mutation                 | `{ id, invitationId }`; owner only |
| `invitations.preview`       | Mutation (read via POST) | `{ token }`; recipient only        |
| `invitations.accept`        | Mutation                 | `{ token }`; recipient only        |

Invitation tokens are carried in the email link fragment and sent to the API in POST bodies, keeping them out of ordinary URL access logs. Tests capture email delivery without contacting Resend and cover acceptance, wrong accounts, cancellation, expiry, duplicates, failures, archive, and concurrent requests.

### Application IDs

New application-owned records use 21-character, URL-safe NanoIDs generated by `createId` from `@spectron/shared`. Projects and invitations store IDs and their references as text. Existing UUID values are retained so project links and invitation references continue to work; the API accepts both formats. Authentication IDs remain managed by Better Auth. Direct SQL inserts must supply an ID; Drizzle inserts generate it automatically.

Issues use a separate integer number unique within their project (for example, `SP-42` and `MKS-42`). Future integrations will store provider IDs as strings in mapping records.

## Issues — first implementation slice

Issues persist with a NanoID, project, optional parent, per-project number, title, plain-text description, author, optional assignee, state, optional priority, and creation/update/deletion timestamps. The display key is derived from the immutable project prefix and number. Prefixes are locked after project creation. Numbers are allocated under a project row lock and never reused, including after deletion. UUID/NanoID project routes remain supported; issue links use their permanent NanoID. A project-scoped display key also resolves in the issue route.

All project members can create/edit issues, read full history, and soft-delete/restore issues. Archived projects remain readable through the API but reject mutations. Assignees must belong to the project when assigned. Parenting is limited to the same project, rejects cycles, and never cascades state changes or deletion. A parent with non-deleted children cannot be deleted. Restore a deleted parent before restoring its children.

Project settings has States and Priorities sections. Owners can add, rename, reorder (using position), color, and soft-delete options. States map to Opened, In progress, Blocked, Cancelled, or Finished; no automation runs. Exactly one active Opened state is the default. Canonical mappings are fixed after state creation for this slice. Deleted options remain on existing issues, but cannot be newly assigned. Every project receives initial states and priorities; migration `0005` backfills existing projects.

Issue history is append-only and written in the same transaction as each create/update/delete/restore. It records the actor and old/new field values. All project members can read it, including deleted issue history. Database triggers reject history updates/deletes. Configuration changes are recorded separately in `project_history`. Editors send the last-seen `updated_at` and receive a conflict instead of overwriting newer changes.

The UI replaces temporary task creation with persisted issues. Use Edit issue for title, description, state, priority, assignee and parent. Child issues link back into the same panel. The Deleted tasks filter exposes soft-deleted issues and their Restore issue action. Files are available in the issue panel. Threaded comments use a persistent composer below attachments. Old in-memory tasks were never saved and cannot survive reloads.

| tRPC procedure | Purpose |
| --- | --- |
| `issues.list` | All issues in a member project, including deleted records |
| `issues.settings` | Project states/priorities, including retained deleted options |
| `issues.create` | Create with title and optional issue fields |
| `issues.update` | Update fields with `expectedUpdatedAt` |
| `issues.setDeleted` | Soft-delete or restore with `expectedUpdatedAt` |
| `issues.history` | Read chronological history in pages of 100 (`offset`) |
| `issues.saveOption` | Owner-only state/priority create or update |
| `issues.deleteOption` | Owner-only soft deletion of state/priority |

All procedures take `projectId`; issue mutations/history also take `id`. Mutations require the app origin. List loading currently fetches each accessible active project's issues in full; pagination of issue lists is a future scaling improvement.

Run `pnpm test:issues` for disposable-database tests of concurrent numbering, access isolation, invalid references, cycles, history rollback/immutability, stale writes, deletion/restoration, workflow configuration, prefix locking, and archive behavior. `pnpm test:projects` covers existing project/invitation behavior and UUID-to-text migration compatibility.

See [the agreed design](docs/issues-design.md) for the remaining slices. Stop after each slice for manual testing.

## Files and reusable issue attachments

Project members can upload files, attach existing project files, and reuse files from another accessible project. Cross-project reuse creates an association that gives the destination project's members access. Removing an attachment only soft-deletes that issue's link; other attachments and stored bytes remain. Attachment changes record the actor and file in issue history without changing the issue field-edit timestamp. Archived projects and deleted issues reject attachment changes.

The issue panel supports image, audio and video previews for supported formats, and downloads for other files. Uploads default to 50 MiB (`FILES_MAX_BYTES`), enforced while streaming. The server detects content type from bytes; unknown formats are served as downloads. Original filenames are retained separately from immutable storage keys. Upload and attachment linking are separate operations: a successful upload remains reusable if linking fails. The library supports filename search, pagination, and current-project or all-accessible-project views.

Development stores files in `data/files` at the repository root, overridable with `FILES_ROOT`. The API serves authenticated downloads directly with range requests for media and private cache revalidation. Docker uses `/data/files/{yyyy-mm-dd}/{file_id}.ext`: the API authorizes each request and delegates delivery to Nginx through an internal `X-Accel-Redirect` location. Direct access to that location is blocked. Nginx mounts the same host directory read-only.

Before starting the full Docker stack, provision `FILES_HOST_PATH` (default `./data/files`) for the API's configured `FILES_UID`/`FILES_GID` (both default to 1000). For the defaults on Linux:

```sh
mkdir -p data/files
sudo chown 1000:1000 data/files
```

Set different IDs to match the host directory owner when needed. Back up both Postgres and the host file directory. Failed, abandoned and detached uploads are retained; there is no automatic byte cleanup. Global file deletion and project-library removal are not exposed in this slice. Comments can reuse these same files.

`POST /api/files/upload?projectId=...&filename=...` accepts raw file bytes with the session cookie and exact app Origin. `GET`/`HEAD /api/files/:projectId/:projectFileId` authorize downloads; `?download=1` requests a download. The authenticated tRPC `files` router provides `limits`, `library`, `attachments`, `link`, and `unlink`.

`pnpm test:files` covers upload validation, membership isolation, reuse, soft removal, history rollback, range requests and cache authorization with disposable data. `pnpm test:files:nginx` verifies the production Nginx configuration in a disposable Docker container with a controlled upstream, including internal-only delivery, ranges and caching.

## Threaded comments and mentions

Each issue supports a tree of user comments. Write a comment, reply at any depth, or post files without text. Root comments and each expanded reply level load in chronological pages of 20; indentation is capped for readability. Use Refresh comments to see changes from other users. Comments remain readable on deleted issues and archived projects, which reject further writes.

Type `@` and choose a project member to create a structured mention. Names are labels; the saved user ID identifies the mention even when names repeat. Editing inside a mention turns that edited text into ordinary text; select the member again to mention them. The server derives one active mention relation per user and retains removed relations with `deleted_at`. Mention notifications are deferred.

Authors can edit or soft-delete their own comments; project owners can soft-delete others' comments for moderation. A deleted parent remains as a placeholder with its replies. Original content, attachment references and actors remain in history. Restoration UI is deferred. Editors retain the version they opened and reject stale saves; cancel and reopen the editor after a conflict.

The composer supports up to 20 uploads or reused files and 100,000 text characters. Uploads retain the existing per-file size limit. Posting/editing atomically saves the comment body, mentions, attachment links and history. Cancelling after uploading leaves reusable project files. Cross-project reuse checks membership in both projects before granting the destination project access.

The authenticated `comments` tRPC router provides `list` (issue, parent, optional cursor), `create`, `update`, and `delete`. All procedures require project and issue IDs; writes require the app Origin. Updates/deletion require the last-seen comment timestamp. No caller can change a comment's author or parent. Migration `0007` adds comments, mentions and comment attachments with same-issue/same-project foreign keys.

Run `pnpm test:comments` for authorization, tree and pagination constraints, structured mention edits, attachment reuse, audit rollback, soft deletion and stale-write checks. Manual human worklogs follow below.

## Human worklogs

Use Log work in the issue panel to record a project member's work, start time, duration in one flexible text input, and optional description. Times are entered/displayed in the browser's local timezone and stored as instants. Overlapping entries are allowed. The recorder is taken from the session and remains unchanged when another member edits the entry.

All project members can add, edit, soft-delete and restore worklogs for now. New workers must belong to the project; existing former workers remain on their entries. Deleted entries appear with Show deleted entries. Archived projects and deleted issues retain readable worklogs but reject changes. Stale edits fail instead of overwriting newer values. Every mutation writes the actor and old/new values to issue history transactionally.

Migration `0008` adds `issue_worklogs`; the authenticated `worklogs` router provides `list`, `create`, `update`, and `setDeleted`. Lists use cursor pages of 20. Durations are positive integer seconds (up to PostgreSQL's integer limit); descriptions allow 10,000 characters. Run `pnpm test:worklogs` for persistence, access, attribution, concurrency, rollback, deletion/restoration, and pagination checks.

Delivery order: human entries, totals, then an additional chat view that preserves the existing issue view. Pause for manual testing after each step. Agents and timers are deferred. Jira and Yandex.Tracker integrations belong to a new session.

Human duration input reads numeric groups: one means minutes, two mean hours/minutes, three mean days/hours/minutes (24-hour days). Separators are ignored, so `1h 35m`, `1h30m`, and `1n20m` work. `30` means 30 minutes; `1h` also means one minute under this positional convention—use `1h0m` for one hour. Human entry has no seconds field; storage remains seconds for compatibility, and editing other fields preserves existing durations.

## Chat and Issue views

The issue header offers **Chat | Issue**. Issue retains the existing details, attachments, worklogs, threaded comments and history. Chat presents the same data as a conversation and chronological activity messages; it creates no duplicate comment or worklog records. Switching views preserves open drafts for the current issue and remembers the selection for the browser session. A new session defaults to Chat.

Chat includes a current issue summary, issue changes, editable comment cards, reply previews, file previews/downloads, and worklog events. Deleted comments remain placeholders; their original content remains in audit messages, as in Issue history. Comment cards show current content once at creation; edits/deletion appear as separate events. Use Files for issue attachments, Log work for a manual entry, and Edit issue to open the existing editor. The new worklog duration field starts empty.

The `issues.activity` query checks project membership and returns the newest 50 events in chronological order, with an opaque history-ID cursor for older pages. Its boundary uses the stored database timestamp to retain sub-millisecond precision and stable ordering. Refresh chat loads new activity; no realtime push or notifications are implemented yet. Run `pnpm test:activity` for access isolation, reply/file hydration, deletion behavior and pagination during concurrent inserts.

Worklog totals remain pending. Agents and tracker integrations remain deferred; Jira and Yandex.Tracker will be handled in a new session.

### Jira Cloud and project fields

Project menu → **Settings → Fields** creates Text, Date, Number and User fields. All issues in that project can use those fields; edit their values in the issue details. Field types are immutable, numeric/date values are validated, and User values must reference project members or imported identities belonging to that project.

Issues also have optional built-in `estimate_time`, `start_at` and `finish_at` columns (API: `estimateTime`, `startAt`, `finishAt`). The issue editor accepts estimates in minutes; storage and numeric Jira mappings use whole seconds. Start and finish are timestamps displayed and edited in UTC. Finish cannot precede start. Changes appear in issue history.

Jira field mapping targets include **Estimate time (built-in)**, **Start at (built-in)** and **Finish at / deadline (built-in)** alongside project fields. For example, map Original estimate to Estimate time, Due date to Finish at / deadline, and a Jira start date field to Start at. Date-only imports use midnight UTC; date-only exports use the UTC calendar date. Standard Jira original estimates are published through `timetracking.originalEstimate` in minutes and must contain whole minutes. Clearing a mapped value also clears it on the other side during sync. Unmapped fields remain untouched.

Project owners connect Jira under **Settings → Integrations**:

1. Enter the `https://your-team.atlassian.net` site, project key, account email and an **unscoped API token**. Test the connection to load Jira options, choose the default issue type, and save.
2. Load mappings. Jira statuses with the same name as an active local status are selected automatically, ignoring capitalization and surrounding whitespace. Existing choices are preserved; ambiguous names are left for manual selection. Review differences and save mappings. Optionally link Jira users to project members and map priorities to existing local options. Create local fields in the Fields tab, then map Jira fields to them; leave unsupported or unwanted fields ignored. Save mappings before importing. Missing users, including historical authors, are created automatically in `external_identities`; they have no login, fake email or membership. The External users section lets an owner link or unlink an identity to an existing project member, updating displayed attribution without moving or duplicating records.
3. **Full import** imports project statuses/priorities, then issues with mapped fields, comments, worklogs and downloaded attachments. Progress and individual errors are shown. A retry upserts external IDs and preserves local issue prefixes/numbers. Stop sends a persistent cancellation request to the server, aborts in-flight Jira requests and checks cancellation between committed entities. Completed work remains saved, and an interrupted issue can be retried. `Last issue imported` records the latest successful issue, not completion of the entire project.
4. Use **Create in Jira / Update Jira issue** on an issue, or **Send comment to Jira** on a comment. These owner-only actions are explicit; local editing does not automatically publish. Jira workflow transitions enforce status changes. Remote comments are written using the connected Jira account and its permissions.

**Automatic import** in Jira Settings can be disabled (the default) or run every 15 minutes, hour, or day. The API server checks due schedules every 30 seconds, so the browser can be closed. The first run is one interval after saving. The first scheduled import scans the project; subsequent runs query `updated >= scheduled_import_watermark - 5 minutes` in `updated ASC` order using saved mappings. The durable watermark advances to the run's start time only after all pages and issues succeed, including an empty result. Errors, conflicts, cancellation and interrupted runs preserve it for retry. The overlap accommodates short indexing delays; it is not a guarantee against arbitrary Jira indexing delays. Numeric epoch timestamps avoid Jira account time-zone differences ([JQL date fields](https://support.atlassian.com/jira-service-management-cloud/docs/jql-fields/)). Full import in Settings always scans all issues and does not change this watermark. Conflict checks preserve unsent edits. Settings shows the next run and latest result, including up to three issue errors. Stop import cancels the active run; disabling the schedule prevents future runs. Each run rechecks the enabling owner's access. Database leases prevent overlapping scheduled runs across API processes and allow recovery of interrupted runs after the lease expires. The API server must be running; missed intervals are coalesced into one run.

Credentials are AES-256-GCM encrypted and never returned to the browser. The API uses `INTEGRATION_SECRET`, falling back to `BETTER_AUTH_SECRET`; keep the chosen secret stable. A connection's Jira site/project cannot be changed after saving, so external IDs cannot be accidentally rebound to another project. External entity records are scoped to the connection; nullable `externalId` columns expose the linked IDs, and issues also have `externalKey`.

Sync snapshots protect edits on both sides. Import preserves unsent local edits when Jira is unchanged, and reports a conflict if both changed. Explicit conflict actions let an owner replace local values with Jira values or replace Jira values with local values. No remote deletions are propagated. If a create loses its response, blind retry is blocked: load mappings to see pending creates and link the actual Jira issue/comment ID. If nothing was created remotely, an owner can create the corresponding entity in Jira and link it. Known validation/auth/rate-limit rejections can be retried normally. Partial field/transition failures are reported and retained for retry.

Initial limits: plain-text conversion of Jira rich text (unchanged rich text is not rewritten); no remote attachment upload, worklog export, parent/subtask mapping, webhooks. Unsupported custom field shapes and Jira values exceeding Spectron's limits produce visible import errors. Attachments use the configured file size limit. Imports are incremental commits, so an issue can be partially imported when a later child entity fails.

Run `pnpm db:migrate` before starting the updated API. `pnpm test:jira` uses mocked Jira responses and an isolated temporary PostgreSQL database (same `TEST_DATABASE_URL` convention as the existing tests). Live Jira credentials are not needed for tests.

The client is adapted from `../spectron-prototype/packages/api/src/integrations/handlers/jira/client.ts`, using Jira's [enhanced issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/), [comments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/), and [attachment content API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/).

### Issue list and quick creation

Issue rows show a key badge, a single-line title and description, the latest activity date, and the actor and update preview. Dates use local time today, “yesterday”, a weekday within the last seven days, and DD.MM.YYYY for older activity.

Use **Filter issues** to select multiple shared triggers or project-specific states. Selected values are combined with OR; Flow groups states by project. Filters are saved in this browser per account and per project/Flow view, and survive reload. **Only deleted issues** switches the list to deleted records.

**New task** opens an inline chat composer. Send a first message to create the issue, then continue in Chat. Its first nonempty line becomes the plain-text title (up to 140 characters); longer or formatted messages are preserved in full in the description. The composer previews typed Markdown (bold, italic, lists and inline code) without a formatting toolbar. Use Shift+Enter for new lines. In Flow, choose the destination project in the composer.

The composer microphone dictates text using browser speech recognition, with English/Russian language selection, editable final transcripts, listening feedback, and stop/error handling. It starts only on a microphone-button click and stops when leaving the composer. Speech recognition support and processing depend on the browser; unsupported browsers display a fallback message.

Add files to a new issue with the circular plus button or drag them onto the composer. Pending files can be removed before sending. Send uploads them using the configured file-size limit, then creates the issue and its attachments atomically (up to 20 files). Successfully uploaded files are reused on retry and remain in the project file library if creation is cancelled. A files-only message uses the first filename as its title.
