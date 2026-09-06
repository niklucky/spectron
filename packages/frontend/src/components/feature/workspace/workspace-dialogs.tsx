import { Icon } from "../../ui/icon";
import { Button } from "../../ui/button";
import { Select } from "../../ui/input";
import { Dialog } from "../../ui/dialog";
import { NewTaskDialog } from "../task/new-task-dialog";
import { ProfileDialog } from "../account/profile-dialog";
import type { Project } from "../task/types";
import type { Theme } from "../../../hooks/use-theme";
export type WorkspaceDialogName =
  | "profile"
  | "language"
  | "new-task"
  | "overview"
  | "issues"
  | "settings"
  | "video"
  | "image"
  | "sources"
  | null;
type WorkspaceDialogsProps = {
  modal: WorkspaceDialogName;
  project: string;
  projects: Project[];
  isFlow: boolean;
  name: string;
  image: string;
  media: {
    imageTitle: string;
    imageAlt: string;
    videoTitle: string;
    videoSrc: string;
    videoNote: string;
  };
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onProfileSave: (name: string) => void | Promise<void>;
  onCreateTask: (title: string, project: string) => void;
  onClose: () => void;
};
export function WorkspaceDialogs({
  modal,
  project,
  projects,
  isFlow,
  name,
  image,
  media,
  theme,
  setTheme,
  onProfileSave,
  onCreateTask,
  onClose,
}: WorkspaceDialogsProps) {
  if (modal === "new-task")
    return (
      <NewTaskDialog
        project={project}
        projects={projects}
        isFlow={isFlow}
        onCreate={onCreateTask}
        onClose={onClose}
      />
    );
  if (modal === "profile")
    return (
      <ProfileDialog name={name} onSave={onProfileSave} onClose={onClose} />
    );
  return (
    <>
      {" "}
      {modal === "language" && (
        <Dialog title="Language" onClose={() => onClose()}>
          <div className="setting-row">
            <span>English</span>
            <Icon name="check" size={16} />
          </div>
          <p className="muted">
            More languages will be added with localization.
          </p>
        </Dialog>
      )}
      {(modal === "overview" || modal === "issues") && (
        <Dialog
          title={modal === "overview" ? "Overview" : "Issues"}
          onClose={() => onClose()}
        >
          <p className="muted">
            {modal === "overview"
              ? "A space for your team’s widgets and reports. We’ll design this next."
              : "Your aggregated kanban, lists, sprints, and reports will live here."}
          </p>
          <div className="dialog-footer">
            <Button onClick={() => onClose()}>Back to conversations</Button>
          </div>
        </Dialog>
      )}
      {modal === "settings" && (
        <Dialog title="Settings" onClose={() => onClose()}>
          <label className="setting-row">
            Appearance
            <Select
              variant="plain"
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </Select>
          </label>
          <div className="setting-row">
            <span>Workspace</span>
            <span>
              {projects.find((item) => item.id === project)?.name ||
                "No project"}
            </span>
          </div>
          <p className="muted">
            Connections and team settings will be added as we build.
          </p>
        </Dialog>
      )}
      {modal === "sources" && (
        <Dialog title="Conversation sources" onClose={() => onClose()}>
          <p className="muted">
            Sample messages show how connected tools can share one conversation.
            No services are connected yet.
          </p>
          {(["slack", "jira", "telegram", "github", "gitlab"] as const).map(
            (source) => (
              <div className="setting-row" key={source}>
                <span className="source-name">
                  <Icon name={source} />
                  {source === "github"
                    ? "GitHub"
                    : source === "gitlab"
                      ? "GitLab"
                      : source.charAt(0).toUpperCase() + source.slice(1)}
                </span>
                <span className="muted">Preview</span>
              </div>
            ),
          )}
        </Dialog>
      )}
      {modal === "image" && (
        <Dialog
          title={media.imageTitle}
          className="media-dialog"
          onClose={() => onClose()}
        >
          <img className="expanded-image" src={image} alt={media.imageAlt} />
        </Dialog>
      )}
      {modal === "video" && (
        <Dialog
          title={media.videoTitle}
          className="media-dialog"
          onClose={() => onClose()}
        >
          <video
            src={media.videoSrc}
            controls
            autoPlay
            playsInline
            className="expanded-video"
          />
          <p className="muted media-note">{media.videoNote}</p>
        </Dialog>
      )}
    </>
  );
}
