import type { Project } from "../task/types";
import { useState } from "react";
export function ProjectMark({ project }: { project: Project }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className="project-icon"
      title={project.name}
      aria-label={`${project.name} project`}
    >
      {project.logo && failed !== project.logo ? (
        <img
          src={project.logo}
          alt=""
          onError={() => setFailed(project.logo)}
        />
      ) : (
        project.initial
      )}
    </span>
  );
}
