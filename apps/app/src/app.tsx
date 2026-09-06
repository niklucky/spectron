import { useEffect, useMemo, useState } from "react";
import { AccountMenu } from "@spectron/frontend/components/feature/account";
import {
  TaskList,
  IssuePanel,
} from "@spectron/frontend/components/feature/task";
import {
  Sidebar,
  WorkspaceLayout,
  WorkspaceDialogs,
} from "@spectron/frontend/components/feature/workspace";
import { Toast } from "@spectron/frontend/components/ui/toast";
import { previewMedia } from "./fixtures/preview-metadata";
import {
  CreateProjectDialog,
  ProjectSettingsDialog,
  ProjectEmptyState,
} from "@spectron/frontend/components/feature/project";
import { InvitationPage } from "./invitation-page";
import { useProjects } from "./hooks/use-projects";
import { useWorkspace } from "./hooks/use-workspace";
import { AuthGate } from "./auth-gate";
import { authClient } from "./lib/auth-client";
import { trpc } from "./lib/trpc";
import "@spectron/frontend/workspace.css";

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return (
    <AuthGate>
      {(user, sessionId) =>
        hash.startsWith("#invite/") ? (
          <InvitationPage
            key={`${sessionId}:${hash}`}
            token={hash.slice(8)}
            email={user.email}
          />
        ) : (
          <Workspace key={sessionId} user={user} sessionId={sessionId} />
        )
      }
    </AuthGate>
  );
}

