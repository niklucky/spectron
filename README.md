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

## Docker

`compose.local.yml` runs just local development infrastructure. `compose.yaml` runs the complete stack: Postgres, a one-off migration service, API, app, and public web page.

For deployment, set a strong `POSTGRES_PASSWORD`, a generated `BETTER_AUTH_SECRET`, the public HTTPS `APP_URL`, and Resend settings in `.env`, then:

```sh
docker compose up --build -d
```

Put a TLS reverse proxy in front of the app on port 8080. The public page is on 8081. Production auth requires HTTPS. The app’s Nginx forwards `/api` to the private API container; neither the API nor Postgres publishes a host port. Migrations must succeed before the API starts. Database volumes persist across `down`.

`TRUST_PROXY=true` is set only for this private API deployment, where Nginx overwrites `X-Real-IP`. Do not enable it on a directly exposed API. With an additional TLS proxy, configure Nginx’s real-IP module for that proxy’s specific addresses to retain per-client rate limits; otherwise clients share that proxy’s quota. In local development the API uses the socket address.

## Next steps

Task persistence, team membership/permissions, integrations, and agent execution remain to be implemented.

An open source license still needs to be selected before public distribution.
