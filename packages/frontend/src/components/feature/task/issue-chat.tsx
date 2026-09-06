import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  IssueActivityEvent,
  IssueActivityPage,
  IssueSettings,
  IssueSummary,
  ProjectMemberSummary,
} from "@spectron/shared";
import { Avatar } from "../../ui/avatar";
import { Button } from "../../ui/button";
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
  revision: number;
  onChange: () => void;
  onSelect: (id: string, projectId: string) => void;
  valueLabel: (field: string, value: unknown) => string;
}) {
  const [events, setEvents] = useState<IssueActivityEvent[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [composing, setComposing] = useState(true),
    [composerKey, setComposerKey] = useState(0),
    [tool, setTool] = useState<"files" | "worklog" | null>(null);
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
  const state = settings.states.find((s) => s.id === issue.stateId),
    parent = issues.find((i) => i.id === issue.parentId),
    children = issues.filter((i) => i.parentId === issue.id && !i.deletedAt);
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
      <div className="issue-chat-toolbar">
        <span>Activity and conversation</span>
        <div>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh chat
          </Button>
          {!issue.deletedAt && (
            <>
              <Button
                variant="ghost"
                onClick={() => setTool(tool === "files" ? null : "files")}
              >
                Files
              </Button>
              <Button
                variant="ghost"
                onClick={() => setTool(tool === "worklog" ? null : "worklog")}
              >
                Log work
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="issue-chat-stream" ref={stream}>
        <article className="chat-summary-message">
          <h3>Issue summary · {issue.key}</h3>
          <strong>{issue.title}</strong>
          <p>{issue.description || "No description yet."}</p>
          <dl>
            <div>
              <dt>State</dt>
              <dd>{state?.name ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{valueLabel("priorityId", issue.priorityId)}</dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>{valueLabel("assigneeId", issue.assigneeId)}</dd>
            </div>
            <div>
              <dt>Author</dt>
              <dd>{valueLabel("authorId", issue.authorId)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(issue.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{new Date(issue.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
          {parent && (
            <p>
              Parent:{" "}
              <button
                className="issue-text-link"
                onClick={() => onSelect(parent.id, parent.projectId)}
              >
                {parent.key} · {parent.title}
              </button>
            </p>
          )}
          {!!children.length && (
            <div>
              Child issues:{" "}
              {children.map((child) => (
                <button
                  key={child.id}
                  className="issue-text-link"
                  onClick={() => onSelect(child.id, child.projectId)}
                >
                  {child.key} · {child.title}
                </button>
              ))}
            </div>
          )}
          {issue.deletedAt && (
            <p className="issue-deleted">
              Issue deleted {new Date(issue.deletedAt).toLocaleString()}.
              Activity is retained.
            </p>
          )}
        </article>
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
        {events.map((event) => {
          const e = event.entry;
          if (event.comment)
            return (
              <div
                key={e.id}
                className={`chat-message-row ${event.comment.authorId === actions.worklogs.currentUserId ? "chat-own-message" : ""}`}
              >
                <span
                  className="chat-message-avatar"
                  role="img"
                  aria-label={`${event.comment.authorName} avatar`}
                >
                  <Avatar
                    initials={
                      event.comment.authorName
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((name) => Array.from(name)[0] ?? "")
                        .join("")
                        .toUpperCase() || "?"
                    }
                    color={
                      ["sage", "sand", "lavender"][
                        Array.from(event.comment.authorId).reduce(
                          (sum, char) => sum + char.charCodeAt(0),
                          0,
                        ) % 3
                      ] ?? "sage"
                    }
                  />
                </span>
                <div className="chat-conversation-message">
                  {event.replyTo && (
                    <blockquote className="chat-reply-label">
                      Reply to {event.replyTo.authorName}:{" "}
                      {event.replyTo.text || "Attachment"}
                    </blockquote>
                  )}
                  <CommentItem
                    context={context}
                    row={event.comment}
                    depth={0}
                    flat
                  />
                </div>
              </div>
            );
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
                <strong>{e.actorName}</strong> {e.action} {entity}
                <time>{new Date(e.createdAt).toLocaleString()}</time>
              </header>
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
              {!!event.files.length && <CommentMedia files={event.files} />}
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
        <div className="chat-message-composer" hidden={!!tool}>
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
              onClose={() => setComposing(false)}
            />
          ) : (
            <Button onClick={() => setComposing(true)}>Write a message</Button>
          )}
        </div>
      )}
    </section>
  );
}
