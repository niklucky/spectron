import { ISSUE_TITLE_MAX_LENGTH } from "@spectron/shared";
import { useState } from "react";
import { Dialog } from "../../ui/dialog";
import { Input, Select } from "../../ui/input";
import { Button } from "../../ui/button";
import type { Project } from "./types";
export function NewTaskDialog({
  project,
  projects,
  isFlow,
  onCreate,
  onClose,
}: {
  project: string;
  projects: Project[];
  isFlow: boolean;
  onCreate: (title: string, project: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newTaskProject, setNewTaskProject] = useState(project);
  return (
    <Dialog
      title="New task"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!newTitle.trim() || busy) return;
          setBusy(true);
          setError("");
          try {
            await onCreate(newTitle.trim(), isFlow ? newTaskProject : project);
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not create issue.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label" htmlFor="task-title">
          Title
        </label>
        <Input
          id="task-title"
          autoFocus
          placeholder="What are we working on?"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          required
          maxLength={ISSUE_TITLE_MAX_LENGTH}
        />
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          {isFlow ? (
            <label className="project-picker">
              Project
              <Select
                variant="plain"
                aria-label="Project"
                value={newTaskProject}
                onChange={(event) => setNewTaskProject(event.target.value)}
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <span>{projects.find((item) => item.id === project)?.name}</span>
          )}
          <Button type="submit" disabled={busy || !newTitle.trim()}>
            {busy ? "Creating…" : "Create task"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
