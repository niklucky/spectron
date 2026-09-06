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

## 3. Comments and mentions — manually approved

Comments form a tree: ID, issue ID, optional parent ID, author ID, structured body, lifecycle timestamps. Parent is fixed at creation and must belong to the same issue. Arbitrary data nesting with capped visual indentation. Paginate roots and progressively load replies. Order siblings by creation time and ID. A deleted parent remains as a placeholder while retaining its replies.

Bodies contain structured mentions with a user ID and display label. Maintain backend-derived `comment_mentions` records with lifecycle timestamps. The picker offers project members; mentioning someone never grants access. Repeated mentions of one user in a comment have one active relation. Edits soft-delete removed mentions. Future notifications distinguish replies and mentions, deduplicate recipients, avoid self-notifications, and notify only newly added mentions.

Comments allow text, multiple attachments, or both. Authors can edit/delete their comments; owners can soft-delete for moderation initially. Retain old content and actors in history. User comments, system events and future PR/deploy/agent entries remain distinct models that the timeline can combine.

This slice stores text/mention nodes, uses a textarea with an `@` project-member picker, and commits comment body, derived mention relations, attachment changes and history together. Roots and each reply level use cursor pages of 20; visual indentation stops growing after three levels. Existing files can be reused across accessible projects. Uploads are ready project files before posting; cancelling a draft retains them in the library. Each comment accepts up to 20 files and 100,000 text characters.

Authors can edit and delete; project owners can delete for moderation. Deleted comments are placeholders, with original content retained in history and the database. Replies remain readable and can be added to a deleted parent. Comment restoration, notifications, rich formatting and system events are deferred. Use Refresh comments to load other users' changes; an editor retains its original version to prevent overwriting a concurrent edit.

## 4. Worklogs — designed, not implemented

Manual entries initially; timers later for both humans and agents. Fields: ID, issue ID, exactly one human user ID or agent ID, recorded-by user, started-at with timezone, positive duration in seconds, optional description, lifecycle timestamps. The worker and recorder are distinct. Agent worklogs require a persistent agent identity model first.

Allow overlap. Totals exclude deleted entries and distinguish human/agent effort. Changes record previous values and actors in history. Future external mapping records reference individual worklogs to prevent duplicate imports and support updates/deletions. Timers will produce the same entry model.

## Future integration and history extensions

Tracker mappings are separate records scoped to the integration and external tracker project, using provider IDs rather than display names. Extend history with entity type/ID for comments, worklogs and attachment relations, and explicit agent/integration actors when those features arrive. Preserve the same transaction boundary and project membership access.
