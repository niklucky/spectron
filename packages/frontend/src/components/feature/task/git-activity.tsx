import { useEffect, useState } from "react";
import {
  createId,
  type AgentIdentity,
  type AgentRunActions,
  type AgentRunScope,
  type FeedbackSelection,
  type GitReplyDraft,
  type GitWorkflowActions,
  type GitWorkspaceView,
} from "@spectron/shared";
import { Button } from "../../ui/button";
import { MessageMarkdown } from "../../ui/message-markdown";

export function GitActivityCards({
  scope,
  actions,
  agents,
  currentUserId,
  active,
  revision,
  closed,
  changed,
}: {
  scope: AgentRunScope;
  actions: GitWorkflowActions;
  agents: AgentRunActions;
  currentUserId: string;
  active: boolean;
  revision: number;
  closed: boolean;
  changed: () => void;
}) {
  const [rows, setRows] = useState<GitWorkspaceView[]>([]),
    [error, setError] = useState("");
  const [available, setAvailable] = useState<AgentIdentity[]>([]);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = await actions.list(scope);
        if (live) {
          setRows(next);
          setError("");
        }
      } catch (e) {
        if (live)
          setError(
            e instanceof Error ? e.message : "Could not load Git activity.",
          );
      } finally {
        if (live) timer = setTimeout(() => void load(), 10000);
      }
    }
    void load();
    void agents.available(scope.projectId).then(
      (a) => {
        if (live) setAvailable(a);
      },
      () => {},
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    active,
    actions,
    agents,
    scope.projectId,
    scope.issueId,
    revision,
    reload,
  ]);
  return (
    <section aria-label="Current Git activity" className="git-activity-cards">
      {error && <p role="alert">{error}</p>}
      {rows.map((row) => (
        <WorkspaceCard
          key={row.id}
          row={row}
          scope={scope}
          actions={actions}
          available={available}
          currentUserId={currentUserId}
          closed={closed}
          changed={() => {
            setReload((n) => n + 1);
            changed();
          }}
        />
      ))}
    </section>
  );
}
function WorkspaceCard({
  row,
  scope,
  actions,
  available,
  currentUserId,
  closed,
  changed,
}: {
  row: GitWorkspaceView;
  scope: AgentRunScope;
  actions: GitWorkflowActions;
  available: AgentIdentity[];
  currentUserId: string;
  closed: boolean;
  changed: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<FeedbackSelection[]>([]),
    [agentId, setAgentId] = useState(""),
    [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<{
    kind: "ready" | "close" | "merge";
    head: string;
  } | null>(null);
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("merge");
  const ref = { ...scope, workspaceId: row.id },
    a = row.activity;
  const pending = row.operations.some(
    (o) =>
      o.state === "dispatching" ||
      (o.state === "uncertain" && o.kind !== "reply"),
  );
  const writable = !closed && row.pull.state === "open";
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      return false;
    } finally {
      setBusy(false);
      changed();
    }
  }
  return (
    <article className="agent-run-card git-workspace-card">
      <header>
        <strong>{row.repositoryName}</strong>
        <a href={row.pull.url} target="_blank" rel="noreferrer">
          {row.provider === "github" ? "PR" : "MR"} #{row.pull.number}
        </a>
        <span>
          {row.pull.state}
          {row.pull.draft && row.pull.state === "open" ? " · Draft" : ""}
        </span>
      </header>
      <p>{a?.title}</p>
      <p>
        <code>{row.pull.sourceBranch}</code> →{" "}
        <code>{row.pull.targetBranch}</code> ·{" "}
        <code>{row.pull.head.slice(0, 12)}</code>
      </p>
      <p className="muted">
        {row.syncing
          ? "Synchronizing…"
          : row.syncedAt
            ? `Updated ${new Date(row.syncedAt).toLocaleString()}`
            : "Awaiting first synchronization"}
      </p>
      <Button
        variant="ghost"
        disabled={busy || row.syncing}
        onClick={() => void run(() => actions.refresh(ref))}
      >
        Refresh provider activity
      </Button>
      {(error || row.error) && <p role="alert">{error || row.error}</p>}
      {a && (
        <>
          <details>
            <summary>Checks ({a.checks.length})</summary>
            {a.checks.length ? (
              a.checks.map((c, i) => (
                <p key={i}>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                  : {c.state}
                </p>
              ))
            ) : (
              <p>No checks reported.</p>
            )}
          </details>
          <details>
            <summary>Commits ({a.commits.length})</summary>
            {a.commits.map((c) => (
              <p key={c.sha}>
                <code>{c.sha.slice(0, 12)}</code> {c.message} · {c.author}
              </p>
            ))}
          </details>
          <details>
            <summary>Participants and reviewers</summary>
            <p>
              Participants:{" "}
              {a.participants.map((p) => p.name).join(", ") || "None"}
            </p>
            {a.reviewers.map((r, i) => (
              <p key={`${r.login}:${i}`}>
                {r.name}: {r.state}
              </p>
            ))}
          </details>
        </>
      )}
      {!!selected.length && writable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await actions.address({
                ...scope,
                requestId: createId(),
                agentId,
                comments: selected,
                message,
              });
              setSelected([]);
              setMessage("");
            });
          }}
        >
          <p>
            {selected.length} comments selected. An active run by this agent
            receives instructions; otherwise a new run starts. Use Take over on
            the active run to change agents.
          </p>
          <label>
            Agent
            <select
              className="input"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              required
              disabled={busy}
            >
              <option value="">Choose an agent</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Additional instructions
            <textarea
              className="input"
              maxLength={100000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button type="submit" disabled={busy || !agentId || pending}>
            Address selected comments
          </Button>
        </form>
      )}
      <details open>
        <summary>Discussions ({row.discussions.length})</summary>
        {!row.discussions.length && <p>No provider discussions yet.</p>}
        {row.discussions.map((thread) => (
          <section className="git-discussion" key={thread.id}>
            <header>
              <a href={thread.url} target="_blank" rel="noreferrer">
                {thread.path
                  ? `${thread.path}${thread.line ? `:${thread.line}` : ""}`
                  : "Discussion"}
              </a>
              <span>
                {thread.resolvable
                  ? thread.resolved
                    ? "Resolved"
                    : "Unresolved"
                  : "Comment"}
              </span>
            </header>
            {thread.notes.map((note) => (
              <div key={note.id} className="git-note">
                <label>
                  {writable && (
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.some(
                        (s) =>
                          s.discussionId === thread.id && s.noteId === note.id,
                      )}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [
                                ...old,
                                { discussionId: thread.id, noteId: note.id },
                              ]
                            : old.filter(
                                (s) =>
                                  !(
                                    s.discussionId === thread.id &&
                                    s.noteId === note.id
                                  ),
                              ),
                        )
                      }
                    />
                  )}{" "}
                  {note.author.name} ·{" "}
                  <a href={note.url} target="_blank" rel="noreferrer">
                    {new Date(note.createdAt).toLocaleString()}
                  </a>
                </label>
                <MessageMarkdown
                  text={note.body.replace(
                    /<!-- spectron-(?:reply|review):[^>]*-->/g,
                    "",
                  )}
                />
              </div>
            ))}
            {row.replies
              .filter(
                (r) => r.discussionId === thread.id && r.state !== "published",
              )
              .map((draft) => (
                <ReplyEditor
                  key={`${draft.id}:${draft.revision}:${draft.state}`}
                  draft={draft}
                  editable={
                    writable &&
                    (row.canManage || draft.authorId === currentUserId)
                  }
                  busy={busy}
                  pending={pending}
                  save={(body) =>
                    run(() =>
                      actions.saveReply({
                        ...ref,
                        discussionId: thread.id,
                        id: draft.id,
                        revision: draft.revision,
                        body,
                      }),
                    )
                  }
                  discard={() =>
                    run(() =>
                      actions.discardReply({
                        ...ref,
                        id: draft.id,
                        revision: draft.revision,
                      }),
                    )
                  }
                  publish={() =>
                    run(() =>
                      actions.publishReply({
                        ...ref,
                        id: draft.id,
                        revision: draft.revision,
                        requestId: createId(),
                      }),
                    )
                  }
                />
              ))}
            {writable && (
              <ReplyEditor
                key={`new:${thread.id}`}
                editable
                busy={busy}
                pending={pending}
                save={(body) =>
                  run(() =>
                    actions.saveReply({
                      ...ref,
                      discussionId: thread.id,
                      body,
                    }),
                  )
                }
              />
            )}
            {writable && thread.resolvable && (
              <Button
                variant="ghost"
                disabled={busy || pending}
                onClick={() =>
                  void run(() =>
                    actions.act({
                      ...ref,
                      requestId: createId(),
                      kind: thread.resolved ? "reopen" : "resolve",
                      expectedHead: row.pull.head,
                      discussionId: thread.id,
                    }),
                  )
                }
              >
                {thread.resolved ? "Reopen discussion" : "Resolve discussion"}
              </Button>
            )}
          </section>
        ))}
      </details>
      {row.writerRunId && (
        <p>
          A writer owns this workspace. PR/MR state controls unlock after its
          tools stop.
        </p>
      )}
      {writable && (
        <div className="agent-run-controls">
          {row.canManage && row.pull.draft && (
            <Button
              disabled={busy || pending || !!row.writerRunId}
              onClick={() => setConfirm({ kind: "ready", head: row.pull.head })}
            >
              Mark ready
            </Button>
          )}
          {row.canMerge && (
            <Button
              disabled={busy || pending || !!row.writerRunId || !a?.mergeable}
              onClick={() => {
                setMethod(a?.mergeMethods[0] ?? "merge");
                setConfirm({ kind: "merge", head: row.pull.head });
              }}
            >
              Merge
            </Button>
          )}
          {row.canManage && (
            <Button
              variant="ghost"
              disabled={busy || pending || !!row.writerRunId}
              onClick={() => setConfirm({ kind: "close", head: row.pull.head })}
            >
              Close PR/MR
            </Button>
          )}
          {a && !a.mergeable && <p className="muted">{a.mergeReason}</p>}
        </div>
      )}
      {confirm && writable && (
        <section aria-label="Confirm provider action">
          <p>
            {confirm.kind === "merge"
              ? "Merge"
              : confirm.kind === "ready"
                ? "Mark ready"
                : "Close"}{" "}
            {row.provider === "github" ? "PR" : "MR"} #{row.pull.number} at{" "}
            <code>{confirm.head.slice(0, 12)}</code>?
          </p>
          {confirm.kind === "merge" && (
            <label>
              Merge method
              <select
                className="input"
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
              >
                {a?.mergeMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {confirm.head !== row.pull.head && (
            <p role="alert">
              The commit changed. Cancel and review the updated activity.
            </p>
          )}
          <Button
            disabled={
              busy ||
              pending ||
              !!row.writerRunId ||
              confirm.head !== row.pull.head
            }
            onClick={() =>
              void run(async () => {
                await actions.act({
                  ...ref,
                  requestId: createId(),
                  kind: confirm.kind,
                  expectedHead: confirm.head,
                  ...(confirm.kind === "merge" ? { mergeMethod: method } : {}),
                });
                setConfirm(null);
              })
            }
          >
            Confirm {confirm.kind}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </Button>
        </section>
      )}
      {!!row.operations.length && (
        <details open={row.operations.some((o) => o.state === "uncertain")}>
          <summary>Provider actions</summary>
          {row.operations.map((o) => (
            <div key={o.id}>
              <p>
                {o.kind} · {o.state} · {o.requesterName}
                {o.error ? ` · ${o.error}` : ""}
              </p>
              {["dispatching", "uncertain"].includes(o.state) && (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() => actions.reconcile({ ...ref, id: o.id }))
                    }
                  >
                    Reconcile {o.kind}
                  </Button>
                  {writable &&
                    o.state === "uncertain" &&
                    o.kind !== "reply" && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            actions.reconcile({
                              ...ref,
                              id: o.id,
                              retry: true,
                            }),
                          )
                        }
                      >
                        Retry original {o.kind}
                      </Button>
                    )}
                </>
              )}
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
function ReplyEditor({
  discard,
  draft,
  editable,
  busy,
  pending,
  save,
  publish,
}: {
  discard?: () => Promise<boolean>;
  draft?: GitReplyDraft;
  editable: boolean;
  busy: boolean;
  pending: boolean;
  save: (body: string) => Promise<boolean>;
  publish?: () => Promise<boolean>;
}) {
  const [body, setBody] = useState(draft?.body ?? ""),
    [open, setOpen] = useState(!!draft);
  if (!open)
    return (
      <Button
        variant="ghost"
        disabled={!editable || busy}
        onClick={() => setOpen(true)}
      >
        Draft a reply
      </Button>
    );
  return (
    <div className="git-reply-draft">
      <p>
        {draft?.runId ? "Agent reply draft" : "Reply draft"}
        {draft && draft.state !== "draft" ? ` · ${draft.state}` : ""}
      </p>
      <textarea
        aria-label="Reply draft"
        className="input"
        maxLength={20000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!editable || busy || (!!draft && draft.state !== "draft")}
      />
      {draft?.error && <p role="alert">{draft.error}</p>}
      {draft?.state === "uncertain" && discard && (
        <>
          <p>
            Discard hides this local draft after checking the provider. It does
            not resend or remove a provider comment; a delayed publication may
            still appear.
          </p>
          <Button
            variant="ghost"
            disabled={!editable || busy}
            onClick={() => void discard()}
          >
            Check provider and discard draft
          </Button>
        </>
      )}
      {(!draft || draft.state === "draft") && (
        <>
          <Button
            variant="ghost"
            disabled={!editable || busy || !body.trim() || body === draft?.body}
            onClick={() =>
              void save(body).then((saved) => {
                if (saved && !draft) {
                  setBody("");
                  setOpen(false);
                }
              })
            }
          >
            Save draft
          </Button>
          {draft && publish && (
            <Button
              disabled={!editable || busy || pending || body !== draft.body}
              onClick={() => void publish()}
            >
              Publish reply
            </Button>
          )}
        </>
      )}
    </div>
  );
}
