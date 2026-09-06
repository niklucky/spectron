# API

Hono HTTP transport. `src/index.ts` mounts Better Auth at `/api/auth/*` protects `/api/me`, and mounts tRPC at `/api/trpc/*`. `src/server.ts` loads root environment settings and starts the Node server.

Run `pnpm dev:api` from the root. Auth configuration belongs in `@spectron/backend`; database access belongs in `@spectron/db`. Browser clients must not import these server implementations.

`pnpm test:auth` exercises real HTTP handlers against a disposable Postgres database. See the root README for endpoint contracts and configuration.

`src/trpc` contains the authenticated context and project router. `pnpm test:projects` tests project endpoints and membership isolation in a disposable Postgres database. `./router` exports `AppRouter` for type-only browser imports.

The authenticated `issues` router provides persistence, workflow options, soft deletion/restoration, and history. `pnpm test:issues` exercises real HTTP routes and disposable Postgres data, including concurrency and rollback. Browser code uses the shared issue contracts.
