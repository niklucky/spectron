import type { IconName } from "../../ui/icon";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { Select } from "../../ui/input";
import { Avatar } from "../../ui/avatar";
import { ProjectMark } from "../project";
import { StatusDot } from "../task/status-dot";
import type { Task, Project } from "../task/types";
const statuses: Task["status"][] = ["Todo", "In progress", "In review", "Done"];
type ChatHeaderProps = {
  task: Task;
  projectInfo: Project;
  assignee: { name: string; initials: string; color: string };
  sources: IconName[];
  isFlow: boolean;
  details: boolean;
  onBack: () => void;
  onToggleDetails: () => void;
  onStatusChange: (status: Task["status"]) => void;
  onCopyLink: () => void;
  onSources: () => void;
};
export function ChatHeader({
  task,
  projectInfo,
  assignee,
  sources,
  isFlow,
  details,
  onBack,
  onToggleDetails,
  onStatusChange,
  onCopyLink,
  onSources,
}: ChatHeaderProps) {
  const project = projectInfo.name;
  return (
    <header className="chat-header">
      <div className="chat-title-row">
        <IconButton
          icon="back"
          label="Back to tasks"
          className="mobile-back"
          onClick={() => onBack()}
        />
        {isFlow && <ProjectMark project={projectInfo} />}
        <span className="chat-task-id">{task.id}</span>
        <span className="title-divider">/</span>
        <h2>{task.title}</h2>
        <div className="chat-actions">
          <IconButton icon="link" label="Copy task link" onClick={onCopyLink} />
          <IconButton
            icon="more"
            label="Task details"
            aria-expanded={details}
            onClick={() => onToggleDetails()}
          />
        </div>
      </div>
      <div className="chat-subtitle">
        <button
          className="status-trigger"
          onClick={() => onToggleDetails()}
          aria-expanded={details}
        >
          <StatusDot status={task.status} />
          {task.status}
          <Icon name="chevron" size={12} />
        </button>
        <span className="metadata-divider" />
        <Avatar initials={assignee.initials} color={assignee.color} small />
        <span>{assignee.name}</span>
        <span className="metadata-divider" />
        <span className="created-label">
          Created {task.updated.toLowerCase()}
        </span>
        {!!sources.length && (
          <button
            className="source-stack"
            aria-label="Conversation sources"
            onClick={() => onSources()}
          >
            {sources.map((source) => (
              <Icon
                key={source}
                name={source}
                size={source === "gitlab" ? 16 : 15}
              />
            ))}
          </button>
        )}
      </div>
      {details && (
        <div className="task-details">
          <label>
            Status
            <Select
              variant="plain"
              value={task.status}
              onChange={(event) =>
                onStatusChange(event.target.value as Task["status"])
              }
            >
              {statuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </label>
          <div>
            <span>Project</span>
            <strong>{project}</strong>
          </div>
          <div>
            <span>Task</span>
            <strong>{task.id}</strong>
          </div>
        </div>
      )}
    </header>
  );
}
