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
import { Icon } from "../../ui/icon";
import { Pill } from "../../ui/pill";
import { MessageMarkdown } from "../../ui/message-markdown";
import { Disclosure, PullCard, ReviewThread } from "../../ui/chat";
import { Avatar } from "../../ui/avatar";
import { cn } from "../../ui/cn";

const field =
  "mt-1 block w-full rounded-md bg-surface px-2.5 py-1.5 text-base text-ink hairline focus:border-line focus:outline-none";

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
  }, [active, actions, agents, scope.projectId, scope.issueId, revision, reload]);
  if (!rows.length && !error) return null;
  return (
    <section aria-label="Current Git activity" className="flex flex-col gap-2 py-2">
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
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
  const checks = a?.checks ?? [];
  const checksFailed = checks.filter((c) => c.state === "failed").length;
  const checksPending = checks.filter((c) => c.state === "pending" || c.state === "unknown").length;
  const open = row.discussions.filter((d) => d.resolvable && !d.resolved).length;
  const prLabel = row.provider === "github" ? "PR" : "MR";
  const state =
    row.pull.state === "open" && row.pull.draft
      ? "draft"
      : (row.pull.state as "open" | "merged" | "closed");
  return (
    <div className="mx-0">
      <PullCard
        className="mx-0 bg-surface"
        title={a?.title ?? row.repositoryName}
        number={row.pull.number}
        state={state}
        provider={row.provider}
        branch={row.pull.sourceBranch}
        target={row.pull.targetBranch}
        url={row.pull.url}
        actions={
          writable ? (
            <>
              {row.canManage && row.pull.draft && (
                <Button variant="secondary" size="sm" disabled={busy || pending || !!row.writerRunId} onClick={() => setConfirm({ kind: "ready", head: row.pull.head })}>
                  Mark ready
                </Button>
              )}
              {row.canMerge && (
                <Button size="sm" variant="primary" disabled={busy || pending || !!row.writerRunId || !a?.mergeable} title={a && !a.mergeable ? a.mergeReason : undefined} onClick={() => { setMethod(a?.mergeMethods[0] ?? "merge"); setConfirm({ kind: "merge", head: row.pull.head }); }}>
                  Merge
                </Button>
              )}
            </>
          ) : undefined
        }
        footer={
          <>
            {checks.length > 0 && (
              <span className={cn("inline-flex items-center gap-1.5", checksFailed ? "text-bad" : checksPending ? "text-ink-2" : "text-ok")}>
                <Icon name={checksFailed ? "alert" : checksPending ? "clock" : "check-circle"} size={13} />
                {checksFailed ? `${checksFailed} check${checksFailed === 1 ? "" : "s"} failed` : checksPending ? "Checks running" : "Checks passing"}
              </span>
            )}
            {!!a?.reviewers.length && (
              <span className="inline-flex items-center gap-1.5">
                <span className="flex [&>*+*]:-ml-1.5 [&>*]:ring-2 [&>*]:ring-surface-2">
                  {a.reviewers.slice(0, 3).map((r, i) => <Avatar key={`${r.login}:${i}`} name={r.name} size="xs" />)}
                </span>
                {a.reviewers.length === 1 ? `${a.reviewers[0]!.name} ${a.reviewers[0]!.state.toLowerCase().replace(/_/g, " ")}` : `${a.reviewers.length} reviewers`}
              </span>
            )}
            <span className="hidden text-ink-3 dev:inline">
              {row.syncing ? "Synchronizing…" : row.syncedAt ? `Updated ${new Date(row.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Awaiting first synchronization"}
            </span>
            <button type="button" className="hidden text-ink-3 hover:text-ink dev:inline-flex" title="Refresh provider activity" disabled={busy || row.syncing} onClick={() => void run(() => actions.refresh(ref))}>
              <Icon name="refresh" size={13} />
            </button>
            {row.writerRunId && <span className="text-ink-3">An agent is working on this branch</span>}
            <span className="ml-auto flex items-center gap-1">
              {writable && row.canManage && (
                <Button size="sm" variant="ghost" disabled={busy || pending || !!row.writerRunId} onClick={() => setConfirm({ kind: "close", head: row.pull.head })}>
                  Close {prLabel}
                </Button>
              )}
              <Disclosure
                label={row.discussions.length ? `${row.discussions.length} comment${row.discussions.length === 1 ? "" : "s"}${open ? `, ${open} open` : ""}` : "No comments yet"}
                defaultOpen={open > 0}
                panelClassName="border-0 bg-transparent"
              >
                {(error || row.error) && <p role="alert" className="px-3 py-2 text-sm text-bad">{error || row.error}</p>}
                {row.discussions.map((thread) => {
                  const noteChecked = (noteId: string) => selected.some((s) => s.discussionId === thread.id && s.noteId === noteId);
                  const first = thread.notes[0];
                  if (!first) return null;
                  return (
                    <ReviewThread
                      key={thread.id}
                      author={{ name: first.author.name }}
                      time={<a href={first.url} target="_blank" rel="noreferrer" className="hover:underline">on {row.provider === "github" ? "GitHub" : "GitLab"} · {new Date(first.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</a>}
                      location={thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ""}` : undefined}
                      resolved={thread.resolvable && thread.resolved}
                      actions={
                        <>
                          {writable && thread.resolvable && (
                            <Button size="sm" variant="ghost" icon={thread.resolved ? "refresh" : "check"} disabled={busy || pending} onClick={() => void run(() => actions.act({ ...ref, requestId: createId(), kind: thread.resolved ? "reopen" : "resolve", expectedHead: row.pull.head, discussionId: thread.id }))}>
                              {thread.resolved ? "Reopen" : "Resolve"}
                            </Button>
                          )}
                          {writable && (
                            <Button size="sm" variant="ghost" icon="sparkle" disabled={busy} aria-pressed={noteChecked(first.id)} className={noteChecked(first.id) ? "bg-accent-soft text-accent-ink" : undefined} onClick={() => setSelected((old) => noteChecked(first.id) ? old.filter((s) => !(s.discussionId === thread.id && s.noteId === first.id)) : [...old, { discussionId: thread.id, noteId: first.id }])}>
                              {noteChecked(first.id) ? "Selected for agent" : "Ask agent to address"}
                            </Button>
                          )}
                        </>
                      }
                      replies={
                        <div className="mt-1.5 flex flex-col gap-1.5">
                          {thread.notes.slice(1).map((note) => (
                            <div key={note.id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-sm text-ink-2">
                              <Avatar name={note.author.name} size="xs" />
                              <div>
                                <span className="flex items-center gap-2"><b className="font-semibold text-ink">{note.author.name}</b><a href={note.url} target="_blank" rel="noreferrer" className="text-xs text-ink-3">{new Date(note.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</a>
                                  {writable && <label className="ml-auto inline-flex items-center gap-1 text-xs text-ink-3"><input type="checkbox" className="accent-accent" disabled={busy} checked={noteChecked(note.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, { discussionId: thread.id, noteId: note.id }] : old.filter((s) => !(s.discussionId === thread.id && s.noteId === note.id)))} />for agent</label>}
                                </span>
                                <div className="prose-chat text-base text-ink"><MessageMarkdown text={note.body.replace(/<!-- spectron-(?:reply|review):[^>]*-->/g, "")} /></div>
                              </div>
                            </div>
                          ))}
                          {row.replies.filter((r) => r.discussionId === thread.id && r.state !== "published").map((draft) => (
                            <ReplyEditor key={`${draft.id}:${draft.revision}:${draft.state}`} draft={draft} editable={writable && (row.canManage || draft.authorId === currentUserId)} busy={busy} pending={pending}
                              save={(body) => run(() => actions.saveReply({ ...ref, discussionId: thread.id, id: draft.id, revision: draft.revision, body }))}
                              discard={() => run(() => actions.discardReply({ ...ref, id: draft.id, revision: draft.revision }))}
                              publish={() => run(() => actions.publishReply({ ...ref, id: draft.id, revision: draft.revision, requestId: createId() }))} />
                          ))}
                          {writable && (
                            <ReplyEditor key={`new:${thread.id}`} editable busy={busy} pending={pending} save={(body) => run(() => actions.saveReply({ ...ref, discussionId: thread.id, body }))} />
                          )}
                        </div>
                      }
                    >
                      <MessageMarkdown text={first.body.replace(/<!-- spectron-(?:reply|review):[^>]*-->/g, "")} />
                    </ReviewThread>
                  );
                })}
                {!row.discussions.length && <p className="px-3 py-2 text-sm text-ink-3">No provider discussions yet.</p>}
              </Disclosure>
            </span>
          </>
        }
      >
        {!!selected.length && writable && (
          <form
            className="flex flex-col gap-2 bg-surface px-3 py-3 hairline-t"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await actions.address({ ...scope, requestId: createId(), agentId, comments: selected, message });
                setSelected([]);
                setMessage("");
              });
            }}
          >
            <p className="text-sm text-ink-2">
              {selected.length} comment{selected.length === 1 ? "" : "s"} selected. An active run by this agent receives instructions; otherwise a new run starts.
            </p>
            <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
              <label><span className="block text-sm text-ink-2">Agent</span>
                <select className={field} value={agentId} onChange={(e) => setAgentId(e.target.value)} required disabled={busy}>
                  <option value="">Choose an agent</option>
                  {available.map((ag) => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
                </select>
              </label>
              <label><span className="block text-sm text-ink-2">Additional instructions</span>
                <input className={field} maxLength={100000} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} placeholder="Optional" />
              </label>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" disabled={busy} onClick={() => setSelected([])}>Clear selection</Button>
              <Button variant="primary" icon="sparkle" type="submit" disabled={busy || !agentId || pending}>Address selected comments</Button>
            </div>
          </form>
        )}
        {confirm && writable && (
          <section aria-label="Confirm provider action" className="flex flex-col gap-2 bg-surface px-3 py-3 hairline-t">
            <p className="text-base">
              {confirm.kind === "merge" ? "Merge" : confirm.kind === "ready" ? "Mark ready" : "Close"} {prLabel} #{row.pull.number} at <span className="mono text-sm">{confirm.head.slice(0, 12)}</span>?
            </p>
            {confirm.kind === "merge" && (
              <label className="max-w-60"><span className="block text-sm text-ink-2">Merge method</span>
                <select className={field} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  {a?.mergeMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
            {confirm.head !== row.pull.head && <p role="alert" className="text-sm text-bad">The commit changed. Cancel and review the updated activity.</p>}
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant={confirm.kind === "close" ? "danger" : "primary"} disabled={busy || pending || !!row.writerRunId || confirm.head !== row.pull.head} onClick={() => void run(async () => { await actions.act({ ...ref, requestId: createId(), kind: confirm.kind, expectedHead: confirm.head, ...(confirm.kind === "merge" ? { mergeMethod: method } : {}) }); setConfirm(null); })}>
                Confirm {confirm.kind}
              </Button>
            </div>
          </section>
        )}
        {a && (
          <div className="hidden flex-wrap gap-1 px-3 py-1.5 hairline-t dev:flex">
            <Disclosure label="Checks" count={checks.length} panelClassName="border-0 bg-transparent">
              <div className="flex flex-col gap-1 px-3 pb-2 text-sm">
                {checks.length ? checks.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Icon name={c.state === "passed" ? "check-circle" : c.state === "failed" ? "alert" : "clock"} size={13} className={c.state === "passed" ? "text-ok" : c.state === "failed" ? "text-bad" : "text-ink-3"} />
                    {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="text-ink hover:underline">{c.name}</a> : c.name}
                    <span className="text-ink-3">{c.state}</span>
                  </div>
                )) : <p className="text-ink-3">No checks reported.</p>}
              </div>
            </Disclosure>
            <Disclosure label="Commits" count={a.commits.length} panelClassName="border-0 bg-transparent">
              <div className="mono flex flex-col gap-1 px-3 pb-2 text-xs text-ink-2">
                {a.commits.map((c) => <div key={c.sha}><span className="text-ink-3">{c.sha.slice(0, 8)}</span> {c.message} <span className="text-ink-3">· {c.author}</span></div>)}
              </div>
            </Disclosure>
            {!!row.operations.length && (
              <Disclosure label="Provider actions" count={row.operations.length} defaultOpen={row.operations.some((o) => o.state === "uncertain")} panelClassName="border-0 bg-transparent">
                <div className="flex flex-col gap-1.5 px-3 pb-2 text-sm">
                  {row.operations.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center gap-2">
                      <Pill tone={o.state === "completed" ? "ok" : o.state === "failed" ? "bad" : "warn"} className="capitalize">{o.state}</Pill>
                      <span className="capitalize">{o.kind}</span>
                      <span className="text-ink-3">· {o.requesterName}{o.error ? ` · ${o.error}` : ""}</span>
                      {["dispatching", "uncertain"].includes(o.state) && (
                        <>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => actions.reconcile({ ...ref, id: o.id }))}>Reconcile</Button>
                          {writable && o.state === "uncertain" && o.kind !== "reply" && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => actions.reconcile({ ...ref, id: o.id, retry: true }))}>Retry original {o.kind}</Button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Disclosure>
            )}
            {a && !a.mergeable && <span className="ml-auto self-center text-sm text-ink-3">{a.mergeReason}</span>}
          </div>
        )}
      </PullCard>
    </div>
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
      <div>
        <Button size="sm" variant="ghost" icon="reply" disabled={!editable || busy} onClick={() => setOpen(true)}>
          Reply
        </Button>
      </div>
    );
  const locked = !editable || busy || (!!draft && draft.state !== "draft");
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-sm">
      <Icon name={draft?.runId ? "sparkle" : "reply"} size={14} className="mt-1 text-ink-3" />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-ink-2">
          <b className="font-semibold text-ink">{draft?.runId ? "Agent reply" : "Your reply"}</b>
          <Pill tone={draft?.state === "uncertain" ? "warn" : draft?.state === "publishing" ? "accent" : "warn"}>{draft ? draft.state === "draft" ? "Draft" : draft.state : "Draft"}</Pill>
        </div>
        <textarea
          aria-label="Reply draft"
          className={cn(field, "mt-0 min-h-14 bg-surface")}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={locked}
          placeholder="Write a reply. It stays here until you publish it."
        />
        {draft?.error && <p role="alert" className="text-bad">{draft.error}</p>}
        {draft?.state === "uncertain" && discard && (
          <div className="flex flex-wrap items-center gap-2 text-ink-3">
            <span>Discard hides this local draft after checking the provider. It does not remove a provider comment.</span>
            <Button size="sm" variant="ghost" disabled={!editable || busy} onClick={() => void discard()}>Check provider and discard</Button>
          </div>
        )}
        {(!draft || draft.state === "draft") && (
          <div className="flex justify-end gap-1.5">
            {!draft && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setBody(""); setOpen(false); }}>Cancel</Button>}
            <Button variant="secondary" size="sm" disabled={!editable || busy || !body.trim() || body === draft?.body} onClick={() => void save(body).then((saved) => { if (saved && !draft) { setBody(""); setOpen(false); } })}>
              Save draft
            </Button>
            {draft && publish && (
              <Button size="sm" variant="primary" disabled={!editable || busy || pending || body !== draft.body} onClick={() => void publish()}>
                Publish reply
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
