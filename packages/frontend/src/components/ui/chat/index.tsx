/**
 * Presentational building blocks for the conversation stream. They carry no
 * data fetching; Flow binds them to issue, comment and agent-run data, and the
 * design-system page renders them with sample content.
 *
 * Detail level is controlled by `data-view="simple" | "dev"` on an ancestor.
 * Elements that only developers need carry `hidden dev:block` (or `dev:flex`).
 */
import { useId, useState, type ReactNode } from "react";
import { cn } from "../cn";
import { Icon, type IconName } from "../icon";
import { Avatar, type AvatarKind } from "../avatar";
import { Pill, type Tone } from "../pill";
import { Spinner, ProgressLine } from "../status";

/* ---------- Stream scaffolding ---------- */

export function DaySeparator({ children }: { children: ReactNode }) {
  return (
    <div className="label-caps flex items-center gap-3 pt-4 pb-2.5 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
      {children}
    </div>
  );
}

/** Quiet system line: status change, PR opened, retry. */
export function EventLine({
  icon,
  children,
  className = "",
}: {
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-center py-2", className)}>
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm text-ink-3 [&_b]:font-semibold [&_b]:text-ink-2 [&_a]:text-accent-ink [&_a]:no-underline">
        {icon && <Icon name={icon} size={13} />}
        <span className="truncate">{children}</span>
      </span>
    </div>
  );
}

/* ---------- Messages ---------- */

export type MessageAuthor = {
  name: string;
  image?: string | null | undefined;
  role?: string | undefined;
  kind?: AvatarKind | undefined;
  working?: boolean | undefined;
};

/**
 * One message. People and agents share the anatomy: avatar, name line, body.
 * `own` renders a right-aligned inverted bubble without avatar or name.
 */
export function MessageRow({
  author,
  time,
  timeTitle,
  own = false,
  continued = false,
  state,
  actions,
  children,
  className = "",
  id,
}: {
  author: MessageAuthor;
  time: string;
  timeTitle?: string | undefined;
  own?: boolean | undefined;
  /** Same author as the previous row: hide avatar and name. */
  continued?: boolean | undefined;
  /** Simple-view state pill for agent messages (failed, needs input). */
  state?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  id?: string | undefined;
}) {
  if (own)
    return (
      <article
        id={id}
        className={cn("group relative flex flex-col items-end gap-1 py-1.5", className)}
      >
        <time className="text-xs text-ink-3" title={timeTitle}>
          {time}
        </time>
        <div className="own-bubble flex max-w-[min(78%,600px)] flex-col items-end gap-1.5">
          {children}
        </div>
        {actions && (
          <div className="absolute top-0 left-0 hidden group-hover:flex">
            {actions}
          </div>
        )}
      </article>
    );
  return (
    <article
      id={id}
      className={cn(
        "group relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-3",
        continued ? "-mt-1 pt-0 pb-1.5" : "py-1.5",
        className,
      )}
    >
      <div className="col-start-1 row-start-1">
        {!continued && (
          <Avatar
            name={author.name}
            image={author.image}
            size="lg"
            kind={author.kind ?? "person"}
            working={author.working}
          />
        )}
      </div>
      <div className="col-start-2 min-w-0">
        {!continued && (
          <div className="mb-0.5 flex min-w-0 items-baseline gap-2">
            <span className="text-base font-semibold text-ink">
              {author.name}
            </span>
            {author.role && (
              <span className="truncate text-sm text-ink-3">{author.role}</span>
            )}
            {state}
            <time
              className={cn(
                "ml-auto shrink-0 text-xs text-ink-3",
                author.kind === "agent"
                  ? "opacity-100"
                  : "opacity-0 transition-opacity group-hover:opacity-100",
              )}
              title={timeTitle}
            >
              {time}
            </time>
          </div>
        )}
        {continued && (
          <time
            className="absolute top-0.5 right-0 text-xs text-ink-3 opacity-0 group-hover:opacity-100"
            title={timeTitle}
          >
            {time}
          </time>
        )}
        {children}
      </div>
      {actions && (
        <div className="absolute -top-2.5 right-0 hidden gap-px rounded-lg bg-surface p-0.5 shadow-soft hairline group-hover:flex">
          {actions}
        </div>
      )}
    </article>
  );
}

/** Body text of a message; markdown output is styled through `.prose-chat`. */
export function MessageText({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("prose-chat max-w-[66ch] text-lg", className)}>
      {children}
    </div>
  );
}

