import { useCallback, useEffect, useRef, useState } from "react";
import {
  commentDraftText,
  commentBodyFromText,
  moveMentionRanges,
  filePreviewKind,
  projectFileURL,
  type CommentCursor,
  type CommentDraft,
  type CommentPage,
  type CommentScope,
  type CommentSummary,
  type ProjectFileSummary,
  type ProjectMemberSummary,
} from "@spectron/shared";
import { Button } from "../../ui/button";
import { FilePicker, type IssueFileActions } from "./issue-files";
export type CommentActions = {
  list: (
    input: CommentScope & { parentId: string | null; cursor?: CommentCursor },
  ) => Promise<CommentPage>;
  create: (
    input: CommentScope & CommentDraft & { parentId: string | null },
  ) => Promise<{ id: string }>;
  update: (
    input: CommentScope &
      CommentDraft & { id: string; expectedUpdatedAt: string },
  ) => Promise<{ id: string }>;
  delete: (
    input: CommentScope & { id: string; expectedUpdatedAt: string },
  ) => Promise<void>;
};
export type CommentContext = {
  scope: CommentScope;
  actions: CommentActions;
  files: IssueFileActions;
  members: ProjectMemberSummary[];
  deleted: boolean;
  revision: number;
  changed: () => void;
};
export function IssueComments({
  projectId,
  issueId,
  actions,
  files,
  members,
  deleted,
  onChange,
  refreshKey = 0,
}: {
  projectId: string;
  issueId: string;
  actions: CommentActions;
  files: IssueFileActions;
  members: ProjectMemberSummary[];
  deleted: boolean;
  onChange: () => void;
  refreshKey?: number;
}) {
  const [revision, setRevision] = useState(0),
    [composing, setComposing] = useState(false);
  const changed = () => {
    setRevision((v) => v + 1);
    onChange();
  };
  const context: CommentContext = {
    scope: { projectId, issueId },
    actions,
    files,
    members,
    deleted,
    revision: revision + refreshKey,
    changed,
  };
  return (
    <section className="issue-comments" aria-label="Comments">
      <div className="issue-files-heading">
        <h3>Comments</h3>
        <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
          Refresh comments
        </Button>
      </div>
      <CommentBranch context={context} parentId={null} depth={0} />
      {!deleted &&
        (composing ? (
          <CommentEditor
            context={context}
            parentId={null}
            onClose={() => setComposing(false)}
          />
        ) : (
          <Button onClick={() => setComposing(true)}>Write a comment</Button>
        ))}
    </section>
  );
}
function CommentBranch({
  context,
  parentId,
  depth,
}: {
  context: CommentContext;
  parentId: string | null;
  depth: number;
}) {
  const { actions, scope, revision } = context;
  const [rows, setRows] = useState<CommentSummary[]>([]),
    [cursor, setCursor] = useState<CommentCursor | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const generation = useRef(0),
    pages = useRef(1);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      let next: CommentCursor | null = null;
      const items: CommentSummary[] = [];
      for (let i = 0; i < pages.current; i++) {
        const page = await actions.list({
          ...scope,
          parentId,
          ...(next ? { cursor: next } : {}),
        });
        items.push(...page.comments);
        next = page.nextCursor;
        if (!next) break;
      }
      if (version === generation.current) {
        setRows(items);
        setCursor(next);
      }
    } catch (cause) {
      if (version === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Could not load comments.",
        );
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [actions, scope.projectId, scope.issueId, parentId]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, revision]);
  return (
    <div className="comment-branch">
      {rows.map((row) => (
        <CommentItem key={row.id} context={context} row={row} depth={depth} />
      ))}
      {loading && <p role="status">Loading comments…</p>}
      {!loading && !rows.length && !error && (
        <p className="muted">
          {parentId ? "No replies yet." : "No comments yet."}
        </p>
      )}
      {error && (
        <p role="alert" className="project-error">
          {error}{" "}
          <Button variant="ghost" onClick={() => void refresh()}>
            Retry comments
          </Button>
        </p>
      )}
      {cursor && (
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => {
            pages.current++;
            void refresh();
          }}
        >
          Load more {parentId ? "replies" : "comments"}
        </Button>
      )}
    </div>
  );
}
export function CommentItem({
  context,
  row,
  depth,
  flat = false,
}: {
  flat?: boolean;
  context: CommentContext;
  row: CommentSummary;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false),
    [mode, setMode] = useState<"edit" | "reply" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <article
      className="comment-item"
      aria-label={`Comment by ${row.authorName}`}
    >
      <header>
        <strong>{row.authorName}</strong>{" "}
        <time dateTime={row.createdAt}>
          {new Date(row.createdAt).toLocaleString()}
        </time>
        {row.updatedAt !== row.createdAt && !row.deletedAt && (
          <small> · edited</small>
        )}
      </header>
      {row.deletedAt ? (
        <p className="muted">
          Comment deleted. Replies and history are retained.
        </p>
      ) : mode === "edit" ? (
        <CommentEditor
          key={row.id}
          context={context}
          parentId={row.parentId}
          existing={row}
          onClose={() => setMode(null)}
        />
      ) : (
        <>
          <p className="comment-body">
            {row.body.map((n, i) =>
              n.type === "text" ? (
                <span key={i}>{n.text}</span>
              ) : (
                <span
                  key={i}
                  className="comment-mention"
                  title={
                    context.members.find((m) => m.id === n.userId)?.email ??
                    "Former project member"
                  }
                >
                  @{n.label}
                </span>
              ),
            )}
          </p>
          <CommentMedia files={row.attachments} />
        </>
      )}
      <div className="comment-actions">
        {!context.deleted && (
          <Button
            variant="ghost"
            disabled={busy || mode !== null}
            onClick={() => setMode("reply")}
          >
            Reply
          </Button>
        )}
        {row.canEdit && !context.deleted && (
          <Button
            variant="ghost"
            disabled={busy || mode !== null}
            onClick={() => setMode("edit")}
          >
            Edit comment
          </Button>
        )}
        {row.canDelete && !context.deleted && (
          <Button
            variant="ghost"
            disabled={busy || mode !== null}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await context.actions.delete({
                  ...context.scope,
                  id: row.id,
                  expectedUpdatedAt: row.updatedAt,
                });
                context.changed();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not delete comment.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete comment
          </Button>
        )}
        {!flat && (row.replyCount > 0 || expanded) && (
          <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide replies" : `Show replies (${row.replyCount})`}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
      {mode === "reply" && (
        <CommentEditor
          context={context}
          parentId={row.id}
          onClose={() => {
            setMode(null);
            setExpanded(true);
          }}
        />
      )}
      {!flat && expanded && (
        <div className={depth < 3 ? "comment-replies" : "comment-replies-flat"}>
          <CommentBranch
            context={context}
            parentId={row.id}
            depth={depth + 1}
          />
        </div>
      )}
    </article>
  );
}
export function CommentMedia({ files }: { files: ProjectFileSummary[] }) {
  return (
    <ul className="issue-file-grid">
      {files.map((file) => {
        const url = projectFileURL(file.projectId, file.projectFileId),
          kind = filePreviewKind(file.contentType);
        return (
          <li key={file.projectFileId}>
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
            <a href={projectFileURL(file.projectId, file.projectFileId, true)}>
              {file.filename}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
export function CommentEditor({
  context,
  parentId,
  existing,
  onClose,
  chat = false,
}: {
  context: CommentContext;
  parentId: string | null;
  existing?: CommentSummary;
  onClose: () => void;
  chat?: boolean;
}) {
  const baseline = useRef(existing);
  const [draft, setDraft] = useState(() =>
      commentDraftText(existing?.body ?? []),
    ),
    [files, setFiles] = useState<ProjectFileSummary[]>(
      existing?.attachments ?? [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [picker, setPicker] = useState(false),
    [caret, setCaret] = useState(0),
    [dismissed, setDismissed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null),
    upload = useRef<HTMLInputElement>(null),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const match = !dismissed
    ? /(?:^|\s)@([^@\s]*)$/.exec(draft.text.slice(0, caret))
    : null;
  const people = match
    ? context.members
        .filter((m) =>
          `${m.name} ${m.email}`
            .toLowerCase()
            .includes(match[1]!.toLowerCase()),
        )
        .slice(0, 8)
    : [];
  function selectMention(person: ProjectMemberSummary) {
    if (!match) return;
    const start = caret - match[1]!.length - 1,
      token = `@${person.name}`,
      text = draft.text.slice(0, start) + token + " " + draft.text.slice(caret);
    const mentions = moveMentionRanges(draft.text, text, draft.mentions).filter(
      (m) => m.end <= start || m.start >= start + token.length,
    );
    setDraft({
      text,
      mentions: [
        ...mentions,
        {
          start,
          end: start + token.length,
          userId: person.id,
          label: person.name,
        },
      ],
    });
    setDismissed(true);
    const end = start + token.length + 1;
    setCaret(end);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(end, end);
    });
  }
  return (
    <div className="comment-editor">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          const input = {
            ...context.scope,
            body: commentBodyFromText(draft.text, draft.mentions),
            files: files.map((f) => ({
              projectId: f.projectId,
              projectFileId: f.projectFileId,
            })),
          };
          try {
            if (existing)
              await context.actions.update({
                ...input,
                id: existing.id,
                expectedUpdatedAt: baseline.current!.updatedAt,
              });
            else await context.actions.create({ ...input, parentId });
            if (active.current) {
              context.changed();
              onClose();
            }
          } catch (cause) {
            if (active.current)
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not save comment.",
              );
          } finally {
            if (active.current) setBusy(false);
          }
        }}
      >
        <label>
          {existing
            ? "Edit comment"
            : parentId
              ? "Your reply"
              : chat
                ? "Your message"
                : "Your comment"}
          <textarea
            ref={area}
            className="input comment-textarea"
            autoFocus
            rows={4}
            maxLength={100000}
            disabled={busy}
            value={draft.text}
            placeholder="Write a comment… Type @ to mention someone."
            onChange={(event) => {
              const text = event.target.value;
              setDraft((previous) => ({
                text,
                mentions: moveMentionRanges(
                  previous.text,
                  text,
                  previous.mentions,
                ),
              }));
              setCaret(event.target.selectionStart);
              setDismissed(false);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDismissed(true);
              if (event.key === "ArrowDown" && people.length) {
                event.preventDefault();
                event.currentTarget
                  .closest("form")
                  ?.querySelector<HTMLButtonElement>(".mention-picker button")
                  ?.focus();
              }
            }}
          />
        </label>
        {match && (
          <div className="mention-picker" aria-label="Mention project member">
            {people.length ? (
              people.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  onClick={() => selectMention(person)}
                >
                  {person.name}
                  <small>{person.email}</small>
                </button>
              ))
            ) : (
              <p>No matching project members.</p>
            )}
          </div>
        )}
        {!!draft.mentions.length && (
          <p className="muted">
            Mentions:{" "}
            {[...new Set(draft.mentions.map((m) => `@${m.label}`))].join(", ")}
          </p>
        )}
        <ul className="comment-draft-files">
          {files.map((f) => (
            <li key={f.id}>
              {f.filename}{" "}
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={`Remove ${f.filename} from comment`}
                onClick={() =>
                  setFiles((previous) =>
                    previous.filter((item) => item.id !== f.id),
                  )
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="comment-actions">
          <Button
            variant="ghost"
            disabled={busy || files.length >= 20}
            onClick={() => upload.current?.click()}
          >
            Upload comment files
          </Button>
          <Button
            variant="ghost"
            disabled={busy || files.length >= 20}
            onClick={() => setPicker(true)}
          >
            Reuse comment file
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || (!draft.text.trim() && !files.length)}
          >
            {busy
              ? "Saving…"
              : existing
                ? "Save comment"
                : parentId
                  ? "Post reply"
                  : chat
                    ? "Send message"
                    : "Post comment"}
          </Button>
        </div>
        {status && <p role="status">{status}</p>}
        {error && (
          <p role="alert" className="project-error">
            {error}
          </p>
        )}
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          aria-label="Upload comment attachments"
          onChange={async (event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!selected.length || busy) return;
            setBusy(true);
            setError("");
            try {
              if (files.length + selected.length > 20)
                throw new Error("Attach up to 20 files per comment.");
              const limits = await context.files.limits();
              for (const f of selected) {
                if (!active.current) break;
                if (!f.size || f.size > limits.maxBytes)
                  throw new Error(
                    `${f.name}: choose a non-empty file up to ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`,
                  );
                setStatus(`Uploading ${f.name}…`);
                const result = await context.files.upload(
                  context.scope.projectId,
                  f,
                );
                if (active.current)
                  setFiles((previous) => [...previous, result]);
              }
            } catch (cause) {
              if (active.current)
                setError(
                  cause instanceof Error ? cause.message : "Upload failed.",
                );
            } finally {
              if (active.current) {
                setBusy(false);
                setStatus("");
              }
            }
          }}
        />
      </form>
      {picker && (
        <FilePicker
          projectId={context.scope.projectId}
          actions={context.files}
          onClose={() => setPicker(false)}
          onSelect={async (file) => {
            setFiles((previous) =>
              previous.some((f) => f.id === file.id)
                ? previous
                : [...previous, file],
            );
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
