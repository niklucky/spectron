#!/usr/bin/env bash
#
# Pull, migrate, restart. Lives at /opt/spectron/deploy.sh, put there by
# .github/workflows/release.yml alongside compose.yaml and the environment.
#
# It is a file on the box rather than a heredoc piped into ssh for a reason.
# `docker compose run` attaches the container's stdin, so when the script
# itself arrives on stdin, `run` consumes the rest of it: the commands after
# it are fed to the container as input instead of being executed, and bash
# reaches EOF and exits 0. A deploy then reports success having started
# nothing. Invoked as `bash deploy.sh`, there is no script on stdin to eat.
#
# Safe to run by hand on the box, which is the other reason it is a file:
#
#   ssh github@5.181.51.100
#   cd /opt/spectron && bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

# The workflow drops the new environment here as deploy.env. A hand-run has
# none and keeps whatever .env is already in place.
if [ -f deploy.env ]; then
  mv deploy.env .env
  chmod 600 .env
fi

docker compose pull --quiet

# Migrations run to completion before anything is restarted: a failure here
# leaves the previous API serving the old schema rather than restarting it
# against a half-migrated database. `run` starts the database first and waits
# for it to be healthy.
#
# -T and </dev/null are belt and braces against the stdin problem above.
docker compose run --rm -T migrate </dev/null

docker compose up --detach --wait --remove-orphans
docker compose ps
docker image prune -f --filter 'until=168h'
