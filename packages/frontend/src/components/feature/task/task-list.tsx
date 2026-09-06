import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { Input, Select } from "../../ui/input";
import { TaskItem } from "./task-item";
import type { Project, TaskListItem } from "./types";
type TaskListProps = {
  project: string;
  projects: Project[];
  isFlow: boolean;
  tasks: TaskListItem[];
  selectedId: string;
  query: string;
  searchOpen: boolean;
  filter: string;
  onSearchToggle: () => void;
  onSearchClear: () => void;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: string) => void;
  onClearFilters: () => void;
  onSelectTask: (id: string, project: string) => void;
  onNewTask: () => void;
};
export function TaskList({
  project,
  projects,
  isFlow,
  tasks,
  selectedId,
  query,
  searchOpen,
  filter,
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
        <h1>{isFlow ? "Flow" : projectName}</h1>
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
        <Select
          variant="plain"
          aria-label="Filter tasks"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        >
          <option value="all">All tasks</option>
          <option value="open">Open tasks</option>
          <option value="unread">Unread</option>
        </Select>
        <span>{tasks.length}</span>
      </div>
      <div className="task-list">
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
        {!tasks.length && (
          <div className="list-empty">
            {query || filter !== "all" ? (
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
