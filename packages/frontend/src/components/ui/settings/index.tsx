import type { ReactNode } from "react";
import { cn } from "../cn";
import { Icon } from "../icon";

/*
 * Settings anatomy, shared by every settings area (project, AI, account):
 *
 *   SettingsLayout    left nav column · content column
 *   SettingsNav       the vertical list of sections
 *   SettingsTitle     one modest title and a sentence at the top of the content
 *   SettingsSection   a titled block; consecutive sections are separated by a hairline
 *
 * Forms inside use `Field` from ui/input, `Note` for help text and `Feedback`
 * for the one status or error line a section shows after an action.
 */
export function SettingsLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full min-w-0 flex-col md:flex-row">
      <div className="shrink-0 md:w-48 md:py-4 md:pr-2 md:pl-3 md:hairline-r">{nav}</div>
      <div className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-10">{children}</div>
      </div>
    </div>
  );
}

export type SettingsNavItem<T extends string> = { value: T; label: string };
export function SettingsNav<T extends string>({
  items,
  value,
  onChange,
  disabled = false,
  label,
}: {
  items: SettingsNavItem<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex gap-0.5 overflow-x-auto px-2 py-2 hairline-b md:flex-col md:overflow-visible md:p-0 md:border-0">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-current={active ? "page" : undefined}
            disabled={disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-md px-2.5 text-sm whitespace-nowrap transition-colors disabled:opacity-60 md:w-full",
              active ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

export function SettingsTitle({
  title,
  description,
  leading,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Something above the title: a back link, breadcrumbs. */
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      {leading}
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink [&_nav]:-ml-1.5 [&_nav]:text-lg">{title}</h2>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {description && <p className="max-w-[60ch] text-sm text-ink-2">{description}</p>}
    </header>
  );
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
  id?: string | undefined;
}) {
  return (
    <section id={id} className={cn("flex flex-col gap-4 [&+&]:pt-10 [&+&]:hairline-t", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {description && <p className="max-w-[60ch] text-sm text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Help text under a control or a block: quiet, readable, never a wall. */
export function Note({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <p className={cn("max-w-[64ch] text-sm leading-relaxed text-ink-2", className)}>{children}</p>;
}

/** One line of outcome after an action. Errors win over feedback. */
export function Feedback({ error, feedback, className }: { error?: string | undefined; feedback?: string | undefined; className?: string | undefined }) {
  if (error)
    return (
      <p role="alert" className={cn("flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm whitespace-pre-wrap text-bad", className)}>
        <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0">{error}</span>
      </p>
    );
  if (feedback)
    return (
      <p role="status" className={cn("flex items-start gap-2 text-sm whitespace-pre-wrap text-ink-2", className)}>
        <Icon name="check" size={14} className="mt-0.5 shrink-0 text-ok" />
        <span className="min-w-0">{feedback}</span>
      </p>
    );
  return null;
}

/** Collapsible block for long option lists (mappings, logs). */
export function Disclosure({
  summary,
  count,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  count?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean | undefined;
}) {
  return (
    <details className="group rounded-xl hairline open:bg-surface" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" size={14} className="text-ink-3 transition-transform group-open:rotate-90" />
        <span className="min-w-0 truncate">{summary}</span>
        {count !== undefined && <span className="ml-auto font-normal text-ink-3 tabular-nums">{count}</span>}
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3 hairline-t pt-3">{children}</div>
    </details>
  );
}
