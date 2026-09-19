import { useAttachmentGallery } from "./attachment-gallery";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  filePreviewKind,
  projectFileURL,
  type FilePage,
  type IssueAttachmentSummary,
  type ProjectFileSummary,
} from "@spectron/shared";
import { Button, IconButton } from "../../ui/button";
import { Input, Select } from "../../ui/input";
import { Dialog } from "../../ui/dialog";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/cn";

export type IssueFileActions = {
  list: (projectId: string, issueId: string) => Promise<IssueAttachmentSummary[]>;
  limits: () => Promise<{ maxBytes: number }>;
  upload: (projectId: string, file: File) => Promise<ProjectFileSummary>;
  library: (projectId: string | undefined, search: string, offset: number) => Promise<FilePage>;
  link: (projectId: string, issueId: string, sourceProjectId: string, projectFileId: string) => Promise<void>;
  unlink: (projectId: string, issueId: string, attachmentId: string) => Promise<void>;
};
export const sizeLabel = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;

/** Attachment tile: image thumbnail, media player, or a file icon. */
export function FileTile({
  file,
  size = "md",
  onRemove,
  busy = false,
}: {
  file: ProjectFileSummary;
  size?: "sm" | "md" | undefined;
  onRemove?: (() => void) | undefined;
  busy?: boolean | undefined;
}) {
  const openGallery = useAttachmentGallery();
  const url = projectFileURL(file.projectId, file.projectFileId);
  const kind = filePreviewKind(file.contentType);
  const box = size === "sm" ? "size-[72px]" : "h-28 w-40";
  return (
    <div className={cn("group/tile relative shrink-0", size === "sm" ? "w-[72px]" : "w-40")}>
      {kind === "image" ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={file.filename}
          className={cn("block overflow-hidden rounded-lg bg-surface-2 hairline", box)}
          onClick={(event) => {
            if (openGallery && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              openGallery(file);
            }
          }}
        >
          <img src={url} alt={file.filename} loading="lazy" className="size-full object-cover" />
        </a>
      ) : kind === "video" ? (
        <video controls preload="metadata" src={url} aria-label={file.filename} className={cn("rounded-lg bg-black object-contain", size === "sm" ? "size-[72px]" : "h-28 w-40")} />
      ) : kind === "audio" ? (
        <audio controls preload="metadata" src={url} aria-label={file.filename} className="h-9 w-60 max-w-full" />
      ) : (
        <a
          href={projectFileURL(file.projectId, file.projectFileId, true)}
          className={cn("grid place-items-center rounded-lg bg-surface-2 text-ink-2 hairline hover:bg-surface-3", box)}
          title={file.filename}
        >
          <Icon name="file" size={size === "sm" ? 18 : 22} />
        </a>
      )}
      {kind !== "audio" && (
        <div className="mt-1 leading-tight">
          <a href={projectFileURL(file.projectId, file.projectFileId, true)} className="block truncate text-xs font-medium text-ink hover:underline" title={file.filename}>
            {file.filename}
          </a>
          <span className="mono block text-2xs text-ink-3">{sizeLabel(file.sizeBytes)}</span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove ${file.filename}`}
          onClick={onRemove}
          className="absolute -top-2 -right-2 hidden size-[18px] place-items-center rounded-full bg-ink text-surface ring-2 ring-surface group-hover/tile:grid focus-visible:grid"
        >
          <Icon name="close" size={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/**
 * Large pending-attachment tile for composers: 200px wide, thumbnail on top,
 * name and size below. `src` is an object URL for local files or the stored
 * file URL after upload.
 */
export function AttachmentPreview({
  name,
  size,
  contentType,
  src,
  onRemove,
  busy = false,
  progress,
}: {
  name: string;
  size: number;
  contentType: string;
  src?: string | undefined;
  onRemove?: (() => void) | undefined;
  busy?: boolean | undefined;
  /** 0..1 while uploading. */
  progress?: number | undefined;
}) {
  const kind = filePreviewKind(contentType);
  return (
    <div className="relative w-[200px] shrink-0">
      <div className="h-[120px] overflow-hidden rounded-lg bg-surface-2 hairline">
        {kind === "image" && src ? (
          <img src={src} alt={name} className="size-full object-cover" />
        ) : kind === "video" && src ? (
          <video src={src} muted preload="metadata" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-ink-3">
            <Icon name={kind === "video" ? "play" : kind === "audio" ? "volume" : kind === "image" ? "image" : "file"} size={26} />
          </div>
        )}
        {kind === "video" && src && (
          <span className="pointer-events-none absolute top-[44px] left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full bg-white/90 text-black"><Icon name="play" size={12} /></span>
        )}
        {progress !== undefined && progress < 1 && (
          <span className="absolute inset-x-2 bottom-[46px] h-1 overflow-hidden rounded-full bg-black/25">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, progress * 100)}%` }} />
          </span>
        )}
      </div>
      <div className="mt-1.5 leading-tight">
        <span className="block truncate text-sm font-medium text-ink" title={name}>{name}</span>
        <span className="mono block text-xs text-ink-3">
          {contentType.split("/")[1]?.toUpperCase() || "FILE"} · {sizeLabel(size)}
          {progress !== undefined && progress < 1 ? ` · ${Math.round(progress * 100)}%` : ""}
        </span>
      </div>
      {onRemove && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-ink text-surface shadow-soft ring-2 ring-surface hover:opacity-90 disabled:opacity-50"
        >
          <Icon name="close" size={11} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export function IssueFiles({
  projectId,
  issueId,
  deleted,
  actions,
  onChange,
  refreshKey = 0,
}: {
  projectId: string;
  issueId: string;
  deleted: boolean;
  actions: IssueFileActions;
  onChange: () => void;
  refreshKey?: number;
}) {
  const [files, setFiles] = useState<IssueAttachmentSummary[]>([]);
  const [maxBytes, setMaxBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      version.current++;
    };
  }, []);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const [rows, limits] = await Promise.all([actions.list(projectId, issueId), actions.limits()]);
      if (active.current && request === version.current) {
        setFiles(rows);
        setMaxBytes(limits.maxBytes);
      }
    } catch (cause) {
      if (active.current && request === version.current)
        setError(cause instanceof Error ? cause.message : "Could not load attachments.");
    } finally {
      if (active.current && request === version.current) setLoading(false);
    }
  }, [actions, projectId, issueId]);
  useEffect(() => {
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh, refreshKey]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Could not save attachment.");
    } finally {
      if (active.current) {
        await refresh();
        setBusy(false);
        setProgress("");
        onChange();
      }
    }
  }
  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Upload attachments"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!selected.length) return;
          void run(async () => {
            for (const [index, selectedFile] of selected.entries()) {
              if (!active.current) break;
              if (!maxBytes || selectedFile.size > maxBytes || !selectedFile.size)
                throw new Error(`${selectedFile.name}: choose a non-empty file up to ${sizeLabel(maxBytes ?? 0)}.`);
              setProgress(`Uploading ${selectedFile.name} (${index + 1}/${selected.length})…`);
              const uploaded = await actions.upload(projectId, selectedFile);
              try {
                await actions.link(projectId, issueId, uploaded.projectId, uploaded.projectFileId);
              } catch {
                throw new Error(`${selectedFile.name} was uploaded to project files but could not be attached. Use “Reuse a file” to try again.`);
              }
            }
          });
        }}
      />
      {loading ? (
        <p role="status" className="text-sm text-ink-3">Loading attachments…</p>
      ) : files.length ? (
        <div className="flex flex-wrap gap-2.5">
          {files.map((file) => (
            <FileTile
              key={file.attachmentId}
              file={file}
              size="sm"
              busy={busy}
              onRemove={!deleted && file.canUnlink !== false ? () => void run(() => actions.unlink(projectId, issueId, file.attachmentId)) : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-3">No attachments yet.</p>
      )}
      {!deleted && (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" icon="paperclip" disabled={busy || loading || maxBytes === null} onClick={() => input.current?.click()}>
            Upload
          </Button>
          <Button variant="ghost" size="sm" icon="files" disabled={busy || loading} onClick={() => setPicker(true)}>
            Reuse a file
          </Button>
          {maxBytes !== null && <span className="ml-auto text-2xs text-ink-3">up to {sizeLabel(maxBytes)}</span>}
        </div>
      )}
      {progress && <p role="status" className="text-sm text-ink-3">{progress}</p>}
      {error && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-bad" role="alert">
          {error}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(""); void refresh(); }}>Reload</Button>
        </p>
      )}
      {picker && (
        <FilePicker
          projectId={projectId}
          actions={actions}
          onClose={() => setPicker(false)}
          onSelect={async (file) => {
            await actions.link(projectId, issueId, file.projectId, file.projectFileId);
            setPicker(false);
            await refresh();
            onChange();
          }}
        />
      )}
    </div>
  );
}