function Workspace({
  user,
  sessionId,
}: {
  user: { name: string };
  sessionId: string;
}) {
  const projectState = useProjects(sessionId);
  const projects = useMemo(
    () =>
      projectState.projects
        .filter((item) => item.state === "active")
        .map((item) => ({
          ...item,
          initial: item.name.slice(0, 1).toUpperCase(),
        })),
    [projectState.projects],
  );
  const workspace = useWorkspace(user.name, projects);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const settingsProject = projectState.projects.find(
    (item) => item.id === settingsId && item.state === "active",
  );
  const settingsActions = useMemo(
    () => ({
      issueSettings: {
        load: () => trpc.issues.settings.query({ projectId: settingsId! }),
        save: async (input: import("@spectron/shared").IssueOptionInput) => {
          await trpc.issues.saveOption.mutate(input);
          await workspace.refresh();
        },
        remove: async (kind: "state" | "priority", id: string) => {
          await trpc.issues.deleteOption.mutate({
            projectId: settingsId!,
            kind,
            id,
          });
          await workspace.refresh();
        },
      },
      update: (input: import("@spectron/shared").CreateProjectInput) =>
        projectState.update(settingsId!, input),
      members: () => trpc.projects.members.query({ id: settingsId! }),
      invitations: () => trpc.projects.invitations.query({ id: settingsId! }),
      invite: (email: string) =>
        trpc.projects.invite.mutate({ id: settingsId!, email }),
      cancel: (invitationId: string) =>
        trpc.projects.cancelInvitation.mutate({
          id: settingsId!,
          invitationId,
        }),
      discoverLogo: (url: string) => trpc.projects.discoverLogo.mutate({ url }),
    }),
    [settingsId, projectState.update, workspace.refresh],
  );
  const project = projects.find((item) => item.id === workspace.project);
  const task = workspace.task;
  const issueActions = useMemo(
    () => ({
      members: (projectId: string) =>
        trpc.projects.members.query({ id: projectId }),
      history: (projectId: string, id: string, offset: number) =>
        trpc.issues.history.query({ projectId, id, offset }),
      save: workspace.saveIssue,
      setDeleted: workspace.setDeleted,
    }),
    [workspace.saveIssue, workspace.setDeleted],
  );
  const clearFilters = () => {
    workspace.setQuery("");
    workspace.setFilter("all");
  };
  return (
    <WorkspaceLayout
      collapsed={workspace.collapsed}
      mobileChat={workspace.mobileChat}
    >
      <Sidebar
        collapsed={workspace.collapsed}
        project={workspace.project}
        projects={projects}
        isFlow={workspace.isFlow}
        onToggleCollapse={() => workspace.setCollapsed((value) => !value)}
        onSelectProject={workspace.selectProject}
        onSelectFlow={workspace.selectFlow}
        onCreateProject={projectState.openCreate}
        onProjectSettings={setSettingsId}
        onArchiveProject={(id) => {
          void projectState
            .archive(id)
            .then(() => {
              workspace.selectFlow();
              workspace.showNotice("Project archived.");
            })
            .catch((cause) =>
              workspace.showNotice(
                cause instanceof Error
                  ? cause.message
                  : "Couldn’t archive project.",
              ),
            );
        }}
        onNavigate={workspace.openModal}
        accountMenu={
          <AccountMenu
            name={workspace.name}
            theme={workspace.theme}
            onThemeChange={workspace.setTheme}
            onAction={(action) => {
              if (action === "signout") {
                void authClient
                  .signOut()
                  .then(({ error }) => {
                    if (error)
                      workspace.showNotice(
                        "Could not sign out. Please try again.",
                      );
                    else window.location.replace("/login");
                  })
                  .catch(() =>
                    workspace.showNotice(
                      "Could not sign out. Please try again.",
                    ),
                  );
              } else workspace.openModal(action);
            }}
          />
        }
      />
      {projectState.loading || !projects.length ? (
        <ProjectEmptyState
          hasArchived={projectState.projects.some(
            (item) => item.state === "archived",
          )}
          loading={projectState.loading}
          error={projectState.error}
          onRetry={() => void projectState.refresh()}
          onCreate={projectState.openCreate}
        />
      ) : (
        <>
          <TaskList
            loading={workspace.loading}
            error={workspace.error}
            onRetry={() => void workspace.refresh()}
            project={workspace.project}
            projects={projects}
            isFlow={workspace.isFlow}
            tasks={workspace.tasks}
            selectedId={workspace.selectedId}
            query={workspace.query}
            searchOpen={workspace.searchOpen}
            filter={workspace.filter}
            onSearchToggle={() => {
              workspace.setSearchOpen((value) => !value);
              workspace.setQuery("");
            }}
            onSearchClear={() => {
              workspace.setSearchOpen(false);
              workspace.setQuery("");
            }}
            onQueryChange={workspace.setQuery}
            onFilterChange={workspace.setFilter}
            onClearFilters={clearFilters}
            onSelectTask={workspace.selectTask}
            onNewTask={() => workspace.openModal("new-task")}
          />
          {task && project ? (
            <IssuePanel
              key={task.id}
              issue={task}
              settings={
                workspace.settings[task.projectId] ?? {
                  states: [],
                  priorities: [],
                }
              }
              issues={workspace.allIssues}
              actions={issueActions}
              onBack={() => workspace.setMobileChat(false)}
              onCopy={workspace.copyTaskLink}
              onSelect={workspace.selectTask}
            />
          ) : (
            <section className="chat-empty-state">
              <button className="mobile-back" onClick={() => workspace.setMobileChat(false)}>Back to tasks</button>
              <p>
                {workspace.loading
                  ? "Loading issues…"
                  : workspace.selectedId
                    ? "Issue not found. Select another issue or create one."
                    : "Select an issue to view its details."}
              </p>
            </section>
          )}
        </>
      )}
      <Toast message={workspace.notice || projectState.error} />
      {projectState.showCreate && (
        <CreateProjectDialog
          first={!projectState.projects.length}
          onClose={projectState.closeCreate}
          onDiscoverLogo={(url) => trpc.projects.discoverLogo.mutate({ url })}
          onCreate={async (input) => {
            const created = await projectState.create(input);
            workspace.selectProject(created.id);
          }}
        />
      )}
      {settingsProject && (
        <ProjectSettingsDialog
          key={settingsProject.id}
          project={settingsProject}
          actions={settingsActions}
          onClose={() => setSettingsId(null)}
        />
      )}
      <WorkspaceDialogs
        modal={workspace.modal}
        project={workspace.project}
        projects={projects}
        isFlow={workspace.isFlow}
        name={workspace.name}
        image={workspace.image}
        media={previewMedia}
        theme={workspace.theme}
        setTheme={workspace.setTheme}
        onProfileSave={async (name) => {
          const { error } = await authClient.updateUser({ name });
          if (error)
            throw new Error(error.message || "Could not save your profile.");
          workspace.setName(name);
        }}
        onCreateTask={workspace.createTask}
        onClose={() => workspace.setModal(null)}
      />
    </WorkspaceLayout>
  );
}
