import { useState } from "react";
import type {
  AgentRunActions,
  AgentRunView,
  ReviewFinding,
} from "@spectron/shared";
import { MessageMarkdown } from "../../ui/message-markdown";
import { Button } from "../../ui/button";
import { Pill, type Tone } from "../../ui/pill";
import { Icon } from "../../ui/icon";
import { cn } from "../../ui/cn";

const findingTone: Record<ReviewFinding["state"], Tone> = {
  draft: "neutral",
  dismissed: "neutral",
  publishing: "accent",
  published: "ok",
  stale: "warn",
  uncertain: "warn",
};

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
    <section
      className="mx-3.5 mb-3 overflow-hidden rounded-lg bg-surface-2 hairline simple:mx-0"
      aria-label="Review drafts"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Icon name="check-circle" size={15} className="text-ink-2" />
        <a
          href={target?.url}
          target="_blank"
          rel="noreferrer"
          className="text-base font-semibold text-ink no-underline hover:underline"
        >
          {run.review
            ? `${run.review.repositoryName} #${run.review.pull.number}`
            : `${run.branchReview?.repositoryName} · ${run.branchReview?.sourceBranch}`}
        </a>
        <span className="mono hidden text-xs text-ink-3 dev:inline">
          {run.repositories[0]?.commit ? "reviewed" : "selected"} {target?.head.slice(0, 12)} · {target?.sourceBranch} → {target?.targetBranch}
        </span>
        <span className="ml-auto text-sm text-ink-3">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {drafts.length ? ` · ${drafts.length} draft${drafts.length === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      {run.branchReview && (
        <p className="px-3 pb-2 text-sm text-ink-3">
          Branch review findings stay local. Review a linked PR/MR to publish provider comments.
        </p>
      )}
      {run.state === "completed" && !findings.length && (
        <p className="px-3 pb-3 text-base text-ink-2">No actionable findings.</p>
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
      {editable && run.review && drafts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 bg-surface px-3 py-2 hairline-t">
          <span className="mr-auto text-sm text-ink-3">
            Findings stay here until you publish them. Only the requester or a project owner can edit and publish.
          </span>
          <Button variant="secondary"
            disabled={busy || editingIds.length > 0 || !drafts.some((f) => selected.includes(f.id))}
            onClick={() =>
              void act(() =>
                actions.publishFindings({
                  ...ref,
                  findingIds: drafts.filter((f) => selected.includes(f.id)).map((f) => f.id),
                }),
              )
            }
          >
            Publish selected
          </Button>
          <Button
            variant="primary"
            disabled={busy || editingIds.length > 0}
            onClick={() =>
              void act(() =>
                actions.publishFindings({ ...ref, findingIds: drafts.map((f) => f.id) }),
              )
            }
          >
            Publish all ({drafts.length})
          </Button>
        </div>
      )}
      {error && <p role="alert" className="px-3 pb-2 text-sm text-bad">{error}</p>}
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
  const field =
    "mt-1 block w-full rounded-md bg-surface px-2.5 py-1.5 text-base text-ink hairline focus:border-line focus:outline-none";
  return (
    <article
      className={cn(
        "grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 bg-surface px-3 py-2.5 hairline-t",
        f.state === "dismissed" && "opacity-60",
      )}
    >
      <div className="pt-0.5">
        {editable && f.state === "draft" ? (
          <input
            type="checkbox"
            aria-label={`Select finding at ${f.path}:${f.line}`}
            checked={selected}
            disabled={busy || editing}
            onChange={(e) => select(e.target.checked)}
            className="size-4 accent-accent"
          />
        ) : (
          <Icon name="chat" size={14} className="text-ink-3" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <span className="mono rounded-sm bg-code px-1.5 text-xs text-ink-2">
            {f.path}:{f.line}
          </span>
          <span className="hidden dev:inline">{f.side === "LEFT" ? "old" : "new"} side</span>
          <Pill tone={findingTone[f.state]} className="capitalize">{f.state}</Pill>
          {f.externalURL && (
            <a href={f.externalURL} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent-ink">
              View comment <Icon name="external" size={11} />
            </a>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <label><span className="block text-sm text-ink-2">Finding</span>
              <textarea aria-label="Finding explanation" className={cn(field, "min-h-20")} maxLength={20000} value={explanation} onChange={(e) => setExplanation(e.target.value)} disabled={busy} />
            </label>
            <label><span className="block text-sm text-ink-2">Suggested fix</span>
              <textarea aria-label="Suggested fix" className={cn(field, "min-h-16")} maxLength={20000} value={fix} onChange={(e) => setFix(e.target.value)} disabled={busy} />
            </label>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" disabled={busy} onClick={() => { setExplanation(f.explanation); setFix(f.suggestedFix ?? ""); setEditing(false); editingChanged(false); }}>Cancel</Button>
              <Button variant="primary" disabled={busy || !explanation.trim()} onClick={() => void save(explanation, fix, false)}>Save finding</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="prose-chat text-base"><MessageMarkdown text={f.explanation} /></div>
            {f.suggestedFix && (
              <details className="text-base">
                <summary className="cursor-pointer text-sm font-medium text-ink-2">Suggested fix</summary>
                <div className="prose-chat mt-1"><MessageMarkdown text={f.suggestedFix} /></div>
              </details>
            )}
          </>
        )}
        {f.error && <p role="status" className="text-sm text-warn">{f.error}</p>}
        {editable && !editing && (
          <div className="-ml-1.5 flex flex-wrap gap-px">
            {f.state === "draft" && (
              <>
                <Button size="sm" variant="ghost" icon="edit" disabled={busy} onClick={() => { select(false); setEditing(true); editingChanged(true); }}>Edit</Button>
                <Button size="sm" variant="ghost" icon="close" disabled={busy} onClick={() => void save(f.explanation, f.suggestedFix ?? "", true)}>Dismiss</Button>
              </>
            )}
            {f.state === "stale" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(f.explanation, f.suggestedFix ?? "", true)}>Dismiss</Button>
            )}
            {f.state === "dismissed" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(f.explanation, f.suggestedFix ?? "", false)}>Restore draft</Button>
            )}
            {["publishing", "uncertain"].includes(f.state) && (
              <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={reconcile}>Reconcile publication</Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
