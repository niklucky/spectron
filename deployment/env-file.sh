# Reading one key out of a deployment/.env.<environment> file.
#
# Sourced by provision-app.sh, which takes its own settings from that file,
# and by github-env.sh, which pushes the rest of it to a GitHub environment.
# One parser, so the two cannot disagree about what the format means.
#
# Deliberately not `source`: these files hold secrets, and running one would
# execute whatever a stray backtick in a pasted value happened to contain.
# And no associative array to cache the parse — macOS still ships bash 3.2.
#
# The format is KEY=value, one per line, optional surrounding quotes, #
# comments. A value is read as a single line, so anything multi-line (an SSH
# key, a certificate) goes in the file as a path to a file instead.

# env_file_value <file> <key>
#
# Prints the last assignment of <key>, with one layer of quotes removed, or
# nothing. Last rather than first, so appending a line to the bottom of the
# file overrides what is above it — which is how people expect an env file to
# behave.
env_file_value() {
  local file="$1" key="$2" line value
  [ -f "$file" ] || return 0
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)
  [ -z "$line" ] && return 0
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}
