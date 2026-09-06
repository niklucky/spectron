import type { Task } from "./types";
export function StatusDot({ status }: { status: Task["status"] }) {
  return (
    <span
      className={`status-dot ${status.toLowerCase().replaceAll(" ", "-")}`}
    />
  );
}
