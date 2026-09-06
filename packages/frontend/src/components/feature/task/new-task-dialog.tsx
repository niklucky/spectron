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
  onCreate: (title: string, project: string) => void;
  onClose: () => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newTaskProject, setNewTaskProject] = useState(project);
  return (
    <Dialog title="New task" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (newTitle.trim())
            onCreate(newTitle.trim(), isFlow ? newTaskProject : project);
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
          maxLength={140}
        />
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
          <Button type="submit" disabled={!newTitle.trim()}>
            Create task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
