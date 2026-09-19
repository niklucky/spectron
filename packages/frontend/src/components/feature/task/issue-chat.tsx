import { GitActivityCards } from "./git-activity";
import { AgentRunCard } from "./agent-run-card";
import { ChatComposer } from "./chat-composer";
import { agentRunPollDelay, type AgentRunView } from "@spectron/shared";
import { formatDateTime } from "../../../lib/date-format";
import { AttachmentMarkdown, nonInlineFiles } from "./issue-comments";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  IssueActivityEvent,
  IssueActivityPage,
  IssueAttachmentSummary,
  IssueSettings,
  IssueSummary,
  ProjectMemberSummary,
} from "@spectron/shared";
import { Button, IconButton } from "../../ui/button";
import { Icon } from "../../ui/icon";
import {
  CommentItem,
  CommentMedia,
  type CommentContext,
} from "./issue-comments";
import { WorklogEditor } from "./issue-worklogs";
import { IssueFiles } from "./issue-files";
import type { IssuePanelActions } from "./issue-panel";
import {
  DaySeparator,
  EventLine,
  MessageRow,
  MessageText,
} from "../../ui/chat";
import { cn } from "../../ui/cn";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(date)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString("en-US", { day: "numeric", month: "long", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function IssueChat({
  issue,
  settings,
  issues,
  members,
  actions,
  active,
  showHistory,
  tool,
  setTool,
  revision,
  onChange,
  onSelect,
  valueLabel,
}: {
  issue: IssueSummary;
  settings: IssueSettings;
  issues: IssueSummary[];
  members: ProjectMemberSummary[];
  actions: IssuePanelActions;
  active: boolean;
  showHistory: boolean;
  tool: "files" | "worklog" | null;
  setTool: (tool: "files" | "worklog" | null) => void;
  revision: number;
  onChange: () => void;
  onSelect: (id: string, projectId: string) => void;
  valueLabel: (field: string, value: unknown) => string;
}) {
  void issues;
  void onSelect;
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [runError, setRunError] = useState("");
  const [events, setEvents] = useState<IssueActivityEvent[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active || !actions.runs) return;
    let alive = true;
    let timer: number | undefined;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const rows = await actions.runs!.list({ projectId: issue.projectId, issueId: issue.id });
        if (alive) {
          setRuns(rows);
          setRunError("");
          const delay = agentRunPollDelay(rows);
          if (delay !== null) timer = window.setTimeout(() => void refresh(), delay);
        }
      } catch (e) {
        if (alive) {
          setRunError(e instanceof Error ? e.message : "Could not load agent runs.");
          timer = window.setTimeout(() => void refresh(), 30000);
        }
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const refocus = () => {
      window.clearTimeout(timer);
      void refresh();
    };
    window.addEventListener("focus", refocus);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refocus);
    };
  }, [active, actions.runs, issue.id, issue.projectId, revision, reload]);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<IssueAttachmentSummary[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setAttachments([]);
    setAttachmentError("");
    void actions.files.list(issue.projectId, issue.id).then(
      (files) => {
        if (alive) setAttachments(files);
      },
      (cause) => {
        if (alive) setAttachmentError(cause instanceof Error ? cause.message : "Could not load attachments.");
      },
    );
    return () => {
      alive = false;
    };
  }, [actions.files, issue.projectId, issue.id, issue.updatedAt, active, revision, reload]);
  const composer = useRef<HTMLDivElement>(null);
  const stream = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    pages = useRef(1),
    loaded = useRef(false),
    scroll = useRef<{ top: number; height: number } | "bottom" | null>("bottom");
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const version = ++generation.current;
    setLoading(true);
    setError("");
    const el = stream.current;
    if (!loaded.current || (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80)) scroll.current = "bottom";
    void (async () => {
      try {
        let next: string | null = null;
        let collected: IssueActivityEvent[] = [];
        for (let n = 0; n < pages.current; n++) {
          const page: IssueActivityPage = await actions.activity({ projectId: issue.projectId, issueId: issue.id, ...(next ? { cursor: next } : {}) });
          collected = [...page.events, ...collected];
          next = page.nextCursor;
          if (!next) break;
        }
        if (alive && version === generation.current) {
          setEvents(collected);
          setCursor(next);
          loaded.current = true;
        }
      } catch (cause) {
        if (alive && version === generation.current) setError(cause instanceof Error ? cause.message : "Could not load chat.");
      } finally {
        if (alive && version === generation.current) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      generation.current++;
    };
  }, [actions, issue.id, issue.projectId, issue.updatedAt, active, revision, reload]);
  useEffect(() => {
    if (!active || !events.some((e) => e.comment?.jiraSync === "pending" || e.comment?.jiraSync === "syncing")) return;
    const timer = window.setTimeout(() => setReload((n) => n + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [active, events]);
  useLayoutEffect(() => {
    const element = composer.current;
    const messages = stream.current;
    if (!element || !messages) return;
    const resize = () => {
      messages.style.setProperty("--composer-height", `${element.getBoundingClientRect().height}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      observer.disconnect();
      messages.style.removeProperty("--composer-height");
    };
  }, [active, tool, issue.deletedAt]);
  useLayoutEffect(() => {
    const el = stream.current;
    if (!el) return;
    if (scroll.current === "bottom") el.scrollTop = el.scrollHeight;
    else if (scroll.current) el.scrollTop = scroll.current.top + el.scrollHeight - scroll.current.height;
    scroll.current = null;
  }, [events, runs]);
  function changed() {
    scroll.current = "bottom";
    onChange();
  }
  const me = actions.worklogs.currentUserId;
  const context: CommentContext = {
    scope: { projectId: issue.projectId, issueId: issue.id },
    actions: actions.comments,
    files: actions.files,
    members,
    deleted: !!issue.deletedAt,
    revision,
    changed,
  };
  const descriptionFiles = attachments.filter((f) => f.inDescription);
  const closed =
    !!issue.deletedAt ||
    settings.states.some((s) => s.id === issue.stateId && ["finished", "cancelled"].includes(s.trigger));
  const timeline = [
    ...events.map((event) => ({ run: null as AgentRunView | null, event, file: null as IssueAttachmentSummary | null, date: event.comment?.createdAt ?? event.entry.createdAt })),
    ...attachments
      .filter((f) => !f.inDescription && !f.commentIds?.length)
      .map((file) => ({ run: null as AgentRunView | null, event: null, file, date: file.attachedAt ?? file.createdAt })),
    ...runs.map((run) => ({ run, event: null, file: null, date: run.createdAt })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const names: Record<string, string> = {
    key: "Issue", title: "Title", description: "Description", stateId: "State", priorityId: "Priority",
    assigneeId: "Assignee", authorId: "Author", workerUserId: "Worker", recordedBy: "Recorded by",
    durationSeconds: "Duration", startedAt: "Started at", deletedAt: "Deleted at", parentId: "Parent",
    attachment: "File", files: "Files", body: "Message",
  };
  let lastDay = "";
  let lastAuthor = "";
  const day = (iso: string) => {
    const label = dayLabel(iso);
    if (label === lastDay) return null;
    lastDay = label;
    lastAuthor = "";
    return <DaySeparator key={`day-${label}`}>{label}</DaySeparator>;
  };
  const authorName = issue.author?.name ?? valueLabel("authorId", issue.authorId);
  return (
    <section className="issue-chat relative flex min-h-0 min-w-0 flex-1 flex-col" hidden={!active} aria-label={`${issue.key} chat`}>
      <div className="min-h-0 flex-1 overflow-y-auto pt-16 pb-6" ref={stream}>
        <div className="mx-auto flex max-w-[820px] flex-col gap-0.5 px-7">
          {(issue.description.trim() || descriptionFiles.length > 0) && (
            <>
              {day(issue.createdAt)}
              <MessageRow
                author={{ name: authorName, image: issue.author?.image }}
                own={issue.authorId === me}
                time={timeOf(issue.createdAt)}
                timeTitle={formatDateTime(issue.createdAt)}
                state={<span className="inline-flex items-center gap-1 text-xs text-ink-3"><Icon name="pin" size={11} />Description</span>}
              >
                <MessageText>
                  {issue.description.trim() && <AttachmentMarkdown text={issue.description.trim()} files={descriptionFiles} />}
                  {descriptionFiles.length > 0 && <CommentMedia files={nonInlineFiles(issue.description, descriptionFiles)} />}
                </MessageText>
              </MessageRow>
            </>
          )}
          {attachmentError && <p role="alert" className="text-sm text-bad">{attachmentError}</p>}
          {cursor && (
            <div className="flex justify-center py-2">
              <Button variant="ghost" size="sm" disabled={loading} onClick={async () => {
                const version = generation.current;
                setLoading(true);
                setError("");
                try {
                  const page = await actions.activity({ projectId: issue.projectId, issueId: issue.id, cursor });
                  if (version === generation.current) {
                    const el = stream.current;
                    if (el) scroll.current = { top: el.scrollTop, height: el.scrollHeight };
                    pages.current++;
                    setEvents((old) => [...page.events, ...old]);
                    setCursor(page.nextCursor);
                  }
                } catch (cause) {
                  if (version === generation.current) setError(cause instanceof Error ? cause.message : "Could not load earlier activity.");
                } finally {
                  if (version === generation.current) setLoading(false);
                }
              }}>
                Load earlier activity
              </Button>
            </div>
          )}
          {actions.gitWorkflow && actions.runs && (
            <GitActivityCards
              scope={context.scope}
              actions={actions.gitWorkflow}
              agents={actions.runs}
              currentUserId={me}
              active={active}
              revision={revision + reload}
              closed={closed}
              changed={() => { setReload((n) => n + 1); changed(); }}
            />
          )}
          {runError && <p role="alert" className="text-sm text-bad">{runError}</p>}
          {timeline.map(({ event, file, run, date }) => {
            const separator = day(date);
            if (run && actions.runs) {
              lastAuthor = `run:${run.agent.id}`;
              return (
                <div key={run.id} className="contents">
                  {separator}
                  <AgentRunCard run={run} actions={actions.runs} closed={closed} changed={() => { setReload((n) => n + 1); changed(); }} />
                </div>
              );
            }
            if (file) {
              const uploader = valueLabel("authorId", file.uploadedBy);
              const continued = lastAuthor === uploader && !separator;
              lastAuthor = uploader;
              return (
                <div key={`file-${file.attachmentId}`} className="contents">
                  {separator}
                  <MessageRow author={{ name: uploader }} own={file.uploadedBy === me} continued={continued} time={timeOf(file.attachedAt ?? file.createdAt)} timeTitle={formatDateTime(file.attachedAt ?? file.createdAt)}>
                    <MessageText><CommentMedia files={[file]} /></MessageText>
                  </MessageRow>
                </div>
              );
            }
            if (!event) return null;
            const e = event.entry;
            if (event.comment) {
              const own = event.comment.authorId === me;
              const continued = lastAuthor === event.comment.authorId && !separator;
              lastAuthor = event.comment.authorId;
              return (
                <div key={e.id} className="contents">
                  {separator}
                  <MessageRow
                    author={{ name: event.comment.authorName }}
                    own={own}
                    continued={continued}
                    time={timeOf(event.comment.createdAt)}
                    timeTitle={formatDateTime(event.comment.createdAt)}
                  >
                    {event.replyTo && (
                      <blockquote className={cn("mb-1 max-w-[66ch] truncate rounded-r-md border-l-2 border-accent bg-accent-soft/60 px-2.5 py-1 text-sm text-ink-2", own && "self-end")}>
                        <b className="font-semibold text-ink">{event.replyTo.authorName}</b> {event.replyTo.text || "Attachment"}
                      </blockquote>
                    )}
                    <CommentItem
                      context={context}
                      row={event.comment}
                      extraFiles={attachments.filter((f) => !event.comment!.deletedAt && f.commentIds?.includes(event.comment!.id))}
                    />
                  </MessageRow>
                </div>
              );
            }
            if (!showHistory) return null;
            lastAuthor = "";
            const expanded = expandedHistory.has(e.id);
            const entity = e.entityType === "issue" ? "the issue" : e.entityType === "attachment" ? "an attachment" : e.entityType === "worklog" ? "a worklog" : "a message";
            const changes = Object.entries(e.changes).filter(([field, change]) =>
              !["id", "projectId", "number", "createdAt", "updatedAt"].includes(field) &&
              !(e.entityType === "comment" && field === "parentId") &&
              JSON.stringify(change.before) !== JSON.stringify(change.after));
            const headline = e.entityType === "worklog" && typeof e.changes.durationSeconds?.after === "number"
              ? `logged ${valueLabel("durationSeconds", e.changes.durationSeconds.after)}`
              : changes.length === 1 && e.action === "updated" && changes[0]![0] === "stateId"
                ? `moved the issue to ${valueLabel("stateId", changes[0]![1].after)}`
                : `${e.action} ${entity}`;
            return (
              <div key={e.id} className="contents">
                {separator}
                <EventLine icon={e.entityType === "worklog" ? "clock" : e.action === "deleted" ? "trash" : "check-circle"}>
                  <button type="button" className="inline-flex items-center gap-1.5 hover:text-ink" aria-expanded={expanded} onClick={() => setExpandedHistory((previous) => { const next = new Set(previous); if (next.has(e.id)) next.delete(e.id); else next.add(e.id); return next; })}>
                    <b>{e.actorName}</b> {headline} · {timeOf(e.createdAt)}
                    {changes.length > 0 && <Icon name="chevron" size={11} className={cn("transition-transform", expanded && "rotate-180")} />}
                  </button>
                </EventLine>
                {expanded && (
                  <div className="mx-auto mb-2 w-fit max-w-full rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      {changes.map(([field, change]) => (
                        <div key={field} className="contents">
                          <dt className="text-ink-3">{names[field] ?? field}</dt>
                          <dd className="break-words">
                            {e.action !== "created" && <><span className="text-ink-3 line-through">{valueLabel(field, change.before)}</span> → </>}
                            <span>{valueLabel(field, change.after)}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {!!event.files.length && <CommentMedia files={event.files} />}
                  </div>
                )}
              </div>
            );
          })}
          {loading && <p role="status" className="py-4 text-center text-sm text-ink-3">Loading chat…</p>}
          {error && (
            <p className="flex items-center justify-center gap-2 py-4 text-sm text-bad" role="alert">
              {error}
              <Button variant="ghost" size="sm" onClick={() => setReload((n) => n + 1)}>Retry</Button>
            </p>
          )}
        </div>
      </div>
      {tool && (
        <div className="max-h-[50%] overflow-y-auto bg-surface-2 px-7 py-4 hairline-t">
          <div className="mx-auto flex max-w-[764px] flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{tool === "files" ? "Files" : "Log work"}</h3>
              <IconButton icon="close" label={`Close ${tool === "files" ? "files" : "worklog"}`} onClick={() => setTool(null)} />
            </div>
            {tool === "files" ? (
              <IssueFiles projectId={issue.projectId} issueId={issue.id} deleted={!!issue.deletedAt} actions={actions.files} onChange={changed} />
            ) : (
              <WorklogEditor entry={null} members={members} currentUserId={me} onClose={() => setTool(null)} onSave={async (fields) => { await actions.worklogs.create({ projectId: issue.projectId, issueId: issue.id, ...fields }); setTool(null); changed(); }} />
            )}
          </div>
        </div>
      )}
      {!issue.deletedAt && (
        <div className="shrink-0 px-7 pb-4 [background:linear-gradient(transparent,var(--sp-surface)_30%)]" ref={composer} hidden={!!tool}>
          <ChatComposer context={context} agentActions={actions.runs} />
        </div>
      )}
    </section>
  );
}
