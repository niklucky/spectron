import type { IssueSettings } from "@spectron/shared";
import { ProjectMark } from "../project";
import { TaskFiltersSelect, type TaskFilters } from "./task-filters";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { ListGroup } from "../../ui/list";
import { TaskItem, taskActivityTime } from "./task-item";
import type { Project, TaskListItem } from "./types";

type TaskListProps = {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  project: string;
  projects: Project[];
  isFlow: boolean;
  tasks: TaskListItem[];
  selectedId: string;
  query: string;
  searchOpen: boolean;
  filter: TaskFilters;
  settings: Record<string, IssueSettings>;
  onSearchToggle: () => void;
  onSearchClear: () => void;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: TaskFilters) => void;
  onClearFilters: () => void;
  onSelectTask: (id: string, project: string) => void;
  onNewTask: () => void;
};

function groupLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(date)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

export function TaskList({
  loading = false,
  error = "",
  onRetry,
  project,
  projects,
  isFlow,
  tasks,
  selectedId,
  query,
  searchOpen,
  filter,
  settings,
  onSearchToggle,
  onSearchClear,
  onQueryChange,
  onFilterChange,
  onClearFilters,
  onSelectTask,
  onNewTask,
}: TaskListProps) {
  const current = projects.find((p) => p.id === project);
  const projectName = current?.name || "Project";
  const filtered =
    !!query ||
    filter.values.length > 0 ||
    !!filter.typeIds?.length ||
    filter.deleted ||
    !!filter.projectIds?.length ||
    !!filter.dateFrom ||
    !!filter.dateTo;
  let lastGroup = "";
  return (
    <section
      className="task-panel flex min-w-0 flex-col border-r border-line bg-surface"
      aria-label={isFlow ? "Flow tasks" : `${projectName} tasks`}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-2 pl-4">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold tracking-[-0.015em]">
          {!isFlow && current && <ProjectMark project={current} size="md" />}
          <span className="truncate">{isFlow ? "Flow" : projectName}</span>
        </h1>
        <IconButton
          icon="search"
          label="Search tasks"
          aria-expanded={searchOpen}
          active={searchOpen}
          onClick={onSearchToggle}
        />
        <IconButton
          icon="plus"
          label="New task"
          onClick={onNewTask}
          className="bg-ink text-surface hover:not-disabled:bg-ink hover:not-disabled:text-surface hover:not-disabled:opacity-90"
        />
      </header>
      {searchOpen && (
        <div className="mx-3.5 mb-2.5 flex h-8 items-center gap-2 rounded-md bg-surface-2 px-2.5 text-ink-2 focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--sp-line)]">
          <Icon name="search" size={14} />
          <input
            autoFocus
            placeholder="Search tasks…"
            aria-label="Search tasks"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
          />
          <IconButton icon="close" label="Clear search" size="sm" onClick={onSearchClear} />
        </div>
      )}
      <div className="flex items-center gap-1 px-3.5 pb-2.5 pl-4">
        <TaskFiltersSelect
          value={filter}
          onChange={onFilterChange}
          projects={isFlow ? projects : projects.filter((p) => p.id === project)}
          settings={settings}
        />
        <span className="ml-auto text-sm text-ink-3 tabular-nums">{tasks.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading && (
          <p className="px-4 py-10 text-center text-base text-ink-2" role="status">
            Loading issues…
          </p>
        )}
        {error && (
          <p className="px-4 py-10 text-center text-base text-ink-2" role="alert">
            {error}{" "}
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          </p>
        )}
        {tasks.map((item) => {
          const group = groupLabel(taskActivityTime(item));
          const showGroup = group !== lastGroup;
          lastGroup = group;
          return (
            <div key={item.id}>
              {showGroup && <ListGroup>{group}</ListGroup>}
              <TaskItem
                item={item}
                project={projects.find((p) => p.id === item.project)!}
                selectedId={selectedId}
                onSelect={onSelectTask}
              />
            </div>
          );
        })}
        {!loading && !error && !tasks.length && (
          <div className="px-4 py-10 text-center text-base text-ink-2">
            {filtered ? (
              <>
                No tasks found.
                <button type="button" className="mx-auto mt-3 block underline" onClick={onClearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                No tasks yet.
                <button type="button" className="mx-auto mt-3 block underline" onClick={onNewTask}>
                  Create a task
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
