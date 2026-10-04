#!/usr/bin/env bash
#
# Nightly dump of the production database. provision-server.sh installs this
# as /usr/local/bin/spectron-backup and schedules it from
# /etc/cron.d/spectron-backup; the log is /var/log/spectron-backup.log.
#
# One compressed pg_dump per night into BACKUP_DIR, written to a .part file
# first so a dump that dies half-way is never mistaken for a backup, then the
# dumps older than KEEP_DAYS are removed. Restoring one locally is
# deployment/db-snapshot.sh --restore=FILE after scp'ing it down.
#
# Attachments are not covered: they are files under /data/spectron/files, and
# a backup of that directory is a separate job.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/data/spectron/backups}
KEEP_DAYS=${KEEP_DAYS:-14}
CONTAINER=${CONTAINER:-spectron-db}

umask 077
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%d-%H%M%S)
target="$BACKUP_DIR/spectron-$stamp.dump"

docker exec "$CONTAINER" pg_dump -U spectron -Fc --no-owner --no-acl spectron > "$target.part"
mv "$target.part" "$target"

find "$BACKUP_DIR" -name 'spectron-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name '*.part' -mmin +180 -delete

printf '%s wrote %s (%s), %s dumps kept\n' "$(date -u +%FT%TZ)" "$target" \
  "$(du -h "$target" | cut -f1)" "$(find "$BACKUP_DIR" -name 'spectron-*.dump' | wc -l | tr -d ' ')"
