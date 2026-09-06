import { Avatar } from "../../ui/avatar";
import { ProjectMark } from "../project";
import { StatusDot } from "./status-dot";
import type { Project, TaskListItem } from "./types";
export function TaskItem({
  item,
  project,
  isFlow,
  selectedId,
  onSelect,
}: {
  item: TaskListItem;
  project: Project;
  isFlow: boolean;
  selectedId: string;
  onSelect: (id: string, project: string) => void;
}) {
  return (
    <button
      className={`task-item ${selectedId === item.id ? "selected" : ""}`}
      onClick={() => onSelect(item.id, item.project)}
      aria-current={selectedId === item.id ? "true" : undefined}
    >
      <div className="task-number">
        <span className="task-context">
          {isFlow && (
            <>
              <ProjectMark project={project} />
              <span className="task-project-name">{item.project}</span>
              <span className="task-context-divider">/</span>
            </>
          )}
          <span>{item.id}</span>
        </span>
        {!!item.unread && (
          <span
            className="unread-count"
            aria-label={`${item.unread} unread messages`}
          >
            {item.unread}
          </span>
        )}
      </div>
      <h2>{item.title}</h2>
      <div className="task-status">
        <StatusDot status={item.status} />
        <span>{item.status}</span>
        <span className="status-age">{item.updated}</span>
      </div>
      <div className="task-preview">
        <Avatar initials={item.initials.slice(0, 1)} color={item.color} small />
        <span>{item.preview}</span>
        <time>{item.time}</time>
      </div>
    </button>
  );
}
