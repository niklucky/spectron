import {
  type ComponentProps,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { Icon } from "../icon";
import { cn } from "../cn";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ComponentProps<typeof Icon>["name"] | undefined;
  danger?: boolean | undefined;
  hint?: string | undefined;
};

/**
 * Small action menu on the native Popover API. `trigger` replaces the default
 * icon button when a custom control should open the menu.
 */
export function Menu({
  label,
  items,
  icon = "more",
  disabled = false,
  className = "",
  trigger,
  align = "start",
}: {
  label: string;
  icon?: ComponentProps<typeof Icon>["name"] | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  items: MenuItem[];
  trigger?: ReactNode;
  align?: "start" | "end" | undefined;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [open, setOpen] = useState(false);
  const width = 220;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        ref={triggerRef}
        className={cn(
          !trigger &&
            "inline-grid size-7 shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:not-disabled:bg-surface-3 hover:not-disabled:text-ink disabled:opacity-40",
          open && !trigger && "bg-surface-3 text-ink",
          className,
        )}
        aria-label={label}
        title={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const rect = triggerRef.current!.getBoundingClientRect();
          setPosition({
            top: Math.min(
              rect.bottom + 6,
              window.innerHeight - items.length * 36 - 24,
            ),
            left: Math.max(
              8,
              Math.min(
                align === "end" ? rect.right - width : rect.left,
                window.innerWidth - width - 8,
              ),
            ),
          });
          ref.current?.togglePopover();
        }}
      >
        {trigger ?? <Icon name={icon} />}
      </button>
      <div
        ref={ref}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className="m-0 rounded-xl border-0 bg-surface p-1 text-ink shadow-pop hairline"
        style={{ ...position, width, position: "fixed", inset: "auto" }}
        onToggle={(event) => {
          const shown = event.newState === "open";
          setOpen(shown);
          if (shown)
            ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        onKeyDown={(event) => {
          const buttons = Array.from(ref.current!.querySelectorAll("button"));
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            buttons[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length
            ]?.focus();
          }
          if (event.key === "Escape") {
            ref.current?.hidePopover();
            triggerRef.current?.focus();
          }
        }}
      >
        {items.map((item) => (
          <button
            type="button"
            key={item.label}
            role="menuitem"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-base hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
              item.danger ? "text-bad" : "text-ink",
            )}
            onClick={() => {
              ref.current?.hidePopover();
              item.onSelect();
            }}
          >
            {item.icon && (
              <Icon
                name={item.icon}
                size={15}
                className={item.danger ? "text-bad" : "text-ink-2"}
              />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="text-xs text-ink-3">{item.hint}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
