# Backend

Business logic and service configuration. `createAuth` configures Better Auth with the database adapter, password policy, sessions, reset email callback, and rate limits. `createResetEmailSender` delivers password resets with Resend.

Factories accept dependencies so tests can use the real database and replace email delivery without sending mail. The package does not start a server; `@spectron/api` owns the HTTP runtime. `createProjectService` owns project persistence and membership checks. Task workflows, agents, and integrations will be added here later.

`src/project-logo` discovers declared website icons, fetches public resources with bounded requests and DNS pinning, and normalizes uploaded/discovered images into small PNG data URLs. `PROJECT_LOGO_DNS=cloudflare` optionally enables encrypted DNS for VPN environments; system DNS is the default.

`createInvitationService` manages team lists, invitation lifecycle, and transactional acceptance. `createInvitationEmailSender` sends plain-text Resend invitations with idempotency keys. Tests inject a captured sender.

`createIssueService` implements project-scoped issues, configuration, and history. A project row lock serializes writes to protect numbering, hierarchy, configuration and archive races. Updates require the last-seen issue timestamp. History writes share the issue transaction. Project creation seeds default states/priorities; prefixes are immutable.
