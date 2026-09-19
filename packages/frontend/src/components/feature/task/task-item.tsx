import { formatDateTime } from "../../../lib/date-format";
import { messagePlainText } from "@spectron/shared";
import { Avatar } from "../../ui/avatar";
import { IssueRow } from "../../ui/list";
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

/** Latest activity timestamp shown on the row. */
export function taskActivityTime(item: TaskListItem): string {
  const activity = item.lastActivity;
  return activity && activity.createdAt > item.updatedAt
    ? activity.createdAt
    : item.updatedAt;
}

export function TaskItem({
  item,
  project,
  selectedId,
  onSelect,
}: {
  item: TaskListItem;
  project: Project;
  isFlow?: boolean;
  selectedId: string;
  onSelect: (id: string, project: string) => void;
}) {
  const activity = item.lastActivity;
  const updatedAt = taskActivityTime(item);
  const description = item.description.trim()
    ? messagePlainText(item.description).replace(/\s+/g, " ")
    : "";
  const preview = activity ? (
    <>
      <Avatar name={activity.actorName} image={activity.actorImage} size="sm" />
      <span className="truncate">
        <b>{activity.actorName}:</b> {activity.preview}
      </span>
    </>
  ) : description ? (
    <span className="truncate">{description}</span>
  ) : undefined;
  return (
    <IssueRow
      assignee={item.assignee ?? null}
      project={project}
      statusTrigger={item.statusTrigger}
      statusColor={item.stateColor}
      issueKey={item.deletedAt ? `${item.key} · deleted` : item.key}
      time={formatIssueDate(updatedAt)}
      timeTitle={formatDateTime(updatedAt)}
      title={item.title}
      preview={preview}
      unread={item.unread ?? 0}
      active={selectedId === item.id}
      ariaCurrent={selectedId === item.id}
      onClick={() => onSelect(item.id, item.project)}
    />
  );
}
