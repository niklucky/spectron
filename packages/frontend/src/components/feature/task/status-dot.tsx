import type { Task } from "./types";
export function StatusDot({
  status,
  color,
}: {
  status: Task["status"];
  color?: string | null;
}) {
  return (
    <span
      style={color ? { borderColor: color, background: color } : undefined}
      className={`status-dot ${status.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-")}`}
    />
  );
}
