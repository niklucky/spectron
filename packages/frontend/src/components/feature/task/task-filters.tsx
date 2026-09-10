import { useId, useRef, useState } from "react";
import { issueTriggers, type IssueSettings } from "@spectron/shared";
import { Icon } from "../../ui/icon";
import type { Project } from "./types";

export type TaskFilters = {
  field: "trigger" | "state" | "type";
  values: string[];
  typeIds?: string[];
  projectIds?: string[];
  dateField?: "updatedAt" | "createdAt" | "startAt" | "finishAt";
  dateFrom?: string;
  dateTo?: string;
  datePreset?: "week" | "month" | "custom";
  deleted: boolean;
};
export const defaultTaskFilters: TaskFilters = {
  field: "trigger",
  values: [],
  deleted: false,
  typeIds: [],
};
export function TaskFiltersSelect({
  value,
  onChange,
  projects,
  settings,
}: {
  value: TaskFilters;
  onChange: (value: TaskFilters) => void;
  projects: Project[];
  settings: Record<string, IssueSettings>;
}) {
  const id = useId(),
    panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 });
  const toggle = (id: string) =>
    onChange({
      ...value,
      values: value.values.includes(id)
        ? value.values.filter((v) => v !== id)
        : [...value.values, id],
    });
  return (
    <>
      <button
        ref={button}
        className="task-filter-button"
        aria-label="Filter tasks"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setPosition({
            top: rect.bottom + 8,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 432)),
          });
          panel.current?.togglePopover();
        }}
      >
        {value.values.length
          ? `${value.values.length} ${value.field === "trigger" ? "triggers" : value.field === "type" ? "types" : "states"}`
          : value.deleted
            ? "Deleted issues"
            : "All issues"}
        {value.typeIds?.length ? ` · ${value.typeIds.length === 1 ? Object.values(settings).flatMap(s => s.issueTypes ?? []).find(t => t.id === value.typeIds![0])?.name ?? "Type" : `${value.typeIds.length} types`}` : ""}
        {value.projectIds?.length ? ` · ${value.projectIds.length} projects` : ""}
        {value.dateFrom || value.dateTo ? " · Date range" : ""}
        <Icon name="chevron" size={13} />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="task-filter-popover"
        style={position}
        role="dialog"
        aria-label="Issue filters"
        onToggle={(e) => setOpen(e.newState === "open")}
      >
        <div className="task-filter-top">
          <strong>Filter issues</strong>
          <button onClick={() => onChange(defaultTaskFilters)}>Reset</button>
        </div>
        {projects.length > 1 && <div className="task-filter-options" role="group" aria-label="Projects">
          <strong>Projects</strong>
          <p className="task-filter-hint">Leave empty for all projects.</p>
          {projects.map(project => <label key={project.id}>
            <input type="checkbox" checked={value.projectIds?.includes(project.id) ?? false}
              onChange={() => onChange({ ...value, projectIds: value.projectIds?.includes(project.id)
                ? value.projectIds.filter(id => id !== project.id) : [...(value.projectIds ?? []), project.id] })} />
            {project.name}
          </label>)}
        </div>}
        <label className="task-filter-field">
          Filter by
          <select
            aria-label="Filter field"
            value={value.field}
            onChange={(e) =>
              onChange({
                ...value,
                field: e.target.value as TaskFilters["field"],
                values: [],
              })
            }
          >
            <option value="trigger">Trigger</option>
            <option value="state">Project state</option>

          </select>
        </label>
        <p className="task-filter-hint">
          {value.field === "trigger"
            ? "Shared across all projects."
            : value.field === "type" ? "Choose issue types from each project." : "Choose states from each project."}{" "}
          Any selected value matches.
        </p>
        <div className="task-filter-options">
          {value.field === "trigger"
            ? issueTriggers.map((trigger) => (
                <label key={trigger}>
                  <input
                    type="checkbox"
                    checked={value.values.includes(trigger)}
                    onChange={() => toggle(trigger)}
                  />
                  {trigger
                    .replaceAll("_", " ")
                    .replace(/^./, (c) => c.toUpperCase())}
                </label>
              ))
            : projects.map((project) => (
                <fieldset key={project.id}>
                  <legend>{project.name}</legend>
                  {((value.field === "type" ? settings[project.id]?.issueTypes : settings[project.id]?.states) ?? []).map((state) => (
                    <label key={state.id}>
                      <input
                        type="checkbox"
                        checked={value.values.includes(state.id)}
                        onChange={() => toggle(state.id)}
                      />
                      {state.name}
                      {state.deletedAt ? " (removed)" : ""}
                    </label>
                  ))}
                </fieldset>
              ))}
        </div>
        <div className="task-filter-options" role="group" aria-label="Issue types">
          <strong>Issue types</strong>
          <p className="task-filter-hint">Any selected type matches. Leave empty for all types.</p>
          {projects.map(project => (
            <fieldset key={project.id}>
              <legend>{project.name}</legend>
              {(settings[project.id]?.issueTypes ?? []).map(type => (
                <label key={type.id}>
                  <input
                    type="checkbox"
                    checked={value.typeIds?.includes(type.id) ?? false}
                    onChange={() => onChange({
                      ...value,
                      typeIds: value.typeIds?.includes(type.id)
                        ? value.typeIds.filter(id => id !== type.id)
                        : [...(value.typeIds ?? []), type.id],
                    })}
                  />
                  {type.name}{type.deletedAt ? " (removed)" : ""}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="task-filter-dates">
          <label className="task-filter-field">Date period
            <select aria-label="Date field" value={value.dateField ?? "updatedAt"} onChange={e => onChange({ ...value, dateField: e.target.value as NonNullable<TaskFilters["dateField"]> })}>
              <option value="updatedAt">Last updated</option><option value="createdAt">Created</option>
              <option value="startAt">Start date</option><option value="finishAt">Finish date</option>
            </select>
          </label>
          <div className="task-date-presets">
            {([['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']] as const).map(([preset, label]) =>
              <button key={preset} aria-pressed={value.datePreset === preset} onClick={() => {
                if (preset === 'custom') { onChange({ ...value, datePreset: preset }); return; }
                const from = new Date(), to = new Date();
                if (preset === 'week') { from.setDate(from.getDate() - (from.getDay() + 6) % 7); to.setFullYear(from.getFullYear(), from.getMonth(), from.getDate() + 6); }
                else { from.setDate(1); to.setMonth(to.getMonth() + 1, 0); }
                const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                onChange({ ...value, datePreset: preset, dateFrom: day(from), dateTo: day(to) });
              }}>{label}</button>)}
          </div>
          <div className="task-date-inputs">
            <label>From<input type="date" aria-label="Period start" value={value.dateFrom ?? ""} max={value.dateTo} onChange={e => onChange({ ...value, datePreset: 'custom', dateFrom: e.target.value })} /></label>
            <label>To<input type="date" aria-label="Period finish" value={value.dateTo ?? ""} min={value.dateFrom} onChange={e => onChange({ ...value, datePreset: 'custom', dateTo: e.target.value })} /></label>
          </div>
          <p className="task-filter-hint">Includes both dates. Weeks start on Monday.</p>
        </div>
        <label className="task-filter-deleted">
          <input
            type="checkbox"
            checked={value.deleted}
            onChange={(e) => onChange({ ...value, deleted: e.target.checked })}
          />
          Only deleted issues
        </label>
        <button
          className="task-filter-done"
          onClick={() => {
            panel.current?.hidePopover();
            button.current?.focus();
          }}
        >
          Done
        </button>
      </div>
    </>
  );
}
