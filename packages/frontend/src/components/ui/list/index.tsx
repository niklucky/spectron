import type { ReactNode } from "react";
import { cn } from "../cn";
import { Avatar } from "../avatar";
import { Icon } from "../icon";
import { StatusDot } from "../status";
import { Badge } from "../pill";
import { ProjectMark } from "../../feature/project/project-mark";
import type { Project } from "../../feature/task/types";

/** Group label inside the issue list: "Agents working", "Today". */
export function ListGroup({ children }: { children: ReactNode }) {
  return <div className="label-caps px-3 pt-[18px] pb-2 first:pt-2">{children}</div>;
}

/**
 * One conversation in the issue list. Left column stacks the assignee's
 * avatar (a placeholder when unassigned) over the project mark; the text
 * column has key line, title, and preview.
 */
export function IssueRow({
  assignee,
  project,
  statusTrigger,
  statusColor,
  issueKey,
  time,
  timeTitle,
  title,
  preview,
  unread = 0,
  active = false,
  onClick,
  ariaCurrent,
}: {
  assignee?: { name: string; image?: string | null | undefined } | null | undefined;
  project: Pick<Project, "name" | "initial" | "logo">;
  statusTrigger: string;
  statusColor?: string | null | undefined;
  issueKey: string;
  time: string;
  timeTitle?: string | undefined;
  title: string;
  preview?: ReactNode;
  unread?: number | undefined;
  active?: boolean | undefined;
  onClick?: (() => void) | undefined;
  ariaCurrent?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ariaCurrent ? "true" : undefined}
      className={cn(
        "grid w-full grid-cols-[34px_minmax(0,1fr)] items-start gap-x-3 rounded-[11px] px-3 pt-3 pb-[13px] text-left transition-colors",
        active
          ? "bg-surface-2"
          : "hover:bg-[color-mix(in_srgb,var(--sp-surface-2)_70%,transparent)]",
        unread > 0 && "is-unread",
      )}
    >
      <span className="mt-0.5 flex flex-col items-center gap-1.5">
        {assignee ? (
          <Avatar name={assignee.name} image={assignee.image} size="lg" title={`Assignee: ${assignee.name}`} />
        ) : (
          <span
            className="inline-grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-ink-3"
            title="Unassigned"
            aria-label="Unassigned"
          >
            <Icon name="user" size={16} />
          </span>
        )}
        <ProjectMark project={project} size="sm" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex h-4 min-w-0 items-center gap-1.5 text-xs text-ink-3">
          <StatusDot trigger={statusTrigger} color={statusColor} />
          <span className="mono text-xs text-ink-2">{issueKey}</span>
          <time className="ml-auto shrink-0" title={timeTitle}>
            {time}
          </time>
        </span>
        <span
          className={cn(
            "clamp-2 text-base leading-[1.3] tracking-[-0.01em] text-ink",
            unread > 0 ? "font-bold" : "font-medium",
          )}
        >
          {title}
        </span>
        {(preview || unread > 0) && (
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm",
                unread > 0 ? "text-ink [&_b]:font-semibold [&_b]:text-ink" : "text-ink-2 [&_b]:font-semibold [&_b]:text-ink-2",
              )}
            >
              {preview}
            </span>
            {unread > 0 && <Badge>{unread}</Badge>}
          </span>
        )}
      </span>
    </button>
  );
}
