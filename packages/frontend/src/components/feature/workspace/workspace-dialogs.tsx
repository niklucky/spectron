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
  onCreateTask: (title: string, project: string) => Promise<void>;
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
