# Database

Postgres 17 with Drizzle and `pg`. `src/schema.ts` defines users, accounts (password credentials), sessions, verifications (hashed reset identifiers), persistent rate limits, projects, and project memberships. Foreign keys cascade when a user is deleted; email, session token, and provider/account pairs are unique.

`createDatabase` owns a connection pool; callers close it when shutting down. `migrations/` contains committed SQL and Drizzle metadata.

From the repository root:

```sh
pnpm compose:up
pnpm db:migrate
# After changing the schema:
pnpm db:generate
pnpm db:migrate
```

Migrations are explicit and tracked by Drizzle. Production Compose applies them in a one-off service before starting the API. Local Compose preserves its named volume when stopped with `compose:down`.

Projects use UUIDs. Memberships have a composite project/user primary key and an owner/member role. Project creation and the creator’s owner membership are transactional. The project service in `backend` restricts reads to members and updates to owners.

Projects store nullable `url` and `logo` fields. Logos are normalized PNG data URLs, so database backups include them. The legacy color column remains for migration compatibility and is no longer exposed by the project API or UI.

Migration `0003_project_invitations` adds active/archived project state and project invitations, with a unique active invitation per project/email. Invitation records store hashed tokens, delivery/acceptance/cancellation status, inviter, and expiry.
