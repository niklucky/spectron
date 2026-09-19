import { useState } from "react";
import type {
  AgentRunActions,
  AgentRunView,
  ReviewFinding,
} from "@spectron/shared";
import { MessageMarkdown } from "../../ui/message-markdown";
import { Button } from "../../ui/button";
export function ReviewDrafts({
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
  const [selected, setSelected] = useState<string[]>([]);
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ref = { projectId: run.projectId, issueId: run.issueId, id: run.id };
  const findings = run.findings ?? [];
  const editable =
    run.canControl &&
    !closed &&
    !run.stopRequested &&
    run.state === "completed";
  const target = run.review?.pull ?? run.branchReview;
  const drafts = findings.filter((f) => f.state === "draft");
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update review.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="agent-review-drafts" aria-label="Review drafts">
      <h4>Review drafts</h4>
      <a href={target?.url} target="_blank" rel="noreferrer">
        {run.review
          ? `${run.review.repositoryName} #${run.review.pull.number}`
          : `${run.branchReview?.repositoryName} · ${run.branchReview?.sourceBranch}`}
      </a>
      <p className="muted">
        {run.repositories[0]?.commit ? "Reviewed" : "Selected"} revision{" "}
        <code>{target?.head.slice(0, 12)}</code> · {target?.sourceBranch} →{" "}
        {target?.targetBranch}
      </p>
      {run.branchReview && (
        <p>
          Branch review findings stay local. Review a linked PR/MR to publish
          provider comments.
        </p>
      )}
      <small>
        Findings stay local until published. Only the requester or a project
        owner can edit and publish.
      </small>
      {run.state === "completed" && !findings.length && (
        <p>No actionable findings.</p>
      )}
      {editable && run.review && drafts.length > 0 && (
        <div className="agent-run-controls">
          <Button
            variant="ghost"
            disabled={
              busy ||
              editingIds.length > 0 ||
              !drafts.some((f) => selected.includes(f.id))
            }
            onClick={() =>
              void act(() =>
                actions.publishFindings({
                  ...ref,
                  findingIds: drafts
                    .filter((f) => selected.includes(f.id))
                    .map((f) => f.id),
                }),
              )
            }
          >
            Publish selected
          </Button>
          <Button
            variant="ghost"
            disabled={busy || editingIds.length > 0}
            onClick={() =>
              void act(() =>
                actions.publishFindings({
                  ...ref,
                  findingIds: drafts.map((f) => f.id),
                }),
              )
            }
          >
            Publish all ({drafts.length})
          </Button>
        </div>
      )}
      {findings.map((f) => (
        <Finding
          key={`${f.id}:${f.revision}:${f.state}`}
          finding={f}
          editable={editable}
          busy={busy}
          selected={selected.includes(f.id)}
          select={(checked) =>
            setSelected((ids) =>
              checked ? [...ids, f.id] : ids.filter((id) => id !== f.id),
            )
          }
          editingChanged={(editing) =>
            setEditingIds((ids) =>
              editing ? [...ids, f.id] : ids.filter((id) => id !== f.id),
            )
          }
          save={(explanation, suggestedFix, dismissed) =>
            act(async () => {
              await actions.editFinding({
                ...ref,
                findingId: f.id,
                revision: f.revision,
                explanation,
                suggestedFix,
                dismissed,
              });
              setEditingIds((ids) => ids.filter((id) => id !== f.id));
            })
          }
          reconcile={() =>
            void act(() =>
              actions.publishFindings({ ...ref, findingIds: [f.id] }),
            )
          }
        />
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function Finding({
  finding: f,
  editable,
  busy,
  selected,
  select,
  save,
  reconcile,
  editingChanged,
}: {
  editingChanged: (editing: boolean) => void;
  finding: ReviewFinding;
  editable: boolean;
  busy: boolean;
  selected: boolean;
  select: (checked: boolean) => void;
  save: (explanation: string, fix: string, dismissed: boolean) => Promise<void>;
  reconcile: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [explanation, setExplanation] = useState(f.explanation),
    [fix, setFix] = useState(f.suggestedFix ?? "");
  return (
    <article className="agent-review-finding">
      <header>
        {editable && f.state === "draft" && (
          <input
            type="checkbox"
            aria-label={`Select finding at ${f.path}:${f.line}`}
            checked={selected}
            disabled={busy || editing}
            onChange={(e) => select(e.target.checked)}
          />
        )}
        <code>
          {f.path}:{f.line}
        </code>{" "}
        · {f.side === "LEFT" ? "old" : "new"} · <strong>{f.state}</strong>
      </header>
      {editing ? (
        <div className="agent-finding-editor">
          <label>
            Finding
            <textarea
              aria-label="Finding explanation"
              maxLength={20000}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Suggested fix
            <textarea
              aria-label="Suggested fix"
              maxLength={20000}
              value={fix}
              onChange={(e) => setFix(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button
            variant="ghost"
            disabled={busy || !explanation.trim()}
            onClick={() => void save(explanation, fix, false)}
          >
            Save finding
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setExplanation(f.explanation);
              setFix(f.suggestedFix ?? "");
              setEditing(false);
              editingChanged(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <MessageMarkdown text={f.explanation} />
          {f.suggestedFix && (
            <details>
              <summary>Suggested fix</summary>
              <MessageMarkdown text={f.suggestedFix} />
            </details>
          )}
        </>
      )}
      {f.error && <p role="status">{f.error}</p>}
      {f.externalURL && (
        <a href={f.externalURL} target="_blank" rel="noreferrer">
          View published comment
        </a>
      )}
      {editable && !editing && (
        <div className="agent-run-controls">
          {f.state === "draft" && (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  select(false);
                  setEditing(true);
                  editingChanged(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void save(f.explanation, f.suggestedFix ?? "", true)
                }
              >
                Dismiss
              </Button>
            </>
          )}
          {f.state === "stale" && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void save(f.explanation, f.suggestedFix ?? "", true)
              }
            >
              Dismiss
            </Button>
          )}
          {f.state === "dismissed" && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void save(f.explanation, f.suggestedFix ?? "", false)
              }
            >
              Restore draft
            </Button>
          )}
          {["publishing", "uncertain"].includes(f.state) && (
            <Button variant="ghost" disabled={busy} onClick={reconcile}>
              Reconcile publication
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
