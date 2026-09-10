import { useId, useRef, useState, type CSSProperties } from "react";
import type { IssuePriority } from "@spectron/shared";
import { Icon } from "../../ui/icon";

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
  return <div className="issue-header-tags" onClick={event => { if (event.target === event.currentTarget) input.current?.focus(); }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    {selected.map(tagId => {
      const tag = tags.find(tag => tag.id === tagId);
      return <span className="header-tag" key={tagId} style={{ '--tag-color': tag?.color ?? 'var(--color-text-secondary)' } as CSSProperties}>
        {tag?.name ?? tagId}
        {!disabled && <button type="button" aria-label={`Remove tag ${tag?.name ?? tagId}`} title="Remove tag" disabled={saving}
          onClick={() => void save(selected.filter(id => id !== tagId))}><Icon name="close" size={12} /></button>}
      </span>;
    })}
    {!disabled && <div className="header-tag-search">
      <input ref={input} role="combobox" aria-label="Add tags" placeholder="Add tags…" value={query} disabled={saving}
        aria-expanded={open} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={open && optionCount ? `${id}-${activeIndex}` : undefined}
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive(Math.max(0, Math.min(optionCount - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (open && available[activeIndex]) void save([...selected, available[activeIndex]!.id]);
            else if (open && canCreate) void save(selected, newName);
            else setOpen(true);
          }
        }} />
      {open && <div className="header-tag-options" id={id} role="listbox" aria-label="Available tags">
        {available.map((tag, index) => <button type="button" role="option" aria-selected={index === activeIndex} id={`${id}-${index}`} key={tag.id}
          onMouseDown={event => event.preventDefault()} onClick={() => void save([...selected, tag.id])} disabled={saving}>
          <span className="tag-color-dot" style={{ background: tag.color ?? 'var(--color-text-secondary)' }} />{tag.name}
        </button>)}
        {canCreate && <button type="button" role="option" aria-selected={activeIndex === available.length} id={`${id}-${available.length}`}
          onMouseDown={event => event.preventDefault()} onClick={() => void save(selected, newName)} disabled={saving}>
          <Icon name="plus" size={14} /> Create “{newName}”
        </button>}
        {!optionCount && <p>{query ? 'No matching tags' : tags.some(tag => !tag.deletedAt) ? 'No more tags available' : onCreate ? 'Type a name to create a tag.' : 'Create tags in Project settings → Tags.'}</p>}
      </div>}
    </div>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
