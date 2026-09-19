import { formatDateTime } from "../../../lib/date-format";
import {
  MessageMarkdown,
  type MarkdownMention,
} from "../../ui/message-markdown";
import { Icon } from "../../ui/icon";
import { ChatComposer } from "./chat-composer";
import { useDictation } from "./use-dictation";
import { useEffect, useRef, useState } from "react";
import {
  trackerImages,
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
import { Button, IconButton } from "../../ui/button";
import { Avatar } from "../../ui/avatar";
import { Pill } from "../../ui/pill";
import { cn } from "../../ui/cn";
import { useAttachmentGallery } from "./attachment-gallery";
import { FilePicker, FileTile, type IssueFileActions } from "./issue-files";

export type CommentActions = {
  canPublish?: (projectId: string) => boolean;
  pushJira?: (projectId: string, id: string, overwriteRemote?: boolean) => Promise<{ sent: boolean }>;
  list: (input: CommentScope & { parentId: string | null; cursor?: CommentCursor }) => Promise<CommentPage>;
  create: (input: CommentScope & CommentDraft & { parentId: string | null }) => Promise<{ id: string }>;
  update: (input: CommentScope & CommentDraft & { id: string; expectedUpdatedAt: string }) => Promise<{ id: string }>;
  delete: (input: CommentScope & { id: string; expectedUpdatedAt: string }) => Promise<void>;
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

/**
 * One comment inside a conversation row. The row (MessageRow) provides the
 * avatar, name and time; this renders the body, media, sync state and the
 * hover actions.
 */
export function CommentItem({
  context,
  row,
  extraFiles = [],
}: {
  context: CommentContext;
  row: CommentSummary;
  /** Attachments linked to this comment but not part of its body. */
  extraFiles?: ProjectFileSummary[] | undefined;
}) {
  const [jiraFeedback, setJiraFeedback] = useState("");
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attachments = [
    ...row.attachments,
    ...extraFiles.filter((f) => !row.attachments.some((a) => a.projectFileId === f.projectFileId)),
  ];
  const text = row.body.map((n) => (n.type === "text" ? n.text : "")).join("");
  const actionButton = "size-7 justify-center px-0 [&>span]:hidden";
  return (
    <div className="relative" aria-label={`Comment by ${row.authorName}`}>
      {row.deletedAt ? (
        <p className="text-sm text-ink-3 italic">Comment deleted. History is retained.</p>
      ) : editing ? (
        <CommentEditor
          key={row.id}
          context={context}
          existing={row}
          onClose={() => setEditing(false)}
        />
      ) : (
        <>
          {row.body.some((n) => n.type !== "text" || n.text.trim()) && (
            <div className="prose-chat max-w-[66ch] text-lg">
              <AttachmentMarkdown
                files={attachments}
                text={row.body
                  .map((node, index) =>
                    node.type === "text"
                      ? node.text
                      : `[@${node.label.replace(/[\\`*_[\]<>]/g, "\\$&")}](#comment-mention-${index})`,
                  )
                  .join("")}
                mentions={row.body.flatMap((node, index) =>
                  node.type === "mention"
                    ? [{
                        href: `#comment-mention-${index}`,
                        label: node.label,
                        title: context.members.find((member) => member.id === node.userId)?.email ?? "Former project member",
                      }]
                    : [],
                )}
              />
            </div>
          )}
          <CommentMedia files={nonInlineFiles(text, attachments)} />
          {(row.updatedAt !== row.createdAt || (row.jiraSync && row.jiraSync !== "synced")) && (
            <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-ink-3">
              {row.updatedAt !== row.createdAt && <span title={formatDateTime(row.updatedAt)}>edited</span>}
              {row.jiraSync && row.jiraSync !== "synced" && (
                <span role="status" className={row.jiraSync === "failed" ? "text-bad" : undefined}>
                  {row.jiraSync === "pending" ? "Waiting to sync with Jira" : row.jiraSync === "syncing" ? "Syncing with Jira…" : row.jiraSync === "failed" ? "Jira sync failed" : "Not synced with Jira"}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {jiraFeedback && <p role="status" className="mt-1 text-xs text-ink-3">{jiraFeedback}</p>}
      {!row.deletedAt && !context.deleted && !editing && !replying && (
        <div className="absolute -top-8 right-0 flex gap-px rounded-lg bg-surface p-0.5 shadow-soft hairline opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
          {(row.jiraSync === "unsynced" || row.jiraSync === "failed") && context.actions.pushJira && context.actions.canPublish?.(context.scope.projectId) && (
            <Button variant="ghost" size="sm" icon="jira" className={actionButton} disabled={busy} aria-label="Send comment to Jira" title="Send comment to Jira"
              onClick={async () => {
                setBusy(true); setError("");
                try {
                  const result = await context.actions.pushJira!(context.scope.projectId, row.id);
                  context.changed();
                  setJiraFeedback(result.sent ? "Comment saved to Jira." : "Comment is already up to date.");
                } catch (e) { setError(e instanceof Error ? e.message : "Could not send comment."); }
                finally { setBusy(false); }
              }}><span>Jira</span></Button>
          )}
          <IconButton icon="reply" label="Reply" size="sm" className="size-7" disabled={busy} onClick={() => setReplying(true)} />
          {row.canEdit && <IconButton icon="edit" label="Edit message" size="sm" className="size-7" disabled={busy} onClick={() => setEditing(true)} />}
          {row.canDelete && (
            <IconButton icon="trash" label="Delete message" size="sm" className="size-7" disabled={busy}
              onClick={async () => {
                setBusy(true); setError("");
                try { await context.actions.delete({ ...context.scope, id: row.id, expectedUpdatedAt: row.updatedAt }); context.changed(); }
                catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete comment."); }
                finally { setBusy(false); }
              }} />
          )}
        </div>
      )}
      {replying && !context.deleted && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-sm text-ink-2">
            <span>Reply to {row.authorName}</span>
            <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>Cancel reply</Button>
          </div>
          <ChatComposer context={context} parentId={row.id} onSent={() => setReplying(false)} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-bad">
          {error}
          {error.includes("This Jira comment changed") && context.actions.pushJira && (
            <Button variant="ghost" size="sm" disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await context.actions.pushJira!(context.scope.projectId, row.id, true); setError(""); setJiraFeedback("Replaced Jira comment with local text."); }
                catch (e) { setError(e instanceof Error ? e.message : "Could not send comment."); }
                finally { setBusy(false); }
              }}>Replace Jira comment with local text</Button>
          )}
        </p>
      )}
    </div>
  );
}

export function AttachmentMarkdown({
  text,
  files,
  mentions,
}: {
  text: string;
  files: ProjectFileSummary[];
  mentions?: MarkdownMention[];
}) {
  const openGallery = useAttachmentGallery();
  return (
    <MessageMarkdown
      text={text}
      mentions={mentions ?? []}
      renderImage={(image) => {
        const file = files.find((file) => file.inlineExternalId === image.id && filePreviewKind(file.contentType) === "image");
        if (!file)
          return (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-sm text-ink-3" title={`${image.filename || "Image"} is not available in this workspace`}>
              <Icon name="image" size={13} />
              {image.filename || "Image"} unavailable
            </span>
          );
        const url = projectFileURL(file.projectId, file.projectFileId);
        return (
          <a href={url} title={file.filename} target="_blank" rel="noreferrer"
            onClick={(event) => { if (openGallery && !event.metaKey && !event.ctrlKey) { event.preventDefault(); openGallery(file); } }}>
            <img src={url} alt={image.filename || file.filename} loading="lazy" style={{ maxWidth: "100%", height: "auto", width: image.width || undefined, verticalAlign: "middle" }} />
          </a>
        );
      }}
    />
  );
}
export function nonInlineFiles(text: string, files: ProjectFileSummary[]) {
  const ids = new Set(trackerImages(text).map((image) => image.id));
  return files.filter((file) => !file.inlineExternalId || !ids.has(file.inlineExternalId) || filePreviewKind(file.contentType) !== "image");
}
/** Attachments shown under a message: images as tiles, media inline, files as chips. */
export function CommentMedia({ files }: { files: ProjectFileSummary[] }) {
  if (!files.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2.5">
      {files.map((file) => <FileTile key={file.projectFileId} file={file} />)}
    </div>
  );
}

/** Inline editor for an existing message. New messages use ChatComposer. */
export function CommentEditor({
  context,
  existing,
  onClose,
}: {
  context: CommentContext;
  existing: CommentSummary;
  onClose: () => void;
}) {
  const baseline = useRef(existing);
  const [draft, setDraft] = useState(() => commentDraftText(existing.body)),
    [files, setFiles] = useState<ProjectFileSummary[]>(existing.attachments),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [picker, setPicker] = useState(false),
    [caret, setCaret] = useState(0),
    [dismissed, setDismissed] = useState(false);
  const [language] = useState(() => (navigator.language.startsWith("ru") ? "ru-RU" : "en-US"));
  const voice = useDictation((text) =>
    setDraft((previous) => {
      const next = `${previous.text}${previous.text ? " " : ""}${text}`.slice(0, 100000);
      return { text: next, mentions: moveMentionRanges(previous.text, next, previous.mentions) };
    }),
  );
  const area = useRef<HTMLTextAreaElement>(null),
    upload = useRef<HTMLInputElement>(null),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const match = !dismissed ? /(?:^|\s)@([^@\s]*)$/.exec(draft.text.slice(0, caret)) : null;
  const people = match
    ? context.members.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(match[1]!.toLowerCase())).slice(0, 8)
    : [];
  function selectMention(person: ProjectMemberSummary) {
    if (!match) return;
    const start = caret - match[1]!.length - 1,
      token = `@${person.name}`,
      text = draft.text.slice(0, start) + token + " " + draft.text.slice(caret);
    const mentions = moveMentionRanges(draft.text, text, draft.mentions).filter((m) => m.end <= start || m.start >= start + token.length);
    setDraft({ text, mentions: [...mentions, { start, end: start + token.length, userId: person.id, label: person.name }] });
    setDismissed(true);
    const end = start + token.length + 1;
    setCaret(end);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(end, end);
    });
  }
  async function uploadFiles(selected: File[]) {
    if (!selected.length || busy) return;
    setBusy(true);
    setError("");
    try {
      if (files.length + selected.length > 20) throw new Error("Attach up to 20 files per message.");
      const limits = await context.files.limits();
      for (const f of selected) {
        if (!active.current) break;
        if (!f.size || f.size > limits.maxBytes) throw new Error(`${f.name}: choose a non-empty file up to ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
        setStatus(`Uploading ${f.name}…`);
        const result = await context.files.upload(context.scope.projectId, f);
        if (active.current) setFiles((previous) => [...previous, result]);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      if (active.current) {
        setBusy(false);
        setStatus("");
      }
    }
  }
  return (
    <form
      className="relative flex max-w-[66ch] flex-col gap-2 rounded-xl bg-surface p-2.5 shadow-soft hairline"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || voice.listening || (!draft.text.trim() && !files.length)) return;
        setBusy(true);
        setError("");
        try {
          await context.actions.update({
            ...context.scope,
            body: commentBodyFromText(draft.text, draft.mentions),
            files: files.map((f) => ({ projectId: f.projectId, projectFileId: f.projectFileId })),
            id: existing.id,
            expectedUpdatedAt: baseline.current.updatedAt,
          });
          if (active.current) {
            context.changed();
            onClose();
          }
        } catch (cause) {
          if (active.current) setError(cause instanceof Error ? cause.message : "Could not save comment.");
        } finally {
          if (active.current) setBusy(false);
        }
      }}
    >
      {match && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-72 rounded-xl bg-surface p-1.5 shadow-pop hairline" aria-label="Mention a person" role="listbox">
          {people.length ? people.map((person) => (
            <button type="button" key={person.id} role="option" className="mention-option grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none" onClick={() => selectMention(person)}>
              <Avatar name={person.name} size="md" />
              <span className="min-w-0"><b className="block truncate text-base font-semibold">{person.name}</b><span className="block truncate text-sm text-ink-3">{person.email}</span></span>
            </button>
          )) : <p className="px-2.5 py-2 text-sm text-ink-3">No matching people.</p>}
        </div>
      )}
      <textarea
        ref={area}
        aria-label="Edit message"
        autoFocus
        rows={3}
        maxLength={100000}
        disabled={busy || voice.listening}
        value={draft.text}
        className="block w-full resize-y bg-transparent px-1 text-lg text-ink outline-none placeholder:text-ink-3"
        onChange={(event) => {
          const text = event.target.value;
          setDraft((previous) => ({ text, mentions: moveMentionRanges(previous.text, text, previous.mentions) }));
          setCaret(event.target.selectionStart);
          setDismissed(false);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !match) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
          if (event.key === "Escape") {
            if (match) setDismissed(true);
            else onClose();
          }
          if (event.key === "ArrowDown" && people.length) {
            event.preventDefault();
            event.currentTarget.closest("form")?.querySelector<HTMLButtonElement>(".mention-option")?.focus();
          }
        }}
      />
      {!!files.length && (
        <div className="flex flex-wrap gap-2.5 px-1">
          {files.map((f) => <FileTile key={f.id} file={f} size="sm" busy={busy} onRemove={() => setFiles((previous) => previous.filter((item) => item.id !== f.id))} />)}
        </div>
      )}
      {voice.listening && <p role="status" className="px-1 text-sm text-ink-2">{voice.interim || "Listening…"}</p>}
      {status && <p role="status" className="px-1 text-sm text-ink-3">{status}</p>}
      {(error || voice.error) && <p role="alert" className="px-1 text-sm text-bad">{error || voice.error}</p>}
      <div className="flex items-center gap-0.5">
        <IconButton icon="paperclip" label="Upload files" className="text-ink-3" disabled={busy || files.length >= 20} onClick={() => upload.current?.click()} />
        <IconButton icon="files" label="Reuse a project file" className="text-ink-3" disabled={busy || files.length >= 20} onClick={() => setPicker(true)} />
        <IconButton icon={voice.listening ? "pause" : "mic"} label={voice.listening ? "Stop dictation" : "Dictate"} className={cn("text-ink-3", voice.listening && "bg-bad-soft text-bad")} disabled={busy} onClick={() => voice.toggle(language)} />
        <span className="ml-auto flex items-center gap-1.5">
          <Pill className="hidden sm:inline-flex">Editing</Pill>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={busy || (!draft.text.trim() && !files.length)}>{busy ? "Saving…" : "Save"}</Button>
        </span>
      </div>
      <input ref={upload} type="file" multiple hidden aria-label="Upload comment attachments" onChange={async (event) => { const selected = Array.from(event.target.files ?? []); event.target.value = ""; await uploadFiles(selected); }} />
      {picker && (
        <FilePicker
          projectId={context.scope.projectId}
          actions={context.files}
          onClose={() => setPicker(false)}
          onSelect={async (file) => {
            setFiles((previous) => (previous.some((f) => f.id === file.id) ? previous : [...previous, file]));
            setPicker(false);
          }}
        />
      )}
      <Icon name="edit" size={12} className="absolute -top-2 -left-2 hidden" />
    </form>
  );
}
