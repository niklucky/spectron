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
