import { AttachmentGallery } from "./attachment-gallery";
import { ISSUE_TITLE_MAX_LENGTH, ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
import { UserInfo } from "../../ui/avatar";
import { Menu } from "../../ui/menu";
import { MessageMarkdown } from "../../ui/message-markdown";
import { IssueChat } from "./issue-chat";
import type { IssueActivityPage } from "@spectron/shared";
import { useEffect, useRef, useState } from "react";
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
  canPublish?: (projectId: string) => boolean;
  pushJira?: (
    projectId: string,
    id: string,
    overwriteRemote?: boolean,
  ) => Promise<{ key: string }>;
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
  settings,
  issues,
  actions,
  onBack,
  onCopy,
  onSelect,
  onActivityChange,
}: {
  issue: IssueSummary;
  settings: IssueSettings;
  issues: IssueSummary[];
  actions: IssuePanelActions;
  onActivityChange?: () => void;
  onBack: () => void;
  onCopy: () => void;
  onSelect: (id: string, projectId: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const [titleError, setTitleError] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const titleCancelled = useRef(false);
  useEffect(() => setTitleDraft(issue.title), [issue.id, issue.title]);
  const issueType = settings.issueTypes?.find(type => type.id === issue.issueTypeId);
  const typeColor = issueType?.color ?? ({ epic: "#a855f7", story: "#22c55e", bug: "#ef4444", task: "#3b82f6" }[issueType?.name.toLowerCase() ?? ""] ?? "#64748b");
  const [keyCopied, setKeyCopied] = useState(false);
  const [view, setView] = useState<"chat" | "all" | "issue" | "files">(() => {
    try {
      const saved = sessionStorage.getItem("issue-view");
      return saved === "issue" || saved === "all" || saved === "files" ? saved : "chat";
    } catch {
      return "chat";
    }
  });
  useEffect(() => { if (!keyCopied) return; const timer = window.setTimeout(() => setKeyCopied(false), 2000); return () => window.clearTimeout(timer); }, [keyCopied]);
  const selectView = (value: "chat" | "all" | "issue" | "files") => {
    setView(value);
    setReload((n) => n + 1);
    try {
      sessionStorage.setItem("issue-view", value);
    } catch {}
  };
  const [chatTool, setChatTool] = useState<"files" | "worklog" | null>(null);
  const [jiraFeedback, setJiraFeedback] = useState("");
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
  const identityPeople = (settings.externalIdentities ?? []).map((i) => ({
    id: i.id,
    name: i.localUserId
      ? (members.find((m) => m.id === i.localUserId)?.name ?? i.displayName)
      : `${i.displayName} (Jira)`,
  }));
  const person = (id: string | null) =>
    id
      ? (members.find((m) => m.id === id)?.name ??
        identityPeople.find((i) => i.id === id)?.name ??
        "Former member")
      : "Unassigned";
  const valueLabel = (field: string, value: unknown): string => {
    if (value == null || value === "") return "None";
    if (field.startsWith("fieldValues.")) {
      const definition = settings.fields?.find((f) => f.id === field.slice(12));
      return definition?.type === "user"
        ? person(String(value))
        : String(value);
    }
    if (field === "estimateTime") return formatWorklogDuration(Number(value));
    if (field === "startAt" || field === "finishAt")
      return `${new Date(String(value)).toLocaleString(undefined, { timeZone: "UTC" })} UTC`;
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
    if (field === "issueTypeId") return settings.issueTypes?.find(type => type.id === value)?.name ?? String(value);
    if (field === "tagIds" && Array.isArray(value)) return value.map(id => settings.tags?.find(tag => tag.id === id)?.name ?? id).join(", ") || "None";
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
    workerUserId: "Worker",
    recordedBy: "Recorded by",
    startedAt: "Started at",
    estimateTime: "Estimate time",
    startAt: "Start at",
    finishAt: "Finish at",
    durationSeconds: "Duration",
    body: "Comment",
    files: "Files",
    attachment: "File",
    title: "Title",
    description: "Description",
    stateId: "State",
    priorityId: "Priority",
    issueTypeId: "Issue type",
    tagIds: "Tags",
    assigneeId: "Assignee",
    authorId: "Author",
    parentId: "Parent",
    deletedAt: "Deleted at",
  };
  return (
    <AttachmentGallery projectId={issue.projectId} issueId={issue.id} actions={actions.files}>
    <main className="chat-panel" aria-label={`${issue.key} issue`}>
      <header className="chat-header">
        <div className="chat-title-row">
          <IconButton
            icon="back"
            label="Back to tasks"
            className="mobile-back"
            onClick={onBack}
          />
          <span className="issue-type-badge" style={{ color: typeColor, background: `color-mix(in srgb, ${typeColor} 14%, transparent)`, borderColor: `color-mix(in srgb, ${typeColor} 35%, transparent)` }}>{settings.issueTypes?.find(type => type.id === issue.issueTypeId)?.name ?? "No type"}</span>
          <button type="button" className="chat-task-id issue-key-copy" title={keyCopied ? "Copied!" : "Click to copy key"} aria-label={keyCopied ? "Issue key copied" : `Copy issue key ${issue.key}`} onClick={async () => {
            try { await navigator.clipboard.writeText(issue.key); setKeyCopied(true); }
            catch { setError("Could not copy issue key."); }
          }}>{issue.key}</button>
          <span className="title-divider">/</span>
          <h2>{issue.deletedAt ? issue.title : <input className="issue-inline-title" aria-label="Issue title" value={titleDraft} maxLength={ISSUE_TITLE_MAX_LENGTH} disabled={titleSaving} onChange={e => setTitleDraft(e.target.value)} onKeyDown={e => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { titleCancelled.current = true; setTitleDraft(issue.title); e.currentTarget.blur(); }
          }} onBlur={async () => {
            if (titleCancelled.current) { titleCancelled.current = false; return; }
            const title = titleDraft.trim();
            if (!title) { setTitleDraft(issue.title); return; }
            if (title === issue.title || titleSaving) return;
            setTitleError("");
            setTitleSaving(true);
            try { await actions.save(issue, { title }); setTitleDraft(title); }
            catch (cause) { setTitleError(cause instanceof Error ? cause.message : "Could not save title."); setTitleDraft(issue.title); }
            finally { setTitleSaving(false); }
          }} />}</h2>
          <div
            className="issue-view-selector"
            role="group"
            aria-label="Issue view"
          >
            <IconButton
              icon="chat"
              label="Chat simple view"
              aria-pressed={view === "chat"}
              onClick={() => selectView("chat")}
            />
            <IconButton
              icon="chats"
              label="Chat all messages"
              aria-pressed={view === "all"}
              onClick={() => selectView("all")}
            />
            <IconButton
              icon="issues"
              label="Issue view"
              aria-pressed={view === "issue"}
              onClick={() => selectView("issue")}
            />
            <IconButton icon="paperclip" label="Files" aria-pressed={view === "files"} onClick={() => selectView("files")} />
          </div>
          <div className="chat-actions">
            {settings.jiraBaseUrl && issue.externalKey && (
              <a className="issue-integration-link"
                href={`${settings.jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(issue.externalKey)}`}
                target="_blank" rel="noreferrer" title={`Open ${issue.externalKey} in Jira`}>
                <img src="/assets/integrations/jira.svg" alt="Jira" />
                <span>{issue.externalKey}</span>
              </a>
            )}
            {!issue.deletedAt &&
              actions.pushJira &&
              actions.canPublish?.(issue.projectId) && (
                <IconButton
                  icon="check"
                  label={
                    issue.externalId ? "Sync issue to Jira" : "Create in Jira"
                  }
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setJiraFeedback("");
                    try {
                      const result = await actions.pushJira!(
                        issue.projectId,
                        issue.id,
                      );
                      setJiraFeedback(`Saved to Jira: ${result.key}`);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not send to Jira.",
                      );
                      selectView("issue");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            <IconButton icon="copy" label="Copy issue link" onClick={onCopy} />
            {!issue.deletedAt && (
              <IconButton
                icon="edit"
                label="Edit issue"
                onClick={() => {
                  selectView("issue");
                  setEditing(true);
                }}
              />
            )}
            <Menu
              label="Conversation actions"
              items={[
                {
                  label: "Refresh chat",
                  onSelect: () => setReload((n) => n + 1),
                },
                ...(!issue.deletedAt
                  ? [
                      {
                        label: "Files",
                        onSelect: () => {
                          if (view === "issue") selectView("chat");
                          setChatTool("files");
                        },
                      },
                      {
                        label: "Log work",
                        onSelect: () => {
                          if (view === "issue") selectView("chat");
                          setChatTool("worklog");
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
        <div className="chat-subtitle">
          <StatusDot
            status={state?.trigger ?? "opened"}
            color={state?.color ?? null}
          />
          {state?.name}
          {state?.deletedAt ? " (deleted state)" : ""}
          <span className="metadata-divider" />
          <UserInfo
            name={issue.assignee?.name ?? person(issue.assigneeId)}
            image={issue.assignee?.image}
            label="Assignee"
          />
        </div>
      </header>
      {titleError && <p role="alert" className="project-error">{titleError}</p>}
      {jiraFeedback && (
        <p role="status" className="project-feedback">
          {jiraFeedback}
        </p>
      )}
      <IssueChat
        issue={issue}
        settings={settings}
        issues={issues}
        members={members}
        actions={actions}
        active={view === "chat" || view === "all"}
        showHistory={view === "all"}
        tool={chatTool}
        setTool={setChatTool}
        revision={reload}
        onChange={() => {
          setReload((n) => n + 1);
          onActivityChange?.();
        }}
        onSelect={onSelect}
        valueLabel={valueLabel}
      />
      {view === "files" && <div className="issue-content">
        <IssueFiles projectId={issue.projectId} issueId={issue.id} deleted={!!issue.deletedAt} actions={actions.files} refreshKey={reload} onChange={() => { setReload((n) => n + 1); onActivityChange?.(); }} />
      </div>}
      <div className="issue-content" hidden={view !== "issue"}>
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
                <dt>Estimate time</dt>
                <dd>
                  {issue.estimateTime == null
                    ? "Not set"
                    : formatWorklogDuration(issue.estimateTime)}
                </dd>
              </div>
              <div>
                <dt>Start at</dt>
                <dd>
                  {issue.startAt
                    ? `${new Date(issue.startAt).toLocaleString(undefined, { timeZone: "UTC" })} UTC`
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Finish at / deadline</dt>
                <dd>
                  {issue.finishAt
                    ? `${new Date(issue.finishAt).toLocaleString(undefined, { timeZone: "UTC" })} UTC`
                    : "Not set"}
                </dd>
              </div>
              {issue.externalKey && (
                <div>
                  <dt>Jira issue</dt>
                  <dd>{issue.externalKey}</dd>
                </div>
              )}
              {(settings.fields ?? []).map((field) => (
                <div key={field.id}>
                  <dt>{field.name}</dt>
                  <dd>
                    {field.type === "user"
                      ? person(
                          String(issue.fieldValues?.[field.id] ?? "") || null,
                        )
                      : String(issue.fieldValues?.[field.id] ?? "Not set")}
                  </dd>
                </div>
              ))}
              <div><dt>Issue type</dt><dd>{settings.issueTypes?.find(type => type.id === issue.issueTypeId)?.name ?? "Not set"}</dd></div>
              <div><dt>Tags</dt><dd className="issue-tags">{issue.tagIds?.length ? issue.tagIds.map(id => <span className="issue-tag" key={id}>{settings.tags?.find(tag => tag.id === id)?.name ?? id}</span>) : "No tags"}</dd></div>
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
            <section className="issue-description">
              <h3>Description</h3>
              <MessageMarkdown
                text={issue.description || "No description yet."}
              />
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
          onChange={() => {
            setReload((n) => n + 1);
            onActivityChange?.();
          }}
        />
        <IssueWorklogs
          refreshKey={reload}
          key={`worklogs:${issue.id}`}
          projectId={issue.projectId}
          issueId={issue.id}
          deleted={!!issue.deletedAt}
          members={members}
          actions={actions.worklogs}
          onChange={() => {
            setReload((n) => n + 1);
            onActivityChange?.();
          }}
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
          onChange={() => {
            setReload((n) => n + 1);
            onActivityChange?.();
          }}
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
                            <dt>
                              {field.startsWith("fieldValues.")
                                ? (settings.fields?.find(
                                    (f) => f.id === field.slice(12),
                                  )?.name ?? "Custom field")
                                : (labels[field] ?? field)}
                            </dt>
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
            {error.includes("Jira changed since") && actions.pushJira && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await actions.pushJira!(
                      issue.projectId,
                      issue.id,
                      true,
                    );
                    setError("");
                    setJiraFeedback(`Replaced Jira values: ${result.key}`);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not send to Jira.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Replace Jira values with local values
              </Button>
            )}
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
    </AttachmentGallery>
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
  const people = [
    ...members,
    ...(settings.externalIdentities ?? []).map((i) => ({
      id: i.id,
      name: i.localUserId
        ? (members.find((m) => m.id === i.localUserId)?.name ?? i.displayName)
        : `${i.displayName} (Jira)`,
    })),
  ];
  const baseline = useRef(issue);
  const [fields, setFields] = useState<IssueFields>(() => ({
    estimateTime: issue.estimateTime ?? null,
    startAt: issue.startAt ?? null,
    finishAt: issue.finishAt ?? null,
    fieldValues: issue.fieldValues ?? {},
    title: issue.title,
    description: issue.description,
    stateId: issue.stateId,
    priorityId: issue.priorityId,
    issueTypeId: issue.issueTypeId ?? null,
    tagIds: issue.tagIds ?? [],
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
            maxLength={ISSUE_TITLE_MAX_LENGTH}
            value={fields.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label>
          Description
          <Textarea
            rows={6}
            maxLength={ISSUE_DESCRIPTION_MAX_LENGTH}
            value={fields.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <div className="issue-field-grid">
          <label>
            Estimate time (minutes)
            <Input
              type="number"
              min={0}
              step="any"
              value={
                fields.estimateTime == null ? "" : fields.estimateTime / 60
              }
              onChange={(e) =>
                set(
                  "estimateTime",
                  e.target.value === ""
                    ? null
                    : Math.round(Number(e.target.value) * 60),
                )
              }
            />
          </label>
          <label>
            Start at (UTC)
            <Input
              type="datetime-local"
              step="1"
              value={fields.startAt?.slice(0, 19) ?? ""}
              onChange={(e) =>
                set(
                  "startAt",
                  e.target.value
                    ? new Date(`${e.target.value}Z`).toISOString()
                    : null,
                )
              }
            />
          </label>
          <label>
            Finish at / deadline (UTC)
            <Input
              type="datetime-local"
              step="1"
              min={fields.startAt?.slice(0, 19)}
              value={fields.finishAt?.slice(0, 19) ?? ""}
              onChange={(e) =>
                set(
                  "finishAt",
                  e.target.value
                    ? new Date(`${e.target.value}Z`).toISOString()
                    : null,
                )
              }
            />
          </label>
          {(settings.fields ?? []).map((field) => (
            <label key={field.id}>
              {field.name}
              {field.type === "user" ? (
                <Select
                  value={String(fields.fieldValues?.[field.id] ?? "")}
                  onChange={(e) =>
                    set("fieldValues", {
                      ...fields.fieldValues,
                      [field.id]: e.target.value || null,
                    })
                  }
                >
                  <option value="">Not set</option>
                  {people.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={
                    field.type === "date"
                      ? "date"
                      : field.type === "number"
                        ? "number"
                        : "text"
                  }
                  step={field.type === "number" ? "any" : undefined}
                  value={fields.fieldValues?.[field.id] ?? ""}
                  onChange={(e) =>
                    set("fieldValues", {
                      ...fields.fieldValues,
                      [field.id]:
                        e.target.value === ""
                          ? null
                          : field.type === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
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
          <label>Issue type<Select value={fields.issueTypeId ?? ""} onChange={event => set("issueTypeId", event.target.value || null)}><option value="">Not set</option>{(settings.issueTypes ?? []).filter(type => !type.deletedAt || type.id === fields.issueTypeId).map(type => <option key={type.id} value={type.id}>{type.name}{type.deletedAt ? " (deleted)" : ""}</option>)}</Select></label>
          <fieldset className="issue-tag-picker"><legend>Tags</legend>{(settings.tags ?? []).filter(tag => !tag.deletedAt || fields.tagIds?.includes(tag.id)).map(tag => <label key={tag.id}><input type="checkbox" checked={fields.tagIds?.includes(tag.id) ?? false} onChange={event => set("tagIds", event.target.checked ? [...(fields.tagIds ?? []), tag.id] : (fields.tagIds ?? []).filter(id => id !== tag.id))} />{tag.name}{tag.deletedAt ? " (deleted)" : ""}</label>)}{!settings.tags?.length && <p className="muted">Create tags in Project settings → Tags.</p>}</fieldset>
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
                !people.some((m) => m.id === fields.assigneeId) && (
                  <option value={fields.assigneeId}>Former member</option>
                )}
              {people.map((m) => (
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
