# Spectron MCP server

Agents such as Claude Code, Codex or Cursor can work with Spectron issues through MCP. The server is at:

```
https://<your-spectron>/api/mcp
```

It offers the same operations as the [REST API](api.md), with the same rules: Spectron keys (`SP-12`), names for statuses and other options, emails or `me` for people, and `<@email>` mentions.

## Connecting

### Sign in with OAuth (recommended)

Add the server URL to your client. On first use it opens a browser window: you sign in to Spectron and approve the app. Nothing to copy or paste.

```sh
claude mcp add --transport http spectron https://<your-spectron>/api/mcp
```

Other clients take the same URL in their "remote MCP server" or "HTTP MCP" settings.

The consent screen shows the address the app returns you to. Only approve requests you started yourself. Connecting needs an account with a verified email.

### Personal access token

For clients without OAuth support, or for scripts, send a [personal access token](api.md#authentication) as a header:

```sh
claude mcp add --transport http spectron https://<your-spectron>/api/mcp \
  --header "Authorization: Bearer spk_…"
```

### Disconnecting

Apps you approved are listed under **AI connections & agents → API tokens → Connected apps**. **Disconnect** revokes an app's access immediately, including access tokens that haven't expired yet. Reconnecting later starts a fresh connection; tokens from before stay revoked. Personal access tokens are revoked on the same page.

## Tools

| Tool | Purpose |
|---|---|
| `whoami` | You and your projects |
| `list_projects` | Projects you belong to |
| `get_project` | Statuses (with categories), priorities, types, tags, custom fields and members |
| `search_issues` | Filter by project, status, status category, assignee, title, and created, updated, due and start dates. Supports sorting and cursors |
| `get_issue` | Issue with description, tags and custom fields |
| `create_issue` | Create an issue |
| `update_issue` | Change fields, including status. `null` clears a field |
| `list_comments` | Comments, or one thread's replies |
| `add_comment` | Comment, with `<@email>` mentions, replies and attachments |
| `list_attachments` | Files on an issue |
| `read_file` | Read an attached file: text as text, images as images, anything else as base64 (up to 3 MB) |
| `upload_file` | Upload a base64 file (up to 3 MB) to an issue, or to a project for use in a comment |

When something goes wrong, a tool returns a readable error (for example `invalid_input: Unknown status "Shipped". Available: …`), so the agent can correct the call and retry.

## How it works

- Spectron is its own OAuth 2.1 authorization server, built on Better Auth's MCP plugin.
- Clients discover it from the `401` challenge, which points to `/.well-known/oauth-protected-resource/api/mcp`. That document names the authorization server at `/api/auth`.
- Clients identify themselves in one of two ways:
  - with a [Client ID Metadata Document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/), as in the MCP 2026-07-28 spec
  - by dynamic client registration, for older clients
- Either way, a person must sign in and approve the client.
- Access tokens:
  - are short-lived (1 hour) JWTs bound to the `/api/mcp` audience, refreshed with refresh tokens (30 days)
  - are verified in-process
  - may be DPoP-bound (RFC 9449); bound tokens need a fresh proof on every request
  - only work while the person's email is verified and the app is still connected, and only if they were issued for the current connection
- Writes go through the same services as the app. History, validation and Jira export are unchanged, and edits are attributed to the person.
- Both MCP protocol generations are served: 2026-07-28, and the 2025 stateless HTTP transport.
- Requests from a browser must come from Spectron's own origin. Native and server-side clients send no `Origin` and are unaffected.
- Registrations may not set `backchannel_logout_uri` or `jwks_uri`, since the server would fetch those URLs. MCP clients are public clients and need neither.
- The OAuth provider's own client, consent, logout, UserInfo and introspection endpoints are switched off. Spectron manages connected apps itself.
