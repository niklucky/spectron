import { useId, useRef, useState } from "react";
import { Icon } from "../icon";
export function Menu({
  label,
  items,
  className = "",
}: {
  label: string;
  className?: string;
  items: { label: string; onSelect: () => void }[];
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={trigger}
        className={`icon-button ${className}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            top: Math.min(
              rect.bottom + 4,
              window.innerHeight - items.length * 40 - 16,
            ),
            left: Math.min(rect.left, window.innerWidth - 180),
          });
          ref.current?.togglePopover();
        }}
      >
        <Icon name="more" />
      </button>
      <div
        ref={ref}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className="popup-menu"
        style={position}
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
            trigger.current?.focus();
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            onClick={() => {
              ref.current?.hidePopover();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
