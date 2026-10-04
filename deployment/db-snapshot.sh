#!/usr/bin/env bash
#
# Copy the production database into the local Compose stack.
#
#   deployment/db-snapshot.sh                 # dump production, restore it locally
#   deployment/db-snapshot.sh --dump-only     # fetch the dump and stop
#   deployment/db-snapshot.sh --restore=FILE  # restore a dump fetched earlier
#
# Snapshot, not connection: the local API never talks to the production
# database. The dump lands in deployment/snapshots/ (git-ignored) and is
# restored into the `db` service of compose.local.yml, replacing whatever the
# local database held. Attachments are not included; they live on the host
# file system in production, not in Postgres.
#
# Reads SSH_TARGET, SSH_PORT and SSH_IDENTITY_FILE from deployment/.env.<env>,
# like provision-app.sh. The dump runs inside the spectron-db container on the
# box, so nothing needs to be installed on the server for this.
#
# Compatible with the bash 3.2 that macOS ships.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

usage() {
  cat <<'HELP'
Usage: deployment/db-snapshot.sh [options]
  --env=NAME       Read deployment/.env.NAME (default: production)
  --host=HOST      Override SSH_TARGET (an SSH alias, or user@host)
  --dump-only      Fetch the dump into deployment/snapshots/ and stop
  --restore=FILE   Skip the dump; restore FILE into the local database
  -h, --help       Show this help
HELP
}

MODE=both
ENV_NAME=production
RESTORE_FILE=''
for arg in "$@"; do
  case "$arg" in
    --dump-only) MODE=dump ;;
    --restore=*) MODE=restore; RESTORE_FILE=${arg#*=} ;;
    --env=*) ENV_NAME=${arg#*=} ;;
    --host=*) SSH_TARGET=${arg#*=} ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $arg" ;;
  esac
done
case "$ENV_NAME" in
  *[!a-zA-Z0-9_-]*|'') die 'Invalid environment name' ;;
esac

ENV_FILE="$HERE/.env.$ENV_NAME"
# shellcheck source=deployment/env-file.sh
. "$HERE/env-file.sh"
setting() {
  local name="$1" default="${2-}" value
  if [ -n "${!name+set}" ]; then return; fi
  value=$(env_file_value "$ENV_FILE" "$name")
  printf -v "$name" '%s' "${value:-$default}"
}
setting SSH_TARGET testron
setting SSH_PORT ''
setting SSH_IDENTITY_FILE ''
setting DB_CONTAINER spectron-db

for cmd in docker; do command -v "$cmd" >/dev/null || die "$cmd is required"; done
SNAPSHOTS="$HERE/snapshots"
mkdir -p "$SNAPSHOTS"
umask 077

if [ "$MODE" != restore ]; then
  case "$SSH_TARGET" in
    ''|*[!a-zA-Z0-9._@-]*) die 'Set SSH_TARGET to an SSH alias or user@host' ;;
  esac
  case "$DB_CONTAINER" in
    *[!a-zA-Z0-9._-]*|'') die 'Invalid DB_CONTAINER' ;;
  esac
  ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15)
  [ -z "$SSH_PORT" ] || ssh_opts+=(-p "$SSH_PORT")
  if [ -n "$SSH_IDENTITY_FILE" ]; then
    [ -f "$SSH_IDENTITY_FILE" ] || die 'SSH_IDENTITY_FILE does not exist'
    ssh_opts+=(-i "$SSH_IDENTITY_FILE" -o IdentitiesOnly=yes)
  fi

  step "Dumping $DB_CONTAINER on $SSH_TARGET"
  RESTORE_FILE="$SNAPSHOTS/spectron-$(date -u +%Y%m%d-%H%M%S).dump"
  # Custom format: compressed, and pg_restore can drop and recreate objects.
  # --no-owner/--no-acl because the local role may not match the server's.
  # shellcheck disable=SC2029
  ssh "${ssh_opts[@]}" "$SSH_TARGET" \
    "docker exec '$DB_CONTAINER' pg_dump -U spectron -Fc --no-owner --no-acl spectron" \
    > "$RESTORE_FILE.part"
  mv "$RESTORE_FILE.part" "$RESTORE_FILE"
  printf '   %s (%s)\n' "$RESTORE_FILE" "$(du -h "$RESTORE_FILE" | cut -f1)"
  [ "$MODE" = dump ] && exit 0
fi

[ -s "$RESTORE_FILE" ] || die "dump not found: $RESTORE_FILE"

step "Restoring into the local database"
local_db=$(docker compose -f "$ROOT/compose.local.yml" ps -q db)
[ -n "$local_db" ] || die 'the local database is not running (pnpm compose:up)'

# Everything open on the old database is cut off; the API reconnects on its
# next query. Recreating the database is simpler and cleaner than --clean.
docker exec -i "$local_db" psql -U spectron -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = 'spectron' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS spectron;
CREATE DATABASE spectron OWNER spectron;
SQL
docker exec -i "$local_db" pg_restore -U spectron -d spectron --no-owner --no-acl --exit-on-error \
  < "$RESTORE_FILE"

step "Done"
cat <<NOTE
   The local database now matches production as of the dump, including the
   drizzle migration history. If this checkout has newer migrations, apply
   them with: pnpm db:migrate
   Attachments are not part of the dump; files referenced by issues will 404
   locally.
NOTE
