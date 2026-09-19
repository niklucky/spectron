import { useId, useRef, useState } from "react";
import { issueTriggers, type IssueSettings } from "@spectron/shared";
import { Icon } from "../../ui/icon";
import { Button } from "../../ui/button";
import { resolveDatePeriod } from "./date-period";
import { cn } from "../../ui/cn";
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

const check = "inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-2 [&_input]:accent-accent";
const select = "h-7 rounded-md bg-surface px-2 text-sm text-ink hairline focus:outline-none";

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
      values: value.values.includes(id) ? value.values.filter((v) => v !== id) : [...value.values, id],
    });
  const active =
    value.values.length + (value.typeIds?.length ?? 0) + (value.projectIds?.length ?? 0) + (value.dateFrom || value.dateTo ? 1 : 0) + (value.deleted ? 1 : 0);
  const summary = value.values.length
    ? `${value.values.length} ${value.field === "trigger" ? "triggers" : value.field === "type" ? "types" : "states"}`
    : value.deleted
      ? "Deleted issues"
      : "Open";
  return (
    <>
      <button
        ref={button}
        type="button"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-surface-3 hover:text-ink",
          active ? "font-medium text-accent-ink" : "text-ink-3",
        )}
        aria-label="Filter tasks"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 432)) });
          panel.current?.togglePopover();
        }}
      >
        <Icon name="filter" size={13} />
        {summary}
        {value.typeIds?.length ? ` · ${value.typeIds.length === 1 ? Object.values(settings).flatMap((s) => s.issueTypes ?? []).find((t) => t.id === value.typeIds![0])?.name ?? "Type" : `${value.typeIds.length} types`}` : ""}
        {value.projectIds?.length ? ` · ${value.projectIds.length} projects` : ""}
        {value.dateFrom || value.dateTo ? " · Date range" : ""}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="m-0 max-h-[calc(100dvh-140px)] w-[min(420px,calc(100vw-16px))] overflow-auto rounded-xl border-0 bg-surface p-3.5 text-base text-ink shadow-pop hairline"
        style={{ ...position, position: "fixed", inset: "auto" }}
        role="dialog"
        aria-label="Issue filters"
        onToggle={(e) => setOpen(e.newState === "open")}
      >
        <div className="mb-3 flex items-center justify-between">
          <strong className="text-base font-semibold">Filter issues</strong>
          <Button variant="ghost" size="sm" onClick={() => onChange(defaultTaskFilters)}>Reset</Button>
        </div>
        {projects.length > 1 && (
          <div className="mb-3" role="group" aria-label="Projects">
            <div className="label-caps mb-1">Projects</div>
            <div className="flex flex-wrap gap-1">
              {projects.map((project) => (
                <label key={project.id} className={check}>
                  <input type="checkbox" checked={value.projectIds?.includes(project.id) ?? false}
                    onChange={() => onChange({ ...value, projectIds: value.projectIds?.includes(project.id) ? value.projectIds.filter((id) => id !== project.id) : [...(value.projectIds ?? []), project.id] })} />
                  {project.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-3">Leave empty for all projects.</p>
          </div>
        )}
        <div className="mb-3">
          <label className="flex items-center justify-between gap-3">
            <span className="label-caps">Status</span>
            <select aria-label="Filter field" className={select} value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as TaskFilters["field"], values: [] })}>
              <option value="trigger">By trigger</option>
              <option value="state">By project state</option>
            </select>
          </label>
          <div className="mt-1 flex flex-wrap gap-1">
            {value.field === "trigger"
              ? issueTriggers.map((trigger) => (
                  <label key={trigger} className={check}>
                    <input type="checkbox" checked={value.values.includes(trigger)} onChange={() => toggle(trigger)} />
                    {trigger.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())}
                  </label>
                ))
              : projects.map((project) => (
                  <fieldset key={project.id} className="min-w-0 border-0 p-0">
                    {projects.length > 1 && <legend className="mb-0.5 text-xs text-ink-3">{project.name}</legend>}
                    <div className="flex flex-wrap gap-1">
                      {((value.field === "type" ? settings[project.id]?.issueTypes : settings[project.id]?.states) ?? []).map((state) => (
                        <label key={state.id} className={check}>
                          <input type="checkbox" checked={value.values.includes(state.id)} onChange={() => toggle(state.id)} />
                          {state.name}{state.deletedAt ? " (removed)" : ""}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
          </div>
          <p className="mt-1 text-xs text-ink-3">{value.field === "trigger" ? "Shared across all projects." : "Choose states from each project."} Any selected value matches.</p>
        </div>
        <div className="mb-3" role="group" aria-label="Issue types">
          <div className="label-caps mb-1">Issue types</div>
          {projects.map((project) => (
            <fieldset key={project.id} className="min-w-0 border-0 p-0">
              {projects.length > 1 && <legend className="mb-0.5 text-xs text-ink-3">{project.name}</legend>}
              <div className="flex flex-wrap gap-1">
                {(settings[project.id]?.issueTypes ?? []).map((type) => (
                  <label key={type.id} className={check}>
                    <input type="checkbox" checked={value.typeIds?.includes(type.id) ?? false}
                      onChange={() => onChange({ ...value, typeIds: value.typeIds?.includes(type.id) ? value.typeIds.filter((id) => id !== type.id) : [...(value.typeIds ?? []), type.id] })} />
                    {type.name}{type.deletedAt ? " (removed)" : ""}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="mt-1 text-xs text-ink-3">Leave empty for all types.</p>
        </div>
        <div className="mb-3 pt-3 hairline-t">
          <label className="flex items-center justify-between gap-3">
            <span className="label-caps">Date period</span>
            <select aria-label="Date field" className={select} value={value.dateField ?? "updatedAt"} onChange={(e) => onChange({ ...value, dateField: e.target.value as NonNullable<TaskFilters["dateField"]> })}>
              <option value="updatedAt">Last updated</option><option value="createdAt">Created</option>
              <option value="startAt">Start date</option><option value="finishAt">Finish date</option>
            </select>
          </label>
          <div className="mt-2 inline-flex rounded-lg bg-surface-2 p-0.5">
            {([["week", "This week"], ["month", "This month"], ["custom", "Custom"]] as const).map(([preset, label]) => (
              <button key={preset} type="button" aria-pressed={value.datePreset === preset}
                className={cn("h-6 rounded-md px-2.5 text-xs font-medium", value.datePreset === preset ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--sp-line-soft)]" : "text-ink-2 hover:text-ink")}
                onClick={() => {
                  if (preset === "custom") { onChange({ ...value, datePreset: preset }); return; }
                  onChange(resolveDatePeriod({ ...value, datePreset: preset }));
                }}>{label}</button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-3">From<input type="date" aria-label="Period start" className={cn(select, "w-full")} value={value.dateFrom ?? ""} max={value.dateTo} onChange={(e) => onChange({ ...value, datePreset: "custom", dateFrom: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">To<input type="date" aria-label="Period finish" className={cn(select, "w-full")} value={value.dateTo ?? ""} min={value.dateFrom} onChange={(e) => onChange({ ...value, datePreset: "custom", dateTo: e.target.value })} /></label>
          </div>
          <p className="mt-1 text-xs text-ink-3">Includes both dates. Weeks start on Monday.</p>
        </div>
        <label className={cn(check, "mb-2 pt-3 hairline-t")}>
          <input type="checkbox" checked={value.deleted} onChange={(e) => onChange({ ...value, deleted: e.target.checked })} />
          Only deleted issues
        </label>
        <Button variant="primary" className="w-full" onClick={() => { panel.current?.hidePopover(); button.current?.focus(); }}>
          Done
        </Button>
      </div>
    </>
  );
}
