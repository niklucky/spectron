import { useEffect, useRef, useState } from "react";
import {
  agentCommands,
  commentBodyFromText,
  createId,
  moveMentionRanges,
  projectFileURL,
  type AgentCommand,
  type AgentIdentity,
  type AgentRunActions,
  type GitRepository,
  type ProjectFileSummary,
  type ProjectMemberSummary,
  type ReviewTarget,
} from "@spectron/shared";
import { MessageMarkdown } from "../../ui/message-markdown";
import { IconButton } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Menu } from "../../ui/menu";
import { Avatar } from "../../ui/avatar";
import { Chip, Pill } from "../../ui/pill";
import { ComposerShell, SendButton } from "../../ui/chat";
import { cn } from "../../ui/cn";
import { useDictation } from "./use-dictation";
import { AttachmentPreview, FilePicker } from "./issue-files";
import type { CommentContext } from "./issue-comments";

const commandInfo: Record<
  Exclude<AgentCommand, "discuss">,
  { description: string; icon: IconName; writes: boolean }
> = {
  "review-issue": { description: "Find unclear requirements, missing cases, open questions", icon: "chat", writes: false },
  "rewrite-issue": { description: "Propose a better title, description and fields", icon: "edit", writes: false },
  "create-plan": { description: "Implementation plan and how to verify it", icon: "files", writes: false },
  implement: { description: "Write the code, run checks, push a branch, open a draft PR", icon: "pr", writes: true },
  "review-code": { description: "Review a PR against the issue; findings stay as drafts", icon: "check-circle", writes: false },
};

const popoverClass =
  "absolute bottom-[calc(100%+8px)] left-3 z-20 w-[min(380px,calc(100%-24px))] rounded-xl bg-surface p-1.5 shadow-pop hairline";
const optionClass =
  "grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

/**
 * Conversation composer: text, mentions, agent commands, repositories,
 * attachments and dictation. Mirrors the comment editor's submit rules.
 */
