import type { ReactNode } from "react";
import { cn } from "../cn";
import { Icon, type IconName } from "../icon";

/**
 * Base anatomy of a full-width page (everything right of the sidebar):
 *
 *   PageHeader   one quiet 44px row: breadcrumbs · tabs · actions
 *   PageToolbar  optional row for filters, display options, counts
 *   PageBody     the scrolling content, or a nested split layout
 *
 * Headers never carry a big title: the last breadcrumb is the title, as in
 * Linear. Separators are hairlines, no borders or shadows.
 */
export function PageShell({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <main
      aria-label={label}
      className={cn(
        "page-shell flex min-h-0 min-w-0 flex-col bg-surface [grid-column:2/-1]",
        className,
      )}
    >
      {children}
    </main>
  );
}

export type Crumb = {
  label: string;
  icon?: IconName | undefined;
  /** Custom leading mark, e.g. a ProjectMark. */
  mark?: ReactNode;
  onClick?: (() => void) | undefined;
};

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const content = (
          <>
            {item.mark ?? (item.icon && <Icon name={item.icon} size={15} className={last ? "text-ink-2" : "text-ink-3"} />)}
            <span className="truncate">{item.label}</span>
          </>
        );
        return (
          <span key={`${item.label}:${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <Icon name="chevron-right" size={13} className="shrink-0 text-ink-3" />}
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                aria-current={last ? "page" : undefined}
                className={cn(
                  "flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-surface-3 hover:text-ink",
                  last ? "font-semibold text-ink" : "text-ink-2",
                )}
              >
                {content}
              </button>
            ) : (
              <span
                aria-current={last ? "page" : undefined}
                className={cn(
                  "flex h-7 min-w-0 items-center gap-1.5 px-1.5",
                  last ? "font-semibold text-ink" : "text-ink-2",
                )}
              >
                {content}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  breadcrumbs,
  tabs,
  actions,
  leading,
}: {
  breadcrumbs: Crumb[];
  /** Section tabs, rendered after the breadcrumbs. */
  tabs?: ReactNode;
  /** Right-aligned controls: search, view options, primary action. */
  actions?: ReactNode;
  /** Mobile-only back control and similar. */
  leading?: ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 px-3 hairline-b">
      {leading}
      <Breadcrumbs items={breadcrumbs} />
      {tabs && <div className="ml-2 hidden min-w-0 items-center md:flex">{tabs}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export type PageTab<T extends string> = {
  value: T;
  label: string;
  icon?: IconName | undefined;
  /** Not built yet: rendered, but muted and inert. */
  soon?: boolean | undefined;
};

/** Quiet section tabs inside the header, like Linear's view switcher. */
export function PageTabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
}: {
  value: T;
  tabs: PageTab<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex items-center gap-0.5">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-surface-3 font-medium text-ink"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {tab.icon && <Icon name={tab.icon} size={14} className={active ? "text-ink" : "text-ink-3"} />}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Secondary row under the header: filters on the left, display on the right. */
export function PageToolbar({
  children,
  trailing,
}: {
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 px-3 hairline-b">
      {children}
      {trailing && <div className="ml-auto flex items-center gap-1">{trailing}</div>}
    </div>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", className)}>
      {children}
    </div>
  );
}

/** Centered empty state: icon, one-line title, one sentence, optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconName;
  title: string;
  description?: string | undefined;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-ink-3">
        <Icon name={icon} size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="max-w-[40ch] text-sm text-ink-2">{description}</p>}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * Dashed slot inviting the user to add a widget. Dashboards start with one of
 * these instead of sample content.
 */
export function WidgetSlot({
  onClick,
  disabled = false,
  label = "Add widget",
  hint,
}: {
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  label?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-ink-3 transition-colors enabled:hover:border-ink-3 enabled:hover:bg-surface-2 enabled:hover:text-ink-2 disabled:cursor-default"
    >
      <Icon name="widget" size={20} />
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="text-xs">{hint}</span>}
    </button>
  );
}
