import { useEffect, useState } from "react";
import {
  createId,
  projectFileURL,
  type AgentRunActions,
  type AgentRunView,
  type AgentRewritePreview,
} from "@spectron/shared";
import { MessageMarkdown } from "../../ui/message-markdown";
import { UserInfo } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { formatDateTime } from "../../../lib/date-format";
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
  const [preview, setPreview] = useState<AgentRewritePreview | null>(null);
  const active = ["queued", "preparing", "working"].includes(run.state);
  const waiting = run.state === "needs_input";
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
  return (
    <article
      id={`agent-run-${run.id}`}
      className="agent-run-card"
      aria-label={`${run.agent.name} run`}
    >
      <header>
        <UserInfo name={run.agent.name} image={run.agent.avatar} />
        <span className="agent-badge">AI</span>
        <span
          className={`agent-run-state ${active ? "is-active" : ""}`}
          role="status"
        >
          {run.stopRequested && (active || waiting)
            ? "Stopping…"
            : run.state.replace("_", " ")}
        </span>
      </header>
      <p className="muted">
        {run.command === "discuss" ? "Discussion" : `/${run.command}`} ·
        Requested by {run.requesterName} ·{" "}
        <time>{formatDateTime(run.createdAt)}</time>
      </p>
      <div className="agent-repo-chips">
        {run.repositories.map((repo) => (
          <a key={repo.id} href={repo.webURL} target="_blank" rel="noreferrer">
            {repo.fullName} · {repo.commit?.slice(0, 8) ?? repo.targetBranch}
          </a>
        ))}
      </div>
      {run.publicationOnly && (
        <p className="muted">
          Publication retry: no new model execution or checks.
        </p>
      )}
      <MessageMarkdown text={run.message} />
      {!!run.attachments?.length && (
        <ul>
          {run.attachments.map((file) => (
            <li key={file.id}>
              <a
                href={projectFileURL(run.projectId, file.id)}
                target="_blank"
                rel="noreferrer"
              >
                {file.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!!run.inputs.length && (
        <details>
          <summary>Additional instructions ({run.inputs.length})</summary>
          {run.inputs.map((input) => (
            <div key={input.id}>
              <small>
                {input.state === "queued"
                  ? "Queued for next session turn"
                  : "Delivered to session turn"}
              </small>
              <MessageMarkdown text={input.message} />
            </div>
          ))}
        </details>
      )}
      {active && (
        <p role="status">
          {run.events.at(-1)?.message ?? "Waiting for an execution worker…"}
        </p>
      )}
      {run.result && (
        <div className="agent-run-result">
          <MessageMarkdown text={run.result.summary} />
          <details open={waiting}>
            <summary>Details</summary>
            <MessageMarkdown text={run.result.details} />
          </details>
        </div>
      )}
      {!!run.result?.verification?.length && (
        <section
          aria-label="Verification results"
          className="agent-verification"
        >
          <h4>Verification reported by the agent</h4>
          <ul>
            {run.result.verification.map((check, i) => (
              <li key={i}>
                <span className={`agent-check-${check.outcome}`}>
                  {check.outcome.replace("_", " ")}
                </span>{" "}
                <code>{check.command}</code>
                <p>{check.details}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!run.implementation?.length && (
        <section
          aria-label="Implementation repositories"
          className="agent-implementation"
        >
          {run.implementation.map((outcome) => {
            const repo = run.repositories.find(
              (r) => r.id === outcome.repositoryId,
            );
            return (
              <div key={outcome.workspaceId} className="agent-pull-card">
                <strong>{repo?.fullName ?? "Repository"}</strong>
                <p>
                  <span
                    className={`agent-branch-icon is-${outcome.pull?.state ?? "draft"}`}
                    aria-hidden="true"
                  >
                    <Icon name="branch" size={16} />
                  </span>{" "}
                  <code>{outcome.branch}</code> →{" "}
                  <code>{outcome.targetBranch}</code>
                </p>
                {outcome.pull && (
                  <a href={outcome.pull.url} target="_blank" rel="noreferrer">
                    {repo?.provider === "gitlab" ? "MR" : "PR"} #
                    {outcome.pull.number} ·{" "}
                    {outcome.pull.state === "open" && outcome.pull.draft
                      ? "Draft"
                      : outcome.pull.state}
                  </a>
                )}
                <p role="status">
                  {outcome.status === "unchanged"
                    ? "No changes to publish"
                    : outcome.status === "published"
                      ? "Published"
                      : outcome.status === "publishing" && !active
                        ? "Publication needs reconciliation"
                        : outcome.status.replace("_", " ")}
                  {outcome.commit ? ` · ${outcome.commit.slice(0, 8)}` : ""}
                </p>
                {outcome.error && <p role="alert">{outcome.error}</p>}
              </div>
            );
          })}
          <small>
            Each repository is published separately. PR/MR status reflects the
            last execution.
          </small>
        </section>
      )}
      {run.result?.rewrite && (
        <details>
          <summary>Proposed issue changes</summary>
          <h4>{run.result.rewrite.title}</h4>
          <MessageMarkdown text={run.result.rewrite.description ?? ""} />
          {Object.entries(run.result.rewrite)
            .filter(([key]) => !["title", "description"].includes(key))
            .map(([key, value]) => (
              <p key={key}>
                {key}: {JSON.stringify(value)}
              </p>
            ))}
        </details>
      )}
      {waiting && run.result?.question && (
        <blockquote>
          <MessageMarkdown text={run.result.question} />
        </blockquote>
      )}
      {run.error && <p role="alert">{run.error}</p>}
      <details>
        <summary>Activity ({run.events.length})</summary>
        <ol>
          {run.events.map((e) => (
            <li key={e.id}>{e.message}</li>
          ))}
        </ol>
        <p className="muted">
          {run.containerRetained
            ? "Container retained temporarily; workspace and results are saved."
            : "Results and workspace are saved independently of the container."}
        </p>
      </details>
      {run.canControl && (
        <div className="agent-run-controls">
          {!closed &&
            !(active && run.publicationOnly) &&
            (!(active || waiting) || !run.stopRequested) && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setWriting((v) => !v)}
              >
                {waiting
                  ? "Reply and resume"
                  : active
                    ? "Send instructions"
                    : "Continue"}
              </Button>
            )}
          {!closed &&
            !active &&
            !waiting &&
            run.command === "implement" &&
            (run.state === "failed" ||
              run.state === "stopped" ||
              run.publicationOnly) && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    actions.invoke({
                      projectId: run.projectId,
                      issueId: run.issueId,
                      requestId: createId(),
                      agentId: run.agent.id,
                      command: "implement",
                      repositoryIds: run.repositories.map((r) => r.id),
                      message: run.retryMessage ?? run.message,
                      fileIds: [],
                      continuationId: run.id,
                    }),
                  )
                }
              >
                Retry implementation
              </Button>
            )}
          {!closed &&
            !active &&
            !waiting &&
            run.canRetryPublication &&
            run.command === "implement" && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    actions.invoke({
                      projectId: run.projectId,
                      issueId: run.issueId,
                      requestId: createId(),
                      agentId: run.agent.id,
                      command: "implement",
                      repositoryIds: run.repositories.map((r) => r.id),
                      message: "Retry publishing saved implementation changes.",
                      fileIds: [],
                      continuationId: run.id,
                      publicationOnly: true,
                    }),
                  )
                }
              >
                Retry publication
              </Button>
            )}
          {(active || waiting || run.containerRetained) && (
            <Button
              variant="ghost"
              disabled={busy || run.stopRequested}
              onClick={() => void act(() => actions.stop(ref))}
            >
              Stop
            </Button>
          )}
          {!closed &&
            run.command === "rewrite-issue" &&
            run.state === "completed" &&
            run.result?.rewrite && (
              <Button
                disabled={busy || !!run.appliedAt}
                onClick={() =>
                  void act(async () =>
                    setPreview(await actions.previewRewrite(ref)),
                  )
                }
              >
                {run.appliedAt ? "Applied" : "Review and apply issue changes"}
              </Button>
            )}
        </div>
      )}
      {preview && !closed && !run.appliedAt && (
        <section
          aria-label="Review issue changes"
          className="agent-rewrite-preview"
        >
          <h4>Review issue changes</h4>
          {preview.stale && (
            <p>
              The issue changed since this run started. Review the current
              values before replacing them.
            </p>
          )}
          {preview.changes.map((change) => (
            <details key={change.field} open>
              <summary>
                {(
                  {
                    title: "Title",
                    description: "Description",
                    stateId: "State",
                    priorityId: "Priority",
                    assigneeId: "Assignee",
                    tagIds: "Tags",
                    fieldValues: "Custom fields",
                  } as Record<string, string>
                )[change.field] ?? change.field}
                {change.changedSinceInvocation
                  ? " — changed since invocation"
                  : ""}
              </summary>
              <p>Current</p>
              <MessageMarkdown
                text={
                  typeof change.current === "string"
                    ? change.current
                    : JSON.stringify(change.current)
                }
              />
              <p>Proposed</p>
              <MessageMarkdown
                text={
                  typeof change.proposed === "string"
                    ? change.proposed
                    : JSON.stringify(change.proposed)
                }
              />
            </details>
          ))}
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await actions.apply({
                  ...ref,
                  expectedUpdatedAt: preview.expectedUpdatedAt,
                });
                setPreview(null);
              })
            }
          >
            Apply reviewed changes
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setPreview(await actions.previewRewrite(ref)),
              )
            }
          >
            Refresh comparison
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            Cancel
          </Button>
        </section>
      )}
      {writing && !closed && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            void act(async () => {
              if (active || waiting)
                await actions.instruct({
                  ...ref,
                  requestId: createId(),
                  message,
                });
              else
                await actions.invoke({
                  projectId: run.projectId,
                  issueId: run.issueId,
                  requestId: createId(),
                  agentId: run.agent.id,
                  command: run.command,
                  repositoryIds: run.repositories.map((r) => r.id),
                  message,
                  fileIds: [],
                  continuationId: run.id,
                });
              setMessage("");
              setWriting(false);
            });
          }}
        >
          <label>
            {waiting ? "Answer the agent" : "Instructions"}
            <textarea
              className="input"
              value={message}
              maxLength={100000}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !message.trim()}>
            {waiting
              ? "Resume"
              : active
                ? "Queue instructions"
                : "Start continuation"}
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
