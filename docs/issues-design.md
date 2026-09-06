# Agreed issue design and delivery slices

Delivery stops after each slice with a short summary and manual test checklist. Do not begin the next slice until the user has tested and asks to continue.

## 1. Issue core — manually approved and committed (`229eb0f`)

NanoIDs for application entities, per-project integer issue numbers, provider strings for future external mappings. Preserve existing UUIDs as text. Authentication owns its IDs. Project prefixes are locked; future renaming must recalculate issue keys. Duplicate prefixes across projects remain permitted; IDs identify issues unambiguously.

Issue fields: ID, project, parent, number/display key, title, description, author, optional assignee, state and priority references, created/updated/deleted timestamps. Parent grouping stays within the project and rejects cycles. No cascading changes to children. Every domain deletion is soft unless an explicit exception is approved. Actor attribution belongs in history.

Priorities are configurable per project. States are project-owned labels mapped to Opened, In progress, Blocked, Cancelled or Finished. Trigger execution and configuration are deferred. Initial implementation uses a required default Opened state and nullable priority. Configuration changes have separate project history. Issue mutation history is atomic and append-only. All project members can see previous/deleted content; finer permissions are deferred.

The first slice uses plain-text issue descriptions, a separate issue history panel, and whole-project list loading. These can evolve with rich content and pagination.

## 2. Files — manually approved and committed (`eec58a0`)

Use host-mounted files, not MinIO: `/data/files/{yyyy-mm-dd}/{file_id}.ext`. File IDs use NanoIDs. The physical path has no project ownership. Store relative object keys and original filenames separately. The API mounts files read/write; Nginx mounts read-only.

`files`: ID, uploader, storage key, filename, validated content type, actual byte size, pending/ready/failed status, lifecycle timestamps.

`project_files`: ID, project ID, file ID, lifecycle timestamps. Files can be reused. `issue_attachments` and `comment_attachments` reference the project-file association and carry their own ID, owner reference, position and lifecycle timestamps. Validate that the owner and association share a project. Cross-project reuse requires access to both projects.

Uploads become ready only after verification. Link ready files in the issue/comment save transaction. Authorize downloads through the API, then use Nginx internal delivery with X-Accel-Redirect. Use private caching with revalidation initially. Contents are immutable; replacement produces a new file.

Soft-delete links or project associations without removing shared bytes. Global file deletion is separately restricted. Abandoned upload cleanup requires an explicit approved exception; do not automatically purge bytes.

This slice implements issue attachments, a searchable project library, cross-project reuse, upload previews/downloads, and attachment history. Comment attachments remain for the next slice. Uploads and attachment linking are separate operations; ready uploads remain reusable when linking fails. The default limit is 50 MiB. Failed/pending uploads and detached bytes are retained. Global file deletion and project association removal have no API/UI yet. Development uses authenticated API streaming; Docker uses authenticated Nginx delivery.

## 3. Comments and mentions — manually approved and committed (`d08e76e`)

Comments form a tree: ID, issue ID, optional parent ID, author ID, structured body, lifecycle timestamps. Parent is fixed at creation and must belong to the same issue. Arbitrary data nesting with capped visual indentation. Paginate roots and progressively load replies. Order siblings by creation time and ID. A deleted parent remains as a placeholder while retaining its replies.

Bodies contain structured mentions with a user ID and display label. Maintain backend-derived `comment_mentions` records with lifecycle timestamps. The picker offers project members; mentioning someone never grants access. Repeated mentions of one user in a comment have one active relation. Edits soft-delete removed mentions. Future notifications distinguish replies and mentions, deduplicate recipients, avoid self-notifications, and notify only newly added mentions.

Comments allow text, multiple attachments, or both. Authors can edit/delete their comments; owners can soft-delete for moderation initially. Retain old content and actors in history. User comments, system events and future PR/deploy/agent entries remain distinct models that the timeline can combine.

This slice stores text/mention nodes, uses a textarea with an `@` project-member picker, and commits comment body, derived mention relations, attachment changes and history together. Roots and each reply level use cursor pages of 20; visual indentation stops growing after three levels. Existing files can be reused across accessible projects. Uploads are ready project files before posting; cancelling a draft retains them in the library. Each comment accepts up to 20 files and 100,000 text characters.

Authors can edit and delete; project owners can delete for moderation. Deleted comments are placeholders, with original content retained in history and the database. Replies remain readable and can be added to a deleted parent. Comment restoration, notifications, rich formatting and system events are deferred. Use Refresh comments to load other users' changes; an editor retains its original version to prevent overwriting a concurrent edit.

## 4. Human worklogs — manually approved and committed (`7c5e941`)

Manual human entries only. Agents and timers are deferred. Fields: ID, project/issue IDs, worker user ID, immutable recorded-by user, start instant with timezone, positive integer duration in seconds, optional description, lifecycle timestamps. Worker and recorder remain distinct. Any project member can record/correct entries; finer permissions are deferred. New worker assignments must be project members. Retain former workers on existing entries.

Allow overlap. Create/edit/delete/restore writes history in the same transaction. Deletion only sets `deleted_at`; restoration retains attribution and values. Version checks prevent stale edits. Lists use newest-created-first cursor pages of 20; the start time remains independently editable. The editor uses the browser's local timezone and one duration input. Totals are the next separate step.

## 5. Human worklog totals — pending

Show totals excluding deleted entries. Stop for manual testing after this step.

## 6. Additional chat view — manually approved

Keep the existing issue view and add a [Chat | Issue] selector with a chat view presenting issue information as messages. The user moved chat ahead of totals; totals remain pending. Stop for manual testing after this step. Jira and Yandex.Tracker integrations will be designed and implemented in a new session. Agents remain deferred.

## Future integration and history extensions

Tracker mappings are separate records scoped to the integration and external tracker project, using provider IDs rather than display names. Extend history with entity type/ID for comments, worklogs and attachment relations, and explicit agent/integration actors when those features arrive. Preserve the same transaction boundary and project membership access.

Human duration input reads numeric groups: one means minutes, two mean hours/minutes, three mean days/hours/minutes (24-hour days). Separators are ignored, so `1h 35m`, `1h30m`, and `1n20m` work. `30` means 30 minutes; `1h` also means one minute under this positional convention—use `1h0m` for one hour. Human entry has no seconds field; storage remains seconds for compatibility, and editing other fields preserves existing durations.

Chat uses the existing issue, comment and history records. The [Chat | Issue] selector remembers the choice for the browser session; both views stay mounted to preserve open drafts for the current issue. Chat defaults for new sessions. The summary message shows current issue details, while the chronological feed shows issue changes, comment creation/edit/deletion, attachments and worklog history. Live comment cards appear once at creation, with reply previews; later changes are separate audit messages. Earlier activity loads in cursor pages of 50, preserving exact stored timestamp ordering. Files are resolved only through accessible project associations. The message composer supports mentions and reusable files, and Chat has file management and human worklog entry. Edit issue opens the retained Issue editor. No notification or realtime transport is added; use Refresh chat for other users' changes. Worklog totals remain pending after the user moved Chat ahead of that step.

Session handoff: Chat now uses rounded message bubbles with tails and side avatars; own messages align right. The existing Issue view is retained. Chat and its UI adjustment were approved. Worklog totals remain pending; agents, timers, notifications and tracker integrations remain deferred. The user will continue in a new session.
