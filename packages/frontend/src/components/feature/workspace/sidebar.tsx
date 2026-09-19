import type { ReactNode } from "react";
import { Icon, type IconName } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { Menu } from "../../ui/menu";
import { ProjectMark } from "../project";
import { cn } from "../../ui/cn";
import type { Project } from "../task/types";

type SidebarProps = {
  collapsed: boolean;
  project: string;
  projects: Project[];
  isFlow: boolean;
  accountMenu: ReactNode;
  unreadCount?: number | undefined;
  onToggleCollapse: () => void;
  onSelectProject: (project: string) => void;
  onSelectFlow: () => void;
  onCreateProject: () => void;
  onProjectSettings: (id: string) => void;
  onArchiveProject: (id: string) => void;
  onNavigate: (page: "overview" | "issues" | "settings") => void;
  onOpenAgents?: (() => void) | undefined;
};

function NavItem({
  icon,
  label,
  active = false,
  collapsed,
  onClick,
  trailing,
  leading,
}: {
  icon?: IconName;
  label: string;
  active?: boolean;
  collapsed: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-base whitespace-nowrap transition-colors select-none",
        collapsed && "justify-center px-0",
        active
          ? "bg-surface text-ink shadow-[0_1px_1px_rgb(0_0_0/0.04),inset_0_0_0_1px_var(--sp-line)]"
          : "text-ink-2 hover:bg-surface-3 hover:text-ink",
      )}
    >
      {leading ?? (icon && <Icon name={icon} size={16} />)}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && trailing}
    </button>
  );
}

export function Sidebar({
  collapsed,
  project,
  projects,
  isFlow,
  accountMenu,
  unreadCount = 0,
  onToggleCollapse,
  onSelectProject,
  onSelectFlow,
  onCreateProject,
  onProjectSettings,
  onArchiveProject,
  onNavigate,
  onOpenAgents,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "sidebar flex min-w-0 flex-col gap-1 bg-bg py-3.5",
        collapsed ? "px-2.5" : "px-3",
      )}
      aria-label="Main navigation"
    >
      <div
        className={cn(
          "flex items-center gap-2.5 pb-3",
          collapsed ? "justify-center px-0" : "pr-1 pl-2",
        )}
      >
        <a
          href="#flow"
          onClick={(event) => {
            event.preventDefault();
            onSelectFlow();
          }}
          className="flex items-center gap-2.5 text-ink no-underline"
          aria-label="Spectron home"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 15 9 5M11 19l3-14M16 15l3-10" />
          </svg>
          {!collapsed && (
            <span className="text-base font-semibold tracking-[-0.02em]">
              spectron
            </span>
          )}
        </a>
        {!collapsed && (
          <IconButton
            icon="sidebar"
            label="Collapse sidebar"
            onClick={onToggleCollapse}
            className="ml-auto text-ink-3"
          />
        )}
      </div>
      {collapsed && (
        <IconButton
          icon="sidebar"
          label="Expand sidebar"
          onClick={onToggleCollapse}
          className="mx-auto mb-1 text-ink-3"
        />
      )}
      <nav className="flex flex-col gap-px">
        <NavItem
          icon="inbox"
          label="Flow"
          collapsed={collapsed}
          active={isFlow}
          onClick={onSelectFlow}
          trailing={
            unreadCount > 0 ? (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  isFlow ? "font-semibold text-accent-ink" : "text-ink-3",
                )}
              >
                {unreadCount}
              </span>
            ) : undefined
          }
        />
        <NavItem
          icon="overview"
          label="Overview"
          collapsed={collapsed}
          onClick={() => onNavigate("overview")}
        />
      </nav>
      <div
        className={cn(
          "label-caps flex items-center justify-between pt-3.5 pb-1.5",
          collapsed ? "justify-center px-0" : "px-2.5",
        )}
      >
        {!collapsed && <span>Projects</span>}
        <button
          type="button"
          title="New project"
          aria-label="New project"
          onClick={onCreateProject}
          className="grid size-5 place-items-center rounded-sm text-ink-3 hover:bg-surface-3 hover:text-ink"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      <nav className="flex flex-col gap-px">
        {projects.map((item) => {
          const active = !isFlow && project === item.id;
          return (
            <div key={item.id} className="group/project relative flex items-center">
              <NavItem
                label={item.name}
                collapsed={collapsed}
                active={active}
                onClick={() => onSelectProject(item.id)}
                leading={<ProjectMark project={item} size="sm" />}
              />
              {!collapsed && (
                <Menu
                  className="absolute right-1 size-6 opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  label={`${item.name} options`}
                  items={[
                    {
                      label: "Settings",
                      icon: "settings",
                      onSelect: () => onProjectSettings(item.id),
                    },
                    ...(item.role === "owner"
                      ? [
                          {
                            label: "Archive",
                            icon: "trash" as const,
                            danger: true,
                            onSelect: () => onArchiveProject(item.id),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </div>
          );
        })}
      </nav>
      {onOpenAgents && (
        <>
          <div
            className={cn(
              "label-caps pt-3.5 pb-1.5",
              collapsed ? "text-center" : "px-2.5",
            )}
          >
            {!collapsed && "Team"}
          </div>
          <nav className="flex flex-col gap-px">
            <NavItem
              icon="users"
              label="Agents"
              collapsed={collapsed}
              onClick={onOpenAgents}
            />
          </nav>
        </>
      )}
      <div className="mt-auto flex flex-col gap-px">
        <NavItem
          icon="issues"
          label="Issues"
          collapsed={collapsed}
          onClick={() => onNavigate("issues")}
        />
        <NavItem
          icon="settings"
          label="Settings"
          collapsed={collapsed}
          onClick={() => onNavigate("settings")}
        />
        {accountMenu}
      </div>
    </aside>
  );
}
