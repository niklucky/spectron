import { ReviewDrafts } from "./review-drafts";
import { useEffect, useState } from "react";
import {
  createId,
  projectFileURL,
  type AgentRunActions,
  type AgentRunView,
  type AgentRewritePreview,
} from "@spectron/shared";
import { MessageMarkdown } from "../../ui/message-markdown";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Pill } from "../../ui/pill";
import { formatDateTime } from "../../../lib/date-format";
import {
  MessageRow,
  Command,
  ResultCard,
  ResultRequest,
  ResultState,
  ResultSummary,
  ResultFacts,
  Fact,
  ResultFooter,
  Disclosure,
  Tabs,
  LogBlock,
  CheckRow,
  PullCard,
  LiveLine,
  ResultReason,
} from "../../ui/chat";
import { cn } from "../../ui/cn";

function formatDuration(from: string, to: string | Date): string {
  const ms = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const fieldLabel = "block text-sm text-ink-2";
const fieldInput =
  "mt-1 block w-full rounded-md bg-surface px-2.5 py-1.5 text-base text-ink hairline focus:border-line focus:outline-none";

export function AgentRunCard({
  run,
  actions,
  changed,
  closed,
}: {
  run: AgentRunView;
  actions: AgentRunActions;
  changed: () => void;
  closed: boolean;
}) {
  useEffect(() => {
    if (window.location.hash.endsWith(`/run/${run.id}`))
      document
        .getElementById(`agent-run-${run.id}`)
        ?.scrollIntoView({ block: "center" });
  }, [run.id]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [writing, setWriting] = useState(false),
    [message, setMessage] = useState("");
  const [takeoverAgents, setTakeoverAgents] = useState<
    import("@spectron/shared").AgentIdentity[]
  >([]);
  const [takeoverAgent, setTakeoverAgent] = useState("");
  const [takingOver, setTakingOver] = useState(false);
  const [preview, setPreview] = useState<AgentRewritePreview | null>(null);
  const [tab, setTab] = useState<"result" | "checks" | "activity" | "context">(
    "result",
  );
  const active = ["queued", "preparing", "working"].includes(run.state);
  const waiting = run.state === "needs_input";
  const failed = run.state === "failed";
  const stopped = run.state === "stopped";
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const ref = { projectId: run.projectId, issueId: run.issueId, id: run.id };
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update run.");
    } finally {
      setBusy(false);
    }
  }
  const stateLabel = run.stopRequested && (active || waiting)
    ? "Stopping…"
    : run.state === "completed"
      ? "Done"
      : run.state === "needs_input"
        ? "Needs input"
        : run.state.charAt(0).toUpperCase() + run.state.slice(1);
  const duration = active
    ? formatDuration(run.createdAt, now)
    : formatDuration(run.createdAt, run.updatedAt);
  const verification = run.result?.verification ?? [];
  const passed = verification.filter((v) => v.outcome === "passed").length;
  const failedChecks = verification.filter((v) => v.outcome === "failed").length;
  const skipped = verification.filter((v) => v.outcome === "not_run").length;
  const pulls = (run.implementation ?? []).filter((o) => o.pull);
  const humanFooter = waiting || failed || stopped || !!run.result?.rewrite;
  const commandLabel =
    run.command === "discuss" ? <Pill tone="accent">discussion</Pill> : <Command>{run.command}</Command>;
  const repoLabel = run.repositories.length ? (
    <>
      <Icon name={run.review ? "pr" : "branch"} size={12} />
      {run.repositories.map((r) => `${r.fullName} · ${r.commit?.slice(0, 8) ?? r.targetBranch}`).join(", ")}
    </>
  ) : undefined;
  const state = active ? (
    <ResultState tone="working" spinning>{stateLabel}</ResultState>
  ) : waiting ? (
    <ResultState tone="needs" icon="chat">{stateLabel} · {duration}</ResultState>
  ) : failed ? (
    <ResultState tone="failed" icon="close">{stateLabel} · {duration}</ResultState>
  ) : stopped ? (
    <ResultState tone="stopped" icon="stop">{stateLabel}</ResultState>
  ) : (
    <ResultState tone="done" icon="check">{stateLabel} · {duration}</ResultState>
  );
  const simplePill = waiting ? (
    <Pill tone="warn" className="simple:inline-flex dev:hidden"><Icon name="chat" size={11} />Needs your input</Pill>
  ) : failed ? (
    <Pill tone="bad" className="simple:inline-flex dev:hidden"><Icon name="close" size={11} />Failed</Pill>
  ) : stopped ? (
    <Pill className="simple:inline-flex dev:hidden"><Icon name="stop" size={11} />Stopped</Pill>
  ) : undefined;

  return (
    <MessageRow
      id={`agent-run-${run.id}`}
      author={{ name: run.agent.name, image: run.agent.avatar, role: run.agent.role, kind: "agent", working: active }}
      time={timeOf(run.createdAt)}
      timeTitle={formatDateTime(run.createdAt)}
      state={simplePill}
    >
      <ResultCard tone={waiting ? "needs" : failed ? "failed" : "default"}>
        <ResultRequest command={commandLabel} requester={run.requesterName} repo={repoLabel} state={state} />
        {run.publicationOnly && (
          <p className="hidden px-3.5 pt-2 text-sm text-ink-3 dev:block">
            Publication retry: no new model execution or checks.
          </p>
        )}
        {run.handoffFromId && (
          <p className="px-3.5 pt-2 text-sm text-ink-3 simple:px-0">
            Continues <a className="text-accent-ink" href={`#agent-run-${run.handoffFromId}`}>the previous execution</a> in the same workspace, with a fresh agent session.
          </p>
        )}

        {/* Summary or live status */}
        {run.result ? (
          <ResultSummary>
            <MessageMarkdown text={run.result.summary} />
            {waiting && run.result.question && (
              <div className="mt-2 rounded-lg border-l-2 border-warn bg-warn-soft/60 px-3 py-2 simple:bg-transparent simple:px-0 simple:py-0 simple:border-0">
                <MessageMarkdown text={run.result.question} />
              </div>
            )}
          </ResultSummary>
        ) : active ? (
          <LiveLine
            simple={run.events.at(-1)?.message ?? "Getting ready…"}
            detail={run.events.at(-1)?.message ?? "Waiting for an execution worker…"}
            elapsed={duration}
          />
        ) : failed ? (
          <ResultSummary>
            <p>The run stopped before producing a result{run.error ? ":" : "."}</p>
            {run.error && <p className="simple:hidden">{run.error}</p>}
            {run.error && <p className="hidden simple:block">{run.error}</p>}
          </ResultSummary>
        ) : stopped ? (
          <ResultSummary><p>Stopped{run.error ? `: ${run.error}` : "."} Available output and workspace were kept.</p></ResultSummary>
        ) : null}
        {failed && run.result && run.error && <ResultReason>{run.error}</ResultReason>}

        {/* Facts */}
        {(verification.length > 0 || pulls.length > 0 || (run.findings?.length ?? 0) > 0) && (
          <ResultFacts>
            {passed > 0 && <Fact tone="ok" icon="check">{passed} check{passed === 1 ? "" : "s"} passed</Fact>}
            {failedChecks > 0 && <Fact tone="bad" icon="alert">{failedChecks} failed</Fact>}
            {skipped > 0 && <Fact tone="warn" icon="clock">{skipped} not run</Fact>}
            {!!run.findings?.length && <Fact icon="chat">{run.findings.length} finding{run.findings.length === 1 ? "" : "s"}</Fact>}
          </ResultFacts>
        )}

        {/* Implementation outcomes */}
        {!!run.implementation?.length && (
          <div className="flex flex-col gap-2 pt-1 simple:pt-2">
            {run.implementation.map((outcome) => {
              const repo = run.repositories.find((r) => r.id === outcome.repositoryId);
              const pull = outcome.pull;
              const statusText =
                outcome.status === "unchanged" ? "No changes to publish"
                : outcome.status === "published" ? "Published"
                : outcome.status === "publishing" && !active ? "Publication needs reconciliation"
                : outcome.status.replace("_", " ");
              if (!pull)
                return (
                  <div key={outcome.workspaceId} className="mx-3.5 mb-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2 hairline simple:mx-0">
                    <b className="font-semibold text-ink">{repo?.fullName ?? "Repository"}</b> · <span className="mono">{outcome.branch}</span> → <span className="mono">{outcome.targetBranch}</span> · {statusText}
                    {outcome.error && <p className="mt-1 text-bad">{outcome.error}</p>}
                  </div>
                );
              return (
                <PullCard
                  key={outcome.workspaceId}
                  title={repo?.fullName ?? "Repository"}
                  number={pull.number}
                  state={pull.state === "open" && pull.draft ? "draft" : (pull.state as "open" | "merged" | "closed")}
                  provider={repo?.provider === "gitlab" ? "gitlab" : "github"}
                  branch={outcome.branch}
                  target={outcome.targetBranch}
                  url={pull.url}
                  footer={<><span>{statusText}{outcome.commit ? <span className="mono"> · {outcome.commit.slice(0, 8)}</span> : null}</span>{outcome.error && <span className="text-bad">{outcome.error}</span>}</>}
                />
              );
            })}
          </div>
        )}

        {(run.review || run.branchReview) && (
          <ReviewDrafts run={run} actions={actions} changed={changed} closed={closed} />
        )}

        {!!run.result?.feedback?.length && (
          <section aria-label="Comment outcomes" className="px-3.5 pb-3 simple:px-0">
            <h4 className="mb-1.5 text-sm font-semibold">Addressed comments</h4>
            <div className="flex flex-col gap-2">
              {run.result.feedback.map((f) => (
                <div key={`${f.discussionId}:${f.noteId}`} className="rounded-lg bg-surface-2 px-3 py-2 text-base">
                  <Pill tone={f.status === "addressed" ? "ok" : "neutral"} className="mb-1 capitalize">{f.status}</Pill>
                  <div className="prose-chat"><MessageMarkdown text={f.explanation} /></div>
                  {f.reply && <p className="mt-1 text-sm text-ink-3">Reply saved as a draft in provider discussions.</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer with actions */}
        {(run.canControl || run.events.length > 0) && (
          <ResultFooter keep={humanFooter}>
            <Disclosure label="Details" count={run.events.length || undefined} panelClassName="hidden dev:block">
              <Tabs value={tab} onChange={setTab} tabs={[
                { value: "result", label: "Result" },
                ...(verification.length ? [{ value: "checks" as const, label: `Checks · ${verification.length}` }] : []),
                { value: "activity", label: `Activity · ${run.events.length}` },
                { value: "context", label: "Context" },
              ]} />
              <div className="px-3.5 pt-3 pb-3.5 text-base">
                {tab === "result" && (
                  run.result?.details ? <div className="prose-chat"><MessageMarkdown text={run.result.details} /></div> : <p className="text-sm text-ink-3">No detailed report yet.</p>
                )}
                {tab === "checks" && (
                  <div className="flex flex-col gap-1.5">
                    {verification.map((check, i) => (
                      <CheckRow key={i} outcome={check.outcome} command={check.command} note={check.details} />
                    ))}
                  </div>
                )}
                {tab === "activity" && (
                  <>
                    <LogBlock lines={run.events.map((e) => ({ time: timeOf(e.createdAt), text: e.message }))} />
                    <p className="mt-2 text-sm text-ink-3">
                      {run.containerRetained ? "Container retained temporarily; workspace and results are saved." : "Results and workspace are saved independently of the container."}
                    </p>
                  </>
                )}
                {tab === "context" && (
                  <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-ink-3">Requested by</dt><dd>{run.requesterName} · {formatDateTime(run.createdAt)}</dd>
                    <dt className="text-ink-3">Message</dt><dd className="prose-chat"><MessageMarkdown text={run.message} /></dd>
                    <dt className="text-ink-3">Repositories</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {run.repositories.map((repo) => (
                        <a key={repo.id} href={repo.webURL} target="_blank" rel="noreferrer" className="mono rounded-sm bg-code px-1.5 text-xs text-ink-2">
                          {repo.fullName} · {repo.commit?.slice(0, 8) ?? repo.targetBranch}
                        </a>
                      ))}
                      {!run.repositories.length && "—"}
                    </dd>
                    {!!run.attachments?.length && (<><dt className="text-ink-3">Attachments</dt><dd className="flex flex-wrap gap-2">{run.attachments.map((file) => <a key={file.id} className="text-accent-ink" href={projectFileURL(run.projectId, file.id)} target="_blank" rel="noreferrer">{file.name}</a>)}</dd></>)}
                    {!!run.inputs.length && (<><dt className="text-ink-3">Instructions</dt><dd className="flex flex-col gap-1.5">{run.inputs.map((input) => <div key={input.id}><span className="text-xs text-ink-3">{input.state === "queued" ? "Queued for next session turn" : "Delivered"}</span><div className="prose-chat"><MessageMarkdown text={input.message} /></div></div>)}</dd></>)}
                  </dl>
                )}
              </div>
            </Disclosure>
            <span className="flex-1" />
            {run.canControl && (
              <>
                {!closed && !(active && run.publicationOnly) && (!(active || waiting) || !run.stopRequested) && (
                  <Button variant={waiting ? "primary" : "ghost"} disabled={busy} onClick={() => setWriting((v) => !v)}>
                    {waiting ? "Reply and resume" : active ? "Send instructions" : "Continue"}
                  </Button>
                )}
                {!closed && !active && !waiting && run.command === "implement" && (failed || stopped || run.publicationOnly) && (
                  <Button variant="primary" disabled={busy} onClick={() => void act(() => actions.invoke({ projectId: run.projectId, issueId: run.issueId, requestId: createId(), agentId: run.agent.id, command: "implement", repositoryIds: run.repositories.map((r) => r.id), message: run.retryMessage ?? run.message, fileIds: [], continuationId: run.id }))}>
                    Retry
                  </Button>
                )}
                {!closed && !active && !waiting && run.canRetryPublication && run.command === "implement" && (
                  <Button variant="secondary" disabled={busy} onClick={() => void act(() => actions.invoke({ projectId: run.projectId, issueId: run.issueId, requestId: createId(), agentId: run.agent.id, command: "implement", repositoryIds: run.repositories.map((r) => r.id), message: "Retry publishing saved implementation changes.", fileIds: [], continuationId: run.id, publicationOnly: true }))}>
                    Retry publication
                  </Button>
                )}
                {!closed && (active || waiting) && run.command === "implement" && !run.stopRequested && !run.publicationOnly && (
                  <Button variant="ghost" disabled={busy} onClick={() => void act(async () => { setTakeoverAgents((await actions.available(run.projectId)).filter((a) => a.id !== run.agent.id)); setTakingOver(true); })}>
                    Take over
                  </Button>
                )}
                {(active || waiting || run.containerRetained) && (
                  <Button variant="ghost" icon="stop" disabled={busy || run.stopRequested} onClick={() => void act(() => actions.stop(ref))}>
                    Stop
                  </Button>
                )}
                {!closed && run.command === "rewrite-issue" && run.state === "completed" && run.result?.rewrite && (
                  <Button variant="primary" disabled={busy || !!run.appliedAt} onClick={() => void act(async () => setPreview(await actions.previewRewrite(ref)))}>
                    {run.appliedAt ? "Applied" : "Review and apply changes"}
                  </Button>
                )}
              </>
            )}
          </ResultFooter>
        )}

        {/* Inline forms */}
        {takingOver && !closed && !run.stopRequested && (active || waiting) && (
          <form className="flex flex-col gap-3 px-3.5 py-3 hairline-t simple:px-0" onSubmit={(e) => { e.preventDefault(); void act(async () => { await actions.takeover({ ...ref, requestId: createId(), agentId: takeoverAgent, message: message.trim() || "Continue the implementation from the preserved workspace and address outstanding feedback." }); setTakingOver(false); setMessage(""); }); }}>
            <p className="text-sm text-ink-2">The current execution stops first. Its workspace, files, and context carry forward; the replacement uses its own credentials and a new session.</p>
            <label><span className={fieldLabel}>Replacement agent</span>
              <select className={fieldInput} required value={takeoverAgent} onChange={(e) => setTakeoverAgent(e.target.value)} disabled={busy}>
                <option value="">Choose an agent</option>
                {takeoverAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label><span className={fieldLabel}>Handoff instructions</span>
              <textarea className={cn(fieldInput, "min-h-20")} value={message} maxLength={100000} onChange={(e) => setMessage(e.target.value)} disabled={busy} />
            </label>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" disabled={busy} onClick={() => setTakingOver(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy || !takeoverAgent}>Stop and hand off</Button>
            </div>
          </form>
        )}
        {preview && !closed && !run.appliedAt && (
          <section aria-label="Review issue changes" className="flex flex-col gap-2 px-3.5 py-3 hairline-t simple:px-0">
            <h4 className="text-base font-semibold">Review issue changes</h4>
            {preview.stale && <p className="text-sm text-warn">The issue changed since this run started. Review the current values before replacing them.</p>}
            {preview.changes.map((change) => (
              <div key={change.field} className="rounded-lg bg-surface-2 px-3 py-2 text-base">
                <div className="mb-1 text-sm font-semibold">
                  {({ title: "Title", description: "Description", stateId: "State", priorityId: "Priority", assigneeId: "Assignee", tagIds: "Tags", fieldValues: "Custom fields" } as Record<string, string>)[change.field] ?? change.field}
                  {change.changedSinceInvocation && <span className="ml-2 font-normal text-warn">changed since invocation</span>}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div><div className="label-caps mb-1">Current</div><div className="prose-chat text-sm"><MessageMarkdown text={typeof change.current === "string" ? change.current : JSON.stringify(change.current)} /></div></div>
                  <div><div className="label-caps mb-1">Proposed</div><div className="prose-chat text-sm"><MessageMarkdown text={typeof change.proposed === "string" ? change.proposed : JSON.stringify(change.proposed)} /></div></div>
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void act(async () => setPreview(await actions.previewRewrite(ref)))}>Refresh comparison</Button>
              <Button variant="primary" disabled={busy} onClick={() => void act(async () => { await actions.apply({ ...ref, expectedUpdatedAt: preview.expectedUpdatedAt }); setPreview(null); })}>Apply reviewed changes</Button>
            </div>
          </section>
        )}
        {writing && !closed && (
          <form className="flex flex-col gap-2 px-3.5 py-3 hairline-t simple:px-0" onSubmit={(event) => { event.preventDefault(); if (!message.trim()) return; void act(async () => { if (active || waiting) await actions.instruct({ ...ref, requestId: createId(), message }); else await actions.invoke({ projectId: run.projectId, issueId: run.issueId, requestId: createId(), agentId: run.agent.id, command: run.command, repositoryIds: run.repositories.map((r) => r.id), message, fileIds: [], continuationId: run.id, ...(run.branchReview ? { reviewBranch: run.branchReview.sourceBranch } : {}), ...(run.review ? { reviewWorkspaceId: run.review.workspaceId } : {}) }); setMessage(""); setWriting(false); }); }}>
            <label><span className={fieldLabel}>{waiting ? "Answer the agent" : "Instructions"}</span>
              <textarea autoFocus className={cn(fieldInput, "min-h-20")} value={message} maxLength={100000} disabled={busy} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" disabled={busy} onClick={() => setWriting(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy || !message.trim()}>{waiting ? "Resume" : active ? "Queue instructions" : "Start continuation"}</Button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="px-3.5 pb-3 text-sm text-bad simple:px-0">{error}</p>}
      </ResultCard>
    </MessageRow>
  );
}
