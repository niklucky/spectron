import type { Project } from "../task/types";
import { useState, type CSSProperties } from "react";
import { cn } from "../../ui/cn";
import { nameHue } from "../../ui/avatar/name-color";

export type ProjectMarkSize = "xs" | "sm" | "md" | "lg";
const sizes: Record<ProjectMarkSize, string> = {
  xs: "size-[14px] rounded-[4px] text-[8px]",
  sm: "size-[18px] rounded-[5px] text-[9.5px]",
  md: "size-6 rounded-md text-2xs",
  lg: "size-[34px] rounded-[9px] text-sm",
};

/** Project logo, or a colored tile with the project's initial. */
export function ProjectMark({
  project,
  size = "md",
  className = "",
}: {
  project: Pick<Project, "name" | "initial" | "logo">;
  size?: ProjectMarkSize | undefined;
  className?: string | undefined;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const hue = nameHue(project.name);
  const showLogo = project.logo && failed !== project.logo;
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden font-bold text-white",
        sizes[size],
        className,
      )}
      title={project.name}
      aria-label={`${project.name} project`}
      style={
        showLogo
          ? undefined
          : ({ background: `hsl(${hue} 38% 42%)` } as CSSProperties)
      }
    >
      {showLogo ? (
        <img
          src={project.logo!}
          alt=""
          onError={() => setFailed(project.logo)}
          className="size-full object-contain"
        />
      ) : (
        project.initial
      )}
    </span>
  );
}