/** Inline @mention token inside message text. */
export function Mention({ children }: { children: ReactNode }) {
  return (
    <span className="mention rounded-sm bg-accent-soft px-1.5 py-px font-semibold text-accent-ink">
      @{children}
    </span>
  );
}
/** Inline /command token inside message text. */
export function Command({ children }: { children: ReactNode }) {
  return (
    <span className="command mono rounded-sm bg-accent-soft px-1.5 py-px text-[0.9em] font-medium text-accent-ink">
      /{children}
    </span>
  );
}

/* ---------- Agent results ---------- */

export type ResultTone = "default" | "needs" | "failed";

/**
 * Container for an agent's answer. In Simple view it dissolves into plain
 * text: no border, shadow or chrome, only the summary and human actions.
 */
export function ResultCard({
  tone = "default",
  children,
  className = "",
}: {
  tone?: ResultTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-1.5 overflow-hidden rounded-xl bg-surface shadow-soft hairline",
        tone === "needs" && "border-warn/40",
        tone === "failed" && "border-bad/35",
        "simple:mt-0 simple:overflow-visible simple:rounded-none simple:border-0 simple:bg-transparent simple:shadow-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Request echo: command, requester, repository, state. Developer view only. */
export function ResultRequest({
  command,
  requester,
  repo,
  state,
}: {
  command: ReactNode;
  requester?: string;
  repo?: ReactNode;
  state: ReactNode;
}) {
  return (
    <div className="hidden flex-wrap items-center gap-2 px-3.5 pt-2.5 text-sm text-ink-3 dev:flex">
      {command}
      {requester && <span>for {requester}</span>}
      {repo && (
        <span className="mono inline-flex items-center gap-1 text-xs text-ink-2">
          {repo}
        </span>
      )}
      <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold">
        {state}
      </span>
    </div>
  );
}

export function ResultState({
  tone,
  icon,
  spinning = false,
  children,
}: {
  tone: "done" | "working" | "needs" | "failed" | "stopped";
  icon?: IconName;
  spinning?: boolean;
  children: ReactNode;
}) {
  const color = {
    done: "text-ok",
    working: "text-accent-ink",
    needs: "text-warn",
    failed: "text-bad",
    stopped: "text-ink-3",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5", color)}>
      {spinning ? <Spinner size={11} /> : icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export function ResultSummary({ children }: { children: ReactNode }) {
  return (
    <div className="prose-chat px-3.5 pt-3 pb-1.5 text-md simple:p-0 simple:text-lg">
      {children}
    </div>
  );
}

/** Row of fact chips: checks, diff size, commits. Developer view only. */
export function ResultFacts({ children }: { children: ReactNode }) {
  return (
    <div className="hidden flex-wrap gap-1.5 px-3.5 pt-2 pb-3 dev:flex">
      {children}
    </div>
  );
}
export function Fact({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad";
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-sm",
        tone === "neutral" && "bg-surface-2 text-ink-2 hairline",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
      )}
    >
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

/** Live status line for a running agent. */
export function LiveLine({
  simple,
  detail,
  elapsed,
}: {
  /** Plain-language status for Simple view. */
  simple: ReactNode;
  /** Technical current step for Developer view. */
  detail?: ReactNode;
  elapsed?: string | undefined;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-3.5 py-3 text-base text-ink-2 simple:px-0 simple:pt-0.5 simple:pb-0">
        <span className="inline-flex min-w-0 items-center gap-2 dev:hidden">
          <Spinner size={12} />
          <span className="truncate">{simple}</span>
        </span>
        {detail && (
          <span className="mono hidden min-w-0 items-center gap-1.5 truncate text-sm text-ink after:inline-block after:h-3.5 after:w-1.5 after:animate-blink after:bg-accent dev:inline-flex">
            {detail}
          </span>
        )}
        {elapsed && (
          <span className="mono ml-auto shrink-0 text-xs text-ink-3">{elapsed}</span>
        )}
      </div>
      <ProgressLine className="simple:hidden" />
    </>
  );
}

/** Reason line under a failed summary. Developer view only. */
export function ResultReason({ children }: { children: ReactNode }) {
  return (
    <div className="hidden grid-cols-[16px_minmax(0,1fr)] gap-2 px-3.5 pb-2.5 text-base text-ink-2 dev:grid [&_code]:mono [&_code]:rounded-sm [&_code]:bg-code [&_code]:px-1 [&_code]:text-sm">
      <Icon name="close" size={15} className="mt-0.5 text-bad" />
      <span>{children}</span>
    </div>
  );
}

/** Answer chips for a Needs-input question. Visible in both views. */
export function Choices({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 px-3.5 pt-1 pb-3 simple:px-0 simple:pt-2 simple:pb-1">
      {children}
    </div>
  );
}
export function Choice({
  index,
  more = false,
  onClick,
  disabled,
  children,
}: {
  index?: number | undefined;
  more?: boolean | undefined;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:not-disabled:border-warn hover:not-disabled:bg-warn-soft disabled:opacity-50",
        more ? "border-dashed border-line-2 text-ink-2" : "border-line bg-surface text-ink",
      )}
    >
      {index !== undefined && (
        <span className="mono rounded-sm border border-line-soft px-1 text-xs text-ink-3">
          {index}
        </span>
      )}
      {children}
    </button>
  );
}

/**
 * Action row under a result. `keep` shows it in Simple view too (Retry,
 * answer buttons); otherwise it is Developer-only.
 */
export function ResultFooter({
  keep = false,
  children,
}: {
  keep?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex-wrap items-center gap-1.5 px-2.5 py-2 pl-3.5 hairline-t",
        keep
          ? "flex simple:border-0 simple:px-0 simple:pt-1.5 simple:pb-0"
          : "hidden dev:flex",
      )}
    >
      {children}
    </div>
  );
}

/** Disclosure trigger + panel pair used for Details and Activity. */
export function Disclosure({
  label,
  count,
  children,
  defaultOpen = false,
  panelClassName = "",
}: {
  label: ReactNode;
  count?: number | undefined;
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  panelClassName?: string | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-sm font-medium text-ink-2 hover:bg-surface-3 hover:text-ink"
      >
        <Icon
          name="chevron"
          size={14}
          className={cn("transition-transform", open && "rotate-180")}
        />
        {label}
        {count !== undefined && <span className="text-ink-3">· {count}</span>}
      </button>
      <div
        id={id}
        hidden={!open}
        className={cn("order-last w-full basis-full bg-surface-2 hairline-t", panelClassName)}
      >
        {children}
      </div>
    </>
  );
}

/** Tabs inside a Details panel. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-0.5 px-2.5 pt-2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "rounded-t-md border-b-2 px-2.5 py-1.5 text-sm font-medium",
            tab.value === value
              ? "border-ink text-ink"
              : "border-transparent text-ink-3 hover:text-ink-2",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Monospace activity log. */
export function LogBlock({
  lines,
  className = "",
}: {
  lines: { time?: string; text: ReactNode }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mono overflow-x-auto rounded-lg bg-code px-3 py-2.5 text-xs leading-[1.65] text-ink-2 [&_b]:font-medium [&_b]:text-ink [&_.path]:text-accent-ink",
        className,
      )}
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre">
          {line.time && <span className="mr-2.5 text-ink-3">{line.time}</span>}
          {line.text}
        </div>
      ))}
    </div>
  );
}

