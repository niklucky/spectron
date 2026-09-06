# Web application

The main application is a chat-first, three-column workspace: collapsible navigation, a project task list, and a task conversation.

Follow the root README to start Postgres, apply migrations, and configure `.env`. Run `pnpm dev:api` and `pnpm dev:app`, then open `APP_URL`. Change `APP_URL` to `http://127.0.0.1:5175` if the default app port is occupied.

## Authentication

`/login`, `/register`, `/forgot-password`, and `/reset-password` use shared auth components. The workspace requires a session. Reset emails use Resend; links return to `/reset-password?token=…`. Successful password reset requires a fresh login. The account menu saves the display name to the API and signs out of the current session.

## Interactions

- Select projects and tasks, search tasks, and filter by open or unread.
- Open Flow to see tasks from every project, ordered by recent activity. Each row identifies its project, and selecting a task keeps the same conversation and draft as its project view. New tasks in Flow include a project selector.
- Create a task, change its status, and compose messages with Enter. Shift + Enter inserts a newline.
- Attach local images, audio, video, or files. Microphone recording requires browser permission and a secure origin such as localhost.
- Play the sample voice note and video, expand gallery images, and download the Markdown attachment.
- Collapse the desktop sidebar and switch between light, dark, and system themes from the account menu.
- On narrow screens, switch between the task list and conversation using the back button.

Tasks, messages, and attachments are in-memory demo data and reset on reload. Accounts, profiles, and login sessions persist in Postgres. The theme preference is saved locally. Existing sample tasks support URL fragments such as `#SP-123` and `#flow/OR-21`; Flow links retain the all-project view on reload. Links to newly created demo tasks only work within the current page session.

Overview, Issues, and external integrations are placeholders. Sending a message does not contact Slack, Telegram, Jira, GitHub, or GitLab.

## Files

- `src/app.tsx`: composition and event wiring for the workspace components.
- `src/hooks/use-workspace.ts`: local task/message state, routing, attachments, and recording.
- `src/mock-data.ts`: sample tasks and project metadata.
- `src/fixtures/`: sample conversation and preview media metadata.
- `../../packages/frontend/src/components/ui/`: shared primitives, including buttons and inputs.
- `../../packages/frontend/src/components/feature/`: chat, task, project, account, and workspace components.
- `../../packages/frontend/src/styles/tokens/`: color and typography source of truth.

Component styles are colocated in `packages/frontend`. The app imports `@spectron/frontend/workspace.css` once; see the frontend package README for conventions.

The assets in `public/demo` are local illustrative samples, not screenshots or recordings of an existing integration. The voice note was synthesized using macOS text-to-speech; the video shows the two SVG interface sketches.
