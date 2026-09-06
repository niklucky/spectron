import { useCallback, useEffect, useRef, useState } from "react";
import {
  filePreviewKind,
  projectFileURL,
  type FilePage,
  type IssueAttachmentSummary,
  type ProjectFileSummary,
} from "@spectron/shared";
import { Button } from "../../ui/button";
import { Input, Select } from "../../ui/input";
import { Dialog } from "../../ui/dialog";

export type IssueFileActions = {
  list: (
    projectId: string,
    issueId: string,
  ) => Promise<IssueAttachmentSummary[]>;
  limits: () => Promise<{ maxBytes: number }>;
  upload: (projectId: string, file: File) => Promise<ProjectFileSummary>;
  library: (
    projectId: string | undefined,
    search: string,
    offset: number,
  ) => Promise<FilePage>;
  link: (
    projectId: string,
    issueId: string,
    sourceProjectId: string,
    projectFileId: string,
  ) => Promise<void>;
  unlink: (
    projectId: string,
    issueId: string,
    attachmentId: string,
  ) => Promise<void>;
};
const sizeLabel = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
      const [rows, limits] = await Promise.all([
        actions.list(projectId, issueId),
        actions.limits(),
      ]);
      if (active.current && request === version.current) {
        setFiles(rows);
        setMaxBytes(limits.maxBytes);
      }
    } catch (cause) {
      if (active.current && request === version.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load attachments.",
        );
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
      if (active.current)
        setError(
          cause instanceof Error ? cause.message : "Could not save attachment.",
        );
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
    <section className="issue-files">
      <div className="issue-files-heading">
        <h3>Attachments</h3>
        {!deleted && (
          <div>
            <Button
              variant="ghost"
              disabled={busy || loading || maxBytes === null}
              onClick={() => input.current?.click()}
            >
              Upload files
            </Button>
            <Button
              variant="ghost"
              disabled={busy || loading}
              onClick={() => setPicker(true)}
            >
              Reuse a file
            </Button>
          </div>
        )}
      </div>
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
              if (
                !maxBytes ||
                selectedFile.size > maxBytes ||
                !selectedFile.size
              )
                throw new Error(
                  `${selectedFile.name}: choose a non-empty file up to ${sizeLabel(maxBytes ?? 0)}.`,
                );
              setProgress(
                `Uploading ${selectedFile.name} (${index + 1}/${selected.length})…`,
              );
              const uploaded = await actions.upload(projectId, selectedFile);
              try {
                await actions.link(
                  projectId,
                  issueId,
                  uploaded.projectId,
                  uploaded.projectFileId,
                );
              } catch {
                throw new Error(
                  `${selectedFile.name} was uploaded to project files but could not be attached. Use “Reuse a file” to try again.`,
                );
              }
            }
          });
        }}
      />
      {loading ? (
        <p role="status">Loading attachments…</p>
      ) : (
        !files.length && <p className="muted">No attachments yet.</p>
      )}
      <ul className="issue-file-grid">
        {files.map((file) => {
          const url = projectFileURL(file.projectId, file.projectFileId);
          const kind = filePreviewKind(file.contentType);
          return (
            <li key={file.attachmentId}>
              {kind === "image" && (
                <a href={url} target="_blank" rel="noreferrer">
                  <img
                    className="issue-file-image"
                    src={url}
                    alt={file.filename}
                    loading="lazy"
                  />
                </a>
              )}
              {kind === "audio" && (
                <audio
                  controls
                  preload="metadata"
                  src={url}
                  aria-label={file.filename}
                />
              )}
              {kind === "video" && (
                <video
                  controls
                  preload="metadata"
                  src={url}
                  aria-label={file.filename}
                />
              )}
              <div className="issue-file-name">
                <a
                  href={projectFileURL(
                    file.projectId,
                    file.projectFileId,
                    true,
                  )}
                >
                  {file.filename}
                </a>
                <small>{sizeLabel(file.sizeBytes)}</small>
              </div>
              {!deleted && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove ${file.filename}`}
                  onClick={() =>
                    void run(() =>
                      actions.unlink(projectId, issueId, file.attachmentId),
                    )
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!deleted && maxBytes !== null && (
        <p className="muted issue-file-limit">
          Up to {sizeLabel(maxBytes)} per file. Removing an attachment keeps the
          file available for reuse.
        </p>
      )}
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p className="project-error" role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            Reload
          </Button>
        </p>
      )}
      {picker && (
        <FilePicker
          projectId={projectId}
          actions={actions}
          onClose={() => setPicker(false)}
          onSelect={async (file) => {
            await actions.link(
              projectId,
              issueId,
              file.projectId,
              file.projectFileId,
            );
            setPicker(false);
            await refresh();
            onChange();
          }}
        />
      )}
    </section>
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
    <Dialog
      title="Reuse a file"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="file-picker-search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
        }}
      >
        <Select
          aria-label="File source"
          value={scope}
          disabled={busy || loading}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="project">This project</option>
          <option value="all">All my projects</option>
        </Select>
        <Input
          aria-label="Search files"
          placeholder="Search filenames…"
          maxLength={255}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || loading}>
          Search
        </Button>
      </form>
      {scope === "all" && (
        <p className="muted">
          Reusing a file here makes it available to members of this issue’s
          project.
        </p>
      )}
      {loading ? (
        <p role="status">Loading files…</p>
      ) : !files.length ? (
        <p className="muted">No matching files.</p>
      ) : (
        <ul className="file-picker-list">
          {files.map((file) => (
            <li key={file.projectFileId}>
              <span>
                <strong>{file.filename}</strong>
                <small>
                  {file.projectName} · {sizeLabel(file.sizeBytes)}
                </small>
              </span>
              <Button
                disabled={busy}
                aria-label={`Attach ${file.filename} from ${file.projectName}`}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onSelect(file);
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not attach file.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
      {next !== null && !loading && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const page = await actions.library(
                scope === "project" ? projectId : undefined,
                query,
                next,
              );
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
      {error && (
        <p className="project-error" role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            onClick={() => setReload((n) => n + 1)}
            disabled={busy}
          >
            Retry
          </Button>
        </p>
      )}
    </Dialog>
  );
}
