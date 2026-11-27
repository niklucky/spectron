# Spectron public API (v1)

REST API for agents, scripts and the upcoming CLI. Base URL: `https://<your-spectron>/api/v1`. Agents that speak MCP can use the [MCP server](mcp.md) instead, which offers the same operations as tools and signs in with OAuth.

## Authentication

Create a personal access token in **AI connections & agents → API tokens**. Send it on every request:

```
Authorization: Bearer spk_…
```

A token acts as you in every project you belong to. Only accounts with a verified email can create tokens, and tokens stop working if the account is not verified. Browser session cookies are not accepted on `/api/v1`. Revoked or expired tokens get `401`.

## Conventions

- **Issues** are addressed by their Spectron key (`SP-12`, case-insensitive) or id. Imported Jira keys are returned as `jiraKey` for reference only and cannot be used to address issues.
- **Projects** are addressed by key (`SP`) or id.
- **People** are addressed by member id, email, or `me`. `GET /projects/{project}` lists members.
- **Statuses, priorities, types and tags** are addressed by name (case-insensitive) or id. Unknown names return `422` with the available names.
- **Dates**: send ISO dates (`2026-12-10`) or date-times (`2026-12-10T09:00:00Z`). A date-only value means midnight UTC. Responses always use full ISO date-times.
- **Date filters**: `…After` is inclusive (`>=`), `…Before` is exclusive (`<`).
- **Errors**: `{ "error": { "code": "…", "message": "…" } }`. Codes are `400` for a malformed request, `401` for auth, `404` when something is not found or not visible to you, `409` for a conflict, `413` when a file is too large, and `422` for a rejected value.
- **Pagination**: list responses include `nextCursor`. Pass it back as `?cursor=` and stop when it is `null`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | You, the token in use, and your projects |
| GET | `/projects` | Projects you belong to |
| GET | `/projects/{project}` | Statuses, priorities, types, tags, custom fields, members |
| GET | `/issues` | Search issues (filters below) |
| POST | `/issues` | Create an issue |
| GET | `/issues/{issue}` | Issue with description, tags and custom fields |
| PATCH | `/issues/{issue}` | Update fields, including status |
| GET | `/issues/{issue}/comments` | Top-level comments, or replies with `?parentId=` |
| POST | `/issues/{issue}/comments` | Comment, with mentions and attachments |
| GET | `/issues/{issue}/attachments` | Files attached to the issue |
| POST | `/issues/{issue}/attachments?filename=…` | Upload the request body and attach it |
| POST | `/issues/{issue}/attachments` | Attach an uploaded file: `{ "fileId": "…" }` |
| POST | `/projects/{project}/files?filename=…` | Upload a file without attaching it (for comments) |
| GET | `/projects/{project}/files/{fileId}` | Download a file (`?download=1` forces attachment) |

### Search issues

`GET /issues` query parameters, all optional:

| Parameter | Example | Notes |
|---|---|---|
| `project` | `SP,OPS` | Default: all your projects |
| `status` | `In progress,Blocked` | Status names or ids |
| `statusCategory` | `opened,in_progress` | `opened`, `in_progress`, `blocked`, `cancelled`, `finished` |
| `assignee` | `me`, `none`, email or id | |
| `q` | `login` | Case-insensitive title search |
| `createdAfter` / `createdBefore` | `2026-11-01` | |
| `updatedAfter` / `updatedBefore` | `2026-11-20T00:00:00Z` | |
| `dueAfter` / `dueBefore` | `2026-12-01` | Due date (“Finish at / deadline”) |
| `startAfter` / `startBefore` | `2026-12-01` | |
| `sort` | `-updated` | `created`, `updated`, `due`, `start`, `key`; prefix `-` for descending. Undated issues sort last |
| `limit` | `50` | 1–200, default 50 |
| `cursor` | | From `nextCursor` |

Deleted issues are excluded.

### Issue fields

`POST /issues` requires `project` and `title`. `PATCH` accepts any subset of the fields below. Send `null` to clear a field.

