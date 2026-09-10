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
import { Input, Select, Textarea } from "../../ui/input";
export type WorklogActions = {
  currentUserId: string;
  list: (
    input: WorklogScope & {
      includeDeleted: boolean;
      cursor?: NonNullable<WorklogPage["nextCursor"]>;
    },
  ) => Promise<WorklogPage>;
  create: (input: WorklogScope & WorklogFields) => Promise<{ id: string }>;
  update: (
    input: WorklogScope &
      WorklogFields & { id: string; expectedUpdatedAt: string },
  ) => Promise<{ id: string }>;
  setDeleted: (
    input: WorklogScope & {
      id: string;
      expectedUpdatedAt: string;
      deleted: boolean;
    },
  ) => Promise<void>;
};
export function IssueWorklogs({
  projectId,
  issueId,
  deleted,
  members,
  actions,
  onChange,
  refreshKey = 0,
}: {
  projectId: string;
  issueId: string;
  deleted: boolean;
  members: ProjectMemberSummary[];
  actions: WorklogActions;
  onChange: () => void;
  refreshKey?: number;
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
      if (version === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Could not load worklogs.",
        );
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
  return (
    <section className="issue-worklogs" aria-label="Worklogs">
      <div className="issue-files-heading">
        <h3>Worklogs</h3>
        <div>
          <Button
            variant="ghost"
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            Refresh worklogs
          </Button>
          {!deleted && (
            <Button
              disabled={busy || editor !== null}
              onClick={() => setEditor("new")}
            >
              Log work
            </Button>
          )}
        </div>
      </div>
      <label className="worklog-filter">
        <input
          type="checkbox"
          checked={includeDeleted}
          disabled={busy}
          onChange={(e) => setIncludeDeleted(e.target.checked)}
        />{" "}
        Show deleted entries
      </label>
      {editor && !deleted && (
        <WorklogEditor
          key={editor === "new" ? "new" : editor.id}
          entry={editor === "new" ? null : editor}
          members={members}
          currentUserId={actions.currentUserId}
          onClose={() => setEditor(null)}
          onSave={async (fields) => {
            if (editor === "new")
              await actions.create({ projectId, issueId, ...fields });
            else
              await actions.update({
                projectId,
                issueId,
                id: editor.id,
                expectedUpdatedAt: editor.updatedAt,
                ...fields,
              });
            setEditor(null);
            await refresh();
            onChange();
          }}
        />
      )}
      {loading && <p role="status">Loading worklogs…</p>}
      {!loading && !entries.length && <p className="muted">No worklogs yet.</p>}
      <ul className="worklog-list">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={entry.deletedAt ? "worklog-deleted" : ""}
          >
            <div>
              <strong>{entry.workerName}</strong> ·{" "}
              {formatWorklogDuration(entry.durationSeconds)}{" "}
              {entry.deletedAt && <span>· Deleted</span>}
            </div>
            <time dateTime={entry.startedAt}>
              Started {formatDateTime(entry.startedAt)}
            </time>
            {entry.description && <p>{entry.description}</p>}
            <small>
              Recorded by {entry.recorderName} ·{" "}
              {formatDateTime(entry.createdAt)}
            </small>
            {!deleted && (
              <div className="comment-actions">
                {!entry.deletedAt && (
                  <Button
                    variant="ghost"
                    disabled={busy || editor !== null}
                    onClick={() => setEditor(entry)}
                  >
                    Edit worklog
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy || editor !== null}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await actions.setDeleted({
                        projectId,
                        issueId,
                        id: entry.id,
                        expectedUpdatedAt: entry.updatedAt,
                        deleted: !entry.deletedAt,
                      });
                      await refresh();
                      onChange();
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Could not change worklog.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {entry.deletedAt ? "Restore worklog" : "Delete worklog"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          variant="ghost"
          disabled={loading || busy}
          onClick={async () => {
            const version = generation.current;
            setBusy(true);
            try {
              const page = await actions.list({
                projectId,
                issueId,
                includeDeleted,
                cursor,
              });
              if (version === generation.current) {
                setEntries((previous) => [...previous, ...page.entries]);
                setCursor(page.nextCursor);
              }
            } catch (cause) {
              if (version === generation.current)
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not load worklogs.",
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          Load more worklogs
        </Button>
      )}
      {error && (
        <p role="alert" className="project-error">
          {error}{" "}
          <Button variant="ghost" onClick={() => void refresh()}>
            Retry worklogs
          </Button>
        </p>
      )}
    </section>
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
    [started, setStarted] = useState(
      localTime(entry?.startedAt ?? new Date().toISOString()),
    ),
    [durationInput, setDurationInput] = useState(
      entry ? humanWorklogDurationInput(entry.durationSeconds) : "",
    ),
    [description, setDescription] = useState(entry?.description ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="issue-editor worklog-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const date = new Date(started),
            duration =
              entry &&
              durationInput === humanWorklogDurationInput(entry.durationSeconds)
                ? entry.durationSeconds
                : parseHumanWorklogDuration(durationInput);
          if (
            !Number.isFinite(date.getTime()) ||
            !Number.isInteger(duration) ||
            duration < 1 ||
            duration > 2147483647
          )
            throw new Error(
              "Enter a valid start time and a positive duration.",
            );
          await onSave({
            workerUserId: worker,
            startedAt: date.toISOString(),
            durationSeconds: duration,
            description,
          });
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Could not save worklog.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <div className="issue-field-grid">
          <label>
            Worker
            <Select
              value={worker}
              onChange={(e) => setWorker(e.target.value)}
              required
            >
              {!members.some((m) => m.id === worker) && (
                <option value={worker}>
                  {entry?.workerName ?? "Current user"}
                </option>
              )}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Started at
            <Input
              type="datetime-local"
              required
              step="1"
              value={started}
              onChange={(e) => setStarted(e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        <label>
          Duration
          <Input
            required
            maxLength={100}
            value={durationInput}
            placeholder="1h 35m or 30"
            onChange={(e) => setDurationInput(e.target.value)}
          />
        </label>
        <p className="muted">
          One number = minutes; two = hours + minutes; three = days + hours +
          minutes. A day is 24 hours.
        </p>
        <label>
          Work description
          <Textarea
            rows={3}
            maxLength={10000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="project-error">
            {error}
          </p>
        )}
        <div className="comment-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : entry ? "Save worklog" : "Add worklog"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
