import { AgentRunCard } from "./agent-run-card";
import type { AgentRunView } from "@spectron/shared";
import { formatDateTime } from "../../../lib/date-format";
import { AttachmentMarkdown, nonInlineFiles } from "./issue-comments";
import { MessageMarkdown } from "../../ui/message-markdown";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  IssueActivityEvent,
  IssueActivityPage,
  IssueAttachmentSummary,
  IssueSettings,
  IssueSummary,
  ProjectMemberSummary,
} from "@spectron/shared";
import { UserInfo } from "../../ui/avatar";
import { Button, IconButton } from "../../ui/button";
import {
  CommentEditor,
  CommentItem,
  CommentMedia,
  type CommentContext,
} from "./issue-comments";
import { WorklogEditor } from "./issue-worklogs";
import { IssueFiles } from "./issue-files";
import type { IssuePanelActions } from "./issue-panel";
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
  const [runs, setRuns] = useState<AgentRunView[]>([]);
  const [runError, setRunError] = useState("");
  const [events, setEvents] = useState<IssueActivityEvent[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [composing, setComposing] = useState(true),
    [composerKey, setComposerKey] = useState(0);
  useEffect(() => {
    if (!active || !actions.runs) return;
    let alive = true;
    const refresh = async () => {
      try {
        const rows = await actions.runs!.list({
          projectId: issue.projectId,
          issueId: issue.id,
        });
        if (alive) {
          setRuns(rows);
          setRunError("");
        }
      } catch (e) {
        if (alive)
          setRunError(
            e instanceof Error ? e.message : "Could not load agent runs.",
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active, actions.runs, issue.id, issue.projectId, revision, reload]);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(
    new Set(),
  );
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
        if (alive)
          setAttachmentError(
            cause instanceof Error
              ? cause.message
              : "Could not load attachments.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, [
    actions.files,
    issue.projectId,
    issue.id,
    issue.updatedAt,
    active,
    revision,
    reload,
  ]);
  const composer = useRef<HTMLDivElement>(null);
  const stream = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    pages = useRef(1),
    loaded = useRef(false),
    scroll = useRef<{ top: number; height: number } | "bottom" | null>(
      "bottom",
    );
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const version = ++generation.current;
    setLoading(true);
    setError("");
    const el = stream.current;
    if (
      !loaded.current ||
      (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    )
      scroll.current = "bottom";
    void (async () => {
      try {
        let next: string | null = null;
        let collected: IssueActivityEvent[] = [];
        for (let n = 0; n < pages.current; n++) {
          const page: IssueActivityPage = await actions.activity({
            projectId: issue.projectId,
            issueId: issue.id,
            ...(next ? { cursor: next } : {}),
          });
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
        if (alive && version === generation.current)
          setError(
            cause instanceof Error ? cause.message : "Could not load chat.",
          );
      } finally {
        if (alive && version === generation.current) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      generation.current++;
    };
  }, [
    actions,
    issue.id,
    issue.projectId,
    issue.updatedAt,
    active,
    revision,
    reload,
  ]);
  useEffect(() => {
    if (
      !active ||
      !events.some(
        (e) =>
          e.comment?.jiraSync === "pending" ||
          e.comment?.jiraSync === "syncing",
      )
    )
      return;
    const timer = window.setTimeout(() => setReload((n) => n + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [active, events]);
  useLayoutEffect(() => {
    const element = composer.current;
    const messages = stream.current;
    if (!element || !messages) return;
    const resize = () => {
      messages.style.setProperty(
        "--composer-height",
        `${element.getBoundingClientRect().height}px`,
      );
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
    else if (scroll.current)
      el.scrollTop =
        scroll.current.top + el.scrollHeight - scroll.current.height;
    scroll.current = null;
  }, [events]);
  function changed() {
    scroll.current = "bottom";
    onChange();
  }
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
  const timeline = [
    ...events.map((event) => ({
      run: null as AgentRunView | null,
      event,
      file: null as IssueAttachmentSummary | null,
      date: event.comment?.createdAt ?? event.entry.createdAt,
    })),
    ...attachments
      .filter((f) => !f.inDescription && !f.commentIds?.length)
      .map((file) => ({
        run: null as AgentRunView | null,
        event: null,
        file,
        date: file.attachedAt ?? file.createdAt,
      })),
    ...runs.map((run) => ({
      run,
      event: null,
      file: null,
      date: run.createdAt,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const names: Record<string, string> = {
    key: "Issue",
    title: "Title",
    description: "Description",
    stateId: "State",
    priorityId: "Priority",
    assigneeId: "Assignee",
    authorId: "Author",
    workerUserId: "Worker",
    recordedBy: "Recorded by",
    durationSeconds: "Duration",
    startedAt: "Started at",
    deletedAt: "Deleted at",
    parentId: "Parent",
    attachment: "File",
    files: "Files",
    body: "Message",
  };
  return (
    <section
      className="issue-chat"
      hidden={!active}
      aria-label={`${issue.key} chat`}
    >
      <div className="issue-chat-stream" ref={stream}>
        {(issue.description.trim() || descriptionFiles.length > 0) && (
          <article
            className={`chat-message-row ${issue.authorId === actions.worklogs.currentUserId ? "chat-own-message" : ""}`}
          >
            <div className="chat-conversation-message initial-description">
              {issue.authorId !== actions.worklogs.currentUserId && (
                <UserInfo
                  name={
                    issue.author?.name ?? valueLabel("authorId", issue.authorId)
                  }
                  image={issue.author?.image}
                  label="Author"
                />
              )}
              {issue.description.trim() && (
                <AttachmentMarkdown
                  text={issue.description.trim()}
                  files={descriptionFiles}
                />
              )}
              {descriptionFiles.length > 0 && (
                <CommentMedia
                  files={nonInlineFiles(issue.description, descriptionFiles)}
                />
              )}
              <time dateTime={issue.createdAt}>
                {formatDateTime(issue.createdAt)}
              </time>
            </div>
          </article>
        )}
        {attachmentError && <p role="alert">{attachmentError}</p>}
        {cursor && (
          <Button
            variant="ghost"
            disabled={loading}
            onClick={async () => {
              const version = generation.current;
              setLoading(true);
              setError("");
              try {
                const page = await actions.activity({
                  projectId: issue.projectId,
                  issueId: issue.id,
                  cursor,
                });
                if (version === generation.current) {
                  const el = stream.current;
                  if (el)
                    scroll.current = {
                      top: el.scrollTop,
                      height: el.scrollHeight,
                    };
                  pages.current++;
                  setEvents((old) => [...page.events, ...old]);
                  setCursor(page.nextCursor);
                }
              } catch (cause) {
                if (version === generation.current)
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not load earlier activity.",
                  );
              } finally {
                if (version === generation.current) setLoading(false);
              }
            }}
          >
            Load earlier activity
          </Button>
        )}
        {runError && <p role="alert">{runError}</p>}
        {timeline.map(({ event, file, run }) => {
          if (run && actions.runs)
            return (
              <AgentRunCard
                key={run.id}
                run={run}
                actions={actions.runs}
                changed={() => {
                  setReload((n) => n + 1);
                  changed();
                }}
                closed={
                  !!issue.deletedAt ||
                  settings.states.some(
                    (s) =>
                      s.id === issue.stateId &&
                      ["finished", "cancelled"].includes(s.trigger),
                  )
                }
              />
            );
          if (file)
            return (
              <article
                className="chat-message-row"
                key={`file-${file.attachmentId}`}
              >
                <div className="chat-conversation-message initial-description">
                  <UserInfo name={valueLabel("authorId", file.uploadedBy)} />
                  <CommentMedia files={[file]} />
                  <time dateTime={file.attachedAt ?? file.createdAt}>
                    {formatDateTime(file.attachedAt ?? file.createdAt)}
                  </time>
                </div>
              </article>
            );
          if (!event) return null;
          const e = event.entry;
          if (event.comment)
            return (
              <div
                key={e.id}
                className={`chat-message-row ${event.comment.authorId === actions.worklogs.currentUserId ? "chat-own-message" : ""}`}
              >
                <div className="chat-conversation-message">
                  {event.replyTo && (
                    <blockquote className="chat-reply-label">
                      Reply to {event.replyTo.authorName}:{" "}
                      {event.replyTo.text || "Attachment"}
                    </blockquote>
                  )}
                  <CommentItem
                    context={context}
                    row={{
                      ...event.comment,
                      attachments: [
                        ...event.comment.attachments,
                        ...attachments.filter(
                          (f) =>
                            !event.comment!.deletedAt &&
                            f.commentIds?.includes(event.comment!.id) &&
                            !event.comment!.attachments.some(
                              (a) => a.projectFileId === f.projectFileId,
                            ),
                        ),
                      ],
                    }}
                    depth={0}
                    flat
                    hideAuthor={
                      event.comment.authorId === actions.worklogs.currentUserId
                    }
                  />
                </div>
              </div>
            );
          if (!showHistory) return null;
          const expanded = expandedHistory.has(e.id);
          const entity =
            e.entityType === "issue"
              ? "the issue"
              : e.entityType === "attachment"
                ? "an attachment"
                : e.entityType === "worklog"
                  ? "a worklog"
                  : "a message";
          return (
            <article key={e.id} className="chat-activity-message">
              <header>
                {e.actorUserId !== actions.worklogs.currentUserId && (
                  <UserInfo name={e.actorName} />
                )}
                <span>
                  {e.entityType === "worklog" &&
                  typeof e.changes.durationSeconds?.after === "number"
                    ? `logged ${valueLabel("durationSeconds", e.changes.durationSeconds.after)}`
                    : `${e.action} ${entity}`}
                </span>
                <time>{formatDateTime(e.createdAt)}</time>
                <IconButton
                  icon="history"
                  label={
                    expanded ? "Hide history details" : "Show history details"
                  }
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedHistory((previous) => {
                      const next = new Set(previous);
                      if (next.has(e.id)) next.delete(e.id);
                      else next.add(e.id);
                      return next;
                    })
                  }
                />
              </header>
              {expanded && (
                <dl>
                  {Object.entries(e.changes)
                    .filter(
                      ([field, change]) =>
                        ![
                          "id",
                          "projectId",
                          "number",
                          "createdAt",
                          "updatedAt",
                        ].includes(field) &&
                        !(e.entityType === "comment" && field === "parentId") &&
                        JSON.stringify(change.before) !==
                          JSON.stringify(change.after),
                    )
                    .map(([field, change]) => (
                      <div key={field}>
                        <dt>{names[field] ?? field}</dt>
                        <dd>
                          {e.action !== "created" && (
                            <>
                              <span>{valueLabel(field, change.before)}</span>
                              <span aria-label="changed to"> → </span>
                            </>
                          )}
                          <span>{valueLabel(field, change.after)}</span>
                        </dd>
                      </div>
                    ))}
                </dl>
              )}
              {expanded && !!event.files.length && (
                <CommentMedia files={event.files} />
              )}
            </article>
          );
        })}
        {loading && <p role="status">Loading chat…</p>}
        {error && (
          <p className="project-error" role="alert">
            {error}{" "}
            <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
              Retry chat
            </Button>
          </p>
        )}
      </div>
      {tool && (
        <div className="chat-tool-panel">
          <Button variant="ghost" onClick={() => setTool(null)}>
            Close {tool === "files" ? "files" : "worklog"}
          </Button>
          {tool === "files" ? (
            <IssueFiles
              projectId={issue.projectId}
              issueId={issue.id}
              deleted={!!issue.deletedAt}
              actions={actions.files}
              onChange={changed}
            />
          ) : (
            <WorklogEditor
              entry={null}
              members={members}
              currentUserId={actions.worklogs.currentUserId}
              onClose={() => setTool(null)}
              onSave={async (fields) => {
                await actions.worklogs.create({
                  projectId: issue.projectId,
                  issueId: issue.id,
                  ...fields,
                });
                setTool(null);
                changed();
              }}
            />
          )}
        </div>
      )}
      {!issue.deletedAt && (
        <div className="chat-message-composer" ref={composer} hidden={!!tool}>
          {composing ? (
            <CommentEditor
              key={composerKey}
              context={{
                ...context,
                changed: () => {
                  changed();
                  setComposerKey((n) => n + 1);
                },
              }}
              parentId={null}
              chat
              agentActions={actions.runs}
              onClose={() => {
                setComposing(true);
                setComposerKey((n) => n + 1);
              }}
            />
          ) : (
            <Button onClick={() => setComposing(true)}>Write a message</Button>
          )}
        </div>
      )}
    </section>
  );
}
