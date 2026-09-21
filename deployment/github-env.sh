#!/usr/bin/env bash
#
# Populate a GitHub environment's secrets and variables from a local env file.
#
#   cp deployment/.env.example deployment/.env.production   # fill it in
#   ./deployment/github-env.sh production
#
# Re-runnable: `gh` overwrites, so this is also how a value is rotated. Keys
# left empty in the file are skipped rather than pushed as empty strings, so a
# partially filled file will not wipe what is already configured.
#
# The split below mirrors .github/workflows/release.yml. A secret is redacted
# in logs and unreadable afterwards; a variable is visible to anyone who can
# read the repository. When in doubt, make it a secret.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

# shellcheck source=deployment/env-file.sh
. "$HERE/env-file.sh"

ENVIRONMENT="${1:-}"
# Next to this script rather than relative to the shell, so it works from
# anywhere and the filled-in file sits with the rest of deployment/.
ENV_FILE="${2:-$HERE/.env.${ENVIRONMENT}}"

if [ -z "$ENVIRONMENT" ]; then
  echo "usage: $0 <production|dev> [env-file]" >&2
  exit 1
fi
[ -f "$ENV_FILE" ] || {
  echo "error: $ENV_FILE not found. Start from $HERE/.env.example." >&2
  exit 1
}

command -v gh >/dev/null || { echo 'error: the gh CLI is not installed.' >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: run 'gh auth login' first." >&2; exit 1; }

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# An environment secret needs its environment to exist first, or the push
# fails on a 404 for the environment's public key — which reads like a
# permissions problem rather than a missing environment. gh has no command for
# this; the API call is a PUT, so it creates or leaves alone, and passing no
# body keeps whatever protection rules are already configured.
if ! gh api "repos/$REPO/environments/$ENVIRONMENT" >/dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/environments/$ENVIRONMENT" --silent 2>/dev/null \
    || { echo "error: could not create the '$ENVIRONMENT' environment in $REPO." >&2; exit 1; }
  echo "Created the '$ENVIRONMENT' environment in $REPO"
fi

SECRETS=(
  SSH_HOST
  POSTGRES_PASSWORD
  BETTER_AUTH_SECRET
  # Optional; the API falls back to BETTER_AUTH_SECRET.
  INTEGRATION_SECRET
  INTEGRATION_ENCRYPTION_KEY
  AI_CREDENTIAL_SECRET
  RESEND_API_KEY
)

VARIABLES=(
  APP_URL
  EMAIL_FROM
  GIT_PROVIDER_DNS PROJECT_LOGO_DNS GITLAB_ALLOWED_PRIVATE_ORIGINS
  FILES_MAX_BYTES
  SSH_USER DEPLOY_PATH
  APP_PORT WEB_PORT DB_PORT
  DB_DATA FILES_DATA
)

# A file, not a string, and shipped verbatim: GitHub holds multi-line secret
# values fine, and the workflow writes this one straight out as an SSH key.
#
# It cannot live in the env file as a value — env_file_value reads a single
# line, so a pasted PEM would be truncated to its BEGIN header and the deploy
# would fail somewhere much less obvious.
FILE_SECRETS=(
  'SSH_PRIVATE_KEY_PATH:SSH_PRIVATE_KEY'
)

value_for() { env_file_value "$ENV_FILE" "$1"; }

# Paths in the env file are relative to the repository root, so they read the
# same whichever directory this is run from.
resolve_path() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s/%s' "$ROOT" "${1#./}" ;;
  esac
}

# `gh secret set` has no --body-file: with no --body it reads stdin, which is
# also how the value stays off the process list.
set_secret() {
  printf '%s' "$2" | gh secret set "$1" --env "$ENVIRONMENT" >/dev/null
  echo "  secret   $1"
}

set_variable() {
  gh variable set "$1" --env "$ENVIRONMENT" --body "$2" >/dev/null
  echo "  variable $1"
}

echo "Configuring the '$ENVIRONMENT' environment of $REPO from $ENV_FILE"
echo

skipped=()
# bash 3.2 treats an empty array as unset under `set -u`.
set +u

for name in "${SECRETS[@]}"; do
  value=$(value_for "$name")
  if [ -z "$value" ]; then skipped[${#skipped[@]}]="$name"; continue; fi
  set_secret "$name" "$value"
done

for name in "${VARIABLES[@]}"; do
  value=$(value_for "$name")
  if [ -z "$value" ]; then skipped[${#skipped[@]}]="$name"; continue; fi
  set_variable "$name" "$value"
done

for pair in "${FILE_SECRETS[@]}"; do
  path=$(value_for "${pair%%:*}")
  secret_name="${pair##*:}"
  if [ -z "$path" ]; then skipped[${#skipped[@]}]="$secret_name"; continue; fi
  path=$(resolve_path "$path")
  if [ ! -f "$path" ]; then
    echo "  WARNING  $secret_name: $path does not exist, skipping" >&2
    continue
  fi
  # Straight from the file on stdin: no shell variable ever holds the key, and
  # no trailing-newline surprise from a here-string.
  gh secret set "$secret_name" --env "$ENVIRONMENT" < "$path" >/dev/null
  echo "  secret   $secret_name  (from $path)"
done

# Pinned now rather than scanned at deploy time: a keyscan from the runner
# trusts whatever answers on the day. Derived from SSH_HOST, so it is not
# something to keep in the env file.
host=$(value_for SSH_HOST)
if [ -n "$host" ]; then
  if known=$(ssh-keyscan -T 10 "$host" 2>/dev/null) && [ -n "$known" ]; then
    set_secret SSH_KNOWN_HOSTS "$known"
  else
    echo "  WARNING  SSH_KNOWN_HOSTS: could not reach $host; the deploy will fall back to ssh-keyscan" >&2
  fi
fi

echo
if [ ${#skipped[@]} -gt 0 ]; then
  echo "Not set (left empty in $ENV_FILE):"
  printf '  %s\n' "${skipped[@]}"
  echo
fi
echo "Review at: https://github.com/$REPO/settings/environments"
