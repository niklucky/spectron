import type { ReactNode } from "react";
import { ProjectMark } from "./project-mark";
import { EmptyState, PageBody, PageHeader, PageShell, PageTabs, WidgetSlot, type PageTab } from "../../ui/page-shell";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/cn";
import type { Project } from "../task/types";

export const projectSections = ["overview", "wiki", "issues", "board", "gantt", "settings"] as const;
export type ProjectSection = (typeof projectSections)[number];
export const isProjectSection = (value: string | undefined): value is ProjectSection =>
  projectSections.includes(value as ProjectSection);

const tabs: PageTab<ProjectSection>[] = [
  { value: "overview", label: "Overview", icon: "overview" },
  { value: "wiki", label: "Wiki", icon: "book" },
  { value: "issues", label: "Issues", icon: "issues" },
  { value: "board", label: "Board", icon: "board" },
  { value: "gantt", label: "Gantt", icon: "gantt" },
  { value: "settings", label: "Settings", icon: "settings" },
];

/**
 * Project shell: breadcrumbs, section tabs, and the section body. Issues and
 * Settings are supplied by the app; the other sections start empty.
 */
export function ProjectPage({
  project,
  section,
  onSectionChange,
  onOpenOverview,
  actions,
  children,
}: {
  project: Project;
  section: ProjectSection;
  onSectionChange: (section: ProjectSection) => void;
  onOpenOverview?: (() => void) | undefined;
  /** Header actions for the current section, e.g. search and new issue. */
  actions?: ReactNode;
  /** Body of sections the app owns (issues, settings). */
  children?: ReactNode;
}) {
  const current = tabs.find((tab) => tab.value === section)!;
  return (
    <PageShell label={`${project.name} · ${current.label}`}>
      <PageHeader
        breadcrumbs={[
          { label: project.name, mark: <ProjectMark project={project} size="sm" />, onClick: onOpenOverview },
        ]}
        tabs={<PageTabs label="Project sections" value={section} tabs={tabs} onChange={onSectionChange} />}
        actions={actions}
      />
      <nav aria-label="Project sections" className="flex gap-0.5 overflow-x-auto px-2 py-1.5 hairline-b md:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-current={tab.value === section ? "page" : undefined}
            onClick={() => onSectionChange(tab.value)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm",
              tab.value === section ? "bg-surface-3 font-medium text-ink" : "text-ink-2",
            )}
          >
            <Icon name={tab.icon!} size={14} />
            {tab.label}
          </button>
        ))}
      </nav>
      {children ?? <ProjectSectionBody section={section} project={project} />}
    </PageShell>
  );
}

function ProjectSectionBody({ section, project }: { section: ProjectSection; project: Project }) {
  if (section === "overview")
    return (
      <PageBody className="p-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          <EmptyState
            icon="overview"
            title={`${project.name} has no widgets yet`}
            description="Compose the project dashboard from widgets: progress, workload, recent activity, whatever this project needs."
            className="py-10"
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <WidgetSlot disabled hint="Widgets are coming next" />
          </div>
        </div>
      </PageBody>
    );
  if (section === "wiki")
    return (
      <PageBody>
        <EmptyState icon="book" title="No pages yet" description="The project wiki will hold specs, notes, and decisions in a simple block editor." />
      </PageBody>
    );
  if (section === "board")
    return (
      <PageBody>
        <EmptyState icon="board" title="Board" description="Issues grouped by state in columns. Coming next." />
      </PageBody>
    );
  if (section === "gantt")
    return (
      <PageBody>
        <EmptyState icon="gantt" title="Gantt" description="Issues on a timeline with dependencies. Coming next." />
      </PageBody>
    );
  return null;
}
