import { IssueChat } from "./issue-chat";
import type { IssueActivityPage } from "@spectron/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  IssueFields,
  IssueHistoryEntry,
  IssueSettings,
  IssueSummary,
  ProjectMemberSummary,
} from "@spectron/shared";
import { Button, IconButton } from "../../ui/button";
import { Input, Select, Textarea } from "../../ui/input";
import { IssueFiles, type IssueFileActions } from "./issue-files";
import { IssueWorklogs, type WorklogActions } from "./issue-worklogs";
import { formatWorklogDuration } from "@spectron/shared";
import { IssueComments, type CommentActions } from "./issue-comments";
import { commentText, type CommentBody } from "@spectron/shared";
import { StatusDot } from "./status-dot";

export type IssuePanelActions = {
  activity: (input: {
    projectId: string;
    issueId: string;
    cursor?: string;
  }) => Promise<IssueActivityPage>;
  files: IssueFileActions;
  comments: CommentActions;
  worklogs: WorklogActions;
  members: (projectId: string) => Promise<ProjectMemberSummary[]>;
  history: (
    projectId: string,
    id: string,
    offset: number,
  ) => Promise<IssueHistoryEntry[]>;
  save: (issue: IssueSummary, fields: Partial<IssueFields>) => Promise<void>;
  setDeleted: (issue: IssueSummary, deleted: boolean) => Promise<void>;
};
export function IssuePanel({
  issue,
  customFields,
  settings,
  issues,
  actions,
  onBack,
  onCopy,
  onSelect,
}: {
  customFields?: ReactNode;
  issue: IssueSummary;
  settings: IssueSettings;
  issues: IssueSummary[];
  actions: IssuePanelActions;
  onBack: () => void;
  onCopy: () => void;
  onSelect: (id: string, projectId: string) => void;
}) {
  const [view, setView] = useState<"chat" | "issue">(() => {
    try {
      return sessionStorage.getItem("issue-view") === "issue"
        ? "issue"
        : "chat";
    } catch {
      return "chat";
    }
  });
  const selectView = (value: "chat" | "issue") => {
    setView(value);
    setReload((n) => n + 1);
    try {
      sessionStorage.setItem("issue-view", value);
    } catch {}
  };
  const [editing, setEditing] = useState(false);
  const [entries, setEntries] = useState<IssueHistoryEntry[]>([]);
  const [members, setMembers] = useState<ProjectMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [reload, setReload] = useState(0);
  const state = settings.states.find((s) => s.id === issue.stateId);
  const priority = settings.priorities.find((s) => s.id === issue.priorityId);
  const parent = issues.find((i) => i.id === issue.parentId);
  const children = issues.filter(
    (i) => i.parentId === issue.id && !i.deletedAt,
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      actions.members(issue.projectId),
      actions.history(issue.projectId, issue.id, 0),
    ])
      .then(([people, history]) => {
        if (active) {
          setMembers(people);
          setEntries(history);
          setMore(history.length === 100);
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load history.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [issue.id, issue.projectId, issue.updatedAt, actions, reload]);
  const person = (id: string | null) =>
    id
      ? (members.find((m) => m.id === id)?.name ?? "Former member")
      : "Unassigned";
  const valueLabel = (field: string, value: unknown): string => {
    if (value == null || value === "") return "None";
    if (field === "customFields" && typeof value === "object") {
      return (
        Object.entries(value)
          .map(([id, v]) => {
            const definition = settings.fields?.find((f) => f.id === id);
            const label = definition?.name ?? "Project field";
            return `${label}: ${v === null ? "None" : definition?.type === "user" ? person(String(v)) : String(v)}`;
          })
          .join(", ") || "None"
      );
    }
    if (field === "durationSeconds")
      return formatWorklogDuration(Number(value));
    if (field === "workerUserId" || field === "recordedBy")
      return person(String(value));
    if (field === "body" && Array.isArray(value))
      return commentText(value as CommentBody);
    if (field === "files" && Array.isArray(value))
      return value.map((f) => f.filename).join(", ") || "None";
    if (
      field === "attachment" &&
      typeof value === "object" &&
      "filename" in value
    )
      return String(value.filename);
    if (field === "stateId")
      return settings.states.find((s) => s.id === value)?.name ?? String(value);
    if (field === "priorityId")
      return (
        settings.priorities.find((s) => s.id === value)?.name ?? String(value)
      );
    if (field === "assigneeId" || field === "authorId")
      return person(String(value));
    if (field === "parentId")
      return issues.find((i) => i.id === value)?.key ?? String(value);
    if (field.endsWith("At")) return new Date(String(value)).toLocaleString();
    return typeof value === "string" ? value : JSON.stringify(value);
  };
  const labels: Record<string, string> = {
    customFields: "Project fields",
    externalId: "Tracker ID",
    externalKey: "Tracker key",
    workerUserId: "Worker",
    recordedBy: "Recorded by",
    startedAt: "Started at",
    durationSeconds: "Duration",
    body: "Comment",
    files: "Files",
    attachment: "File",
    title: "Title",
    description: "Description",
    stateId: "State",
    priorityId: "Priority",
    assigneeId: "Assignee",
    authorId: "Author",
    parentId: "Parent",
    deletedAt: "Deleted at",
  };
  return (
    <main className="chat-panel" aria-label={`${issue.key} issue`}>
      <header className="chat-header">
        <div className="chat-title-row">
          <IconButton
            icon="back"
            label="Back to tasks"
            className="mobile-back"
            onClick={onBack}
          />
          <span className="chat-task-id">{issue.key}</span>
          <span className="title-divider">/</span>
          <h2>{issue.title}</h2>
          <div className="chat-actions">
            <IconButton icon="link" label="Copy issue link" onClick={onCopy} />
            {!issue.deletedAt && (
              <Button
                variant="ghost"
                onClick={() => {
                  selectView("issue");
                  setEditing(true);
                }}
              >
                Edit issue
              </Button>
            )}
          </div>
        </div>
        <div
          className="issue-view-selector"
          role="group"
          aria-label="Issue view"
        >
          <button
            type="button"
            aria-pressed={view === "chat"}
            onClick={() => selectView("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            aria-pressed={view === "issue"}
            onClick={() => selectView("issue")}
          >
            Issue
          </button>
        </div>
        <div className="chat-subtitle">
          <StatusDot
            status={state?.trigger ?? "opened"}
            color={state?.color ?? null}
          />
          {state?.name}
          {state?.deletedAt ? " (deleted state)" : ""}
          <span className="metadata-divider" />
          {person(issue.assigneeId)}
        </div>
      </header>
      <IssueChat
        issue={issue}
        settings={settings}
        issues={issues}
        members={members}
        actions={actions}
        active={view === "chat"}
        revision={reload}
        onChange={() => setReload((n) => n + 1)}
        onSelect={onSelect}
        valueLabel={valueLabel}
      />
      <div className="issue-content" hidden={view === "chat"}>
        {issue.deletedAt && (
          <div className="issue-deleted" role="status">
            Deleted {new Date(issue.deletedAt).toLocaleString()}. History is
            retained.
          </div>
        )}
        {editing && !issue.deletedAt ? (
          <IssueEditor
            issue={issue}
            settings={settings}
            issues={issues}
            members={members}
            onSave={actions.save}
            onClose={() => setEditing(false)}
          />
        ) : (
          <>
            <dl className="issue-metadata">
              <div>
                <dt>Priority</dt>
                <dd>
                  {priority?.name ?? "No priority"}
                  {priority?.deletedAt ? " (deleted)" : ""}
                </dd>
              </div>
              <div>
                <dt>Author</dt>
                <dd>{person(issue.authorId)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(issue.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Parent</dt>
                <dd>
                  {parent ? (
                    <button
                      className="issue-text-link"
                      onClick={() => onSelect(parent.id, parent.projectId)}
                    >
                      {parent.key} · {parent.title}
                    </button>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
            </dl>
            {customFields}
            <section className="issue-description">
              <h3>Description</h3>
              <p>{issue.description || "No description yet."}</p>
            </section>
          </>
        )}
        {!!children.length && (
          <section>
            <h3>Child issues</h3>
            <ul className="issue-children">
              {children.map((child) => (
                <li key={child.id}>
                  <button
                    className="issue-text-link"
                    onClick={() => onSelect(child.id, child.projectId)}
                  >
                    {child.key} · {child.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <IssueFiles
          refreshKey={reload}
          projectId={issue.projectId}
          issueId={issue.id}
          deleted={!!issue.deletedAt}
          actions={actions.files}
          onChange={() => setReload((n) => n + 1)}
        />
        <IssueWorklogs
          refreshKey={reload}
          key={`worklogs:${issue.id}`}
          projectId={issue.projectId}
          issueId={issue.id}
          deleted={!!issue.deletedAt}
          members={members}
          actions={actions.worklogs}
          onChange={() => setReload((n) => n + 1)}
        />
        <IssueComments
          refreshKey={reload}
          key={issue.id}
          projectId={issue.projectId}
          issueId={issue.id}
          actions={actions.comments}
          files={actions.files}
          members={members}
          deleted={!!issue.deletedAt}
          onChange={() => setReload((n) => n + 1)}
        />
        <section className="issue-history">
          <h3>History</h3>
          {loading ? (
            <p role="status">Loading history…</p>
          ) : (
            <ol>
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.actorName}</strong> {entry.action}{" "}
                    {entry.entityType === "worklog"
                      ? "a worklog"
                      : entry.entityType === "comment"
                        ? "a comment"
                        : entry.entityType === "attachment"
                          ? "an attachment"
                          : "this issue"}{" "}
                    <time>{new Date(entry.createdAt).toLocaleString()}</time>
                  </div>
                  {entry.action === "created" &&
                  entry.entityType === "issue" ? (
                    <p>{valueLabel("title", entry.changes.title?.after)}</p>
                  ) : (
                    <dl>
                      {Object.entries(entry.changes)
                        .filter(
                          ([field]) =>
                            !(
                              entry.entityType === "comment" &&
                              field === "parentId"
                            ),
                        )
                        .map(([field, change]) => (
                          <div key={field}>
                            <dt>{labels[field] ?? field}</dt>
                            <dd>
                              <span>{valueLabel(field, change.before)}</span>
                              <span aria-label="changed to"> → </span>
                              <span>{valueLabel(field, change.after)}</span>
                            </dd>
                          </div>
                        ))}
                    </dl>
                  )}
                </li>
              ))}
            </ol>
          )}
          {more && !loading && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const next = await actions.history(
                    issue.projectId,
                    issue.id,
                    entries.length,
                  );
                  setEntries((p) => [...p, ...next]);
                  setMore(next.length === 100);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not load history.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load more history
            </Button>
          )}
        </section>
        {error && (
          <p className="project-error" role="alert">
            {error}{" "}
            <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
              Reload
            </Button>
          </p>
        )}
        {!editing && (
          <div className="issue-footer">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await actions.setDeleted(issue, !issue.deletedAt);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not save issue.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {issue.deletedAt ? "Restore issue" : "Delete issue"}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
function IssueEditor({
  issue,
  settings,
  issues,
  members,
  onSave,
  onClose,
}: {
  issue: IssueSummary;
  settings: IssueSettings;
  issues: IssueSummary[];
  members: ProjectMemberSummary[];
  onSave: IssuePanelActions["save"];
  onClose: () => void;
}) {
  const baseline = useRef(issue);
  const [fields, setFields] = useState<IssueFields>(() => ({
    title: issue.title,
    description: issue.description,
    stateId: issue.stateId,
    priorityId: issue.priorityId,
    parentId: issue.parentId,
    assigneeId: issue.assigneeId,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof IssueFields>(key: K, value: IssueFields[K]) =>
    setFields((p) => ({ ...p, [key]: value }));
  const invalidParents = new Set([issue.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of issues)
      if (
        candidate.parentId &&
        invalidParents.has(candidate.parentId) &&
        !invalidParents.has(candidate.id)
      ) {
        invalidParents.add(candidate.id);
        changed = true;
      }
  }
  return (
    <form
      className="issue-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await onSave(baseline.current, fields);
          onClose();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Could not save issue.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Title
          <Input
            required
            maxLength={140}
            value={fields.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label>
          Description
          <Textarea
            rows={6}
            maxLength={100000}
            value={fields.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <div className="issue-field-grid">
          <label>
            State
            <Select
              value={fields.stateId}
              onChange={(e) => set("stateId", e.target.value)}
            >
              {settings.states
                .filter((s) => !s.deletedAt || s.id === fields.stateId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.deletedAt ? " (deleted)" : ""}
                  </option>
                ))}
            </Select>
          </label>
          <label>
            Priority
            <Select
              value={fields.priorityId ?? ""}
              onChange={(e) => set("priorityId", e.target.value || null)}
            >
              <option value="">No priority</option>
              {settings.priorities
                .filter((s) => !s.deletedAt || s.id === fields.priorityId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.deletedAt ? " (deleted)" : ""}
                  </option>
                ))}
            </Select>
          </label>
          <label>
            Assignee
            <Select
              value={fields.assigneeId ?? ""}
              onChange={(e) => set("assigneeId", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {fields.assigneeId &&
                !members.some((m) => m.id === fields.assigneeId) && (
                  <option value={fields.assigneeId}>Former member</option>
                )}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Parent
            <Select
              value={fields.parentId ?? ""}
              onChange={(e) => set("parentId", e.target.value || null)}
            >
              <option value="">No parent</option>
              {issues
                .filter(
                  (i) =>
                    i.projectId === issue.projectId &&
                    !i.deletedAt &&
                    !invalidParents.has(i.id),
                )
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.key} · {i.title}
                  </option>
                ))}
            </Select>
          </label>
        </div>
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !fields.title.trim()}>
            {busy ? "Saving…" : "Save issue"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
