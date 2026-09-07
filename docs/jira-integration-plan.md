# Jira Cloud integration

## Scope and sequence

1. Project-owned Text, Date, Number and User fields, with typed issue values.
2. One Jira Cloud connection per project. Owner-only encrypted credentials, connection test, metadata discovery and mapping. Keep the connection's site/project immutable once linked.
3. Explicit paginated import; upsert by external ID, preserve local keys and original authors/timestamps, download attachments through Spectron storage. Import statuses/priorities automatically unless mapped; create external identities without authentication accounts or membership; allow optional links to local users.
4. Explicit issue/comment publishing. Translate status changes via Jira transitions. Protect local/remote edits with sync snapshots and surface partial failures. Never automatically retry an ambiguous create.
5. Tests with mocked Jira and isolated PostgreSQL; typecheck and application build.

## Initial behavior

- Import is run from Settings, one issue per request, with progress and per-issue errors. Re-running imports safely refreshes previously imported entities.
- Publishing is explicit from an issue. Comments are sent separately, preserving user intent.
- Optional server-side imports every 15 minutes, hour or day, disabled by default; durable claims, cancellation, results, and crash recovery. Both manual and scheduled imports use `updated ASC` ordering. Scheduled runs retain a successful run-start watermark with a five-minute overlap; failures and cancellation do not advance it. Settings retains an unfiltered Full import.
- No webhooks, remote deletion, attachment upload, or worklog export in this iteration.
- Jira rich text is converted to plain text; unchanged descriptions/comments are not rewritten.
- Unmapped users import automatically into `external_identities`; authors, assignees, comments, worklogs, file uploaders and User field values retain references. Optional mappings resolve identities to real users without granting membership.
- Import runs have durable cancellation tokens; Stop aborts active Jira fetches and prevents subsequent entity commits. A cancelled run cannot continue, and retries use fresh run IDs.
- Conflicts stop the affected entity rather than silently overwriting unsent edits.
- A create whose outcome is unknown stays blocked until an owner reconciles its remote ID/key.

## Reuse

Adapt `spectron-prototype/packages/api/src/integrations/handlers/jira/client.ts`; retain enhanced JQL pagination, API v3 data shapes, ADF conversion, and transition-based status updates. Replace the prototype's database mapper/import/push orchestration with Spectron permissions, storage, field types and history.
