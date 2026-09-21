#!/usr/bin/env bash
#
# Provision the spectron half of the VPS: packages, the deploy user's key, the
# data directories, nginx and TLS for spectron.dev and app.spectron.dev.
#
#   ./deployment/provision-app.sh                 # everything
#   ./deployment/provision-app.sh --skip-certs    # before DNS points here
#   ./deployment/provision-app.sh --certs-only    # once it does
#   ./deployment/provision-app.sh --nginx-only    # after editing nginx/
#
# Run it from your workstation; it ssh's to the box itself. It is idempotent:
# packages already installed are left alone, the deploy key is appended only
# if it is not already there, an existing database directory is never touched,
# and certificates are reused until they are actually due for renewal.
#
# The host is shared with testron, so this script only ever adds: it creates
# nothing outside /opt/spectron, /data/spectron and the two spectron nginx
# sites, and it does not change the host's SSH policy — whoever provisioned
# the box first owns that. It warns if password authentication is still on.
#
# What it does NOT do: open a firewall, deploy the stack, or create the
# database. GitHub Actions deploys; see deployment/README.md.
#
# Compatible with the bash 3.2 that macOS ships.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

usage() {
  cat <<'HELP'
Usage: deployment/provision-app.sh [options]
  --env=NAME       Read deployment/.env.NAME (default: production)
  --host=HOST      Override SSH_TARGET (an SSH alias, or user@host)
  --nginx-only     Re-render and reload nginx only; requires existing certificates
  --certs-only     Render nginx and issue or renew certificates only
  --skip-certs     Full run without issuance; the TLS sites are left unconfigured
                   and HTTP answers 503, with the ACME path still live
  -h, --help       Show this help
HELP
}

MODE=full
SKIP_CERTS=0
ENV_NAME=production
for arg in "$@"; do
  case "$arg" in
    --nginx-only|--certs-only)
      [ "$MODE" = full ] || die 'Select only one mode'
      MODE=${arg#--}; MODE=${MODE%-only} ;;
    --skip-certs) SKIP_CERTS=1 ;;
    --env=*) ENV_NAME=${arg#*=} ;;
    --host=*) SSH_TARGET=${arg#*=} ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

case "$ENV_NAME" in
  *[!a-zA-Z0-9_-]*|'') die 'Invalid environment name' ;;
esac
[ "$MODE" = full ] || [ "$SKIP_CERTS" = 0 ] || die '--skip-certs applies only to a full run'

ENV_FILE="$HERE/.env.$ENV_NAME"

# shellcheck source=deployment/env-file.sh
. "$HERE/env-file.sh"

# setting NAME [DEFAULT]
#
# The shell wins over the file, and the file over the default. `${NAME+set}`
# rather than a -n test, so `INCLUDE_WWW= ./provision-app.sh` counts as an
# explicit empty rather than falling through to what the file says.
setting() {
  local name="$1" default="${2-}" value
  if [ -n "${!name+set}" ]; then return; fi
  value=$(env_file_value "$ENV_FILE" "$name")
  [ -n "$value" ] || value="$default"
  printf -v "$name" '%s' "$value"
}

setting SSH_TARGET testron
setting SSH_PORT
setting SSH_IDENTITY_FILE
setting DEPLOY_KEY_FILE deploy_key.pub
# The env file calls this SSH_USER: it is the account the deploy workflow logs
# in as, and this script is what installs its key. Accept either name, so the
# two halves of .env.production cannot disagree about who deploys.
setting SSH_USER github
setting DEPLOY_USER "$SSH_USER"
setting CERT_EMAIL
setting INCLUDE_WWW 0
setting DEPLOY_PATH /opt/spectron
setting DB_DATA /data/spectron/db
setting FILES_DATA /data/spectron/files
setting APP_PORT 4500
setting WEB_PORT 4501

# Everything below is rendered into a remote shell or an nginx file, so the
# shapes are checked here rather than trusted.
case "$SSH_TARGET" in
  ''|*[!a-zA-Z0-9._@-]*) die 'Set SSH_TARGET to an SSH alias or user@host' ;;
esac
if [ -n "$SSH_PORT" ]; then
  case "$SSH_PORT" in *[!0-9]*|'') die 'Invalid SSH_PORT' ;; esac
  [ "$SSH_PORT" -gt 0 ] && [ "$SSH_PORT" -le 65535 ] || die 'Invalid SSH_PORT'
fi
case "$DEPLOY_USER" in ''|*[!a-z0-9_-]*) die 'Invalid DEPLOY_USER' ;; esac
case "$INCLUDE_WWW" in 0|1) ;; *) die 'INCLUDE_WWW must be 0 or 1' ;; esac
for name in APP_PORT WEB_PORT; do
  case "${!name}" in *[!0-9]*|'') die "Invalid $name" ;; esac
  [ "${!name}" -gt 0 ] && [ "${!name}" -le 65535 ] || die "Invalid $name"