export function FilePicker({
  projectId,
  actions,
  onClose,
  onSelect,
}: {
  projectId: string;
  actions: IssueFileActions;
  onClose: () => void;
  onSelect: (file: ProjectFileSummary) => Promise<void>;
}) {
  const [scope, setScope] = useState("project");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<ProjectFileSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    actions
      .library(scope === "project" ? projectId : undefined, query, 0)
      .then((result) => {
        if (active) {
          setFiles(result.files);
          setNext(result.nextOffset);
        }
      })
      .catch(() => {
        if (active) setError("Could not load project files.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actions, projectId, scope, query, reload]);
  return (
    <Dialog title="Reuse a file" onClose={() => { if (!busy) onClose(); }}>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
        }}
      >
        <Select aria-label="File source" className="w-44" value={scope} disabled={busy || loading} onChange={(e) => setScope(e.target.value)}>
          <option value="project">This project</option>
          <option value="all">All my projects</option>
        </Select>
        <Input aria-label="Search files" placeholder="Search filenames…" maxLength={255} value={search} onChange={(e) => setSearch(e.target.value)} disabled={busy} />
        <Button variant="secondary" type="submit" className="h-8" disabled={busy || loading}>Search</Button>
      </form>
      {scope === "all" && <p className="mt-2 text-sm text-ink-3">Reusing a file here makes it available to members of this issue’s project.</p>}
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {loading ? (
          <p role="status" className="py-4 text-center text-sm text-ink-3">Loading files…</p>
        ) : !files.length ? (
          <p className="py-4 text-center text-sm text-ink-3">No matching files.</p>
        ) : (
          <ul className="flex flex-col">
            {files.map((file) => {
              const kind = filePreviewKind(file.contentType);
              return (
                <li key={file.projectFileId} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-3 text-ink-2">
                    {kind === "image" ? <img src={projectFileURL(file.projectId, file.projectFileId)} alt="" className="size-full object-cover" loading="lazy" /> : <Icon name={kind === "video" ? "play" : kind === "audio" ? "volume" : "file"} size={16} />}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <b className="block truncate text-sm font-semibold">{file.filename}</b>
                    <span className="block truncate text-xs text-ink-3">{file.projectName} · {sizeLabel(file.sizeBytes)}</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Attach ${file.filename} from ${file.projectName}`}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await onSelect(file);
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : "Could not attach file.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Attach
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {next !== null && !loading && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const page = await actions.library(scope === "project" ? projectId : undefined, query, next);
                setFiles((p) => [...p, ...page.files]);
                setNext(page.nextOffset);
              } catch {
                setError("Could not load more files.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Load more files
          </Button>
        )}
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-2 text-sm text-bad" role="alert">
          {error}
          <Button variant="ghost" size="sm" onClick={() => setReload((n) => n + 1)} disabled={busy}>Retry</Button>
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <IconButton icon="close" label="Close" className="hidden" onClick={onClose} />
      </div>
    </Dialog>
  );
}
