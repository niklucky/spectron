# Web application

The main application is a chat-first, three-column workspace: collapsible navigation, a project task list, and a task conversation.

Follow the root README to start Postgres, apply migrations, and configure `.env`. Run `pnpm dev:api` and `pnpm dev:app`, then open `APP_URL`. Change `APP_URL` to `http://127.0.0.1:5175` if the default app port is occupied.

## Authentication

`/login`, `/register`, `/forgot-password`, and `/reset-password` use shared auth components. The workspace requires a session. Reset emails use Resend; links return to `/reset-password?token=…`. Successful password reset requires a fresh login. The account menu saves the display name to the API and signs out of the current session.

## Interactions

- Select projects and tasks, search tasks, and filter by open or unread.
- Open Flow to see tasks from every project, ordered by recent activity. Each row identifies its project, and selecting a task keeps the same conversation and draft as its project view. New tasks in Flow include a project selector.
- Create projects with a name, issue prefix, optional website URL, and logo. Website icons are discovered automatically; uploaded images take priority. The first-project prompt can be skipped for the current login session; use New project in the sidebar to open it again.
- Create a task, change its status, and compose messages with Enter. Shift + Enter inserts a newline.
- Attach local images, audio, video, or files. Microphone recording requires browser permission and a secure origin such as localhost.
- Play attached audio/video and share files within the local task preview.
- Collapse the desktop sidebar and switch between light, dark, and system themes from the account menu.
- On narrow screens, switch between the task list and conversation using the back button.

Tasks, messages, and attachments are in-memory demo data and reset on reload. Accounts, profiles, login sessions, projects, and memberships persist in Postgres. The theme preference is saved locally. Project routes use `#project/<project-id>`, and Flow uses `#flow`. Task links work only within the current page session until task persistence is added.

Overview, Issues, and external integrations are placeholders. Sending a message does not contact Slack, Telegram, Jira, GitHub, or GitLab.

## Files

- `src/app.tsx`: composition and event wiring for the workspace components.
- `src/hooks/use-workspace.ts`: local task/message state, routing, attachments, and recording.
- `src/hooks/use-projects.ts`: project loading, creation, and skippable onboarding.
- `src/lib/trpc.ts`: typed browser client.
- `src/fixtures/`: retained design reference fixtures; new projects do not load sample conversations.
- `../../packages/frontend/src/components/ui/`: shared primitives, including buttons and inputs.
- `../../packages/frontend/src/components/feature/`: chat, task, project, account, and workspace components.
- `../../packages/frontend/src/styles/tokens/`: color and typography source of truth.

Component styles are colocated in `packages/frontend`. The app imports `@spectron/frontend/workspace.css` once; see the frontend package README for conventions.

The assets in `public/demo` are local illustrative samples, not screenshots or recordings of an existing integration. The voice note was synthesized using macOS text-to-speech; the video shows the two SVG interface sketches.
