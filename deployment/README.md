# Deployment

Production is one VPS, `5.181.51.100`, shared with testron. Spectron keeps to
its own corner of it: `/opt/spectron` for the stack, `/data/spectron` for the
data, two nginx sites, and loopback ports 4500–4502. The `github` account is
the deploy user for both projects and gets one extra authorized key here.

| Hostname             | Serves                        | Container | Loopback |
| -------------------- | ----------------------------- | --------- | -------- |
| `spectron.dev`       | the marketing site, `apps/web` | `web`     | `:4501`  |
| `app.spectron.dev`   | the SPA and `/api`, `apps/app` | `app`     | `:4500`  |

Only `app` talks to the API: its own nginx proxies `/api/` to the `api`
container and owns the `/_protected_files/` location that serves attachments
after the API has authorised the request. The host nginx terminates TLS and
proxies to those two ports and nothing else.

## Layout

```
deployment/
  compose.yaml           the production stack; shipped to /opt/spectron
  deploy.sh              pull, migrate, restart; shipped and run on the box
  provision-app.sh       run this from your machine
  provision-server.sh    the remote half; not run by hand
  github-env.sh          pushes .env.<environment> to a GitHub environment
  env-file.sh            the shared KEY=value reader
  nginx/                 templates rendered onto the box
  .env.example           copy to .env.production and fill it in
```

`.env.production` holds both halves of the configuration: the top block
configures provisioning and never leaves your machine, and everything below it
is what `github-env.sh` pushes to the GitHub environment. It is git-ignored,
as is the private deploy key.

## First run

1. **Generate the deploy key.** The private half goes to GitHub; only the
   public half reaches the server.

   ```bash
   ssh-keygen -t ed25519 -N '' -C 'github-deploy@spectron' -f deployment/deploy_key
   ```

2. **Fill in the settings.**

   ```bash
   cp deployment/.env.example deployment/.env.production
   $EDITOR deployment/.env.production
   ```

   Generate each secret with `openssl rand -base64 32`. `BETTER_AUTH_SECRET`,
   `INTEGRATION_SECRET`, `INTEGRATION_ENCRYPTION_KEY` and
   `AI_CREDENTIAL_SECRET` are stable-or-nothing: rotating one signs everyone
   out or invalidates every stored Jira, Git and AI credential.

3. **Point DNS at the box.** `spectron.dev` and `app.spectron.dev` both need an
   A record for `5.181.51.100`. Certificate issuance checks this first, because
   Let's Encrypt rate-limits failed authorisations.

   Nothing resolves yet at the time of writing, so a first run before the
   records exist should be `--skip-certs`; the sites then answer 503 on HTTP
   with the ACME path live, and `--certs-only` finishes the job later.

4. **Provision.**

   ```bash
   ./deployment/provision-app.sh                 # everything
   ./deployment/provision-app.sh --skip-certs    # before DNS points here
   ./deployment/provision-app.sh --certs-only    # once it does
   ```

5. **Push the GitHub environment.**

   ```bash
   ./deployment/github-env.sh production
   ```

   This creates the `production` environment if it does not exist, pushes the
   secrets and variables, sends the private key as `SSH_PRIVATE_KEY`, and pins
   the server's host keys as `SSH_KNOWN_HOSTS` so the deploy does not trust
   whatever answers on the day.

6. **Ship.**

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

## What runs when

| Trigger          | Workflow            | Does                                        |
| ---------------- | ------------------- | ------------------------------------------- |
| pull request     | `pull-request.yml`  | typecheck, test, build                       |
| push to `main`   | `main.yml`          | the same checks; no deploy                   |
| tag `vX.Y.Z`     | `release.yml`       | checks, three images to ghcr.io, deploy      |

`main` is deliberately not a deploy trigger, and there is no dev server yet.
When there is one, copy the `deploy` job in `release.yml`, point it at a `dev`
environment and trigger it from the `dev` branch — everything it needs is
already a variable or a secret rather than hardcoded.

The deploy pins all three images to the commit sha it just built and verified,
so what is running is unambiguous. A rollback is the same deploy re-run against
an older tag.

## Provisioning, in detail

`provision-app.sh` runs on your machine and ssh's to the box. It is idempotent
and strictly additive — it installs nothing that is already installed, appends
the deploy key only if it is missing, never touches a directory that already
holds a database, and only ever writes the two spectron nginx sites. If nginx
fails to reload, it restores those two files and nothing else, so a rollback
cannot revert a change testron made in the meantime.

It does **not** change the host's SSH configuration. Whoever provisioned the
box first owns that, and two projects writing competing drop-ins is how a box
locks everyone out; the script warns if password authentication is still on.
It also does not open a firewall, deploy the stack, or create the database.

Modes:

| Flag             | Does                                                      |
| ---------------- | --------------------------------------------------------- |
| *(none)*         | packages, deploy user, directories, nginx, certificates    |
| `--skip-certs`   | a full run with no issuance; TLS sites are left off        |
| `--certs-only`   | render nginx and issue or renew, nothing else              |
| `--nginx-only`   | re-render and reload nginx; needs existing certificates    |

Re-run `--nginx-only` after editing anything under `nginx/`.

## On the box

```bash
ssh github@5.181.51.100
cd /opt/spectron
docker compose ps
docker compose logs -f api
```

`deploy.sh` is the same script the workflow runs, so a deploy can be repeated
by hand without reconstructing the commands:

```bash
cd /opt/spectron && bash deploy.sh
```

It is a file on the box rather than a heredoc piped into ssh on purpose.
`docker compose run` attaches the container's stdin; when the script itself
arrives on stdin, `run` eats the rest of it, the restart never happens, and
bash reaches EOF and exits 0 — a deploy that reports success having started
nothing. The header of the script says the same thing, because the fix is
invisible once it works.

The database is a bind mount at `/data/spectron/db`, so it outlives the stack
and a `compose down -v`. Uploaded files are at `/data/spectron/files`, owned by
`1000:1000` — the `node` user inside the API image, not the host account that
happens to share that uid.

Postgres is published on `127.0.0.1:4502` for psql over an SSH tunnel:

```bash
ssh -N -L 5442:127.0.0.1:4502 github@5.181.51.100
psql postgresql://spectron@127.0.0.1:5442/spectron
```

A backup is `pg_dump` through that tunnel, or on the box directly:

```bash
docker compose exec -T db pg_dump -U spectron spectron | gzip > spectron-$(date +%F).sql.gz
```

## Things worth knowing

- **HSTS** is set on both hostnames with a one-year max-age (no
  `includeSubDomains`, no preload). Drop the header from `nginx/*.conf` before
  the first issuance if that is not wanted — once browsers have seen it, it
  sticks until it expires.
- **`POSTGRES_PASSWORD`** is baked into the cluster on the first `compose up`.
  Changing it later needs an `ALTER ROLE` against the running database, not
  just a new secret.
- **The agent runner** (`AGENT_RUNNER_ENABLED`) is off. Turning it on needs the
  Docker socket mounted into the API container and a durable workspaces path
  visible at the same path to the daemon; neither is configured here.
- **Uploads** are capped by `FILES_MAX_BYTES`, which the API enforces on the
  authenticated request. The nginx `client_max_body_size` in front is
  deliberately loose so the API's error reaches the user instead of an nginx
  error page.
