import { ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
import { ComposerShell, SendButton } from "../../ui/chat";
import { IconButton } from "../../ui/button";
import { AttachmentPreview } from "./issue-files";
import type { IssueFileActions } from "./issue-files";
import { useEffect, useMemo, useRef, useState } from "react";
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
        ISSUE_DESCRIPTION_MAX_LENGTH,
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
  const previews = useMemo(() => {
    const map = new Map<File, string>();
    for (const file of files)
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) map.set(file, URL.createObjectURL(file));
    return map;
  }, [files]);
  useEffect(() => () => { for (const url of previews.values()) URL.revokeObjectURL(url); }, [previews]);
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
  const projectMark = destination;
  return (
    <section className="chat-column relative flex min-w-0 flex-col items-center justify-center bg-surface px-8 py-8" aria-label="New issue chat">
      <button type="button" className="absolute top-4 left-4 hidden text-sm text-accent-ink max-[700px]:block" onClick={onBack}>
        ← Back to tasks
      </button>
      <div className="mb-7 flex flex-col items-center text-center">
        <ProjectMark project={projectMark} size="lg" className="mb-4" />
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">What are we working on?</h1>
        <p className="mt-2 text-md text-ink-2">Send your first message to create an issue in {destination.name}.</p>
      </div>
      <div className="w-full max-w-[680px]">
        <ComposerShell
          className={dragging ? "outline-2 outline-dashed outline-accent outline-offset-4" : undefined}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = busy ? "none" : "copy";
              if (!busy) setDragging(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
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
          pending={
            files.length ? (
              <>
                {files.map((file, index) => (
                  <AttachmentPreview
                    key={`${file.name}:${file.lastModified}:${index}`}
                    name={file.name}
                    size={file.size}
                    contentType={file.type || "application/octet-stream"}
                    src={previews.get(file)}
                    busy={busy}
                    onRemove={() => setFiles((previous) => previous.filter((f) => f !== file))}
                  />
                ))}
              </>
            ) : undefined
          }
          chips={
            isFlow && projects.length > 1 ? (
              <label className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-surface-3 pr-1.5 pl-2 text-sm font-medium text-ink-2">
                <ProjectMark project={destination} size="xs" />
                <select aria-label="Issue project" className="bg-transparent text-sm font-medium text-ink outline-none" value={destination.id} disabled={busy || voice.listening} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            ) : undefined
          }
          hint="first line becomes the title"
          tools={
            <>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              <IconButton icon="paperclip" label="Add attachments" className="text-ink-3" disabled={busy} onClick={() => fileInput.current?.click()} />
              <IconButton icon={voice.listening ? "pause" : "mic"} label={voice.listening ? "Stop dictation" : "Dictate"} className={voice.listening ? "bg-bad-soft text-bad" : "text-ink-3"} aria-pressed={voice.listening} disabled={busy} onClick={() => { setPreview(false); voice.toggle(language); }} />
              {voice.listening && (
                <select className="h-6 rounded-sm bg-transparent text-xs text-ink-3" aria-label="Dictation language" value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="en-US">EN</option>
                  <option value="ru-RU">RU</option>
                </select>
              )}
              <button type="button" className={`ml-1 rounded-sm px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink ${preview ? "bg-surface-3 text-ink" : ""}`} aria-pressed={preview} onClick={() => setPreview((v) => !v)}>{preview ? "Edit" : "Preview"}</button>
              <span className="ml-auto mr-1.5 hidden text-xs text-ink-3 md:inline"><kbd className="mono rounded-sm border border-line-soft bg-surface-2 px-1 text-2xs">↵</kbd> create · <kbd className="mono rounded-sm border border-line-soft bg-surface-2 px-1 text-2xs">⇧↵</kbd> newline</span>
              <SendButton disabled={busy || voice.listening || (!draft.trim() && !files.length)} label="Create issue" />
            </>
          }
        >
          {preview ? (
            <div className="prose-chat max-h-60 min-h-[72px] overflow-y-auto px-3.5 pt-2.5 pb-1 text-lg" aria-label="Message preview">
              <MessageMarkdown text={draft || "Your message preview appears here."} />
            </div>
          ) : (
            <textarea
              ref={editor}
              autoFocus
              rows={3}
              aria-label="First message"
              placeholder="Describe the issue…"
              value={draft}
              maxLength={ISSUE_DESCRIPTION_MAX_LENGTH}
              disabled={busy || voice.listening}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="block max-h-[40vh] min-h-[72px] w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-lg text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
            />
          )}
          {voice.listening && <p className="px-3.5 pb-1 text-sm text-ink-2" role="status">{voice.interim || "Listening…"}</p>}
          {progress && <p className="px-3.5 pb-1 text-sm text-ink-3" role="status">{progress}</p>}
          {(error || voice.error) && <p role="alert" className="px-3.5 pb-1 text-sm text-bad">{error || voice.error}</p>}
        </ComposerShell>
        <p className="mt-3 text-center text-xs text-ink-3">Formatting and details are saved in the description.</p>
      </div>
    </section>
  );
}
