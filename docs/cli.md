# Spectron CLI

`spectron` works with issues from the terminal. It is a thin client over the [REST API](api.md), so it follows the same rules: issues are addressed by Spectron key (`SP-12`), people by `me`, email or member id, and statuses, priorities, types and tags by name.

Agents that speak MCP can use the [MCP server](mcp.md) instead. The CLI suits agents that work through a shell (Claude Code, Codex and others), scripts and CI.

## Install

Requires Node.js 22 or later. Every Spectron server serves a CLI that matches its API. On a self-hosted server, use its address instead of `app.spectron.dev`.

### macOS and Linux

```sh
curl -fsSL https://app.spectron.dev/cli/install.sh | sh
```

The script needs no sudo. It downloads the CLI from that server and checks it against a SHA-256 checksum, which the server fills into the script when serving it. It then installs to `~/.local/share/spectron` and links `~/.local/bin/spectron`. If that directory isn't on your `PATH`, it says what to add. `SPECTRON_INSTALL_DIR` and `SPECTRON_BIN_DIR` change the two locations. For example, to install for every user of a container image:

```sh
curl -fsSL https://app.spectron.dev/cli/install.sh -o /tmp/install-spectron.sh &&
  SPECTRON_INSTALL_DIR=/usr/local/lib/spectron SPECTRON_BIN_DIR=/usr/local/bin sh /tmp/install-spectron.sh &&
  rm /tmp/install-spectron.sh
```

This downloads first, then runs, as described for scripts below: a Dockerfile `RUN` has no `pipefail`, so a pipe would let a failed download build an image without the CLI.

In scripts and CI, download the installer first and then run it. With a pipe, the shell reports only `sh`'s status, so a failed download still looks like success:

```sh
curl -fsSL https://app.spectron.dev/cli/install.sh -o install-spectron.sh && sh install-spectron.sh
```

Behind an HTTP proxy, the installer and the CLI use `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, as curl does. On Node 22, also set `NODE_USE_ENV_PROXY=1` for the CLI (Node 22.21 or later); Node 24 needs nothing extra.

Run the install command again to upgrade. It only ever replaces its own `spectron` link: if another program already has that name, it stops and says so.

To uninstall, sign out first with `spectron auth logout`. Then remove what the installer added: the `spectron` link in the bin directory you installed to (`~/.local/bin` by default, or your `SPECTRON_BIN_DIR`), and `spectron.mjs` and `install.json` in the install directory. The install directory is `~/.local/share/spectron` by default, `$XDG_DATA_HOME/spectron` when that is set, or your `SPECTRON_INSTALL_DIR`. With the defaults:

```sh
rm ~/.local/bin/spectron ~/.local/share/spectron/spectron.mjs ~/.local/share/spectron/install.json
rmdir ~/.local/share/spectron
```

### Windows

In PowerShell (Windows PowerShell 5.1 or PowerShell 7):

```powershell
irm https://app.spectron.dev/cli/install.ps1 | iex
```

It needs no administrator rights, and checks the download against its SHA-256 the same way. It installs to `%LOCALAPPDATA%\Programs\spectron` with a `spectron.cmd` launcher in its `bin` folder, puts that folder first in your user `PATH`, and works in the current window right away. Other terminals see it once reopened. Downloads use the system proxy. `SPECTRON_INSTALL_DIR` changes the location. `SPECTRON_NO_MODIFY_PATH=1` leaves `PATH` alone, for example in CI. Run the same command again to upgrade.

`spectron` runs through a `.cmd` launcher, so PowerShell passes its arguments the way it passes them to batch files: an empty argument is dropped. Write an empty value with `=`, as in `--description=` rather than `--description ''`. Text with double quotes is safest in a file: `--description-file notes.md`, `--body-file notes.md`.

To uninstall, run `spectron auth logout`. Then delete `%LOCALAPPDATA%\Programs\spectron` and remove its `bin` folder from your user `PATH` (Settings → System → About → Advanced system settings → Environment Variables).

### From source

In local development, run `pnpm --filter @spectron/cli build` first. Your local server then serves the CLI at `$APP_URL/cli/install.sh` and `$APP_URL/cli/install.ps1`.

From a checkout of this repository instead:

```sh
pnpm install
pnpm --filter @spectron/cli build    # bundles dist/spectron.mjs
npm install -g ./apps/cli            # puts `spectron` on your PATH
```

## Sign in

Create a personal access token in Spectron: account menu → **AI connections & agents** → **API tokens**. Then:

```sh
spectron auth login                     # prompts for the token
echo "$TOKEN" | spectron auth login --with-token
spectron auth status
```

`auth login` picks the server in this order:
1. `--url`
2. `SPECTRON_URL`
3. the server you're already signed in to
4. the server the CLI was installed from

To switch servers, pass `--url`. A CLI built from source has no install server, so it needs `--url` the first time. When prompting, `auth login` names the server before asking for the token.

The URL and token are saved to `~/.config/spectron/config.json`, readable only by you (on Windows, `%APPDATA%\spectron\config.json` in your profile, where file modes are advisory). `$XDG_CONFIG_HOME` and `$SPECTRON_CONFIG_DIR` move it. `spectron auth logout` deletes the file. The token stays valid until you revoke it in Spectron.

`SPECTRON_URL` and `SPECTRON_TOKEN` override the saved login. That suits agents, CI and containers, where nothing needs to be written to disk. A saved token is only sent to the server it was saved for: if `SPECTRON_URL` names a different server, set `SPECTRON_TOKEN` too. The CLI never follows redirects, so use the server's exact address.

## Commands

| Command | Purpose |
|---|---|
| `auth login` / `status` / `logout` | Sign in, show the account, forget the token (`whoami` = `auth status`) |
| `project list` | Projects you belong to |
| `project view SP` | Statuses, priorities, types, tags, custom fields and members |
| `issue list` | Search with filters and sorting |
| `issue view SP-12 [--comments]` | Fields, description, optionally comments |
| `issue create -p SP -t "Title" …` | Create an issue |
| `issue edit SP-12 …` | Change fields |
| `issue status SP-12 In review` | Move to another status |
| `issue assign SP-12 me` | Assign (`me`, email, member id, or `none`) |
| `issue comment SP-12 "text"` | Comment, mention, reply, attach files |
| `issue comments SP-12` | Comments, oldest first (`--replies-to <id>` for a thread) |
| `issue attach SP-12 file…` | Upload and attach files |
| `issue attachments SP-12` | List attached files |
| `file upload SP file…` | Upload without attaching |
| `file download <url>` or `file download SP <file-id>` | Download (`-o path`, `-o -` for stdout) |
| `api <path>` | Call any `/api/v1` endpoint |

`spectron <command> --help` lists every option.

### Searching

```sh
spectron issue list -a me -c opened,in_progress --sort due
spectron issue list -p SP --updated-after 2026-11-23
spectron issue list -s "In review" -q login --sort -created -L 200
```

Filters: `-p/--project`, `-s/--status`, `-c/--category` (`opened`, `in_progress`, `blocked`, `cancelled`, `finished`), `-a/--assignee` (`me`, `none`, email, id), `-q/--search` (title), and `--created-`, `--updated-`, `--due-` and `--start-` each with `-after` (inclusive) or `-before` (exclusive). `--sort` takes `created`, `updated`, `due`, `start` or `key`, with `-` for descending (default `-updated`). `-L/--limit` (default 50) fetches as many pages as needed. When more match, the text output says so and `--json` returns `nextCursor` for `--cursor`.

### Creating and editing

Shared field options: `-t/--title`, `-d/--description` or `--description-file <file|->`, `-s/--status`, `--priority`, `--type`, `-a/--assignee`, `--parent SP-1`, `--tag` (repeat), `--start`, `--due` (dates like `2026-12-10`), and `--estimate` (`2h30m`, `90m`, or seconds).

```sh
spectron issue create -p SP -t "Fix login redirect" --type Bug --priority High -a me --due 2026-12-05 --attach trace.log
git log -1 --format=%B | spectron issue create -p SP -t "Follow up" --description-file -