```json
{
  "title": "Ship the public API",
  "description": "Markdown text",
  "status": "In progress",
  "priority": "High",
  "type": "Task",
  "assignee": "me",
  "parent": "SP-1",
  "tags": ["backend"],
  "startAt": "2026-12-01",
  "dueAt": "2026-12-10",
  "estimateSeconds": 7200
}
```

`parent` is looked up within the issue's own project, so a key prefix shared by several projects is not ambiguous here.

On create you can also send `"attachments": ["<fileId>", …]`, using ids from an upload.

On `PATCH`, only the fields you send are written. Add `"expectedUpdatedAt"` (the issue's `updatedAt`) to get `409` if someone changed the issue since you read it.

Response shape (abridged):

```json
{
  "id": "…", "key": "SP-12", "jiraKey": "OLD-345",
  "project": { "id": "…", "key": "SP" },
  "title": "…",
  "status": { "id": "…", "name": "In progress", "category": "in_progress" },
  "priority": { "id": "…", "name": "High" },
  "type": null,
  "assignee": { "id": "…", "name": "Alice", "email": "alice@example.com" },
  "author": { "id": "…", "name": "Bob", "email": "bob@example.com" },
  "parent": { "id": "…", "key": "SP-1" },
  "startAt": null, "dueAt": "2026-12-10T00:00:00.000Z", "estimateSeconds": null,
  "createdAt": "…", "updatedAt": "…", "deletedAt": null,
  "url": "https://…/#project/…/issues/…"
}
```

`GET /issues/{issue}` also returns `description`, `tags` (names) and `fields` (custom fields by name).

Imported people who have not joined Spectron yet appear with their external id and `"email": null`.

### Comments and mentions

```json
POST /issues/SP-12/comments
{ "body": "Ready for review <@alice@example.com>", "parentId": null, "attachments": ["<fileId>"] }
```

Write `<@email>` or `<@member-id>` to mention a project member. Mentioned people see the issue as a mention in Flow. Responses return mentions as `<@member-id>`, plus a `mentions` list with names. Set `parentId` to reply in a thread.

### Files

```sh
# Upload and attach in one step
curl -X POST -H "Authorization: Bearer $SPECTRON_TOKEN" \
  --data-binary @screenshot.png \
  "$SPECTRON_URL/api/v1/issues/SP-12/attachments?filename=screenshot.png"

# Upload for a comment, then reference the returned id
curl -X POST -H "Authorization: Bearer $SPECTRON_TOKEN" \
  --data-binary @trace.log "$SPECTRON_URL/api/v1/projects/SP/files?filename=trace.log"
```

The server detects the content type from the bytes. Each file's size is capped by the server's `FILES_MAX_BYTES`.

## Examples

```sh
export SPECTRON_URL=https://app.example.com SPECTRON_TOKEN=spk_…
auth=(-H "Authorization: Bearer $SPECTRON_TOKEN")

# My open work, soonest due first
curl "${auth[@]}" "$SPECTRON_URL/api/v1/issues?assignee=me&statusCategory=opened,in_progress&sort=due"

# Issues updated this week in SP
curl "${auth[@]}" "$SPECTRON_URL/api/v1/issues?project=SP&updatedAfter=2026-11-23"

# Move an issue to review and comment
curl -X PATCH "${auth[@]}" -H 'content-type: application/json' \
  -d '{"status":"In review"}' "$SPECTRON_URL/api/v1/issues/SP-12"
curl -X POST "${auth[@]}" -H 'content-type: application/json' \
  -d '{"body":"PR is up: https://github.com/acme/app/pull/42"}' \
  "$SPECTRON_URL/api/v1/issues/SP-12/comments"
```

## Behaviour notes

- Writes go through the same services as the app. History, validation, read state and Jira/Tracker export all behave as if you had made the edit in the UI. History is attributed to the token's owner.
- Status changes are plain field updates. Spectron does not restrict which status can follow which.
