# Spectron

An open source workspace for development teams, designed for self-hosting.

The planned scope includes tasks, AI agents, Jira and Yandex Tracker, GitHub issues/actions/pull requests, self-hosted GitLab, chats, and calls. These are product directions, not implemented features.

## Repository structure

```text
apps/
  app/          Main web application; current focus
  web/          Public single-page website
  desktop/      Reserved for Electron or Tauri
  mobile/       Reserved for React Native
packages/
  frontend/     Shared UI, features, and design tokens
  backend/      Business logic and integration services
  api/          REST and tRPC transport boundary
  db/           Database access, schema, and migrations
  shared/       Environment-independent types and utilities
```

## Boundaries

Web applications consume `frontend` and `shared`. `frontend` must remain independent of server code. Future API clients should expose browser-safe contracts without importing server implementations.

Server routes in `api` call business logic in `backend`; `backend` uses `db` for persistence. `shared` must not depend on apps, browser APIs, server runtimes, or database clients.

Desktop and mobile are placeholders. Shared web components are not assumed to work in React Native.

## Development

Use Node.js 24 and pnpm 9.15.0 (the version pinned in `package.json`).

```sh
pnpm install
cp .env.example .env
# Set BETTER_AUTH_SECRET in .env using: openssl rand -base64 32
pnpm compose:up
pnpm db:migrate
pnpm dev
```

`compose:up` starts Postgres 17 Alpine and waits for it to be healthy. `compose:down` stops it and preserves the database volume. Local Postgres uses `127.0.0.1:5442` to avoid an existing database on 5432; change `POSTGRES_PORT` and `DATABASE_URL` together if needed.

