# Spectron CLI

`spectron` works with issues from the terminal. It is a thin client over the [REST API](api.md), so it follows the same rules: issues are addressed by Spectron key (`SP-12`), people by `me`, email or member id, and statuses, priorities, types and tags by name.

Agents that speak MCP can use the [MCP server](mcp.md) instead. The CLI suits agents that work through a shell (Claude Code, Codex and others), scripts and CI.

## Install

Requires Node.js 22 or later. From a checkout of this repository:

```sh
pnpm install
pnpm --filter @spectron/cli build
npm install -g ./apps/cli    # puts `spectron` on your PATH
```

## Sign in

Create a personal access token in Spectron: account menu → **AI connections & agents** → **API tokens**. Then:

```sh
spectron auth login --url https://spectron.example.com    # prompts for the token
echo "$TOKEN" | spectron auth login --url https://spectron.example.com --with-token
spectron auth status
```

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
