import type { Project } from "../task/types";
export function ProjectMark({ project }: { project: Project }) {
  return (
    <span
      className={`project-icon ${project.color}`}
      title={project.name}
      aria-label={`${project.name} project`}
    >
      {project.initial}
    </span>
  );
}