done
[ "$APP_PORT" != "$WEB_PORT" ] || die 'APP_PORT and WEB_PORT must differ'
for name in DEPLOY_PATH DB_DATA FILES_DATA; do
  case "${!name}" in
    /*) ;;
    *) die "$name must be an absolute path" ;;
  esac
  case "${!name}" in *[!a-zA-Z0-9/._-]*) die "Invalid characters in $name" ;; esac
done
# Optional. Let's Encrypt ended expiration notifications and now discards the
# contact however you set it, so an empty value costs nothing there — and this
# box already has an ACME account, which certbot reuses either way. Kept for
# other ACME CAs, and validated when it is set.
if [ -n "$CERT_EMAIL" ]; then
  case "$CERT_EMAIL" in
    ?*@?*.?*) ;;
    *) die "CERT_EMAIL does not look like an email address" ;;
  esac
  case "$CERT_EMAIL" in *[!a-zA-Z0-9._%+@-]*) die 'Invalid characters in CERT_EMAIL' ;; esac
fi

for cmd in ssh ssh-keygen tar mktemp; do
  command -v "$cmd" >/dev/null || die "Missing local command: $cmd"
done

ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15)
[ -z "$SSH_PORT" ] || ssh_opts+=(-p "$SSH_PORT")
if [ -n "$SSH_IDENTITY_FILE" ]; then
  [ -f "$SSH_IDENTITY_FILE" ] || die 'SSH_IDENTITY_FILE does not exist'
  ssh_opts+=(-i "$SSH_IDENTITY_FILE" -o IdentitiesOnly=yes)
fi
# The arguments are remote command strings assembled from the validated values
# above, not from anything a remote host said.
# shellcheck disable=SC2029
remote() { ssh "${ssh_opts[@]}" "$SSH_TARGET" "$@"; }

bundle=$(mktemp -d)
stage=''
cleanup() {
  local rc=$?
  trap - EXIT
  [ -z "$stage" ] || remote "rm -rf -- '$stage'" >/dev/null 2>&1 || true
  rm -rf "$bundle"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077

step "Preflight"

remote true 2>/dev/null || die "cannot ssh to $SSH_TARGET (needs a working key and BatchMode)"

if [ "$MODE" = full ]; then
  key_path="$DEPLOY_KEY_FILE"
  case "$key_path" in /*) ;; *) key_path="$HERE/$key_path" ;; esac
  if [ ! -s "$key_path" ]; then
    cat >&2 <<HELP
Error: missing deploy key $key_path

Generate the pair, then re-run. The private half goes to GitHub as the
SSH_PRIVATE_KEY secret and is never uploaded to the server:

  ssh-keygen -t ed25519 -N '' -C 'github-deploy@spectron' \\
    -f ${key_path%.pub}
HELP
    exit 1
  fi
  # A public key, not a private one: this is appended to authorized_keys, and
  # confusing the two would publish the private half to the box.
  read -r first_line < "$key_path" || true
  case "$first_line" in
    ssh-*|ecdsa-*|sk-*) ;;
    *) die "$key_path is not a public key. Do not point DEPLOY_KEY_FILE at the private half." ;;
  esac
  ssh-keygen -lf "$key_path" >/dev/null || die "Invalid public key in $key_path"
  # It rides to the box in a file, but the fingerprint is worth showing.
  printf '   deploy key %s\n' "$(ssh-keygen -lf "$key_path")"
  cp "$key_path" "$bundle/DEPLOY_KEY_FILE"
fi

cp "$HERE/provision-server.sh" "$bundle/"
cp -R "$HERE/nginx" "$bundle/"

# Written with printf %q from values this script has already validated, and
# sourced rather than parsed on the far side.
: > "$bundle/settings.sh"
for name in MODE SKIP_CERTS DEPLOY_USER DEPLOY_PATH DB_DATA FILES_DATA \
            APP_PORT WEB_PORT CERT_EMAIL INCLUDE_WWW; do
  printf '%s=%q\n' "$name" "${!name}" >> "$bundle/settings.sh"
done

printf '   host %s, environment %s, mode %s\n' "$SSH_TARGET" "$ENV_NAME" "$MODE"

uid=$(remote id -u)
sudo_cmd=''
if [ "$uid" != 0 ]; then
  sudo_cmd='sudo -n'
  remote 'sudo -n true' || die 'the provisioning account needs passwordless sudo'
fi

step "Staging"

stage=$(remote 'umask 077; mktemp -d /tmp/spectron-provision.XXXXXXXX')
case "$stage" in
  /tmp/spectron-provision.*) ;;
  *) die 'Unexpected remote staging path' ;;
esac

# macOS tar stamps files with xattrs that GNU tar warns about once per file.
tar_opts=()
[ "$(uname)" != Darwin ] || tar_opts+=(--no-mac-metadata --no-xattrs)
COPYFILE_DISABLE=1 tar "${tar_opts[@]}" -C "$bundle" -cf - . | remote "tar -C '$stage' -xf -"

remote "$sudo_cmd bash '$stage/provision-server.sh' '$stage'"

step "Done"

server_ip=$(remote "ip -4 route get 1.1.1.1 | sed -n 's/.*src \([0-9.]*\).*/\1/p'" || true)
cat <<SUMMARY
   Deploy user    $DEPLOY_USER@${server_ip:-$SSH_TARGET}
   Deploy path    $DEPLOY_PATH
   Database       $DB_DATA
   Files          $FILES_DATA
   Loopback       app :$APP_PORT   web :$WEB_PORT

   GitHub environment: SSH_HOST=${server_ip:-?}, SSH_USER=$DEPLOY_USER,
   DEPLOY_PATH=$DEPLOY_PATH.

   Next:
     ./deployment/github-env.sh $ENV_NAME
     git tag v0.1.0 && git push origin v0.1.0
SUMMARY
