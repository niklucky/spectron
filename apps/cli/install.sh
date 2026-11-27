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
#   curl -fsSL https://app.spectron.dev/cli/install.sh | SPECTRON_BIN_DIR=/usr/local/bin sh
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
# wget may not be), checks the SHA-256 and writes the file only if it matches.
# Redirects are refused: the address is exactly the server that served this.
# Exit 3 means a checksum mismatch.
DOWNLOAD='
const [url, file, expected] = process.argv.slice(1);
const { createHash } = require("node:crypto");
const { chmodSync, writeFileSync } = require("node:fs");
(async () => {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) throw new Error(url + " answered " + response.status + ".");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected) process.exit(3);
  writeFileSync(file, bytes, { flag: "wx" });
  // Set explicitly: a mode passed to writeFileSync is reduced by the umask.
  chmodSync(file, 0o755);
})().catch((error) => {
  console.error(error.cause?.message || error.cause?.code || error.message);
  process.exit(1);
});
'

# The absolute form of an existing directory, so the link resolves from anywhere.
absolute() { (CDPATH='' cd -- "$1" && pwd); }

main() {
  server='__SPECTRON_SERVER__'
  checksum='__SPECTRON_SHA256__'

  command -v node >/dev/null 2>&1 ||
    fail "The Spectron CLI needs Node.js 22 or later. Install it from https://nodejs.org, then run this again."
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' </dev/null ||
    fail "The Spectron CLI needs Node.js 22 or later, and this is $(node --version </dev/null). Upgrade Node.js, then run this again."

  install_dir="${SPECTRON_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/spectron}"
  bin_dir="${SPECTRON_BIN_DIR:-$HOME/.local/bin}"
  mkdir -p "$install_dir" "$bin_dir"
  install_dir=$(absolute "$install_dir")
  bin_dir=$(absolute "$bin_dir")
  target="$install_dir/spectron.mjs"
  link="$bin_dir/spectron"
  # Only ever replace our own link, never another program called spectron.
  if [ -L "$link" ]; then
    [ "$(readlink "$link")" = "$target" ] ||
      fail "$link links to $(readlink "$link"), not to $target. Remove it, or choose another directory with SPECTRON_BIN_DIR."
  elif [ -e "$link" ]; then
    fail "$link already exists and isn't a link to the Spectron CLI. Move it away, or choose another directory with SPECTRON_BIN_DIR."
  fi

  # Staged beside the live files and checked before replacing them, so a
  # failure at any step leaves a working install as it was.
  part="$install_dir/.spectron-$$.mjs"
  meta="$install_dir/.install-$$.json"
  trap 'rm -f "$part" "$meta"' EXIT
  say "Downloading the Spectron CLI from $server"
  status=0
  node -e "$DOWNLOAD" "$server/cli/spectron.mjs" "$part" "$checksum" </dev/null || status=$?
  case $status in
    0) ;;
    3) fail "The download doesn't match its checksum, so nothing was installed. Run the install command again." ;;
    *) fail "Couldn't download $server/cli/spectron.mjs." ;;
  esac
  version=$(node "$part" --version </dev/null) ||
    fail "The downloaded CLI doesn't run with this Node.js ($(node --version </dev/null)), so nothing was installed."
  # The CLI reads install.json beside itself: `spectron auth login` signs in here unless told otherwise.
  printf '{ "url": "%s" }\n' "$server" >"$meta"

  mv -f "$meta" "$install_dir/install.json"
  mv -f "$part" "$target"
  [ -L "$link" ] || ln -s "$target" "$link"

  say "Installed spectron $version: $link"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      say ""
      say "$bin_dir isn't on your PATH. Add this line to your shell profile (~/.zshrc, ~/.bashrc):"
      say "  export PATH=\"$bin_dir:\$PATH\""
      ;;
  esac
  say ""
  say "Next: spectron auth login"
}

main "$@"
