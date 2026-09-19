import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

export type Tone =
  | "neutral"
  | "accent"
  | "ok"
  | "warn"
  | "bad"
  | "merged"
  | "ink";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  merged: "bg-merged-soft text-merged",
  ink: "bg-ink text-surface",
};

/** Small rounded label: status, state, counts, access badges. */
export function Pill({
  tone = "neutral",
  mono = false,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone | undefined;
  mono?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-semibold whitespace-nowrap",
        mono && "mono font-medium",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Round counter, e.g. unread messages. */
export function Badge({
  children,
  quiet = false,
  className = "",
}: {
  children: ReactNode;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
        quiet ? "bg-surface-3 text-ink-2" : "bg-accent text-white",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Editable token above the composer: mention, command, repository. */
export function Chip({
  tone = "accent",
  mono = false,
  onRemove,
  removeLabel = "Remove",
  className = "",
  children,
}: {
  tone?: "accent" | "neutral" | undefined;
  mono?: boolean | undefined;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-md pl-2 text-xs font-semibold",
        onRemove ? "pr-1" : "pr-2",
        tone === "accent"
          ? "bg-accent-soft text-accent-ink"
          : "bg-surface-3 text-ink-2",
        mono && "mono text-xs font-medium",
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="grid size-4 place-items-center rounded-sm opacity-70 hover:bg-black/10 hover:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-[11px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
