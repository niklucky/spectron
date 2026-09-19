import { formatDateTime } from "../../../lib/date-format";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatWorklogDuration,
  parseHumanWorklogDuration,
  humanWorklogDurationInput,
  type ProjectMemberSummary,
  type WorklogFields,
  type WorklogPage,
  type WorklogScope,
  type WorklogSummary,
} from "@spectron/shared";
import { Button } from "../../ui/button";
import { Field, Input, Select, Textarea } from "../../ui/input";
import { Avatar } from "../../ui/avatar";
import { cn } from "../../ui/cn";
export type WorklogActions = {
  currentUserId: string;
  list: (input: WorklogScope & { includeDeleted: boolean; cursor?: NonNullable<WorklogPage["nextCursor"]> }) => Promise<WorklogPage>;
  create: (input: WorklogScope & WorklogFields) => Promise<{ id: string }>;
  update: (input: WorklogScope & WorklogFields & { id: string; expectedUpdatedAt: string }) => Promise<{ id: string }>;
  setDeleted: (input: WorklogScope & { id: string; expectedUpdatedAt: string; deleted: boolean }) => Promise<void>;
};

export function IssueWorklogs({
  projectId,
  issueId,
  deleted,
  members,
  actions,
  onChange,
  refreshKey = 0,
  estimateSeconds,
}: {
  projectId: string;
  issueId: string;
  deleted: boolean;
  members: ProjectMemberSummary[];
  actions: WorklogActions;
  onChange: () => void;
  refreshKey?: number;
  estimateSeconds?: number | null | undefined;
}) {
  const [entries, setEntries] = useState<WorklogSummary[]>([]),
    [cursor, setCursor] = useState<WorklogPage["nextCursor"]>(null),
    [includeDeleted, setIncludeDeleted] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<WorklogSummary | "new" | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const page = await actions.list({ projectId, issueId, includeDeleted });
      if (version === generation.current) {
        setEntries(page.entries);
        setCursor(page.nextCursor);
      }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "Could not load worklogs.");
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [projectId, issueId, includeDeleted, actions]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, refreshKey]);
  const logged = entries.filter((e) => !e.deletedAt).reduce((sum, e) => sum + e.durationSeconds, 0);
  const ratio = estimateSeconds ? Math.min(1, logged / estimateSeconds) : 0;
  return (
    <div className="flex flex-col gap-2.5" aria-label="Worklogs">
      {(logged > 0 || estimateSeconds) && (
        <div>
          {estimateSeconds ? (
            <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
            </div>
          ) : null}
          <div className="flex justify-between text-xs text-ink-3">
            <span>{logged ? `${formatWorklogDuration(logged)} logged` : "Nothing logged"}</span>
            {estimateSeconds ? <span>{formatWorklogDuration(estimateSeconds)} estimate</span> : null}
          </div>
        </div>
      )}
      {editor && !deleted && (
        <WorklogEditor
          key={editor === "new" ? "new" : editor.id}
          entry={editor === "new" ? null : editor}
          members={members}
          currentUserId={actions.currentUserId}
          onClose={() => setEditor(null)}
          onSave={async (fields) => {
            if (editor === "new") await actions.create({ projectId, issueId, ...fields });
            else await actions.update({ projectId, issueId, id: editor.id, expectedUpdatedAt: editor.updatedAt, ...fields });
            setEditor(null);
            await refresh();
            onChange();
          }}
        />
      )}
      {loading && <p role="status" className="text-sm text-ink-3">Loading worklogs…</p>}
      {!loading && !entries.length && !estimateSeconds && <p className="text-sm text-ink-3">No time logged yet.</p>}
      {entries.length > 0 && (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.id} className={cn("group/log flex items-start gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface-2", entry.deletedAt && "opacity-60")}>
              <Avatar name={entry.workerName} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1 leading-snug">
                <div className="flex items-baseline gap-1.5">
                  <b className="truncate font-semibold text-ink">{entry.workerName}</b>
                  <span className="mono shrink-0 text-xs text-ink-2">{formatWorklogDuration(entry.durationSeconds)}</span>
                  {entry.deletedAt && <span className="text-xs text-ink-3">deleted</span>}
                  <time dateTime={entry.startedAt} className="ml-auto shrink-0 text-xs text-ink-3" title={`Recorded by ${entry.recorderName} · ${formatDateTime(entry.createdAt)}`}>{formatDateTime(entry.startedAt)}</time>
                </div>
                {entry.description && <p className="text-ink-2">{entry.description}</p>}
                {!deleted && (
                  <div className="-ml-1.5 mt-0.5 hidden gap-px group-hover/log:flex">
                    {!entry.deletedAt && <Button variant="ghost" size="sm" icon="edit" disabled={busy || editor !== null} onClick={() => setEditor(entry)}>Edit</Button>}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={entry.deletedAt ? "refresh" : "trash"}
                      disabled={busy || editor !== null}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await actions.setDeleted({ projectId, issueId, id: entry.id, expectedUpdatedAt: entry.updatedAt, deleted: !entry.deletedAt });
                          await refresh();
                          onChange();
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : "Could not change worklog.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {entry.deletedAt ? "Restore" : "Delete"}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {!deleted && <Button variant="ghost" size="sm" icon="clock" disabled={busy || editor !== null} onClick={() => setEditor("new")}>Log time</Button>}
        {cursor && (
          <Button variant="ghost" size="sm" disabled={loading || busy} onClick={async () => {
            const version = generation.current;
            setBusy(true);
            try {
              const page = await actions.list({ projectId, issueId, includeDeleted, cursor });
              if (version === generation.current) {
                setEntries((previous) => [...previous, ...page.entries]);
                setCursor(page.nextCursor);
              }
            } catch (cause) {
              if (version === generation.current) setError(cause instanceof Error ? cause.message : "Could not load worklogs.");
            } finally {
              setBusy(false);
            }
          }}>Load more</Button>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-3">
          <input type="checkbox" className="accent-accent" checked={includeDeleted} disabled={busy} onChange={(e) => setIncludeDeleted(e.target.checked)} />
          deleted
        </label>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-bad">
          {error}
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>Retry</Button>
        </p>
      )}
    </div>
  );
}
function localTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
export function WorklogEditor({
  entry,
  members,
  currentUserId,
  onClose,
  onSave,
}: {
  entry: WorklogSummary | null;
  members: ProjectMemberSummary[];
  currentUserId: string;
  onClose: () => void;
  onSave: (fields: WorklogFields) => Promise<void>;
}) {
  const [worker, setWorker] = useState(entry?.workerUserId ?? currentUserId),
    [started, setStarted] = useState(localTime(entry?.startedAt ?? new Date().toISOString())),
    [durationInput, setDurationInput] = useState(entry ? humanWorklogDurationInput(entry.durationSeconds) : ""),
    [description, setDescription] = useState(entry?.description ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3 hairline"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const date = new Date(started),
            duration = entry && durationInput === humanWorklogDurationInput(entry.durationSeconds) ? entry.durationSeconds : parseHumanWorklogDuration(durationInput);
          if (!Number.isFinite(date.getTime()) || !Number.isInteger(duration) || duration < 1 || duration > 2147483647)
            throw new Error("Enter a valid start time and a positive duration.");
          await onSave({ workerUserId: worker, startedAt: date.toISOString(), durationSeconds: duration, description });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save worklog.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-3 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Duration" hint="1h 35m, or 30 for minutes">
            <Input required autoFocus maxLength={100} value={durationInput} placeholder="1h 35m" onChange={(e) => setDurationInput(e.target.value)} />
          </Field>
          <Field label="Worker">
            <Select value={worker} onChange={(e) => setWorker(e.target.value)} required>
              {!members.some((m) => m.id === worker) && <option value={worker}>{entry?.workerName ?? "Current user"}</option>}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Started at" hint={`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}>
          <Input type="datetime-local" required step="1" value={started} onChange={(e) => setStarted(e.target.value)} />
        </Field>
        <Field label="What was done">
          <Textarea rows={2} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Saving…" : entry ? "Save" : "Add worklog"}</Button>
        </div>
      </fieldset>
    </form>
  );
}
