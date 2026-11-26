import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createJiraFieldOnImport, createJiraJsonOnImport, type ProjectField } from "@spectron/shared";
import { Icon } from "../../ui/icon";
import { Pill } from "../../ui/pill";

type Choice = { id: string; name: string; badge?: string; suggested?: boolean };
const normalize = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s*\(built-in\)$/i, "").trim();

export function JiraFieldPicker({ name, value, options, createType, hintId, onChange }: {
  name: string;
  value: string;
  options: readonly Choice[];
  createType?: ProjectField["type"] | undefined;
  hintId?: string | undefined;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const creates: Choice[] = [];
  if (createType) {
    creates.push({ id: createJiraFieldOnImport, name: "Create", badge: createType === "json" ? "JSON" : createType });
    if (createType !== "json" || value === createJiraJsonOnImport)
      creates.push({ id: createJiraJsonOnImport, name: "Create", badge: "JSON" });
  }
  const clear: Choice = { id: "", name: "Do not map" };
  const selected = value ? [...creates, ...options].find(item => item.id === value) : clear;
  const selectedName = selected?.name ?? (value === createJiraFieldOnImport || value === createJiraJsonOnImport ? "Create (unavailable)" : `${value} (unavailable)`);
  const matches = options.filter(option => normalize(option.name) === normalize(name));
  const suggested = matches.length === 1 ? matches[0] : undefined;
  const filter = (item: Choice) => `${item.name} ${item.badge ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
  const top = [...(suggested ? [{ ...suggested, suggested: true }] : []), ...creates].filter(filter);
  const rest = [...options.filter(option => option !== suggested), clear].filter(filter);
  const choices = [...top, ...rest];
  const index = Math.min(active, choices.length - 1);

  function choose(choice: Choice) {
    onChange(choice.id);
    popup.current?.hidePopover();
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!(event.target instanceof Node && popup.current?.contains(event.target))) popup.current?.hidePopover();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Map fields ${name}: ${selectedName} ${selected?.badge ?? ""}`.trim()} aria-describedby={hintId}
      className="inline-flex h-7 min-w-0 items-center gap-2 rounded-md border-0 bg-surface-2 px-2.5 text-left text-sm hover:not-disabled:bg-surface-3 focus-visible:outline-accent disabled:text-ink-2"
      onClick={() => {
        if (open) return;
        const rect = trigger.current!.getBoundingClientRect();
        const width = rect.width;
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const flip = below < 280 && above > below;
        setPosition({
          left: rect.left, right: "auto", width, boxSizing: "border-box",
          top: flip ? "auto" : rect.bottom + 4, bottom: flip ? window.innerHeight - rect.top + 4 : "auto",
          maxHeight: Math.min(340, flip ? above : below),
        });
        setQuery("");
        setActive(0);
      }}>
      <span className="truncate">{selectedName}</span>
      {selected?.badge && <Pill tone="accent">{selected.badge}</Pill>}
      <Icon name="chevron" size={13} className="ml-auto shrink-0 text-ink-3" />
    </button>
    <div ref={popup} id={id} popover="auto" role="dialog" aria-label={`Choose a mapping for ${name}`}
      style={position} className="fixed m-0 overflow-hidden rounded-md border-0 bg-surface p-1 text-ink shadow-pop open:flex open:flex-col"
      onToggle={e => { setOpen(e.newState === "open"); if (e.newState === "open") search.current?.focus(); }}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) popup.current?.hidePopover(); }}>
      <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 text-ink-2">
        <Icon name="search" size={14} />
        <input ref={search} role="combobox" aria-label="Search mapping options" aria-autocomplete="list" aria-expanded={open}
          aria-controls={id + "-list"} aria-activedescendant={open && index >= 0 ? id + "-" + index : undefined}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none" placeholder="Search fields…" value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); if (choices[index]) choose(choices[index]); }
            if (choices.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              const next = (index + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
              setActive(next);
              document.getElementById(id + "-" + next)?.scrollIntoView({ block: "nearest" });
            }
          }} />
      </div>
      {open && <div id={id + "-list"} role="listbox" aria-label="Mapping options" className="min-h-0 overflow-y-auto">
        {choices.map((choice, i) => <div key={choice.id} className={i === top.length && top.length > 0 ? "mt-1 pt-1 hairline-t" : undefined}>
          <div id={id + "-" + i} role="option" aria-selected={choice.id === value}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${i === index ? "bg-surface-3" : ""}`}
            onPointerMove={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(choice)}>
            <span className="truncate">{choice.name}</span>
            {choice.badge && <Pill tone="accent">{choice.badge}</Pill>}
            {choice.suggested && <span className="text-xs text-ink-2">Suggested</span>}
            {choice.id === value && <Icon name="check" size={13} className="ml-auto shrink-0" />}
          </div>
        </div>)}
        {!choices.length && <p role="status" className="px-2 py-2 text-sm text-ink-2">No matching fields.</p>}
      </div>}
    </div>
  </>;
}
