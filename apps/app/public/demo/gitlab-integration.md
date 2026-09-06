# GitLab integration notes

Design prototype — sample attachment.

## First version

- Connect a self-hosted GitLab instance.
- Map repositories to Spectron projects.
- Receive merge request and pipeline events in task chats.
- Preserve links to original conversations.

## To clarify

- Which webhook events should create a new conversation?
- How should failed delivery be surfaced?
- Add issue sync after the initial webhook flow.
