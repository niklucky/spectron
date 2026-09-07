# Yandex Tracker integration

## Implementation plan and scope

The integration builds on the Yandex Tracker v3 client from `spectron-prototype`, adapted to this repository's project permissions, issue model, migrations, and tRPC API. This checkout did not contain a Jira backend. Outbound operations target Yandex Tracker, as confirmed for this task.

1. Store one Tracker queue connection per project, with encrypted credentials and owner-only configuration.
2. Add project issue fields (Text, Date, Number, User), validated on every issue write.
3. Map remote statuses, priorities, users and fields to local project values. Fields can be ignored.
4. Import issues and comments, retain external identities, and update existing records on subsequent imports.
5. Push local issue creation/updates and comment creation/updates to Tracker; perform status changes through transitions.
6. Keep entity checkpoints for repeatability, concurrent sync exclusion, conflict reporting and explicit conflict resolution.

## Server setup

Apply migrations with `pnpm db:migrate`. Set `INTEGRATION_ENCRYPTION_KEY` in the API environment to a base64-encoded 32-byte key, generated with `openssl rand -base64 32`. The Compose API service forwards this variable. Keep the key stable and back it up alongside the database; changing it makes saved tokens unreadable.

OAuth tokens use AES-256-GCM with a random nonce. API responses never return stored tokens. Requests use the fixed `api.tracker.yandex.net` host, a 30-second timeout, and sanitized errors without remote response bodies or credentials.

## Project setup

Open **Project settings → Fields** to create optional issue fields. Each field belongs to its project. Its type is fixed after creation. Fill in values in the issue's **Issue** view. Text allows up to 10,000 characters, Number accepts finite decimals, Date requires a valid calendar date, and User must be a project member. Changes are included in issue history.

Open **Project settings → Integrations**:

1. Choose Yandex Cloud / Identity Hub or Yandex 360, enter the organization ID, queue key and OAuth token.
2. Save and test the connection to load Tracker statuses, priorities, global/local fields and users.
3. Map statuses to project states; every imported status needs a mapping. Map priorities and users as needed. Map additional Tracker fields to the project fields you created, or leave them ignored. Outbound mappings must be one-to-one.
4. Save the mappings. A blank token keeps the existing encrypted token. The organization and queue can be corrected before any records have synced. After sync, they are fixed to protect existing identities; use another project for another queue.
5. Use **Import issues and comments** or **Push local changes**. Both actions operate on the configured project and report per-issue failures. Successfully processed entities remain committed if a later entity fails.

Unmapped authors import as the owner running the import. Unmapped assignees import as unassigned. Users are matched only through explicit mappings, never by creating accounts or guessing identities from display names. Imported creation dates are preserved. Issue titles exceeding the local 140-character limit are reported for correction rather than silently truncated.

## Sync semantics

Sync is manual in this version; there are no webhooks, schedules or automatic remote writes when saving locally. Import fetches all queue issues in pages and each issue's comments using Tracker's comment cursor. Push processes local issues and comments that changed since their checkpoint, including unlinked local issues. Deleted issues/comments are skipped; deletion, attachment transfer, worklog transfer, parent relationships and historical event migration are outside this version.

Issue and comment identities are namespaced by integration. Comments also include the remote issue ID because comment IDs can repeat across issues. `externalId` is present on projects, users, states, priorities, fields, issues and comments; issues also have `externalKey`. User mappings are authoritative per integration; the optional user-level external ID is informational.

An import does not overwrite unsynced local edits. A push does not overwrite remote edits that happened after the checkpoint, and issue PATCH requests include Tracker's current version. Conflicts are reported. After reviewing them, the explicit **Resolve conflicts** checkbox lets the owner select the source of truth: import replaces local values with Tracker values, and push replaces Tracker values with local values. This choice applies to the run and resets afterwards.

A stable Tracker `unique` value identifies outbound issue creation, allowing a retry to recover a created issue through Tracker’s `_findByUnique` endpoint when its response was lost. Outbound comments contain a `<!-- spectron-comment:... -->` marker for the same recovery purpose; retain it when editing in Tracker. This is application-level recovery, not a distributed transaction. Checkpoints are saved before status transitions so unavailable transitions can be retried without creating another issue. A project has one active sync at a time across API processes; each service instance allows at most three syncs to reserve database connections for checkpoint writes.

Run sync with the settings dialog open. Large queues may exceed a deployment's HTTP request timeout; raise the proxy timeout if needed. After an interrupted request, retry once the active run has finished. Already committed identities are reused.

## Verification

- `pnpm typecheck`
- `pnpm --filter @spectron/app build`
- `pnpm test:integrations` (requires local PostgreSQL, or `TEST_DATABASE_URL`)
- Existing issue and comment regression suites

The integration tests use an isolated disposable PostgreSQL database and a fake Tracker API. They cover encrypted credential storage, permissions, field validation, import updates, external IDs, repeated syncs, issue/comment creation and updates, lost-response recovery, and conflicts. Browser checks cover the settings form, field creation and saving decimal field values. Live credentials are needed to validate the target organization's permissions and workflow-specific transition requirements.

The issue-recovery endpoint follows the [official Yandex Python client](https://github.com/yandex/yandex_tracker_client/blob/master/yandex_tracker_client/collections.py).

Protocol references: [issue creation](https://yandex.ru/support/tracker/en/api-ref/issues/create-issue), [issue updates and version checks](https://yandex.ru/support/tracker/en/api-ref/issues/patch-issue), [comment pagination](https://yandex.ru/support/tracker/en/api/issues/get-comments), and [status transitions](https://yandex.ru/support/tracker/en/api/issues/new-transition).
