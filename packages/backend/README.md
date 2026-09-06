# Backend

Business logic and service configuration. `createAuth` configures Better Auth with the database adapter, password policy, sessions, reset email callback, and rate limits. `createResetEmailSender` delivers password resets with Resend.

Factories accept dependencies so tests can use the real database and replace email delivery without sending mail. The package does not start a server; `@spectron/api` owns the HTTP runtime. `createProjectService` owns project persistence and membership checks. Task workflows, agents, and integrations will be added here later.

`src/project-logo` discovers declared website icons, fetches public resources with bounded requests and DNS pinning, and normalizes uploaded/discovered images into small PNG data URLs. `PROJECT_LOGO_DNS=cloudflare` optionally enables encrypted DNS for VPN environments; system DNS is the default.

`createInvitationService` manages team lists, invitation lifecycle, and transactional acceptance. `createInvitationEmailSender` sends plain-text Resend invitations with idempotency keys. Tests inject a captured sender.

`createIssueService` implements project-scoped issues, configuration, and history. A project row lock serializes writes to protect numbering, hierarchy, configuration and archive races. Updates require the last-seen issue timestamp. History writes share the issue transaction. Project creation seeds default states/priorities; prefixes are immutable.

`createFileService` streams uploads to immutable local storage, detects content types, enforces size limits, and manages project-file associations and issue attachments. Membership checks gate reads and writes; cross-project reuse checks both projects. Attachment history and link mutations share a transaction. Removing a link retains shared metadata and bytes. Failed and abandoned uploads are retained.

`createCommentService` owns threaded comments, membership and author/moderation checks, canonical mention labels, derived mention relations, reusable comment attachments and atomic history. Writes lock projects in sorted order for cross-project reuse; stale edits fail. Deleted parents retain their children and original content.

`createActivityService` reads existing issue history with current comment cards, parent previews and project-authorized files. It uses one read transaction and exact stored history timestamps for cursor boundaries; it creates no activity copies.