/** One row in a checks list. */
export function CheckRow({
  outcome,
  command,
  note,
  duration,
}: {
  outcome: "passed" | "failed" | "not_run" | "skipped";
  command: ReactNode;
  note?: ReactNode;
  duration?: string | undefined;
}) {
  const icon: IconName =
    outcome === "passed" ? "check-circle" : outcome === "failed" ? "alert" : "close";
  const color =
    outcome === "passed" ? "text-ok" : outcome === "failed" ? "text-bad" : "text-ink-3";
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-2.5 text-sm">
      <Icon name={icon} size={14} className={cn("self-center", color)} />
      <span className="mono min-w-0 break-words">
        {command}
        {note && <span className="ml-2 font-sans text-ink-3">{note}</span>}
      </span>
      <span className="mono text-xs text-ink-3">{duration ?? "—"}</span>
    </div>
  );
}

/* ---------- Pull request card ---------- */

export type PullState = "draft" | "open" | "merged" | "closed";

export function PullCard({
  title,
  number,
  state,
  provider = "github",
  branch,
  target,
  additions,
  deletions,
  url,
  actions,
  footer,
  children,
  className = "",
}: {
  title: ReactNode;
  number: number | string;
  state: PullState;
  provider?: "github" | "gitlab" | undefined;
  branch: string;
  target: string;
  additions?: number | undefined;
  deletions?: number | undefined;
  url?: string | undefined;
  actions?: ReactNode;
  /** Status line: checks, reviewers, comments toggle. */
  footer?: ReactNode;
  /** Expanded content, e.g. review threads. */
  children?: ReactNode;
  className?: string;
}) {
  const tone: Tone =
    state === "merged" ? "merged" : state === "open" ? "ok" : state === "closed" ? "bad" : "neutral";
  const iconBg = {
    draft: "bg-surface-3 text-ink-2",
    open: "bg-ok-soft text-ok",
    merged: "bg-merged-soft text-merged",
    closed: "bg-bad-soft text-bad",
  }[state];
  return (
    <div
      className={cn(
        "mx-3.5 mb-3 overflow-hidden rounded-lg bg-surface-2 hairline simple:mx-0",
        className,
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2.5">
        <span className={cn("row-span-2 grid size-[30px] place-items-center rounded-lg", iconBg)}>
          <Icon name={state === "merged" ? "merge" : "pr"} size={16} />
        </span>
        <div className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span className="truncate">{title}</span>
          <span className="mono shrink-0 text-xs font-medium text-ink-3">
            #{number}
          </span>
          <Pill tone={tone} className="shrink-0 capitalize">
            {state}
          </Pill>
        </div>
        <div className="row-span-2 flex items-center gap-1">
          {actions}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-grid size-7 place-items-center rounded-md text-ink-2 hover:bg-surface-3 hover:text-ink"
              title={provider === "gitlab" ? "Open on GitLab" : "Open on GitHub"}
            >
              <Icon name="external" size={14} />
            </a>
          )}
        </div>
        <div className="mono hidden min-w-0 flex-wrap items-center gap-2 text-xs text-ink-3 dev:flex">
          <span className="inline-flex max-w-full items-center gap-1 truncate rounded-sm bg-code px-1.5 text-ink-2">
            <Icon name="branch" size={11} />
            <span className="truncate">{branch}</span>
          </span>
          <span>→ {target}</span>
          {(additions !== undefined || deletions !== undefined) && (
            <span>
              <span className="text-ok">+{additions ?? 0}</span>{" "}
              <span className="text-bad">−{deletions ?? 0}</span>
            </span>
          )}
        </div>
      </div>
      {footer && (
        <div className="flex flex-wrap items-center gap-3.5 px-3 py-1.5 text-sm text-ink-2 hairline-t">
          {footer}
        </div>
      )}
      {children}
    </div>
  );
}

