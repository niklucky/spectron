# Backend

Business logic and service configuration. `createAuth` configures Better Auth with the database adapter, password policy, sessions, reset email callback, and rate limits. `createResetEmailSender` delivers password resets with Resend.

Factories accept dependencies so tests can use the real database and replace email delivery without sending mail. The package does not start a server; `@spectron/api` owns the HTTP runtime. Task workflows, agents, and integrations will be added here later.
