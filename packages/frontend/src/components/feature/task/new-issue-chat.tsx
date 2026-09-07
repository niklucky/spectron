import { MessageComposer, MessageComposerActions } from "./message-composer";
import type { IssueFileActions } from "./issue-files";
import { useRef, useState } from "react";
import { ProjectMark } from "../project";
import { Icon } from "../../ui/icon";
import { MessageMarkdown } from "../../ui/message-markdown";
import { useDictation } from "./use-dictation";
import type { Project } from "./types";

export function NewIssueChat({
  project,
  projects,
  isFlow,
  onCreate,
  onBack,
  fileActions,
}: {
  project: string;
  projects: Project[];
  isFlow: boolean;
  onCreate: (
    message: string,
    projectId: string,
    projectFileIds?: string[],
  ) => Promise<void>;
  fileActions: Pick<IssueFileActions, "upload" | "limits">;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(""),
    [projectId, setProjectId] = useState(project);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState(false),
    [language, setLanguage] = useState(() =>
      navigator.language.startsWith("ru") ? "ru-RU" : "en-US",
    );
  const editor = useRef<HTMLTextAreaElement>(null);
  const voice = useDictation((text) =>
    setDraft((previous) =>
      `${previous}${previous && !/\s$/.test(previous) ? " " : ""}${text}`.slice(
        0,
        100000,
      ),
    ),
  );
  const destination =
    projects.find((p) => p.id === (isFlow ? projectId : project)) ??
    projects[0]!;
  const fileInput = useRef<HTMLInputElement>(null);
  const uploaded = useRef(new Map<File, { projectId: string; id: string }>());
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState("");
  const addFiles = (incoming: File[]) => {
    if (busy) return;
    setError("");
    setFiles((previous) => {
      const next = [...previous];
      for (const file of incoming) {
        if (
          !next.some(
            (f) =>
              f.name === file.name &&
              f.size === file.size &&
              f.lastModified === file.lastModified,
          )
        )
          next.push(file);
      }
      return next;
    });
  };
  const send = async () => {
    if (busy || voice.listening || (!draft.trim() && !files.length)) return;
    setBusy(true);
    setError("");
    try {
      if (files.length > 20)
        throw new Error("Attach up to 20 files per issue.");
      const ids: string[] = [];
      if (files.length) {
        const { maxBytes } = await fileActions.limits();
        const tooLarge = files.find((file) => file.size > maxBytes);
        if (tooLarge)
          throw new Error(
            `${tooLarge.name} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB file limit.`,
          );
        for (const [index, file] of files.entries()) {
          setProgress(`Uploading ${index + 1} of ${files.length}…`);
          let saved = uploaded.current.get(file);
          if (!saved || saved.projectId !== destination.id) {
            const row = await fileActions.upload(destination.id, file);
            saved = { projectId: destination.id, id: row.projectFileId };
            uploaded.current.set(file, saved);
          }
          ids.push(saved.id);
        }
      }
      setProgress("Creating issue…");
      await onCreate(draft.trim() || files[0]!.name, destination.id, ids);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create issue. Try again.",
      );
      setBusy(false);
      setProgress("");
    }
  };
  return (
    <section className="new-issue-chat" aria-label="New issue chat">
      <button className="mobile-back" onClick={onBack}>
        Back to tasks
      </button>
      <div className="new-issue-welcome">
        <ProjectMark project={destination} />
        <h1>What are we working on?</h1>
        <p>Send your first message to create an issue in {destination.name}.</p>
      </div>
      <MessageComposer
        className={`new-issue-composer ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = busy ? "none" : "copy";
            if (!busy) setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(false);
            addFiles(Array.from(e.dataTransfer.files));
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {preview ? (
          <div className="message-preview" aria-label="Message preview">
            <MessageMarkdown
              text={draft || "Your message preview appears here."}
            />
          </div>
        ) : (
          <textarea
            ref={editor}
            autoFocus
            aria-label="First message"
            placeholder="Describe the issue…"
            value={draft}
            maxLength={100000}
            disabled={busy || voice.listening}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
        )}
        {voice.listening && (
          <p className="dictation-status" role="status">
            {voice.interim || "Listening…"}
          </p>
        )}
        {dragging && (
          <div className="new-issue-drop-hint">Drop files to attach</div>
        )}
        {!!files.length && (
          <ul
            className="new-issue-attachments"
            aria-label="Pending attachments"
          >
            {files.map((file, index) => (
              <li key={`${file.name}:${file.lastModified}:${index}`}>
                <Icon name="file" size={16} />
                <span title={file.name}>
                  {file.name}
                  <small>
                    {file.size < 1024 * 1024
                      ? `${Math.ceil(file.size / 1024)} KB`
                      : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles((previous) => previous.filter((f) => f !== file))
                  }
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {progress && (
          <p className="dictation-status" role="status">
            {progress}
          </p>
        )}
        <div className="new-issue-toolbar">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="new-issue-attach"
            aria-label="Add attachments"
            title="Add attachments or drop files here"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="plus" size={18} />
          </button>
          {isFlow ? (
            <select
              aria-label="Issue project"
              value={destination.id}
              disabled={busy || voice.listening}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="new-issue-project-name">{destination.name}</span>
          )}
          <MessageComposerActions
            preview={preview}
            setPreview={setPreview}
            language={language}
            setLanguage={setLanguage}
            voice={voice}
            busy={busy}
            canSend={!!draft.trim() || !!files.length}
          />
        </div>
        {(error || voice.error) && (
          <p role="alert" className="project-error">
            {error || voice.error}
          </p>
        )}
        <p className="new-issue-hint">
          First line becomes the title. Formatting and details are saved in the
          description. Shift+Enter for a new line.
        </p>
      </MessageComposer>
    </section>
  );
}
