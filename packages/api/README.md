# API

Hono HTTP transport. `src/index.ts` mounts Better Auth at `/api/auth/*` and protects `/api/me`. `src/server.ts` loads root environment settings and starts the Node server.

Run `pnpm dev:api` from the root. Auth configuration belongs in `@spectron/backend`; database access belongs in `@spectron/db`. Browser clients must not import these server implementations.

`pnpm test:auth` exercises real HTTP handlers against a disposable Postgres database. See the root README for endpoint contracts and configuration.
