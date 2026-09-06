# API

Hono HTTP transport. `src/index.ts` mounts Better Auth at `/api/auth/*` protects `/api/me`, and mounts tRPC at `/api/trpc/*`. `src/server.ts` loads root environment settings and starts the Node server.

Run `pnpm dev:api` from the root. Auth configuration belongs in `@spectron/backend`; database access belongs in `@spectron/db`. Browser clients must not import these server implementations.

`pnpm test:auth` exercises real HTTP handlers against a disposable Postgres database. See the root README for endpoint contracts and configuration.

`src/trpc` contains the authenticated context and project router. `pnpm test:projects` tests project endpoints and membership isolation in a disposable Postgres database. `./router` exports `AppRouter` for type-only browser imports.

The authenticated `issues` router provides persistence, workflow options, soft deletion/restoration, and history. `pnpm test:issues` exercises real HTTP routes and disposable Postgres data, including concurrency and rollback. Browser code uses the shared issue contracts.

`src/files.ts` handles streaming uploads and authenticated GET/HEAD downloads at `/api/files`. Development supports conditional and range requests directly; Docker returns an internal Nginx redirect after authorization. The `files` tRPC router handles the library and attachment links. Configure `FILES_ROOT`, `FILES_MAX_BYTES`, and `FILE_DELIVERY` in the server environment. Run `pnpm test:files` and `pnpm test:files:nginx` from the root.

The authenticated `comments` router lists root/reply cursor pages and creates, edits or soft-deletes comments. Write schemas reject author/parent changes and require versions for edits/deletion. `pnpm test:comments` tests the real API and disposable database.
