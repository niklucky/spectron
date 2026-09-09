import type { IssueSettings } from "@spectron/shared";
import { ProjectMark } from "../project";
import { TaskFiltersSelect, type TaskFilters } from "./task-filters";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { TaskItem } from "./task-item";
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
  const projectName =
    projects.find((item) => item.id === project)?.name || "Project";
  return (
    <section
      className="task-panel"
      aria-label={isFlow ? "Flow tasks" : `${projectName} tasks`}
    >
      <header className="task-panel-header">
        <h1>
          {!isFlow && projects.find((p) => p.id === project) && (
            <ProjectMark project={projects.find((p) => p.id === project)!} />
          )}
          {isFlow ? "Flow" : projectName}
        </h1>
        <div>
          <IconButton
            icon="search"
            label="Search tasks"
            aria-expanded={searchOpen}
            onClick={onSearchToggle}
          />
          <IconButton icon="plus" label="New task" onClick={onNewTask} />
        </div>
      </header>
      {searchOpen && (
        <div className="task-search">
          <Icon name="search" size={15} />
          <Input
            variant="plain"
            autoFocus
            placeholder="Search tasks…"
            aria-label="Search tasks"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <IconButton
            icon="close"
            label="Clear search"
            onClick={onSearchClear}
          />
        </div>
      )}
      <div className="task-list-heading">
        <TaskFiltersSelect
          value={filter}
          onChange={onFilterChange}
          projects={
            isFlow ? projects : projects.filter((p) => p.id === project)
          }
          settings={settings}
        />
        <span>{tasks.length}</span>
      </div>
      <div className="task-list">
        {loading && (
          <p className="list-empty" role="status">
            Loading issues…
          </p>
        )}
        {error && (
          <p className="list-empty" role="alert">
            {error} <button onClick={onRetry}>Retry</button>
          </p>
        )}
        {tasks.map((item) => (
          <TaskItem
            key={item.id}
            item={item}
            project={projects.find((project) => project.id === item.project)!}
            isFlow={isFlow}
            selectedId={selectedId}
            onSelect={onSelectTask}
          />
        ))}
        {!loading && !error && !tasks.length && (
          <div className="list-empty">
            {query || filter.values.length > 0 || filter.typeIds?.length || filter.deleted ? (
              <>
                No tasks found.
                <button onClick={onClearFilters}>Clear filters</button>
              </>
            ) : (
              <>
                No tasks yet.<button onClick={onNewTask}>Create a task</button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
