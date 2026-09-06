import type { ReactNode } from "react";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
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
  onNavigate,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand-row">
        <a
          href="#SP-123"
          onClick={(event) => {
            event.preventDefault();
            onSelectProject("Spectron");
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
            <button
              key={item.name}
              className={`nav-item ${!isFlow && project === item.name ? "active" : ""}`}
              title={item.name}
              aria-label={item.name}
              aria-current={
                !isFlow && project === item.name ? "page" : undefined
              }
              onClick={() => onSelectProject(item.name)}
            >
              <span className={`project-icon ${item.color}`}>
                {item.initial}
              </span>
              <span className="sidebar-label">{item.name}</span>
              {item.name === "Spectron" && (
                <span className="project-unread sidebar-label" />
              )}
            </button>
          ))}
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
