import type { CSSProperties } from "react";
import type { IssueTrigger } from "@spectron/shared";
import { cn } from "../cn";

/** Maps a workflow trigger to the semantic status color token. */
export function statusColor(trigger: IssueTrigger | string): string {
  switch (trigger) {
    case "started":
    case "in_progress":
      return "var(--sp-warn)";
    case "review":
    case "in_review":
      return "var(--sp-merged)";
    case "finished":
    case "done":
      return "var(--sp-ok)";
    case "blocked":
      return "var(--sp-bad)";
    case "cancelled":
      return "var(--sp-ink-3)";
    default:
      return "var(--sp-ink-3)";
  }
}

/**
 * Status dot. "opened" (to do) renders as a hollow ring, every other state is
 * a filled dot in its color. A custom state color overrides the token.
 */
export function StatusDot({
  trigger,
  color,
  size = 8,
  className = "",
}: {
  trigger: IssueTrigger | string;
  color?: string | null | undefined;
  size?: number | undefined;
  className?: string | undefined;
}) {
  const hollow = !color && (trigger === "opened" || trigger === "todo");
  const fill = color ?? statusColor(trigger);
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={
        {
          width: size,
          height: size,
          background: hollow ? "transparent" : fill,
          boxShadow: hollow ? `inset 0 0 0 1.5px ${fill}` : undefined,
        } as CSSProperties
      }
    />
  );
}

/** Small spinning ring used for working agents and pending actions. */
export function Spinner({
  size = 12,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cn(
        "inline-block shrink-0 animate-spin-slow rounded-full border-[1.5px] border-accent border-r-transparent",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

/** Indeterminate progress line for running agents. */
export function ProgressLine({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative h-0.5 overflow-hidden bg-surface-3",
        className,
      )}
    >
      <span className="absolute inset-y-0 w-2/5 animate-slide rounded-full bg-accent" />
    </div>
  );
}
