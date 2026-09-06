export type Task = {
  id: string;
  title: string;
  status: "In progress" | "In review" | "Todo" | "Done";
  updated: string;
  preview: string;
  initials: string;
  color: string;
  time: string;
  unread?: number;
};

export type Project = { name: string; initial: string; color: string };
export type TaskListItem = Task & { project: string };