/** One review thread inside a pull card. */
export function ReviewThread({
  author,
  time,
  location,
  resolved = false,
  actions,
  children,
  replies,
}: {
  author: MessageAuthor;
  time: ReactNode;
  location?: ReactNode;
  resolved?: boolean | undefined;
  actions?: ReactNode;
  children: ReactNode;
  replies?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 bg-surface px-3 pt-3 pb-2.5 hairline-t">
      <Avatar name={author.name} image={author.image} size="sm" kind={author.kind} className="col-start-1 row-start-1" />
      <div className="col-start-2 flex min-w-0 flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
        <b className="font-semibold text-ink">{author.name}</b>
        <span>{time}</span>
        {location && (
          <span className="mono hidden rounded-sm bg-code px-1.5 text-xs text-ink-2 dev:inline">
            {location}
          </span>
        )}
        {resolved && (
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-ok">
            <Icon name="check" size={12} /> Resolved
          </span>
        )}
      </div>
      <div className="prose-chat text-base leading-normal text-ink">{children}</div>
      {actions && <div className="-ml-1.5 mt-1 flex flex-wrap gap-px">{actions}</div>}
      {replies}
      </div>
    </div>
  );
}

/* ---------- Composer shell ---------- */

export function ComposerShell({
  chips,
  hint,
  pending,
  tools,
  children,
  className = "",
  overlay,
  ...props
}: {
  chips?: ReactNode;
  hint?: ReactNode;
  pending?: ReactNode;
  tools: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  /** Floating pickers anchored above the composer. */
  overlay?: ReactNode;
} & Omit<React.ComponentProps<"form">, "children" | "popover" | "className">) {
  return (
    <form
      {...props}
      className={cn(
        "relative mx-auto w-full max-w-[764px] rounded-2xl bg-surface shadow-soft hairline transition-shadow focus-within:border-line focus-within:shadow-pop",
        className,
      )}
    >
      {overlay}
      {pending && <div className="flex flex-wrap gap-2.5 px-3 pt-2.5">{pending}</div>}
      {(chips || hint) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          {chips}
          {hint && <span className="ml-1 text-sm text-ink-3">{hint}</span>}
        </div>
      )}
      {children}
      <div className="flex items-center gap-0.5 px-2 pt-1 pb-2">{tools}</div>
    </form>
  );
}

/** Round accent send button. */
export function SendButton({
  disabled,
  label = "Send",
}: {
  disabled?: boolean | undefined;
  label?: string | undefined;
}) {
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="ml-1 grid size-[30px] place-items-center rounded-full bg-accent text-white transition hover:not-disabled:brightness-105 disabled:opacity-35"
    >
      <Icon name="arrow" size={15} strokeWidth={2.2} />
    </button>
  );
}
