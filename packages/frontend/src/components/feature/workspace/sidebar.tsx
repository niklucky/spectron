import type { ReactNode } from "react";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { Menu } from "../../ui/menu";
import { ProjectMark } from "../project";
import type { Project } from "../task/types";

type SidebarProps = {
  collapsed: boolean;
  project: string;
  projects: Project[];
  isFlow: boolean;
  accountMenu: ReactNode;
  onToggleCollapse: () => void;
  onSelectProject: (project: string) => void;
  onSelectFlow: () => void;
  onCreateProject: () => void;
  onProjectSettings: (id: string) => void;
  onArchiveProject: (id: string) => void;
  onNavigate: (page: "overview" | "issues" | "settings") => void;
};
export function Sidebar({
  collapsed,
  project,
  projects,
  isFlow,
  accountMenu,
  onToggleCollapse,
  onSelectProject,
  onSelectFlow,
  onCreateProject,
  onProjectSettings,
  onArchiveProject,
  onNavigate,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand-row">
        <a
          href="#flow"
          onClick={(event) => {
            event.preventDefault();
            onSelectFlow();
          }}
          className="brand"
          aria-label="Spectron home"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="sidebar-label">spectron</span>
        </a>
        <IconButton
          icon="sidebar"
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => onToggleCollapse()}
          className="collapse-button"
        />
      </div>
      <nav>
        <button
          className="nav-item"
          title="Overview"
          onClick={() => onNavigate("overview")}
        >
          <Icon name="overview" />
          <span className="sidebar-label">Overview</span>
        </button>
        <button
          className={`nav-item ${isFlow ? "active" : ""}`}
          title="Flow"
          aria-label="Flow"
          aria-current={isFlow ? "page" : undefined}
          onClick={onSelectFlow}
        >
          <Icon name="chats" />
          <span className="sidebar-label">Flow</span>
        </button>
        <div className="nav-divider" />
        <div className="projects">
          {projects.map((item) => (
            <div key={item.id} className="project-nav-row">
              <button
                className={`nav-item ${!isFlow && project === item.id ? "active" : ""}`}
                title={item.name}
                aria-label={item.name}
                aria-current={
                  !isFlow && project === item.id ? "page" : undefined
                }
                onClick={() => onSelectProject(item.id)}
              >
                <ProjectMark project={item} />
                <span className="sidebar-label">{item.name}</span>
              </button>
              <Menu
                className="project-menu-trigger"
                label={`${item.name} options`}
                items={[
                  {
                    label: "Settings",
                    onSelect: () => onProjectSettings(item.id),
                  },
                  ...(item.role === "owner"
                    ? [
                        {
                          label: "Archive",
                          onSelect: () => onArchiveProject(item.id),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          ))}
          <button
            className="nav-item"
            title="New project"
            aria-label="New project"
            onClick={onCreateProject}
          >
            <Icon name="plus" />
            <span className="sidebar-label">New project</span>
          </button>
        </div>
        <div className="nav-divider" />
        <button
          className="nav-item"
          title="Issues"
          onClick={() => onNavigate("issues")}
        >
          <Icon name="issues" />
          <span className="sidebar-label">Issues</span>
        </button>
        <button
          className="nav-item"
          title="Settings"
          onClick={() => onNavigate("settings")}
        >
          <Icon name="settings" />
          <span className="sidebar-label">Settings</span>
        </button>
      </nav>
      {accountMenu}
    </aside>
  );
}
