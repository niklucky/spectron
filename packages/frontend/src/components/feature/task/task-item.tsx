import { messagePlainText } from "@spectron/shared";
import { Avatar, UserInfo } from "../../ui/avatar";
import { ProjectMark } from "../project";
import { StatusDot } from "./status-dot";
import type { Project, TaskListItem } from "./types";

export function formatIssueDate(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(date)) / 86400000);
  if (days === 0)
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return "yesterday";
  if (days > 1 && days < 7)
    return date.toLocaleDateString("en-US", { weekday: "short" });
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}
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
  const activity = item.lastActivity;
  const updatedAt =
    activity && activity.createdAt > item.updatedAt
      ? activity.createdAt
      : item.updatedAt;
  return (
    <button
      className={`task-item ${selectedId === item.id ? "selected" : ""}`}
      onClick={() => onSelect(item.id, item.project)}
      aria-current={selectedId === item.id ? "true" : undefined}
    >
      <span
        className="task-author"
        title={`Author: ${item.author?.name ?? "Unknown author"}`}
      >
        <UserInfo
          name={item.author?.name ?? "Unknown author"}
          image={item.author?.image}
          label="Author"
        />
      </span>
      <div className="task-title-row">
        {isFlow && <ProjectMark project={project} />}
        <span className="task-key">{item.key}</span>
        <h2 title={item.title}>{item.title}</h2>
        {!!item.unread && (
          <span
            className="unread-count"
            aria-label={`${item.unread} unread messages`}
          >
            {item.unread}
          </span>
        )}
      </div>
      {item.description.trim() && <p className="task-description">
        {messagePlainText(item.description).replace(/\s+/g, " ")}
      </p>}
      <div className="task-status">
        <span
          className="task-assignee"
          title={`Assignee: ${item.assignee?.name ?? "Unassigned"}`}
        >
          {item.assignee ? (
            <UserInfo
              name={item.assignee.name}
              image={item.assignee.image}
              label="Assignee"
            />
          ) : (
            <span>Unassigned</span>
          )}
        </span>
        <StatusDot status={item.statusTrigger} color={item.stateColor} />
        <span>{item.deletedAt ? "Deleted" : item.status}</span>
        <time dateTime={updatedAt} title={new Date(updatedAt).toLocaleString()}>
          {formatIssueDate(updatedAt)}
        </time>
      </div>
      {activity && (
        <div className="task-preview">
          <span title={activity.actorImage ? activity.actorName : `${activity.actorName} has no profile photo`}>
          {activity.actorImage ? (
            <img
              className="task-actor-image"
              src={activity.actorImage}
              alt=""
            />
          ) : (
            <Avatar
              initials={activity.actorName.slice(0, 1).toUpperCase()}
              color={item.color}
              small
            />
          )}
          </span>
          <span className="task-actor">{activity.actorName}</span>
          <span className="task-update">{activity.preview}</span>
        </div>
      )}
    </button>
  );
}
