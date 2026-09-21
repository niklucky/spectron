import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Icon, type IconName } from "../icon";
import { cn } from "../cn";

export type CommandItem = {
  id: string;
  label: string;
  /** Right-aligned detail: an issue key, a shortcut, a project name. */
  hint?: string | undefined;
  icon?: IconName | undefined;
  /** Custom leading mark, e.g. a ProjectMark or Avatar. */
  mark?: ReactNode;
  /** Extra text the search matches against. */
  keywords?: string | undefined;
  onSelect: () => void;
};
export type CommandGroup = {
  id: string;
  label: string;
  items: CommandItem[];
  /** How many items to show while the query is empty. */
  limit?: number | undefined;
  /** Cap on matches while searching; defaults to 25. */
  maxResults?: number | undefined;
};

const commandHotkey = "Mod+K";
export const commandShortcut = () => formatForDisplay(commandHotkey);

function matches(item: CommandItem, words: string[]) {
  const haystack = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Command palette (Mod+K): one search box over navigation, issues, and
 * actions. Groups keep their order; the query filters across all of them.
 */
export function CommandPalette({
  open,
  onClose,
  groups,
  placeholder = "Search issues, projects, pages… or run a command",
}: {
  open: boolean;
  onClose: () => void;
  groups: CommandGroup[];
  placeholder?: string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setQuery("");
      setActive(0);
      node.showModal();
    } else if (!open && node.open) node.close();
  }, [open]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: words.length
            ? group.items.filter((item) => matches(item, words)).slice(0, group.maxResults ?? 25)
            : group.items.slice(0, group.limit ?? group.items.length),
        }))
        .filter((group) => group.items.length),
    [groups, words.join(" ")],
  );
  const flat = visible.flatMap((group) => group.items);
  const current = flat[Math.min(active, flat.length - 1)];
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  const run = (item: CommandItem) => {
    onClose();
    item.onSelect();
  };
  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      className="mx-auto mt-[12vh] mb-0 w-[calc(100vw-32px)] max-w-[620px] overflow-hidden rounded-2xl border-0 bg-surface p-0 text-ink shadow-pop hairline backdrop:bg-black/30 backdrop:backdrop-blur-[2px] open:flex open:flex-col"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-12 items-center gap-2.5 px-4 hairline-b">
        <Icon name="search" size={16} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={current ? `command-${current.id}` : undefined}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!flat.length) return;
              setActive((index) => (index + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
            } else if (event.key === "Enter" && current) {
              event.preventDefault();
              run(current);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-ink-3"
        />
        <kbd className="hidden rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-ink-3 sm:block">esc</kbd>
      </div>
      <div ref={list} id="command-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
        {flat.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches “{query}”.</p>
        )}
        {visible.map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="mb-1 last:mb-0">
            <div className="label-caps px-2.5 pt-2 pb-1">{group.label}</div>
            {group.items.map((item) => {
              const selected = current?.id === item.id;
              return (
                <div
                  key={item.id}
                  id={`command-${item.id}`}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => {
                    const index = flat.indexOf(item);
                    if (index !== active) setActive(index);
                  }}
                  onClick={() => run(item)}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-base",
                    selected ? "bg-surface-2 text-ink" : "text-ink-2",
                  )}
                >
                  <span className="grid size-5 shrink-0 place-items-center text-ink-3">
                    {item.mark ?? (item.icon && <Icon name={item.icon} size={15} />)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="mono shrink-0 text-xs text-ink-3">{item.hint}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex h-9 items-center gap-4 px-4 text-xs text-ink-3 hairline-t">
        <span><kbd className="mono">↑↓</kbd> navigate</span>
        <span><kbd className="mono">↵</kbd> open</span>
        <span className="ml-auto">{commandShortcut()} toggles</span>
      </div>
    </dialog>
  );
}

/** Header button that opens the palette; shows the platform shortcut. */
export function CommandTrigger({ onClick, className }: { onClick: () => void; className?: string | undefined }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open command palette"
      title={`Search and commands (${commandShortcut()})`}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-sm text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink",
        className,
      )}
    >
      <Icon name="search" size={14} />
      <span className="hidden lg:inline">Search</span>
      <kbd className="mono hidden rounded-sm bg-surface-2 px-1 py-px text-[11px] text-ink-3 sm:inline">{commandShortcut()}</kbd>
    </button>
  );
}
