import { formatDateTime } from "../../../lib/date-format";
import { IssueHeaderTags } from "./issue-header-tags";
import { AttachmentGallery } from "./attachment-gallery";
import { ISSUE_TITLE_MAX_LENGTH, ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
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
import { Field, Input, Select, Textarea } from "../../ui/input";
import { Icon } from "../../ui/icon";
import { Segmented } from "../../ui/segmented";
import { Avatar } from "../../ui/avatar";
import { Pill } from "../../ui/pill";
import { cn } from "../../ui/cn";
import { statusColor } from "../../ui/status";
import { IssueFiles, type IssueFileActions } from "./issue-files";
import { IssueWorklogs, type WorklogActions } from "./issue-worklogs";
import { formatWorklogDuration } from "@spectron/shared";
import type { CommentActions } from "./issue-comments";
import { commentText, type CommentBody } from "@spectron/shared";

export type IssuePanelActions = {
  runs?: import('@spectron/shared').AgentRunActions;
  gitWorkflow?: import('@spectron/shared').GitWorkflowActions;
  canCreateTag?: (projectId: string) => boolean;
  createTag?: (projectId: string, name: string) => Promise<string>;
  canPublishTracker?: (projectId: string) => boolean;
  pushTracker?: (projectId: string, id: string) => Promise<void>;
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
  const [typeSaving, setTypeSaving] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [detail, setDetailState] = useState<"simple" | "dev">(() => {
    try {
      return localStorage.getItem("flow-view") === "dev" ? "dev" : "simple";
    } catch {
      return "simple";
    }
  });
  const setDetail = (value: "simple" | "dev") => {
    setDetailState(value);
    try {
      localStorage.setItem("flow-view", value);
    } catch {}
  };
  const [drawer, setDrawer] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("issue-drawer") === "open";
    } catch {
      return false;
    }
  });
  const toggleDrawer = (open: boolean) => {
    setDrawer(open);
    try {
      sessionStorage.setItem("issue-drawer", open ? "open" : "closed");
    } catch {}
  };
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  useEffect(() => { if (!keyCopied) return; const timer = window.setTimeout(() => setKeyCopied(false), 2000); return () => window.clearTimeout(timer); }, [keyCopied]);
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
  // Imported issues may point at an external identity; select the mapped
  // member when there is one, otherwise offer the identity itself as an option.
  const assigneeValue = (() => {
    const id = issue.assigneeId;
    if (!id || members.some((m) => m.id === id)) return id ?? "";
    const identity = (settings.externalIdentities ?? []).find((i) => i.id === id);
    return identity?.localUserId && members.some((m) => m.id === identity.localUserId)
      ? identity.localUserId
      : id;
  })();
  const assigneeOptions = (
    <>
      <option value="">Unassigned</option>
      {assigneeValue && !members.some((m) => m.id === assigneeValue) && (
        <option value={assigneeValue}>{person(assigneeValue)}</option>
      )}
      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </>
  );
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
  const fieldSelect =
    "h-6 max-w-full rounded-md bg-transparent px-1.5 text-sm font-medium text-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-60";
  const saveField = async (fields: Partial<IssueFields>, failure: string) => {
    setBusy(true);
    setError("");
    try {
      await actions.save(issue, fields);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const stateFill = state?.color ?? statusColor(state?.trigger ?? "opened");
  const menuItems = [
    { label: "Refresh chat", icon: "refresh" as const, onSelect: () => setReload((n) => n + 1) },
    { label: "Copy issue link", icon: "link" as const, onSelect: onCopy },
    ...(!issue.deletedAt
      ? [
          { label: "Files", icon: "files" as const, onSelect: () => setChatTool("files") },
          { label: "Log work", icon: "clock" as const, onSelect: () => setChatTool("worklog") },
          { label: "Edit issue", icon: "edit" as const, onSelect: () => { toggleDrawer(true); setEditing(true); } },
        ]
      : []),
    ...(!issue.deletedAt && actions.pushJira && actions.canPublish?.(issue.projectId)
      ? [{ label: issue.externalId ? "Sync to Jira" : "Create in Jira", icon: "jira" as const, onSelect: async () => {
          setBusy(true); setError(""); setJiraFeedback("");
          try { const result = await actions.pushJira!(issue.projectId, issue.id); setJiraFeedback(`Saved to Jira: ${result.key}`); }
          catch (e) { setError(e instanceof Error ? e.message : "Could not send to Jira."); toggleDrawer(true); }
          finally { setBusy(false); }
        } }]
      : []),
    ...(!issue.deletedAt && actions.pushTracker && actions.canPublishTracker?.(issue.projectId)
      ? [{ label: issue.trackerKey ? "Sync to Yandex Tracker" : "Create in Yandex Tracker", icon: "external" as const, onSelect: async () => {
          setBusy(true); setError(""); setJiraFeedback("");
          try { await actions.pushTracker!(issue.projectId, issue.id); setJiraFeedback("Saved to Yandex Tracker."); }
          catch (e) { setError(e instanceof Error ? e.message : "Could not send to Yandex Tracker."); toggleDrawer(true); }
          finally { setBusy(false); }
        } }]
      : []),
    { label: issue.deletedAt ? "Restore issue" : "Delete issue", icon: "trash" as const, danger: !issue.deletedAt, onSelect: async () => {
        setBusy(true); setError("");
        try { await actions.setDeleted(issue, !issue.deletedAt); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save issue."); }
        finally { setBusy(false); }
      } },
  ];
  const kv = "grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 text-sm";
  const dt = "text-ink-3";
  return (
    <AttachmentGallery projectId={issue.projectId} issueId={issue.id} actions={actions.files}>
    <main className="chat-column relative flex min-w-0 bg-surface" aria-label={`${issue.key} issue`}>
      <div className="relative flex min-w-0 flex-1 flex-col" data-view={detail}>
        <header className="absolute inset-x-0 top-0 z-10 flex min-h-14 items-center gap-2.5 py-2.5 pr-3.5 pl-5 glass">
          <span className="hidden max-[700px]:contents"><IconButton icon="back" label="Back to tasks" onClick={onBack} /></span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button type="button" className="mono shrink-0 text-xs text-ink-3 hover:text-ink" title={keyCopied ? "Copied!" : "Click to copy key"} aria-label={keyCopied ? "Issue key copied" : `Copy issue key ${issue.key}`} onClick={async () => {
              try { await navigator.clipboard.writeText(issue.key); setKeyCopied(true); }
              catch { setError("Could not copy issue key."); }
            }}>{keyCopied ? "Copied" : issue.key}</button>
            <span className="text-line-2">/</span>
            <h2 className="min-w-0 flex-1 text-base font-semibold tracking-[-0.012em]">
              {issue.deletedAt ? <span className="block truncate">{issue.title}</span> : <input className="w-full truncate bg-transparent text-ink outline-none placeholder:text-ink-3" aria-label="Issue title" value={titleDraft} maxLength={ISSUE_TITLE_MAX_LENGTH} disabled={titleSaving} onChange={e => setTitleDraft(e.target.value)} onKeyDown={e => {
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
              }} />}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="group/status relative flex h-[26px] cursor-pointer items-center gap-0 rounded-md px-1.5 transition-[padding,gap] hover:gap-1.5 hover:bg-surface hover:px-2 hover:hairline focus-within:gap-1.5 focus-within:bg-surface focus-within:px-2 focus-within:hairline" title={`Status: ${state?.name ?? "Unknown"}`}>
              <span aria-hidden="true" className="h-[11px] w-[22px] rounded-md transition-all group-hover/status:size-[7px] group-hover/status:rounded-full group-focus-within/status:size-[7px] group-focus-within/status:rounded-full" style={{ background: stateFill }} />
              <span className="hidden text-sm font-medium text-ink-2 group-hover/status:inline group-focus-within/status:inline">{state?.name}{state?.deletedAt ? " (deleted)" : ""}</span>
              <Icon name="chevron" size={12} className="hidden text-ink-3 group-hover/status:inline group-focus-within/status:inline" />
              <select aria-label="Status" className="absolute inset-0 cursor-pointer opacity-0" value={issue.stateId} disabled={!!issue.deletedAt || busy} onChange={(e) => void saveField({ stateId: e.target.value }, "Could not update status.")}>
                {settings.states.filter((s) => !s.deletedAt || s.id === issue.stateId).map((s) => <option key={s.id} value={s.id} disabled={!!s.deletedAt}>{s.name}</option>)}
              </select>
            </label>
            <label className="relative flex h-[26px] max-w-40 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hairline hover:bg-surface-2 max-[900px]:hidden" title={`Assignee: ${issue.assignee?.name ?? person(issue.assigneeId)}`}>
              {issue.assigneeId ? <Avatar name={issue.assignee?.name ?? person(issue.assigneeId)} image={issue.assignee?.image} size="xs" /> : <Icon name="user" size={13} className="text-ink-3" />}
              <span className="truncate">{issue.assigneeId ? (issue.assignee?.name ?? person(issue.assigneeId)).split(" ")[0] : "Unassigned"}</span>
              <select aria-label="Assignee" className="absolute inset-0 cursor-pointer opacity-0" value={assigneeValue} disabled={!!issue.deletedAt || busy} onChange={(e) => void saveField({ assigneeId: e.target.value || null }, "Could not update assignee.")}>
                {assigneeOptions}
              </select>
            </label>
            <span className="mx-1 h-[18px] w-px bg-line max-[900px]:hidden" />
            <Segmented label="Conversation detail" size="sm" value={detail} onChange={setDetail} options={[{ value: "simple", label: "Simple", title: "People and agent summaries" }, { value: "dev", label: "Developer", title: "Requests, checks, branches and logs" }]} />
            <IconButton icon="panel" label={drawer ? "Hide issue details" : "Show issue details"} active={drawer} onClick={() => toggleDrawer(!drawer)} />
            <Menu label="Issue actions" items={menuItems} align="end" />
          </div>
        </header>
        {(titleError || jiraFeedback || (error && !drawer)) && (
          <div className="absolute inset-x-0 top-14 z-10 flex justify-center px-5 pt-2">
            <p role={titleError || error ? "alert" : "status"} className={cn("rounded-lg px-3 py-1.5 text-sm shadow-soft hairline", titleError || error ? "bg-bad-soft text-bad" : "bg-surface text-ink-2")}>{titleError || error || jiraFeedback}</p>
          </div>
        )}
        <IssueChat
          issue={issue}
          settings={settings}
          issues={issues}
          members={members}
          actions={actions}
          active
          showHistory={detail === "dev"}
          tool={chatTool}
          setTool={setChatTool}
          revision={reload}
          onChange={() => { setReload((n) => n + 1); onActivityChange?.(); }}
          onSelect={onSelect}
          valueLabel={valueLabel}
        />
      </div>
      {drawer && (
        <aside className="flex w-[304px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface max-[980px]:absolute max-[980px]:inset-y-0 max-[980px]:right-0 max-[980px]:z-20 max-[980px]:shadow-pop" aria-label="Issue details">
          <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between py-2.5 pr-2.5 pl-4 glass">
            <h3 className="text-base font-semibold">Issue</h3>
            <div className="flex gap-0.5">
              {!issue.deletedAt && <IconButton icon="edit" label={editing ? "Stop editing" : "Edit issue"} active={editing} onClick={() => setEditing((v) => !v)} />}
              <IconButton icon="close" label="Close details" onClick={() => toggleDrawer(false)} />
            </div>
          </div>
          {issue.deletedAt && (
            <div className="mx-4 mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="status">
              Deleted {formatDateTime(issue.deletedAt)}. History is retained.
            </div>
          )}
          {editing && !issue.deletedAt ? (
            <div className="px-4 pb-4">
              <IssueEditor issue={issue} settings={settings} issues={issues} members={members} onSave={actions.save} onClose={() => setEditing(false)} />
            </div>
          ) : (
            <>
              <section className="px-4 pb-4">
                <dl className={kv}>
                  <dt className={dt}>Status</dt>
                  <dd className="min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <span className="size-[7px] shrink-0 rounded-full" style={{ background: stateFill }} />
                      <select aria-label="Status" className={fieldSelect} value={issue.stateId} disabled={!!issue.deletedAt || busy} onChange={(e) => void saveField({ stateId: e.target.value }, "Could not update status.")}>
                        {settings.states.filter((s) => !s.deletedAt || s.id === issue.stateId).map((s) => <option key={s.id} value={s.id} disabled={!!s.deletedAt}>{s.name}</option>)}
                      </select>
                    </span>
                  </dd>
                  <dt className={dt}>Assignee</dt>
                  <dd className="min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      {issue.assigneeId && <Avatar name={issue.assignee?.name ?? person(issue.assigneeId)} image={issue.assignee?.image} size="xs" />}
                      <select aria-label="Assignee" className={fieldSelect} value={assigneeValue} disabled={!!issue.deletedAt || busy} onChange={(e) => void saveField({ assigneeId: e.target.value || null }, "Could not update assignee.")}>
                        {assigneeOptions}
                      </select>
                    </span>
                  </dd>
                  <dt className={dt}>Type</dt>
                  <dd className="min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <span className="size-[7px] shrink-0 rounded-sm" style={{ background: typeColor }} />
                      <select aria-label="Issue type" className={fieldSelect} value={issue.issueTypeId ?? ""} disabled={!!issue.deletedAt || typeSaving} onChange={async event => {
                        const issueTypeId = event.target.value || null;
                        setTypeSaving(true); setError("");
                        try { await actions.save(issue, { issueTypeId }); }
                        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update issue type."); }
                        finally { setTypeSaving(false); }
                      }}>
                        <option value="">No type</option>
                        {(settings.issueTypes ?? []).filter(type => !type.deletedAt || type.id === issue.issueTypeId).map(type => <option key={type.id} value={type.id} disabled={!!type.deletedAt}>{type.name}</option>)}
                      </select>
                    </span>
                  </dd>
                  <dt className={dt}>Priority</dt>
                  <dd className="min-w-0">
                    <select aria-label="Priority" className={fieldSelect} value={issue.priorityId ?? ""} disabled={!!issue.deletedAt || busy} onChange={(e) => void saveField({ priorityId: e.target.value || null }, "Could not update priority.")}>
                      <option value="">No priority</option>
                      {settings.priorities.filter((p) => !p.deletedAt || p.id === issue.priorityId).map((p) => <option key={p.id} value={p.id} disabled={!!p.deletedAt}>{p.name}</option>)}
                    </select>
                  </dd>
                  <dt className={cn(dt, "self-start pt-1")}>Tags</dt>
                  <dd className="min-w-0">
                    <IssueHeaderTags key={issue.id} tags={settings.tags ?? []} selected={issue.tagIds ?? []} disabled={!!issue.deletedAt} onChange={tagIds => actions.save(issue, { tagIds })} onCreate={actions.createTag && actions.canCreateTag?.(issue.projectId) ? name => actions.createTag!(issue.projectId, name) : undefined} />
                  </dd>
                  <dt className={dt}>Author</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 text-ink-2"><Avatar name={issue.author?.name ?? person(issue.authorId)} image={issue.author?.image} size="xs" /><span className="truncate">{issue.author?.name ?? person(issue.authorId)}</span><span className="text-ink-3">· {formatDateTime(issue.createdAt)}</span></dd>
                  <dt className={dt}>Estimate</dt>
                  <dd className="text-ink-2">{issue.estimateTime == null ? "Not set" : formatWorklogDuration(issue.estimateTime)}</dd>
                  {(issue.startAt || issue.finishAt) && (<><dt className={dt}>Dates</dt><dd className="text-ink-2">{issue.startAt ? new Date(issue.startAt).toLocaleDateString(undefined, { timeZone: "UTC" }) : "…"} → {issue.finishAt ? new Date(issue.finishAt).toLocaleDateString(undefined, { timeZone: "UTC" }) : "…"}</dd></>)}
                  {(settings.fields ?? []).map((field) => (
                    <div key={field.id} className="contents">
                      <dt className={dt}>{field.name}</dt>
                      <dd className="truncate text-ink-2">{field.type === "user" ? person(String(issue.fieldValues?.[field.id] ?? "") || null) : String(issue.fieldValues?.[field.id] ?? "Not set")}</dd>
                    </div>
                  ))}
                  {parent && (<><dt className={dt}>Parent</dt><dd className="min-w-0"><button type="button" className="max-w-full truncate text-accent-ink hover:underline" onClick={() => onSelect(parent.id, parent.projectId)}><span className="mono text-xs">{parent.key}</span> {parent.title}</button></dd></>)}
                </dl>
              </section>
              <section className="px-4 py-4 hairline-t">
                <div className="label-caps mb-2.5 flex items-center justify-between">Description
                  {issue.description.length > 240 && <button type="button" className="text-xs font-medium normal-case tracking-normal text-ink-3 hover:text-ink" onClick={() => setDescriptionOpen((v) => !v)}>{descriptionOpen ? "Collapse" : "Expand"}</button>}
                </div>
                <div className={cn("prose-chat text-base text-ink-2", !descriptionOpen && "max-h-28 overflow-hidden [mask-image:linear-gradient(#000_60%,transparent)]")}>
                  <MessageMarkdown text={issue.description || "No description yet."} />
                </div>
              </section>
              {!!children.length && (
                <section className="px-4 py-4 hairline-t">
                  <div className="label-caps mb-2.5">Child issues <span className="normal-case tracking-normal">· {children.length}</span></div>
                  <ul className="flex flex-col gap-1">
                    {children.map((child) => (
                      <li key={child.id}><button type="button" className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-surface-2" onClick={() => onSelect(child.id, child.projectId)}><span className="mono text-xs text-ink-3">{child.key}</span><span className="truncate">{child.title}</span></button></li>
                    ))}
                  </ul>
                </section>
              )}
              {(issue.externalKey || issue.trackerKey) && (
                <section className="px-4 py-4 hairline-t">
                  <div className="label-caps mb-2.5">Synced</div>
                  {settings.jiraBaseUrl && issue.externalKey && (
                    <a className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2" href={`${settings.jiraBaseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(issue.externalKey)}`} target="_blank" rel="noreferrer">
                      <span className="grid size-[26px] place-items-center rounded-md bg-surface-3"><img src="/assets/integrations/jira.svg" alt="" className="size-4" /></span>
                      <span className="min-w-0 flex-1"><b className="block font-semibold">Jira · {issue.externalKey}</b></span>
                      <Icon name="external" size={13} className="text-ink-3" />
                    </a>
                  )}
                  {issue.trackerKey && (
                    <a className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2" href={`https://tracker.yandex.ru/${encodeURIComponent(issue.trackerKey)}`} target="_blank" rel="noreferrer">
                      <span className="grid size-[26px] place-items-center rounded-md bg-surface-3"><img src="/assets/integrations/yandex.svg" alt="" className="size-4" /></span>
                      <span className="min-w-0 flex-1"><b className="block font-semibold">Yandex Tracker · {issue.trackerKey}</b></span>
                      <Icon name="external" size={13} className="text-ink-3" />
                    </a>
                  )}
                </section>
              )}
              <section className="px-4 py-4 hairline-t">
                <div className="label-caps mb-2.5">Attachments</div>
                <IssueFiles refreshKey={reload} projectId={issue.projectId} issueId={issue.id} deleted={!!issue.deletedAt} actions={actions.files} onChange={() => { setReload((n) => n + 1); onActivityChange?.(); }} />
              </section>
              <section className="px-4 py-4 hairline-t">
                <div className="label-caps mb-2.5">Time</div>
                <IssueWorklogs refreshKey={reload} key={`worklogs:${issue.id}`} projectId={issue.projectId} issueId={issue.id} deleted={!!issue.deletedAt} members={members} actions={actions.worklogs} estimateSeconds={issue.estimateTime} onChange={() => { setReload((n) => n + 1); onActivityChange?.(); }} />
              </section>
              <section className="px-4 py-4 hairline-t">
                <div className="label-caps mb-2.5">History</div>
                {loading ? <p role="status" className="text-sm text-ink-3">Loading history…</p> : (
                  <ol className="flex flex-col gap-2.5 text-sm">
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <div className="text-ink-2"><b className="font-semibold text-ink">{entry.entityType === "issue" && entry.action === "created" ? (issue.author?.name ?? entry.actorName) : entry.actorName}</b> {entry.action} {entry.entityType === "worklog" ? "a worklog" : entry.entityType === "comment" ? "a comment" : entry.entityType === "attachment" ? "an attachment" : "this issue"} <time className="text-xs text-ink-3">{formatDateTime(entry.createdAt)}</time></div>
                        {entry.action === "created" && entry.entityType === "issue" ? (
                          <p className="text-ink-3">{valueLabel("title", entry.changes.title?.after)}</p>
                        ) : (
                          <dl className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs text-ink-3">
                            {Object.entries(entry.changes).filter(([field]) => !(entry.entityType === "comment" && field === "parentId")).map(([field, change]) => (
                              <div key={field} className="contents">
                                <dt>{field.startsWith("fieldValues.") ? (settings.fields?.find((f) => f.id === field.slice(12))?.name ?? "Custom field") : (labels[field] ?? field)}</dt>
                                <dd className="break-words"><span className="line-through">{valueLabel(field, change.before)}</span> → <span className="text-ink-2">{valueLabel(field, change.after)}</span></dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {more && !loading && (
                  <Button variant="ghost" size="sm" className="mt-2" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { const next = await actions.history(issue.projectId, issue.id, entries.length); setEntries((p) => [...p, ...next]); setMore(next.length === 100); }
                    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load history."); }
                    finally { setBusy(false); }
                  }}>Load more history</Button>
                )}
              </section>
            </>
          )}
          {error && (
            <p className="mx-4 mb-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
              {error}{" "}
              {error.includes("Jira changed since") && actions.pushJira && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try { const result = await actions.pushJira!(issue.projectId, issue.id, true); setError(""); setJiraFeedback(`Replaced Jira values: ${result.key}`); }
                  catch (e) { setError(e instanceof Error ? e.message : "Could not send to Jira."); }
                  finally { setBusy(false); }
                }}>Replace Jira values with local values</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setReload((n) => n + 1)}>Reload</Button>
            </p>
          )}
        </aside>
      )}
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
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await onSave(baseline.current, fields);
          onClose();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save issue.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-3 border-0 p-0">
        <Field label="Title">
          <Input required maxLength={ISSUE_TITLE_MAX_LENGTH} value={fields.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Description" hint="Markdown is supported.">
          <Textarea rows={8} maxLength={ISSUE_DESCRIPTION_MAX_LENGTH} value={fields.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <Select value={fields.stateId} onChange={(e) => set("stateId", e.target.value)}>
              {settings.states.filter((s) => !s.deletedAt || s.id === fields.stateId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.deletedAt ? " (deleted)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={fields.priorityId ?? ""} onChange={(e) => set("priorityId", e.target.value || null)}>
              <option value="">No priority</option>
              {settings.priorities.filter((s) => !s.deletedAt || s.id === fields.priorityId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.deletedAt ? " (deleted)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={fields.issueTypeId ?? ""} onChange={(event) => set("issueTypeId", event.target.value || null)}>
              <option value="">Not set</option>
              {(settings.issueTypes ?? []).filter((type) => !type.deletedAt || type.id === fields.issueTypeId).map((type) => <option key={type.id} value={type.id}>{type.name}{type.deletedAt ? " (deleted)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Assignee">
            <Select value={fields.assigneeId ?? ""} onChange={(e) => set("assigneeId", e.target.value || null)}>
              <option value="">Unassigned</option>
              {fields.assigneeId && !people.some((m) => m.id === fields.assigneeId) && <option value={fields.assigneeId}>Former member</option>}
              {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Estimate (minutes)">
            <Input type="number" min={0} step="any" value={fields.estimateTime == null ? "" : fields.estimateTime / 60} onChange={(e) => set("estimateTime", e.target.value === "" ? null : Math.round(Number(e.target.value) * 60))} />
          </Field>
          <Field label="Parent">
            <Select value={fields.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}>
              <option value="">No parent</option>
              {issues.filter((i) => i.projectId === issue.projectId && !i.deletedAt && !invalidParents.has(i.id)).map((i) => <option key={i.id} value={i.id}>{i.key} · {i.title}</option>)}
            </Select>
          </Field>
          <Field label="Start (UTC)">
            <Input type="datetime-local" step="1" value={fields.startAt?.slice(0, 19) ?? ""} onChange={(e) => set("startAt", e.target.value ? new Date(`${e.target.value}Z`).toISOString() : null)} />
          </Field>
          <Field label="Finish / deadline (UTC)">
            <Input type="datetime-local" step="1" min={fields.startAt?.slice(0, 19)} value={fields.finishAt?.slice(0, 19) ?? ""} onChange={(e) => set("finishAt", e.target.value ? new Date(`${e.target.value}Z`).toISOString() : null)} />
          </Field>
          {(settings.fields ?? []).map((field) => (
            <Field key={field.id} label={field.name}>
              {field.type === "user" ? (
                <Select value={String(fields.fieldValues?.[field.id] ?? "")} onChange={(e) => set("fieldValues", { ...fields.fieldValues, [field.id]: e.target.value || null })}>
                  <option value="">Not set</option>
                  {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              ) : (
                <Input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} value={fields.fieldValues?.[field.id] ?? ""} onChange={(e) => set("fieldValues", { ...fields.fieldValues, [field.id]: e.target.value === "" ? null : field.type === "number" ? Number(e.target.value) : e.target.value })} />
              )}
            </Field>
          ))}
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-ink-2">Tags</div>
          <div className="flex flex-wrap gap-1">
            {(settings.tags ?? []).filter((tag) => !tag.deletedAt || fields.tagIds?.includes(tag.id)).map((tag) => (
              <label key={tag.id} className={cn("inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", fields.tagIds?.includes(tag.id) ? "bg-accent-soft text-accent-ink" : "bg-surface-3 text-ink-2 hover:bg-surface-2")}>
                <input type="checkbox" className="sr-only" checked={fields.tagIds?.includes(tag.id) ?? false} onChange={(event) => set("tagIds", event.target.checked ? [...(fields.tagIds ?? []), tag.id] : (fields.tagIds ?? []).filter((id) => id !== tag.id))} />
                {tag.name}{tag.deletedAt ? " (deleted)" : ""}
              </label>
            ))}
            {!settings.tags?.length && <p className="text-sm text-ink-3">Create tags in Project settings → Tags.</p>}
          </div>
        </div>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <div className="flex justify-end gap-1.5 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !fields.title.trim()}>{busy ? "Saving…" : "Save issue"}</Button>
        </div>
      </fieldset>
    </form>
  );
}
