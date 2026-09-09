import { useId, useRef, useState } from "react";
import { issueTriggers, type IssueSettings } from "@spectron/shared";
import { Icon } from "../../ui/icon";
import type { Project } from "./types";

export type TaskFilters = {
  field: "trigger" | "state" | "type";
  values: string[];
  typeIds?: string[];
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
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 312)),
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