spectron issue edit SP-12 --add-tag backend --remove-tag triage
spectron issue edit SP-12 --clear due --clear assignee
spectron issue edit SP-12 -t "New title" --expected-updated-at 2026-11-27T10:15:00.000Z
```

On `edit`, `--tag` replaces all tags and `--add-tag`/`--remove-tag` adjust them. `--clear` empties `description`, `priority`, `type`, `assignee`, `parent`, `tags`, `start`, `due` or `estimate`. Adding or removing tags reads the issue first and refuses (`conflict`) if someone changed it in between. `--expected-updated-at` does the same for any edit.

### Comments and mentions

```sh
spectron issue comment SP-12 "Ready for review <@alice@example.com>"
spectron issue comment SP-12 --body-file notes.md --attach screenshot.png
spectron issue comment SP-12 --reply-to <comment-id> "Fixed in abc123"
```

Write `<@email>` or `<@member-id>` to mention a project member. Text output shows mentions as `@Name`; `--json` returns `<@member-id>` plus a `mentions` list.

### Raw API

`spectron api` sends an authenticated request to any endpoint and prints the response:

```sh
spectron api /issues/SP-12
spectron api -X PATCH /issues/SP-12 -d '{"dueAt":"2026-12-20"}'
spectron api /issues -d @new-issue.json
```

`-d` sends JSON (`@file` reads a file, `@-` reads stdin) and implies `POST` unless `-X` says otherwise.

## For agents and scripts

- Add `--json` to any command for the API's own response shapes (see [api.md](api.md)). Errors then go to stderr as `{"error":{"message","code","status"}}`. `code` is the API's error code, `usage` for bad arguments, or `error` otherwise. `status` is present only when the server answered.
- Arguments are strict: extra positional arguments and empty option values (such as an unset `$VAR`) are errors rather than silently ignored. Quote values that contain spaces. Only `--description ""` may be empty.
- Write each option and its value separately (`-s Done`, not `-sDone`). A value may start with a dash (`--sort -created`, `-d "-1 on this"`), so an option whose value is missing takes the next word as its value: `-t -sDone` sets the title to `-sDone`.
- Exit codes: `0` success, `1` API or other error, `2` bad arguments, `4` not signed in or token rejected.
- Text goes to stdout; notes such as "More issues match" go to stderr, so piping stays clean.
- Edits are attributed to the token's owner, like edits made through the API.
