import { useState } from "react";
import {
  createId,
  projectFileURL,
  type AgentRunActions,
  type AgentRunView,
} from "@spectron/shared";
import { MessageMarkdown } from "../../ui/message-markdown";
import { UserInfo } from "../../ui/avatar";
import { Button } from "../../ui/button";
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [writing, setWriting] = useState(false),
    [message, setMessage] = useState("");
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
    <article className="agent-run-card" aria-label={`${run.agent.name} run`}>
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
          {!closed && (!(active || waiting) || !run.stopRequested) && (
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
                onClick={() => void act(() => actions.apply(ref))}
              >
                {run.appliedAt ? "Applied" : "Apply issue changes"}
              </Button>
            )}
        </div>
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
