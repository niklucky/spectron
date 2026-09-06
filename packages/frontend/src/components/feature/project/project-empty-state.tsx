import { Button } from "../../ui/button";

export function ProjectEmptyState({
  loading,
  hasArchived = false,
  error,
  onRetry,
  onCreate,
}: {
  loading: boolean;
  hasArchived?: boolean;
  error: string;
  onRetry: () => void;
  onCreate: () => void;
}) {
  return (
    <main className="project-empty-state">
      {loading ? (
        <p role="status">Loading projects…</p>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </>
      ) : (
        <>
          <h1>{hasArchived ? "No active projects" : "No projects yet"}</h1>
          <p>Create a project, or join one when you’re invited.</p>
          <Button onClick={onCreate}>Create project</Button>
        </>
      )}
    </main>
  );
}