The main app uses the port from `APP_URL` (default http://localhost:5173), the API listens on 127.0.0.1:3001, and the public page uses http://localhost:5174. Open the exact `APP_URL`: auth validates the origin, including hostname and port. The current local preview can use `APP_URL=http://127.0.0.1:5175`.

`pnpm dev` starts all three services. Alternatively run `pnpm dev:api` and `pnpm dev:app` in separate terminals. `pnpm dev:web` runs just the public page. The API and migration runner load the root `.env`; shell environment variables take precedence. Resend and database credentials stay on the server.

```sh
pnpm db:generate  # Generate a migration after editing the schema
pnpm db:migrate   # Apply committed migrations
pnpm typecheck
pnpm build
pnpm test:auth
pnpm test:projects
```

Auth tests create and drop a disposable database on local Postgres, send no real emails, and leave application data alone. To use another development Postgres, set `TEST_DATABASE_URL` to a connection whose role can create databases. Tests cover registration, login, profile persistence, sign-out, origin checks, password resets, token expiry/concurrent reuse, session revocation, and persistent rate limits.

Both web apps use React and Vite. pnpm manages workspaces; Turborepo schedules tasks. Internal packages export TypeScript source. The Node API uses Hono, Better Auth, and Drizzle with `pg`.

## Authentication

Registration signs the user in immediately. Login sessions are stored in Postgres and carried by HttpOnly, SameSite cookies; HTTPS uses Secure cookies. Passwords use Better Auth’s scrypt hashing with a 12–128 character policy. Reset links expire after 30 minutes, are single-use, and revoke all sessions when redeemed. Reset identifiers are hashed in the database. Rate limits are stored in Postgres, including stricter limits on login, registration, and password reset requests.

Add `RESEND_API_KEY` and `EMAIL_FROM` in `.env`, then restart the API to enable reset emails. The sender must belong to a [verified Resend domain](https://resend.com/docs/send-with-nodejs). Without email configuration, registration and login work; reset email delivery failures are reported in server logs. Reset requests always show the same public response whether the email exists or delivery fails. Tokens and provider response bodies are not logged.

The current flow uses [Better Auth email/password authentication](https://better-auth.com/docs/authentication/email-password). Registration is open and does not require email verification yet. Team invitations, permissions, and provider logins can be added later. Tasks and conversations still use demo data.

| Method | Endpoint                           | Purpose                                           |
| ------ | ---------------------------------- | ------------------------------------------------- |
| POST   | `/api/auth/sign-up/email`          | Register: `name`, `email`, `password`             |
| POST   | `/api/auth/sign-in/email`          | Login: `email`, `password`                        |
| POST   | `/api/auth/sign-out`               | Revoke the current session                        |
| GET    | `/api/auth/get-session`            | Get current session, or `null`                    |
| GET    | `/api/me`                          | Authenticated user; returns 401 without a session |
| POST   | `/api/auth/update-user`            | Update profile: `name`                            |
| POST   | `/api/auth/request-password-reset` | Send reset email: `email`, `redirectTo`           |
| GET    | `/api/auth/reset-password/:token`  | Validate email link and redirect to the form      |
| POST   | `/api/auth/reset-password`         | Set password: `token`, `newPassword`              |

POST JSON with `Content-Type: application/json` and the app’s `Origin`. Browser clients send cookies with same-origin requests. `redirectTo` should be `${APP_URL}/reset-password`. The React client is browser-only; server auth code stays in `backend`, HTTP routing in `api`, and schema/migrations in `db`.

## Projects

Projects and project memberships persist in Postgres. Each project has a UUID, name, issue prefix, optional website URL and logo, and timestamps. The creator becomes an owner in the same transaction. Owners and members can read projects; only owners can update them. Project names and prefixes may repeat across projects because IDs, rather than names, identify them.

The authenticated tRPC API lives at `/api/trpc`:

| Procedure         | Type     | Input                                        |
| ----------------- | -------- | -------------------------------------------- |
| `projects.list`   | Query    | None; lists the current user's memberships   |
| `projects.get`    | Query    | `{ id }`                                     |
| `projects.create` | Mutation | `{ name, key, url?, logo? }`                 |
| `projects.update` | Mutation | `{ id, name, key, url?, logo? }`; owner only |

Names are trimmed and limited to 80 characters. Issue prefixes are normalized to uppercase and accept 2–10 letters/numbers, starting with a letter. Colors are `blue`, `slate`, or `sand`. Mutations require an exact `Origin` match with `APP_URL`. Membership checks use the authenticated session; callers cannot select an acting user or assign themselves ownership.

The app loads projects after login and refreshes them when the window regains focus. Accounts without memberships see a skippable first-project modal. Skipping is remembered in browser session storage for the current login session; it creates no project or membership. "New project" remains in the sidebar. Invitations are a later feature; projects joined through memberships already appear in the same list.

The project form discovers logos from HTML icon links (including Apple touch icons) and falls back to `/favicon.ico`. `projects.discoverLogo` is an authenticated mutation accepting `{ url }` and returning `{ logo: string | null }`. Users can upload an image instead or remove the suggested icon. Uploads take priority over pending lookups. PNG, JPEG, WebP, GIF, SVG and ICO are supported, up to 2 MB and 16 million pixels; the backend converts logos to static PNGs up to 128×128 and stores them in Postgres. No upload volume is needed.

Website downloads allow only public HTTP(S) addresses on ports 80/443, validate each redirect, pin DNS, and limit response size and duration. For private sites, upload a logo. DNS defaults to the system resolver. If a VPN returns synthetic proxy addresses, `PROJECT_LOGO_DNS=cloudflare` opts into sending website hostnames to Cloudflare’s encrypted DNS instead; private addresses remain blocked.

New projects start with empty task lists. Task creation and chat still use temporary in-memory state until task persistence is implemented. Project links use `#project/<project-id>` and survive reloads; Flow uses `#flow`. The old mock project/task list is no longer used.

`pnpm test:projects` uses a disposable database to test creation, transaction rollback, isolation, member/owner permissions, validation, origin checks, session revocation, and persistence. Browser code imports only the tRPC router type from `@spectron/api/router`; server implementations are not bundled into the UI.

## Docker

`compose.local.yml` runs just local development infrastructure. `compose.yaml` runs the complete stack: Postgres, a one-off migration service, API, app, and public web page.

For deployment, set a strong `POSTGRES_PASSWORD`, a generated `BETTER_AUTH_SECRET`, the public HTTPS `APP_URL`, and Resend settings in `.env`, then:

```sh
docker compose up --build -d
```

Put a TLS reverse proxy in front of the app on port 8080. The public page is on 8081. Production auth requires HTTPS. The app’s Nginx forwards `/api` to the private API container; neither the API nor Postgres publishes a host port. Migrations must succeed before the API starts. Database volumes persist across `down`.

`TRUST_PROXY=true` is set only for this private API deployment, where Nginx overwrites `X-Real-IP`. Do not enable it on a directly exposed API. With an additional TLS proxy, configure Nginx’s real-IP module for that proxy’s specific addresses to retain per-client rate limits; otherwise clients share that proxy’s quota. In local development the API uses the socket address.

## Next steps

Task persistence, invitations, broader team permissions, integrations, and agent execution remain to be implemented.

An open source license still needs to be selected before public distribution.

### Project settings and invitations

Each sidebar project has an options menu for Settings and Archive. Settings reuses the creation form under General, with a Members section for email invitations, team members, and invitation history. Owners can edit, invite, cancel pending invitations, and archive. Members can view the project and its member list. More granular permissions are deferred.

Archiving sets `projects.state = archived`, keeps the project and memberships, removes it from active navigation and Flow, and cancels pending invitations. Archived projects remain available through the project API; restoration UI is not implemented yet.

Invitations are delivered using the existing `RESEND_API_KEY` and `EMAIL_FROM`. Links use `APP_URL`; set it to a reachable public HTTPS origin when inviting people from other devices (the local development URL only works on this machine). Tokens expire after seven days, are stored hashed, and require a signed-in account with the matching invited email. The invitation survives switching between login and registration. Acceptance is explicit and transactional; retries do not duplicate membership. Delivery failures appear in invitation history and can be retried by creating a fresh invitation. Duplicate pending invitations are rejected; up to 50 invitations per project per hour are allowed.

Additional authenticated tRPC procedures:

| Procedure                   | Type                     | Input                              |
| --------------------------- | ------------------------ | ---------------------------------- |
| `projects.archive`          | Mutation                 | `{ id }`                           |
| `projects.members`          | Query                    | `{ id }`                           |
| `projects.invitations`      | Query                    | `{ id }`; owner only               |
| `projects.invite`           | Mutation                 | `{ id, email }`; owner only        |
| `projects.cancelInvitation` | Mutation                 | `{ id, invitationId }`; owner only |
| `invitations.preview`       | Mutation (read via POST) | `{ token }`; recipient only        |
| `invitations.accept`        | Mutation                 | `{ token }`; recipient only        |

Invitation tokens are carried in the email link fragment and sent to the API in POST bodies, keeping them out of ordinary URL access logs. Tests capture email delivery without contacting Resend and cover acceptance, wrong accounts, cancellation, expiry, duplicates, failures, archive, and concurrent requests.
