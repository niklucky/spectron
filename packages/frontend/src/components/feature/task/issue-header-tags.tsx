import { useId, useRef, useState } from "react";
import type { IssuePriority } from "@spectron/shared";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/cn";

/** Tag chips with an inline combobox to add or create tags. */
export function IssueHeaderTags({ tags, selected, disabled, onChange, onCreate }: {
  tags: IssuePriority[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => Promise<void>;
  onCreate?: ((name: string) => Promise<string>) | undefined;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const available = tags.filter(tag => !tag.deletedAt && !selected.includes(tag.id) && tag.name.toLowerCase().includes(query.toLowerCase()));
  const newName = query.trim();
  const canCreate = !!onCreate && newName.length > 0 && newName.length <= 80 && !tags.some(tag => !tag.deletedAt && tag.name.toLowerCase() === newName.toLowerCase());
  const optionCount = available.length + (canCreate ? 1 : 0);
  const activeIndex = Math.min(active, Math.max(0, optionCount - 1));
  async function save(ids: string[], createName?: string) {
    if (saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      if (createName && onCreate) ids = [...ids, await onCreate(createName)];
      await onChange([...new Set(ids)]); setQuery(""); setActive(0); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save tags."); }
    finally { setSaving(false); input.current?.focus(); }
  }
  const option = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2 aria-selected:bg-surface-2";
  return (
    <div
      className="relative flex min-w-0 flex-wrap items-center gap-1"
      onClick={event => { if (event.target === event.currentTarget) input.current?.focus(); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    >
      {selected.map(tagId => {
        const tag = tags.find(tag => tag.id === tagId);
        const color = tag?.color ?? "var(--sp-ink-3)";
        return (
          <span key={tagId} className="inline-flex h-[22px] items-center gap-1 rounded-full pr-1.5 pl-2 text-xs font-medium text-ink" style={{ background: `color-mix(in srgb, ${color} 14%, var(--sp-surface))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)` }}>
            {tag?.name ?? tagId}
            {!disabled && (
              <button type="button" aria-label={`Remove tag ${tag?.name ?? tagId}`} title="Remove tag" disabled={saving} className="grid size-3.5 place-items-center rounded-full text-ink-3 hover:bg-black/10 hover:text-ink" onClick={() => void save(selected.filter(id => id !== tagId))}>
                <Icon name="close" size={10} strokeWidth={2.5} />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (
        <div className="relative min-w-16 flex-1">
          <input
            ref={input}
            role="combobox"
            aria-label="Add tags"
            placeholder={selected.length ? "Add…" : "Add tags…"}
            value={query}
            disabled={saving}
            aria-expanded={open}
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={open && optionCount ? `${id}-${activeIndex}` : undefined}
            className="h-[22px] w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            onFocus={() => setOpen(true)}
            onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
            onKeyDown={event => {
              if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); setOpen(true);
                setActive(Math.max(0, Math.min(optionCount - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (open && available[activeIndex]) void save([...selected, available[activeIndex]!.id]);
                else if (open && canCreate) void save(selected, newName);
                else setOpen(true);
              }
            }}
          />
          {open && (
            <div id={id} role="listbox" aria-label="Available tags" className="absolute top-full left-0 z-20 mt-1 w-56 rounded-xl bg-surface p-1 shadow-pop hairline">
              {available.map((tag, index) => (
                <button type="button" role="option" aria-selected={index === activeIndex} id={`${id}-${index}`} key={tag.id} className={option} onMouseDown={event => event.preventDefault()} onClick={() => void save([...selected, tag.id])} disabled={saving}>
                  <span className="size-2 rounded-full" style={{ background: tag.color ?? "var(--sp-ink-3)" }} />{tag.name}
                </button>
              ))}
              {canCreate && (
                <button type="button" role="option" aria-selected={activeIndex === available.length} id={`${id}-${available.length}`} className={cn(option, "text-accent-ink")} onMouseDown={event => event.preventDefault()} onClick={() => void save(selected, newName)} disabled={saving}>
                  <Icon name="plus" size={13} /> Create “{newName}”
                </button>
              )}
              {!optionCount && <p className="px-2 py-1.5 text-sm text-ink-3">{query ? "No matching tags" : tags.some(tag => !tag.deletedAt) ? "No more tags available" : onCreate ? "Type a name to create a tag." : "Create tags in Project settings → Tags."}</p>}
            </div>
          )}
        </div>
      )}
      {error && <span role="alert" className="w-full text-xs text-bad">{error}</span>}
    </div>
  );
}
