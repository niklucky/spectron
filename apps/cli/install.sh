#!/bin/sh
# Installs or upgrades the Spectron CLI:
#
#   curl -fsSL https://app.spectron.dev/cli/install.sh | sh
#
# The Spectron server fills in its own address and the CLI's checksum when it
# serves this file, so the CLI signs in to that server by default and a
# damaged download is refused. Needs Node.js 22 or later.
#
# Installs to ~/.local/share/spectron and links ~/.local/bin/spectron.
# SPECTRON_INSTALL_DIR and SPECTRON_BIN_DIR change those, e.g.
#   curl -fsSL https://app.spectron.dev/cli/install.sh -o /tmp/install-spectron.sh &&
#     SPECTRON_INSTALL_DIR=/usr/local/lib/spectron SPECTRON_BIN_DIR=/usr/local/bin sh /tmp/install-spectron.sh
#
# Everything runs inside main(), called on the last line, so a download that
# is cut short runs nothing.

set -eu

say() { printf '%s\n' "$*"; }
fail() {
  printf 'spectron install: %s\n' "$*" >&2
  exit 1
}

# Downloads with Node itself (already required, and present where curl or
# wget may not be) into the staging directory: spectron.mjs only if its
# SHA-256 matches, and install.json naming the server. Redirects are refused:
# the address is exactly the server that served this. Exit 3 means a checksum
# mismatch.
DOWNLOAD='
const [server, stage, expected] = process.argv.slice(1);
const { createHash } = require("node:crypto");
const { chmodSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
(async () => {
  const url = server + "/cli/spectron.mjs";
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(120000) });
  if (response.status !== 200) throw new Error(url + " answered " + response.status + ".");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected) process.exit(3);
  // Modes set explicitly: a mode passed to writeFileSync is reduced by the umask.
  writeFileSync(join(stage, "spectron.mjs"), bytes, { flag: "wx" });
  chmodSync(join(stage, "spectron.mjs"), 0o755);
  // The CLI reads install.json beside itself: auth login signs in here unless told otherwise.
  writeFileSync(join(stage, "install.json"), JSON.stringify({ url: server }) + "\n", { flag: "wx" });
  chmodSync(join(stage, "install.json"), 0o644);
})().catch((error) => {
  console.error(error.cause?.message || error.cause?.code || error.message);
  process.exit(1);
});
'

# The physical absolute path of an existing directory, so the link resolves
# from anywhere and `..` means what it meant to mkdir.
absolute() { (CDPATH='' cd -P -- "$1" && pwd -P); }

# On a signal: stop the download, then exit, which runs the EXIT cleanup.
# (dash and BusyBox ash skip the EXIT trap on signals unless the shell exits.)
stop() {
  if [ -n "${child:-}" ]; then
    kill "$child" 2>/dev/null || :
    wait "$child" 2>/dev/null || :
  fi
  exit "$1"
}

main() {
  server=__SPECTRON_SERVER__
  checksum='__SPECTRON_SHA256__'

  command -v node >/dev/null 2>&1 ||
    fail "The Spectron CLI needs Node.js 22 or later. Install it from https://nodejs.org, then run this again."
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' </dev/null ||
    fail "The Spectron CLI needs Node.js 22 or later, and this is $(node --version </dev/null). Upgrade Node.js, then run this again."

  if [ -z "${HOME:-}" ]; then
    if { [ -z "${SPECTRON_INSTALL_DIR:-}" ] && [ -z "${XDG_DATA_HOME:-}" ]; } || [ -z "${SPECTRON_BIN_DIR:-}" ]; then
      fail "HOME isn't set. Set SPECTRON_INSTALL_DIR and SPECTRON_BIN_DIR to choose where to install."
    fi
  fi
  install_dir="${SPECTRON_INSTALL_DIR:-${XDG_DATA_HOME:-${HOME:-}/.local/share}/spectron}"
  bin_dir="${SPECTRON_BIN_DIR:-${HOME:-}/.local/bin}"
  # New directories are readable by everyone whatever the umask, so a shared
  # install works for every user. Existing ones keep their permissions.
  (umask 022 && mkdir -p "$install_dir" "$bin_dir")
  install_dir=$(absolute "$install_dir")
  bin_dir=$(absolute "$bin_dir")
  target="$install_dir/spectron.mjs"
  meta="$install_dir/install.json"
  link="$bin_dir/spectron"
  # Only ever replace our own link, never another program called spectron.
  if [ -L "$link" ]; then
    [ "$(readlink "$link")" = "$target" ] ||
      fail "$link links to $(readlink "$link"), not to $target. Remove it, or choose another directory with SPECTRON_BIN_DIR."
  elif [ -e "$link" ]; then
    fail "$link already exists and isn't a link to the Spectron CLI. Move it away, or choose another directory with SPECTRON_BIN_DIR."
  fi
  for path in "$target" "$meta"; do
    [ ! -d "$path" ] || fail "$path is a directory. Remove it, or choose another directory with SPECTRON_INSTALL_DIR."
  done

  # Staged in a private directory of its own and checked before replacing
  # anything, so a failure at any step leaves a working install as it was.
  # umask 077 keeps it usable (0700) even under umask 177.
  stage=$(umask 077 && mktemp -d "$install_dir/.staging.XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  trap 'stop 130' INT
  trap 'stop 143' TERM
  trap 'stop 129' HUP
  say "Downloading the Spectron CLI from $server"
  # Node's fetch uses HTTPS_PROXY, HTTP_PROXY and NO_PROXY only when asked,
  # like curl did for this script. (On Node 22 this needs 22.21 or later.)
  if [ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}" ]; then
    NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"
    export NODE_USE_ENV_PROXY
  fi
  # In the background, so a signal is handled at once rather than after the download.
  node -e "$DOWNLOAD" "$server" "$stage" "$checksum" </dev/null &
  child=$!
  status=0
  wait "$child" || status=$?
  child=
  case $status in
    0) ;;
    3) fail "The download doesn't match its checksum, so nothing was installed. Run the install command again." ;;
    *) fail "Couldn't download $server/cli/spectron.mjs." ;;
  esac
  # Run as the link will run it: through its shebang, from this file system.
  version=$("$stage/spectron.mjs" --version </dev/null) ||
    fail "The downloaded CLI doesn't run with this Node.js ($(node --version </dev/null)), so nothing was installed."

  mv -f "$stage/install.json" "$meta"
  mv -f "$stage/spectron.mjs" "$target"
  [ -L "$link" ] || ln -s "$target" "$link"
  # Something else may have claimed the name while this ran.
  [ "$(readlink "$link" 2>/dev/null)" = "$target" ] ||
    fail "$link changed during the install and doesn't point to $target. Check it, then run this again."

  say "Installed spectron $version: $link"
  # Which spectron a new shell would run, resolved like the link.
  found=$(command -v spectron 2>/dev/null || :)
  if [ -z "$found" ]; then
    say ""
    say "$bin_dir isn't on your PATH. Add this line to your shell profile (~/.zshrc, ~/.bashrc):"
    say "  export PATH=\"$bin_dir:\$PATH\""
  elif [ "$(absolute "$(dirname "$found")")/spectron" != "$link" ]; then
    say ""
    say "Another spectron comes first on your PATH: $found. Remove it (for an npm install: npm uninstall -g @spectron/cli), or put $bin_dir before it in PATH."
  fi
  say ""
  say "Next: spectron auth login"
}

main "$@"
