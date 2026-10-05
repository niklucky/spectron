# API

Hono HTTP transport. `src/index.ts` mounts Better Auth at `/api/auth/*` protects `/api/me`, and mounts tRPC at `/api/trpc/*`. `src/server.ts` loads root environment settings and starts the Node server.

Run `pnpm dev:api` from the root. Auth configuration belongs in `@spectron/backend`; database access belongs in `@spectron/db`. Browser clients must not import these server implementations.

`pnpm test:auth` exercises real HTTP handlers against a disposable Postgres database. See the root README for endpoint contracts and configuration.

`src/trpc` contains the authenticated context and project router. `pnpm test:projects` tests project endpoints and membership isolation in a disposable Postgres database. `./router` exports `AppRouter` for type-only browser imports.

The authenticated `issues` router provides persistence, workflow options, soft deletion/restoration, and history. `pnpm test:issues` exercises real HTTP routes and disposable Postgres data, including concurrency and rollback. Browser code uses the shared issue contracts.

`src/files.ts` handles streaming uploads and authenticated GET/HEAD downloads at `/api/files`. Development supports conditional and range requests directly; Docker returns an internal Nginx redirect after authorization. The `files` tRPC router handles the library and attachment links. Configure `FILES_ROOT`, `FILES_MAX_BYTES`, and `FILE_DELIVERY` in the server environment. Run `pnpm test:files` and `pnpm test:files:nginx` from the root.

The authenticated `comments` router lists root/reply cursor pages and creates, edits or soft-deletes comments. Write schemas reject author/parent changes and require versions for edits/deletion. `pnpm test:comments` tests the real API and disposable database.

`issues.activity` returns an authenticated, cursor-paginated issue activity feed for Chat. `pnpm test:activity` covers isolation, related records and stable history boundaries.

Personal desktop agents can hand issue work to Codex or T3 Code without an API connection. In **Agents → Create agent**, choose **Local Codex** or **Local T3 Code** under **Runs in**. In **Project settings → Local apps**, select a repository and optionally its absolute local folder. Workspace settings are stored per account, project and repository in the current browser; the folder stays on that computer. Mention the agent in issue Chat or Flow and send a request to create a “Passing work to…” card.

Codex opens a new chat with the issue summary in its composer and selects the workspace by local path or Git remote. The draft includes the request, issue description, recent conversation, agent instructions and attachment links. T3 Code currently supports opening its app but has no public URL contract to create a chat with a prompt; its handoff opens `t3code://` and offers **Copy summary** for pasting into a new chat. Oversized Codex links use the same copy fallback. **Open app**, **Copy summary** and **View summary** remain available to the requester in Chat. T3 Code's embedded preview cannot dispatch these custom URLs to the OS; in that preview, automatic navigation is suppressed and **Copy app link** replaces **Open app**. Paste the link into a regular browser's address bar to launch the app with its workspace and draft. A launch attempt is recorded only when Spectron attempts protocol navigation; desktop receipt and results are not synchronized back to Spectron.

The authenticated `handoffs` router stores immutable context snapshots with idempotent request IDs. Project members see the handoff card; only the requester can retrieve its private draft, launch it or revoke file links. Attachment URLs grant download access to only the snapshot's files for seven days and check the requester's current membership and issue access on each request. **Revoke file links** immediately invalidates those URLs. Expired or revoked drafts use ordinary signed-in file links. `pnpm test:handoffs` covers the real HTTP API, attachment access, immutable drafts, personal agent permissions, launch URLs and browser workspace isolation.
