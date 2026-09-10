import { exportActionsFor } from "./lib/export-actions";
import { ProjectIntegrationSettings } from "./project-integration-settings";
import type {
  WorklogFields,
  WorklogPage,
  WorklogScope,
} from "@spectron/shared";
import type {
  CommentScope,
  CommentCursor,
  CommentDraft,
} from "@spectron/shared";
import { useEffect, useMemo, useState } from "react";
import { AccountMenu, AISettingsPage } from "@spectron/frontend/components/feature/account";
import { aiActions } from "./lib/ai-actions";
import {
  TaskList,
  NewIssueChat,
  defaultTaskFilters,
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
  ProjectSettingsPage,
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
  user: { id: string; name: string };
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
  const workspace = useWorkspace(user.name, projects, user.id);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [aiSettings, setAISettings] = useState(false);
  const settingsProject = projectState.projects.find(
    (item) => item.id === settingsId && item.state === "active",
  );
  const settingsActions = useMemo(
    () => ({
      fields: {
        load: () => trpc.issues.settings.query({ projectId: settingsId! }),
        save: async (input: {
          id?: string;
          name: string;
          type: "text" | "date" | "number" | "user";
        }) => {
          await trpc.fields.save.mutate({ projectId: settingsId!, ...input });
          await workspace.refresh();
        },
      },
      jira: {
        exports: exportActionsFor(settingsId!, "jira"),
        test: (config: import("@spectron/shared").JiraConfigInput) => trpc.jira.test.mutate({ projectId: settingsId!, config }),
        get: () => trpc.jira.get.query({ projectId: settingsId! }),
        save: async (config: import("@spectron/shared").JiraConfigInput) => {
          const result = await trpc.jira.save.mutate({
            projectId: settingsId!,
            config,
          });
          await workspace.refresh();
          return result;
        },
        discover: (config?: import("@spectron/shared").JiraConfigInput) =>
          trpc.jira.discover.mutate({
            projectId: settingsId!,
            ...(config ? { config } : {}),
          }),
        mappings: async (mappings: import("@spectron/shared").JiraMappings) => {
          await trpc.jira.mappings.mutate({ projectId: settingsId!, mappings });
          await workspace.refresh();
        },
        schedule: (minutes: 15 | 60 | 1440 | null) =>
          trpc.jira.schedule.mutate({ projectId: settingsId!, minutes }),
        startImport: () =>
          trpc.jira.startImport.mutate({ projectId: settingsId! }),
        stopImport: (runId: string) =>
          trpc.jira.stopImport.mutate({ projectId: settingsId!, runId }),
        finishImport: (runId: string) =>
          trpc.jira.finishImport.mutate({ projectId: settingsId!, runId }),
        prepare: (runId?: string) =>
          trpc.jira.prepare.mutate({
            projectId: settingsId!,
            ...(runId ? { runId } : {}),
          }),
        search: (nextPageToken?: string, runId?: string) =>
          trpc.jira.search.mutate({
            projectId: settingsId!,
            ...(nextPageToken ? { nextPageToken } : {}),
            ...(runId ? { runId } : {}),
          }),
        import: (externalId: string, overwriteLocal = false, runId?: string) =>
          trpc.jira.import.mutate({
            projectId: settingsId!,
            externalId,
            overwriteLocal,
            ...(runId ? { runId } : {}),
          }),
        settings: () => trpc.issues.settings.query({ projectId: settingsId! }),
        members: () => trpc.projects.members.query({ id: settingsId! }),
        refresh: workspace.refresh,
        pending: () => trpc.jira.pending.query({ projectId: settingsId! }),
        reconcile: (
          kind: "issue" | "comment",
          id: string,
          externalId: string,
        ) =>
          trpc.jira.reconcile.mutate({
            projectId: settingsId!,
            kind,
            id,
            externalId,
          }),
      },
      issueSettings: {
        load: () => trpc.issues.settings.query({ projectId: settingsId! }),
        save: async (input: import("@spectron/shared").IssueOptionInput) => {
          await trpc.issues.saveOption.mutate(input);
          await workspace.refresh();
        },
        remove: async (kind: "state" | "priority" | "type" | "tag", id: string) => {
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
      canPublish: (projectId: string) =>
        projects.some((p) => p.id === projectId && p.role === "owner") &&
        !!workspace.settings[projectId]?.jiraConnected,
      pushJira: async (
        projectId: string,
        id: string,
        overwriteRemote = false,
      ) => {
        const result = await trpc.jira.pushIssue.mutate({
          projectId,
          id,
          overwriteRemote,
        });
        await workspace.refresh();
        return result;
      },
      activity: (input: {
        projectId: string;
        issueId: string;
        cursor?: string;
      }) => trpc.issues.activity.query(input),
      worklogs: {
        currentUserId: user.id,
        list: (
          input: WorklogScope & {
            includeDeleted: boolean;
            cursor?: NonNullable<WorklogPage["nextCursor"]>;
          },
        ) => trpc.worklogs.list.query(input),
        create: (input: WorklogScope & WorklogFields) =>
          trpc.worklogs.create.mutate(input),
        update: (
          input: WorklogScope &
            WorklogFields & { id: string; expectedUpdatedAt: string },
        ) => trpc.worklogs.update.mutate(input),
        setDeleted: async (
          input: WorklogScope & {
            id: string;
            expectedUpdatedAt: string;
            deleted: boolean;
          },
        ) => {
          await trpc.worklogs.setDeleted.mutate(input);
        },
      },
      comments: {
        canPublish: (projectId: string) =>
          projects.some((p) => p.id === projectId && p.role === "owner") &&
          !!workspace.settings[projectId]?.jiraConnected,
        pushJira: (projectId: string, id: string, overwriteRemote = false) =>
          trpc.jira.pushComment.mutate({ projectId, id, overwriteRemote }),
        list: (
          input: CommentScope & {
            parentId: string | null;
            cursor?: CommentCursor;
          },
        ) => trpc.comments.list.query(input),
        create: (
          input: CommentScope & CommentDraft & { parentId: string | null },
        ) => trpc.comments.create.mutate(input),
        update: (
          input: CommentScope &
            CommentDraft & { id: string; expectedUpdatedAt: string },
        ) => trpc.comments.update.mutate(input),
        delete: async (
          input: CommentScope & { id: string; expectedUpdatedAt: string },
        ) => {
          await trpc.comments.delete.mutate(input);
        },
      },
      files: {
        list: (projectId: string, issueId: string) =>
          trpc.files.attachments.query({ projectId, issueId }),
        limits: () => trpc.files.limits.query(),
        upload: async (
          projectId: string,
          file: File,
        ): Promise<import("@spectron/shared").ProjectFileSummary> => {
          const query = new URLSearchParams({ projectId, filename: file.name });
          const response = await fetch(`/api/files/upload?${query}`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/octet-stream" },
            body: file,
          });
          if (!response.ok) {
            const error = (await response.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(
              error?.error || "Could not upload the file. Please try again.",
            );
          }
          return response.json();
        },
        library: (
          projectId: string | undefined,
          search: string,
          offset: number,
        ) =>
          trpc.files.library.query({
            ...(projectId ? { projectId } : {}),
            search,
            offset,
          }),
        link: async (
          projectId: string,
          issueId: string,
          sourceProjectId: string,
          projectFileId: string,
        ) => {
          await trpc.files.link.mutate({
            projectId,
            issueId,
            sourceProjectId,
            projectFileId,
          });
        },
        unlink: async (
          projectId: string,
          issueId: string,
          attachmentId: string,
        ) => {
          await trpc.files.unlink.mutate({ projectId, issueId, attachmentId });
        },
      },
      members: (projectId: string) =>
        trpc.projects.members.query({ id: projectId }),
      history: (projectId: string, id: string, offset: number) =>
        trpc.issues.history.query({ projectId, id, offset }),
      save: workspace.saveIssue,
      setDeleted: workspace.setDeleted,
    }),
    [
      workspace.saveIssue,
      workspace.setDeleted,
      workspace.refresh,
      projects,
      workspace.settings,
      user.id,
    ],
  );
  const loadIntegrations = useMemo(() => async () => {
    const [jira, tracker] = await Promise.all([
      trpc.jira.get.query({ projectId: settingsId! }),
      trpc.tracker.get.query({ projectId: settingsId! }),
    ]);
    return [
      ...(jira ? [{ provider: "jira", name: "Jira Cloud", key: jira.projectKey, url: jira.baseUrl, account: jira.email, connectedAt: jira.createdAt, lastSyncAt: jira.lastImportedAt }] : []),
      ...(tracker ? [{ provider: "yandex", name: "Yandex Tracker", key: tracker.queue, url: `https://tracker.yandex.ru/${encodeURIComponent(tracker.queue)}`, account: tracker.organizationId, connectedAt: tracker.createdAt, lastSyncAt: null }] : []),
    ];
  }, [settingsId]);
  const clearFilters = () => {
    workspace.setQuery("");
    workspace.setFilter(defaultTaskFilters);
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
        onSelectProject={(id) => { if (!integrationBusy) { setAISettings(false); setSettingsId(null); workspace.selectProject(id); } }}
        onSelectFlow={() => { if (!integrationBusy) { setAISettings(false); setSettingsId(null); workspace.selectFlow(); } }}
        onCreateProject={projectState.openCreate}
        onProjectSettings={(id) => { setAISettings(false); setSettingsId(id); }}
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
              if (action === "ai") {
                if (!integrationBusy) { setSettingsId(null); setAISettings(true); }
              } else if (action === "signout") {
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
      {aiSettings ? (
        <AISettingsPage actions={aiActions} projects={projects} ownerId={user.id} onClose={() => setAISettings(false)} />
      ) : settingsProject ? (
        <ProjectSettingsPage
          key={settingsProject.id}
          project={settingsProject}
          actions={settingsActions}
          externalBusy={integrationBusy}
          loadIntegrations={loadIntegrations}
          yandexSettings={
            settingsProject.role === "owner" ? (
              <ProjectIntegrationSettings
                projectId={settingsProject.id}
                onChanged={workspace.refresh}
                onBusyChange={setIntegrationBusy}
              />
            ) : (
              <p className="muted">
                Only the project owner can manage Yandex Tracker.
              </p>
            )
          }
          onClose={() => setSettingsId(null)}
        />
      ) : projectState.loading || !projects.length ? (
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
            settings={workspace.settings}
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
            onNewTask={workspace.startNewIssue}
          />
          {workspace.creatingIssue ? (
            <NewIssueChat
              key={`${workspace.isFlow}:${workspace.project}`}
              project={workspace.project}
              projects={projects}
              isFlow={workspace.isFlow}
              onCreate={workspace.createTask}
              fileActions={issueActions.files}
              onBack={() => workspace.setMobileChat(false)}
            />
          ) : task && project ? (
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
              onActivityChange={() => void workspace.refresh()}
              onBack={() => workspace.setMobileChat(false)}
              onCopy={workspace.copyTaskLink}
              onSelect={workspace.selectTask}
            />
          ) : (
            <section className="chat-empty-state">
              <button
                className="mobile-back"
                onClick={() => workspace.setMobileChat(false)}
              >
                Back to tasks
              </button>
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
