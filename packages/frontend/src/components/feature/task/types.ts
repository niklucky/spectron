import type { IssueSummary, IssueTrigger } from "@spectron/shared";
export type Task = IssueSummary & {
  id: string;
  title: string;
  status: string;
  statusTrigger: IssueTrigger;
  stateColor: string | null;
  updated: string;
  preview: string;
  initials: string;
  color: string;
  time: string;
  unread?: number;
};

export type Project = {
  role: "owner" | "member";
  id: string;
  name: string;
  key: string;
  initial: string;
  logo: string | null;
  url: string | null;
};
export type TaskListItem = Task & { project: string };