export function ChatComposer({
  context,
  agentActions,
  parentId = null,
  onSent,
}: {
  context: CommentContext;
  agentActions?: AgentRunActions | undefined;
  parentId?: string | null;
  onSent?: () => void;
}) {
  const [agents, setAgents] = useState<AgentIdentity[]>([]),
    [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [agentId, setAgentId] = useState(""),
    [command, setCommand] = useState<AgentCommand>("discuss"),
    [repositoryIds, setRepositoryIds] = useState<string[]>([]);
  const [reviewBranch, setReviewBranch] = useState("");
  const [reviewTargets, setReviewTargets] = useState<ReviewTarget[]>([]);
  const [reviewWorkspaceId, setReviewWorkspaceId] = useState("");
  const [agentError, setAgentError] = useState("");
  const requestId = useRef(createId());
  useEffect(() => {
    if (!agentActions || command !== "review-code") return;
    let alive = true;
    void agentActions.reviewTargets(context.scope).then(
      (targets) => {
        if (!alive) return;
        setReviewTargets(targets);
        setReviewWorkspaceId((id) =>
          targets.some((t) => t.workspaceId === id) ? id : targets.length === 1 ? targets[0]!.workspaceId : "",
        );
      },
      (e) => {
        if (alive) setAgentError(e instanceof Error ? e.message : "Could not load PR/MRs.");
      },
    );
    return () => {
      alive = false;
    };
  }, [agentActions, command, context.scope.projectId, context.scope.issueId]);
  useEffect(() => {
    if (!agentActions) return;
    let alive = true;
    void Promise.all([
      agentActions.available(context.scope.projectId),
      agentActions.repositories(context.scope.projectId),
    ]).then(
      ([a, repos]) => {
        if (alive) {
          setAgents(a);
          setRepositories(repos);
          setRepositoryIds(repos.filter((r) => repos.length === 1 || r.isDefault).map((r) => r.id));
        }
      },
      (e) => {
        if (alive) setAgentError(e instanceof Error ? e.message : "Agent settings could not load.");
      },
    );
    return () => {
      alive = false;
    };
  }, [agentActions, context.scope.projectId]);

  const [draft, setDraft] = useState<{ text: string; mentions: ReturnType<typeof moveMentionRanges> }>({ text: "", mentions: [] }),
    [files, setFiles] = useState<ProjectFileSummary[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [picker, setPicker] = useState(false),
    [caret, setCaret] = useState(0),
    [dismissed, setDismissed] = useState(false),
    [preview, setPreview] = useState(false),
    [dragging, setDragging] = useState(false);
  const [language, setLanguage] = useState(() => (navigator.language.startsWith("ru") ? "ru-RU" : "en-US"));
  const voice = useDictation((text) =>
    setDraft((previous) => {
      const next = `${previous.text}${previous.text ? " " : ""}${text}`.slice(0, 100000);
      return { text: next, mentions: moveMentionRanges(previous.text, next, previous.mentions) };
    }),
  );
  const area = useRef<HTMLTextAreaElement>(null),
    upload = useRef<HTMLInputElement>(null),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft.text, preview]);

  const match = !dismissed ? /(?:^|\s)@([^@\s]*)$/.exec(draft.text.slice(0, caret)) : null;
  const people = match
    ? context.members.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(match[1]!.toLowerCase())).slice(0, 8)
    : [];
  const matchingAgents = match ? agents.filter((a) => a.name.toLowerCase().includes(match[1]!.toLowerCase())) : [];
  const slash = agentActions ? /(?:^|\s)\/([^\s]*)$/.exec(draft.text.slice(0, caret)) : null;
  const slashCommands = slash
    ? agentCommands.filter((c) => c !== "discuss" && c.startsWith(slash[1]!.toLowerCase()))
    : [];
  const agent = agents.find((a) => a.id === agentId);

  function setText(text: string, extra?: (m: typeof draft.mentions) => typeof draft.mentions) {
    setDraft((previous) => {
      const mentions = moveMentionRanges(previous.text, text, previous.mentions);
      return { text, mentions: extra ? extra(mentions) : mentions };
    });
  }
  function selectMention(person: ProjectMemberSummary) {
    if (!match) return;
    const start = caret - match[1]!.length - 1,
      token = `@${person.name}`,
      text = draft.text.slice(0, start) + token + " " + draft.text.slice(caret);
    setText(text, (mentions) => [
      ...mentions.filter((m) => m.end <= start || m.start >= start + token.length),
      { start, end: start + token.length, userId: person.id, label: person.name },
    ]);
    setDismissed(true);
    const end = start + token.length + 1;
    setCaret(end);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(end, end);
    });
  }
  function selectAgent(a: AgentIdentity) {
    setAgentId(a.id);
    if (match) {
      const start = caret - match[1]!.length - 1;
      setText(draft.text.slice(0, start) + draft.text.slice(caret));
      setCaret(start);
    }
    setDismissed(true);
    area.current?.focus();
  }
  function selectCommand(c: AgentCommand) {
    setCommand(c);
    if (slash) {
      const start = caret - slash[1]!.length - 1;
      setText(draft.text.slice(0, start) + draft.text.slice(caret));
      setCaret(start);
    }
    area.current?.focus();
  }
  function insertToken(token: string) {
    const el = area.current;
    const pos = el?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, pos);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const text = before + prefix + token + draft.text.slice(pos);
    setText(text);
    const next = pos + prefix.length + token.length;
    setCaret(next);
    setDismissed(false);
    setPreview(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next, next);
    });
  }
  async function uploadFiles(selected: File[]) {
    if (!selected.length || busy) return;
    setBusy(true);
    setError("");
    try {
      if (files.length + selected.length > 20) throw new Error("Attach up to 20 files per message.");
      const limits = await context.files.limits();
      for (const f of selected) {
        if (!active.current) break;
        if (!f.size || f.size > limits.maxBytes)
          throw new Error(`${f.name}: choose a non-empty file up to ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
        setStatus(`Uploading ${f.name}…`);
        const result = await context.files.upload(context.scope.projectId, f);
        if (active.current) setFiles((previous) => [...previous, result]);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      if (active.current) {
        setBusy(false);
        setStatus("");
      }
    }
  }
  const canSend = !!draft.text.trim() || !!files.length;
  const hint = agent
    ? command === "discuss"
      ? "discussion with code access"
      : command === "implement"
        ? "opens a draft PR per repository"
        : command === "review-code"
          ? reviewWorkspaceId
            ? "reviews the selected PR"
            : "reviews a branch"
          : "reads code"
    : command !== "discuss"
      ? "choose an agent to run this command"
      : undefined;

  return (
    <div className="relative">
      <ComposerShell
        className={cn(dragging && "outline-2 outline-dashed outline-accent outline-offset-4")}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            if (!busy) setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(false);
            void uploadFiles(Array.from(event.dataTransfer.files));
          }
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || voice.listening || !canSend) return;
          setBusy(true);
          setError("");
          try {
            if (agentActions && command !== "discuss" && !agentId) throw new Error("Select an agent for this command.");
            if (agentId && agentActions) {
              if (command === "review-code" && !reviewWorkspaceId && (!reviewBranch.trim() || repositoryIds.length !== 1))
                throw new Error("Select a linked PR/MR, or enter a branch and select exactly one repository.");
              if (command !== "review-code" && !repositoryIds.length) throw new Error("Select at least one project repository.");
              await agentActions.invoke({
                ...context.scope,
                requestId: requestId.current,
                agentId,
                command,
                repositoryIds:
                  command === "review-code" && reviewWorkspaceId
                    ? [reviewTargets.find((t) => t.workspaceId === reviewWorkspaceId)!.repositoryId]
                    : repositoryIds,
                ...(command === "review-code" ? (reviewWorkspaceId ? { reviewWorkspaceId } : { reviewBranch: reviewBranch.trim() }) : {}),
                message: draft.text,
                fileIds: files.map((f) => f.projectFileId),
              });
            } else
              await context.actions.create({
                ...context.scope,
                body: commentBodyFromText(draft.text, draft.mentions),
                files: files.map((f) => ({ projectId: f.projectId, projectFileId: f.projectFileId })),
                parentId,
              });
            if (active.current) {
              context.changed();
              setDraft({ text: "", mentions: [] });
              setFiles([]);
              setAgentId("");
              setCommand("discuss");
              setReviewBranch("");
              setReviewWorkspaceId("");
              setPreview(false);
              requestId.current = createId();
              onSent?.();
            }
          } catch (cause) {
            if (active.current) setError(cause instanceof Error ? cause.message : "Could not send message.");
          } finally {
            if (active.current) setBusy(false);
          }
        }}
        overlay={
          <>
            {match && (matchingAgents.length > 0 || people.length > 0 || match[1]!.length > 0) && (
              <div className={popoverClass} aria-label="Mention a person or agent" role="listbox">
                {matchingAgents.length > 0 && <div className="label-caps flex items-center justify-between px-2.5 pt-2 pb-1"><span>Agents</span><span className="mono rounded-sm bg-accent-soft px-1.5 text-xs font-medium normal-case text-accent-ink">@{match[1]}</span></div>}
                {matchingAgents.map((a) => (
                  <button type="button" key={a.id} role="option" className={cn(optionClass, "mention-option")} onClick={() => selectAgent(a)}>
                    <Avatar name={a.name} image={a.avatar} kind="agent" size="md" />
                    <span className="min-w-0"><b className="block truncate text-base font-semibold">{a.name}</b><span className="block truncate text-sm text-ink-3">{a.role} · runs only with a command</span></span>
                    <Pill tone="accent">AI</Pill>
                  </button>
                ))}
                {people.length > 0 && <div className="label-caps px-2.5 pt-2 pb-1">People</div>}
                {people.map((person) => (
                  <button type="button" key={person.id} role="option" className={cn(optionClass, "mention-option")} onClick={() => selectMention(person)}>
                    <Avatar name={person.name} size="md" />
                    <span className="min-w-0"><b className="block truncate text-base font-semibold">{person.name}</b><span className="block truncate text-sm text-ink-3">{person.email}</span></span>
                  </button>
                ))}
                {!matchingAgents.length && !people.length && <p className="px-2.5 py-2 text-sm text-ink-3">No matching people or agents.</p>}
              </div>
            )}
            {slash && !match && slashCommands.length > 0 && (
              <div className={cn(popoverClass, "w-[min(460px,calc(100%-24px))]")} aria-label="Agent commands" role="listbox">
                <div className="label-caps flex items-center justify-between px-2.5 pt-2 pb-1">
                  <span>{agent ? `Command for ${agent.name}` : "Command · pick an agent with @"}</span>
                  <span className="mono rounded-sm bg-accent-soft px-1.5 text-xs font-medium normal-case text-accent-ink">/{slash[1]}</span>
                </div>
                {slashCommands.map((c) => {
                  const info = commandInfo[c as Exclude<AgentCommand, "discuss">];
                  return (
                    <button type="button" key={c} role="option" className={cn(optionClass, "mention-option")} onClick={() => selectCommand(c)}>
                      <span className="grid size-7 place-items-center rounded-md bg-surface-3 text-ink-2"><Icon name={info.icon} size={14} /></span>
                      <span className="min-w-0"><b className="mono block text-sm font-medium text-accent-ink">/{c}</b><span className="block truncate text-sm text-ink-3">{info.description}</span></span>
                      <Pill tone={info.writes ? "warn" : "neutral"}>{info.writes ? "writes code" : "reads code"}</Pill>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        }
        pending={
          files.length ? (
            <>
              {files.map((f) => (
                <AttachmentPreview
                  key={f.id}
                  name={f.filename}
                  size={f.sizeBytes}
                  contentType={f.contentType}
                  src={projectFileURL(f.projectId, f.projectFileId)}
                  busy={busy}
                  onRemove={() => setFiles((previous) => previous.filter((item) => item.id !== f.id))}
                />
              ))}
            </>
          ) : undefined
        }
        chips={
          agentActions && (agent || command !== "discuss" || (agent && repositoryIds.length)) ? (
            <>
              {agent && <Chip onRemove={() => { setAgentId(""); setCommand("discuss"); }} removeLabel="Remove agent"><Avatar name={agent.name} image={agent.avatar} kind="agent" size="xs" className="mr-0.5 rounded-[30%]" />{agent.name}</Chip>}
              {command !== "discuss" && <Chip mono onRemove={() => setCommand("discuss")} removeLabel="Remove command">/{command}</Chip>}
              {agent && (command !== "review-code" || !reviewWorkspaceId) && repositories.filter((r) => repositoryIds.includes(r.id)).map((repo) => (
                <Chip key={repo.id} tone="neutral" mono onRemove={repositories.length > 1 ? () => setRepositoryIds((ids) => ids.filter((id) => id !== repo.id)) : undefined} removeLabel={`Remove ${repo.fullName}`}>
                  <Icon name="branch" size={12} />{repo.fullName}
                </Chip>
              ))}
              {agent && repositories.length > 1 && (command !== "review-code" || !reviewWorkspaceId) && (
                <Menu label="Repositories" icon="plus" className="size-6" items={repositories.map((repo) => ({ label: `${repositoryIds.includes(repo.id) ? "✓ " : ""}${repo.fullName}`, icon: "branch" as const, onSelect: () => setRepositoryIds((ids) => ids.includes(repo.id) ? ids.filter((id) => id !== repo.id) : [...ids, repo.id]) }))} />
              )}
            </>
          ) : undefined
        }
        hint={hint}
        tools={
          <>
            <Menu
              label="Attach"
              icon="paperclip"
              placement="top"
              className="text-ink-3"
              disabled={busy || files.length >= 20}
              items={[
                { label: "Upload files", icon: "paperclip", onSelect: () => upload.current?.click() },
                { label: "Files from this project", icon: "files", onSelect: () => setPicker(true) },
              ]}
            />
            {agentActions && <IconButton icon="at" label="Mention an agent or person" className="text-ink-3" disabled={busy} onClick={() => insertToken("@")} />}
            {agentActions && <IconButton icon="slash" label="Agent command" className="text-ink-3" disabled={busy} onClick={() => insertToken("/")} />}
            <IconButton icon={voice.listening ? "pause" : "mic"} label={voice.listening ? "Stop dictation" : "Dictate"} className={cn("text-ink-3", voice.listening && "bg-bad-soft text-bad")} aria-pressed={voice.listening} disabled={busy} onClick={() => { setPreview(false); voice.toggle(language); }} />
            {voice.listening && (
              <select className="h-6 rounded-sm bg-transparent text-xs text-ink-3" aria-label="Dictation language" value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en-US">EN</option>
                <option value="ru-RU">RU</option>
              </select>
            )}
            <button type="button" className={cn("ml-1 rounded-sm px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink", preview && "bg-surface-3 text-ink")} aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
              {preview ? "Edit" : "Preview"}
            </button>
            <span className="ml-auto mr-1.5 hidden text-xs text-ink-3 md:inline">
              <kbd className="mono rounded-sm border border-line-soft bg-surface-2 px-1 text-2xs">↵</kbd> send · <kbd className="mono rounded-sm border border-line-soft bg-surface-2 px-1 text-2xs">⇧↵</kbd> newline
            </span>
            <SendButton disabled={busy || voice.listening || !canSend} label={agent && command !== "discuss" ? `Run /${command}` : "Send"} />
          </>
        }
      >
        {preview ? (
          <div className="prose-chat max-h-60 overflow-y-auto px-3.5 pt-2.5 pb-1 text-lg" aria-label="Message preview">
            <MessageMarkdown text={draft.text || "Your message preview appears here."} />
          </div>
        ) : (
          <textarea
            ref={area}
            rows={1}
            autoFocus={parentId !== null}
            aria-label="Your message"
            maxLength={100000}
            disabled={busy || voice.listening}
            value={draft.text}
            placeholder={agent ? `Message ${agent.name}…` : "Message, @ to mention, / for a command"}
            className="block w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-lg text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
            onChange={(event) => {
              setText(event.target.value);
              setCaret(event.target.selectionStart);
              setDismissed(false);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !match && !(slash && slashCommands.length)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
              if (event.key === "Escape") setDismissed(true);
              if (event.key === "ArrowDown" && (people.length || matchingAgents.length || slashCommands.length)) {
                event.preventDefault();
                event.currentTarget.closest("form")?.querySelector<HTMLButtonElement>(".mention-option")?.focus();
              }
            }}
          />
        )}
        {agent && command === "review-code" && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-1 text-sm">
            <select className="h-7 max-w-full rounded-md bg-surface-2 px-2 text-sm text-ink hairline" aria-label="PR/MR to review" value={reviewWorkspaceId} disabled={busy} onChange={(e) => setReviewWorkspaceId(e.target.value)}>
              <option value="">{reviewTargets.length ? "Choose a PR/MR or review a branch" : "Review a branch"}</option>
              {reviewTargets.map((t) => <option key={t.workspaceId} value={t.workspaceId}>{t.repositoryName} #{t.pull.number} · {t.pull.sourceBranch} → {t.pull.targetBranch}</option>)}
            </select>
            {!reviewWorkspaceId && (
              <input className="mono h-7 min-w-0 flex-1 rounded-md bg-surface-2 px-2 text-xs text-ink hairline placeholder:text-ink-3" value={reviewBranch} onChange={(e) => setReviewBranch(e.target.value)} maxLength={255} disabled={busy} placeholder="source branch, e.g. feature/my-change" />
            )}
          </div>
        )}
        {voice.listening && <p role="status" className="px-3.5 pb-1 text-sm text-ink-2">{voice.interim || "Listening…"}</p>}
        {(voice.error || error || agentError) && <p role="alert" className="px-3.5 pb-1 text-sm text-bad">{voice.error || error || agentError}</p>}
        {status && <p role="status" className="px-3.5 pb-1 text-sm text-ink-3">{status}</p>}
        <input ref={upload} type="file" multiple hidden aria-label="Upload attachments" onChange={async (event) => { const selected = Array.from(event.target.files ?? []); event.target.value = ""; await uploadFiles(selected); }} />
      </ComposerShell>
      {picker && (
        <FilePicker
          projectId={context.scope.projectId}
          actions={context.files}
          onClose={() => setPicker(false)}
          onSelect={async (file) => {
            setFiles((previous) => (previous.some((f) => f.id === file.id) ? previous : [...previous, file]));
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
