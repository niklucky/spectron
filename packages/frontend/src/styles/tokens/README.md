# Text and color tokens

The CSS files in this directory are the source of truth. Their values preserve the slate light theme and blue-gray dark theme. They are plain CSS custom properties, usable by any web framework.

## Typography

| Token | Default | Used for |
| --- | --- | --- |
| `--font-family-sans` | system-ui, sans-serif | Interface font |
| `--font-size-2xs` | 10px | Small avatar initials |
| `--font-size-xs` | 11px | Timestamps and hints |
| `--font-size-sm` | 12px | Message metadata and task status |
| `--font-size-md` | 13px | Secondary labels and file names |
| `--font-size-base` | 14px | Message text and common controls |
| `--font-size-ui` | 15px | Navigation, task titles, inputs |
| `--font-size-lg` | 16px | Chat headings and mobile inputs |
| `--font-size-brand-compact` | 17px | Compact wordmark |
| `--font-size-xl` | 18px | Project and Flow headings |
| `--font-size-2xl` | 20px | Wordmark |
| `--font-size-page-title` | 24px | Public-page title |

Sizes are expressed in rem; pixel equivalents assume a 16px browser root. Weight tokens range from `light` (300) through `bold` (650), preserving the existing intermediate weights. Line-height roles are `ui`, `body`, `dialog`, and `message`. Tracking roles cover UI, headings, labels, wordmark, and avatars.

## Colors

| Group | Tokens |
| --- | --- |
| Surfaces | `--color-surface`, `--color-sidebar`, `--color-list`, `--color-menu`, `--color-composer` |
| Text | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted` |
| Interaction | `--color-hover`, `--color-selected`, `--color-nav-active`, `--color-focus` |
| Action | `--color-accent`, `--color-action`, `--color-on-action` |
| Conversation | `--color-bubble`, `--color-own-bubble` |
| Borders | `--color-line` (subtle dividers), `--color-line-active` (active container borders) |
| Status | `--color-status-todo`, `--color-status-progress`, `--color-status-review`, `--color-status-done` |
| Identity | `--color-avatar-*`, `--color-project-*` |
| Media and feedback | `--color-media-*`, `--color-on-media`, `--color-recording`, `--color-recording-border`, `--color-overlay` |
| Shadows | `--color-shadow-*` |

Light values live in `:root`; dark overrides live in `:root[data-theme="dark"]`. Semantic status and identity colors retain their meaning across themes. The public page retains its neutral foreground/background through `--color-page-text` and `--color-page-background`.

```css
.example {
  color: var(--color-text-primary);
  background: var(--color-surface);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-body);
}
```

Change token values here to adjust the design globally. Do not duplicate hex colors or literal text sizes in component styles. The SVGs in the app's demo assets are illustrative attachments, not live components, and intentionally do not consume theme tokens.

Border tokens use translucent theme-specific values so borders stay soft on every surface in both themes. Keep keyboard focus indicators on the dedicated focus token.

The composer surface is white in light mode and black in dark mode. Light theme surfaces, text, actions, and selections use slate tones.
