# Frontend

Shared React UI for Spectron. The approved chat design is the baseline; this package contains its tokens, primitives, and feature components.

```text
src/
  styles/tokens/
    colors.css           Semantic colors, light and dark themes
    typography.css       Font family, sizes, weights, line heights, tracking
    index.css            Tokens-only entry
  components/
    ui/
      button/            Button, IconButton
      input/             Input, Textarea, Select
      icon/
      avatar/
      dialog/
      toast/
      page/
    feature/
      chat/              Header, timeline, composer, messages, media
      task/              Task list, rows, status, task creation dialog
      project/           Project icon
      account/           Account menu, profile dialog
      workspace/         Sidebar, layout, workspace dialogs
  hooks/use-theme.ts
  styles.css             Base document and public Page styles
  ui.css                 Theme and common component styles
  workspace.css          UI styles plus feature styles
```

## Imports

```tsx
import "@spectron/frontend/styles.css";
import "@spectron/frontend/ui.css";
import { Button } from "@spectron/frontend/components/ui/button";
import { Input } from "@spectron/frontend/components/ui/input";

<Input aria-label="Task title" placeholder="What are we working on?" />;
<Button onClick={save}>Save</Button>;
```

For the full workspace, import `@spectron/frontend/workspace.css` instead of `ui.css`. Styles live beside the relevant components and are assembled by these CSS entry points; TypeScript imports do not load CSS implicitly. This keeps base, primitive, and feature overrides in a predictable order.

Feature imports follow the same structure:

```tsx
import { ChatHeader, ChatComposer } from "@spectron/frontend/components/feature/chat";
import { TaskList } from "@spectron/frontend/components/feature/task";
```

## Design tokens

Import `@spectron/frontend/tokens.css` when only the custom properties are needed. See [the token reference](src/styles/tokens/README.md) for the scale and roles. All component text sizes, weights, line heights, tracking, and color values use these tokens. Layout dimensions and spacing remain component-owned.

Set `data-theme="light"` or `data-theme="dark"` on the document root. `useTheme` resolves the system preference and persists the chosen mode locally. Components consume the same semantic color names in either theme.

## Boundaries

`ui` contains general components and never imports `feature`. Features compose primitives and expose typed props for data and callbacks. Input primitives accept native attributes and React refs; buttons default to `type="button"`, with explicit `type="submit"` for forms.

Keep app state, routing, demo fixtures, service calls, and integration credentials outside this package. The current app owns those concerns in `apps/app/src/hooks` and `apps/app/src/fixtures`. Shared feature components receive messages, tasks, project metadata, media URLs, and event handlers through props.

When adding a component, colocate its implementation and CSS, export it through its group, and add its CSS to `ui.css` or `workspace.css`. Reuse existing tokens before introducing new roles. Keep server logic out of this package.

Auth screens are exported from `@spectron/frontend/components/feature/auth`. Import `@spectron/frontend/auth.css` for their styles. They accept a submit callback; the application owns API requests and session state.
