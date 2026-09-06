import { AccountMenu } from "@spectron/frontend/components/feature/account";
import {
  ChatPanel,
  ChatHeader,
  ChatTimeline,
  ChatComposer,
} from "@spectron/frontend/components/feature/chat";
import { TaskList } from "@spectron/frontend/components/feature/task";
import {
  Sidebar,
  WorkspaceLayout,
  WorkspaceDialogs,
} from "@spectron/frontend/components/feature/workspace";
import { Toast } from "@spectron/frontend/components/ui/toast";
import {
  previewAssignee,
  previewSources,
  previewMedia,
} from "./fixtures/preview-metadata";
import { DemoConversation } from "./fixtures/demo-conversation";
import { useWorkspace } from "./hooks/use-workspace";
import { projects } from "./mock-data";
import { AuthGate } from "./auth-gate";
import { authClient } from "./lib/auth-client";
import "@spectron/frontend/workspace.css";

export function App() {
  return (
    <AuthGate>{(user) => <Workspace key={user.id} user={user} />}</AuthGate>
  );
}

function Workspace({ user }: { user: { name: string } }) {
  const workspace = useWorkspace(user.name);
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
      <TaskList
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
      <ChatPanel
        header={
          <ChatHeader
            assignee={previewAssignee}
            sources={previewSources}
            task={workspace.task}
            projectInfo={
              projects.find((project) => project.name === workspace.project)!
            }
            isFlow={workspace.isFlow}
            details={workspace.details}
            onBack={() => workspace.setMobileChat(false)}
            onToggleDetails={() => workspace.setDetails((value) => !value)}
            onStatusChange={(status) => workspace.updateTask({ status })}
            onCopyLink={workspace.copyTaskLink}
            onSources={() => workspace.openModal("sources")}
          />
        }
        composer={
          <ChatComposer
            project={workspace.project}
            taskId={workspace.task.id}
            draft={workspace.draft}
            attachment={workspace.attachment}
            recording={workspace.recording}
            composeRef={workspace.composeRef}
            onDraftChange={workspace.setDraft}
            onSend={workspace.sendMessage}
            onAttachFile={workspace.attachFile}
            onRemoveAttachment={workspace.removeAttachment}
            onToggleRecording={() => void workspace.toggleRecording()}
          />
        }
      >
        <ChatTimeline
          title={workspace.task.title}
          historyRef={workspace.historyRef}
          endRef={workspace.bottomRef}
          messages={workspace.messages}
        >
          {workspace.task.id === "SP-123" && (
            <DemoConversation
              onImage={(url) => {
                workspace.setImage(url);
                workspace.openModal("image");
              }}
              onVideo={() => workspace.openModal("video")}
              onSource={() => workspace.openModal("sources")}
            />
          )}
        </ChatTimeline>
      </ChatPanel>
      <Toast message={workspace.notice} />
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
