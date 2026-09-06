# Database

Postgres 17 with Drizzle and `pg`. `src/schema.ts` defines users, accounts (password credentials), sessions, verifications (hashed reset identifiers), and persistent rate limits. Foreign keys cascade when a user is deleted; email, session token, and provider/account pairs are unique.

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
