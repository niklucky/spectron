import { useState, type ReactNode } from "react";
import { useTheme } from "../../../hooks/use-theme";
import { Avatar } from "../../ui/avatar";
import { UserInfo } from "../../ui/avatar/user-info";
import { Button, IconButton } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Menu } from "../../ui/menu";
import { Pill, Badge, Chip } from "../../ui/pill";
import { Segmented } from "../../ui/segmented";
import { StatusDot, Spinner, ProgressLine } from "../../ui/status";
import { ProjectMark } from "../project/project-mark";
import { IssueRow, ListGroup } from "../../ui/list";
import { Breadcrumbs, EmptyState, PageTabs, PageToolbar, WidgetSlot } from "../../ui/page-shell";
import {
  DaySeparator,
  EventLine,
  MessageRow,
  MessageText,
  Mention,
  Command,
  ResultCard,
  ResultRequest,
  ResultState,
  ResultSummary,
  ResultFacts,
  Fact,
  ResultFooter,
  Disclosure,
  Tabs,
  LogBlock,
  CheckRow,
  PullCard,
  ReviewThread,
  LiveLine,
  ResultReason,
  Choices,
  Choice,
  ComposerShell,
  SendButton,
} from "../../ui/chat";
import { cn } from "../../ui/cn";

/* ---------- page scaffolding ---------- */

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-line py-10 last:border-0">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-[-0.015em]">{title}</h2>
        {lead && <p className="mt-1 max-w-[62ch] text-md text-ink-2">{lead}</p>}
      </div>
      {children}
    </section>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-6 py-3 hairline-t first:border-0">
      <div className="pt-1 text-sm text-ink-3">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
function Swatch({ name, token }: { name: string; token: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="size-9 rounded-lg hairline"
        style={{ background: `var(${token})` }}
      />
      <span className="leading-tight">
        <span className="block text-sm font-medium">{name}</span>
        <span className="mono block text-xs text-ink-3">{token}</span>
      </span>
    </div>
  );
}

const nav: { id: string; label: string }[] = [
  { id: "color", label: "Color" },
  { id: "type", label: "Typography" },
  { id: "avatars", label: "Avatars" },
  { id: "buttons", label: "Buttons" },
  { id: "labels", label: "Pills & chips" },
  { id: "controls", label: "Controls" },
  { id: "icons", label: "Icons" },
  { id: "page", label: "Page anatomy" },
  { id: "list", label: "Issue list" },
  { id: "messages", label: "Messages" },
  { id: "results", label: "Agent results" },
  { id: "pull", label: "Pull requests" },
  { id: "composer", label: "Composer" },
];

const people = {
  nikita: { name: "Nikita", role: "Owner" },
  marina: { name: "Marina Petrova", role: "Frontend" },
  ilya: { name: "Ilya Kuznetsov", role: "Backend" },
};
const agents = {
  dev: { name: "Dev senior", role: "Developer", kind: "agent" as const },
  reviewer: { name: "Reviewer", role: "Reviewer", kind: "agent" as const },
};
const project = { name: "Spectron", initial: "S", logo: null };

/* ---------- page ---------- */

export function DesignSystemPage() {
  const { theme, setTheme, palette, setPalette } = useTheme();
  const [view, setView] = useState<"simple" | "dev">("dev");
  const [seg, setSeg] = useState<"all" | "mine" | "unread">("all");
  const [tab, setTab] = useState<"checks" | "changes" | "activity">("checks");
  const [section, setSection] = useState<"overview" | "wiki" | "issues" | "board" | "gantt" | "settings">("issues");
  const iconNames: IconName[] = [
    "pulse", "inbox", "overview", "book", "board", "gantt", "widget", "command", "chats", "chat", "issues", "settings", "users", "plus", "search",
    "filter", "chevron", "chevron-right", "back", "arrow", "more", "paperclip", "mic", "play",
    "pause", "stop", "file", "files", "image", "download", "close", "check", "check-circle",
    "branch", "pr", "merge", "diff", "github", "gitlab", "jira", "link", "external", "sparkle",
    "at", "slash", "pin", "clock", "bug", "info", "alert", "edit", "trash", "refresh", "copy",
    "reply", "history", "sun", "moon", "user", "globe", "logout", "sidebar", "panel", "eye",
    "eye-off", "terminal", "hash", "volume",
  ];
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-4 px-6 glass hairline-b">
        <span className="flex items-center gap-2 text-base font-semibold">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 15 9 5M11 19l3-14M16 15l3-10"/></svg>
          spectron <span className="font-normal text-ink-3">/ design system</span>
        </span>
        <nav className="ml-4 hidden gap-1 whitespace-nowrap xl:flex">
          {nav.map((n) => (
            <a key={n.id} href={`#design/${n.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(n.id)?.scrollIntoView({ behavior: "smooth" }); }}
              className="rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Segmented label="Palette" size="sm" value={palette} onChange={setPalette}
            options={[{ value: "warm", label: "Warm" }, { value: "slate", label: "Slate" }]} />
          <Segmented label="Theme" size="sm" value={theme} onChange={setTheme}
            options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
          <a href="#flow" className="ml-2 text-sm text-accent-ink">Back to app</a>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-6 pb-24">
        <div className="pt-12 pb-4">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Components</h1>
          <p className="mt-2 max-w-[64ch] text-md text-ink-2">
            Every building block of the Flow screen on one page, rendered with the live tokens.
            Switch palette and theme above; toggle Simple and Developer in the conversation
            sections to see how technical detail is hidden.
          </p>
        </div>

        <Section id="color" title="Color" lead="Semantic tokens only. Components never reference raw hex values, so the warm and slate palettes and both themes come from the same markup.">
          <Row label="Grounds"><Swatch name="Background" token="--sp-bg" /><Swatch name="Surface" token="--sp-surface" /><Swatch name="Surface 2" token="--sp-surface-2" /><Swatch name="Surface 3" token="--sp-surface-3" /><Swatch name="Code" token="--sp-code" /></Row>
          <Row label="Ink"><Swatch name="Ink" token="--sp-ink" /><Swatch name="Ink 2" token="--sp-ink-2" /><Swatch name="Ink 3" token="--sp-ink-3" /><Swatch name="Line" token="--sp-line" /><Swatch name="Line 2" token="--sp-line-2" /></Row>
          <Row label="Accent"><Swatch name="Accent" token="--sp-accent" /><Swatch name="Accent ink" token="--sp-accent-ink" /><Swatch name="Accent soft" token="--sp-accent-soft" /><Swatch name="Accent soft 2" token="--sp-accent-soft-2" /><Swatch name="Own message" token="--sp-own" /></Row>
          <Row label="Semantic"><Swatch name="OK" token="--sp-ok" /><Swatch name="Warn" token="--sp-warn" /><Swatch name="Bad" token="--sp-bad" /><Swatch name="Merged" token="--sp-merged" /></Row>
          <Row label="Soft"><Swatch name="OK soft" token="--sp-ok-soft" /><Swatch name="Warn soft" token="--sp-warn-soft" /><Swatch name="Bad soft" token="--sp-bad-soft" /><Swatch name="Merged soft" token="--sp-merged-soft" /></Row>
          <Row label="Elevation">
            <div className="size-16 rounded-xl bg-surface hairline" />
            <div className="size-16 rounded-xl bg-surface shadow-soft hairline" />
            <div className="size-16 rounded-xl bg-surface shadow-pop hairline" />
            <span className="text-sm text-ink-3">hairline · soft · pop</span>
          </Row>
        </Section>

        <Section id="type" title="Typography" lead="Inter for everything people read. JetBrains Mono only for the technical layer: keys, branches, checks, logs. Seeing mono means detail.">
          <Row label="Sizes">
            <div className="flex flex-col gap-2">
              {([["2xl", "Agent runs: retries duplicate draft PRs", "text-2xl font-semibold tracking-[-0.02em]"], ["xl", "Section title", "text-xl font-semibold tracking-[-0.015em]"], ["lg", "Message text reads at this size", "text-lg"], ["md", "Agent summary text", "text-md"], ["base", "Interface text, buttons, list previews", "text-base"], ["sm", "Secondary labels and metadata", "text-sm text-ink-2"], ["xs", "Timestamps and counters", "text-xs text-ink-3"]] as const).map(([k, t, c]) => (
                <div key={k} className="flex items-baseline gap-4"><span className="mono w-8 text-xs text-ink-3">{k}</span><span className={c}>{t}</span></div>
              ))}
            </div>
          </Row>
          <Row label="Mono">
            <span className="mono text-sm">SPC-142 · spectron/SPC-142-idempotent-publish → main · 9f2c1e0</span>
          </Row>
          <Row label="Label caps"><span className="label-caps">Agents working</span><span className="label-caps">Participants</span></Row>
        </Section>

        <Section id="avatars" title="Avatars" lead="People are circles, agents are rounded squares with a small AI mark. The hue is derived from the name so it is stable everywhere. A working agent shows a spinning ring.">
          <Row label="People">{(["xs", "sm", "md", "lg", "xl"] as const).map((s) => <Avatar key={s} name={people.marina.name} size={s} />)}<Avatar name={people.ilya.name} size="lg" /><Avatar name={people.nikita.name} size="lg" /></Row>
          <Row label="Agents">{(["xs", "sm", "md", "lg", "xl"] as const).map((s) => <Avatar key={s} name={agents.dev.name} kind="agent" size={s} />)}<Avatar name={agents.reviewer.name} kind="agent" size="lg" working /><span className="text-sm text-ink-3">working</span></Row>
          <Row label="With name"><UserInfo name={people.marina.name} /><UserInfo name={agents.dev.name} kind="agent" /><UserInfo name={people.ilya.name} label="Assignee" size="md" /></Row>
          <Row label="Stack">
            <span className="flex items-center [&>*+*]:-ml-2 [&>*]:ring-2 [&>*]:ring-surface"><Avatar name="Nikita" size="sm" /><Avatar name="Ilya Kuznetsov" size="sm" /><Avatar name="Dev senior" kind="agent" size="sm" /><Avatar name="Reviewer" kind="agent" size="sm" /></span><span className="text-xs text-ink-3">+1</span>
          </Row>
        </Section>

        <Section id="buttons" title="Buttons" lead="Secondary is the default. Primary is reserved for the one action that moves work forward: Retry, Implement this plan, Send.">
          <Row label="Variants"><Button variant="primary">Retry</Button><Button variant="secondary">Implement this plan</Button><Button variant="ghost">Ask a question</Button><Button variant="danger">Close PR</Button></Row>
          <Row label="With icon"><Button variant="primary" icon="arrow">Send</Button><Button variant="secondary" icon="sparkle">Review with Reviewer</Button><Button variant="ghost" icon="stop">Stop</Button><Button variant="ghost" icon="reply">Reply</Button></Row>
          <Row label="Small"><Button variant="secondary" size="sm">Mark ready</Button><Button size="sm" variant="ghost" icon="check">Resolve</Button><Button size="sm" variant="ghost" icon="sparkle">Ask Dev senior to address</Button></Row>
          <Row label="Disabled"><Button variant="primary" disabled>Retry</Button><Button variant="secondary" disabled>Secondary</Button><Button variant="ghost" disabled>Ghost</Button></Row>
          <Row label="Icon buttons"><IconButton icon="search" label="Search" /><IconButton icon="panel" label="Issue details" active /><IconButton icon="more" label="More" /><IconButton icon="plus" label="New issue" className="bg-ink text-surface hover:bg-ink hover:text-surface" /><IconButton icon="close" label="Close" size="sm" /></Row>
        </Section>

        <Section id="labels" title="Pills, badges and chips" lead="Pills label state. Badges count. Chips are editable tokens above the composer.">
          <Row label="Pills"><Pill>Draft</Pill><Pill tone="ok">Open</Pill><Pill tone="merged">Merged</Pill><Pill tone="bad">Closed</Pill><Pill tone="warn">Needs input</Pill><Pill tone="accent">AI</Pill><Pill tone="ink">3 runs</Pill></Row>
          <Row label="Mono pills"><Pill mono>#218</Pill><Pill mono tone="ok">3 checks passed</Pill><Pill mono tone="warn">needs input</Pill></Row>
          <Row label="Badges"><Badge>3</Badge><Badge>12</Badge><Badge quiet>2</Badge></Row>
          <Row label="Chips"><Chip onRemove={() => {}}>Dev senior</Chip><Chip mono onRemove={() => {}}>/implement</Chip><Chip tone="neutral" mono><Icon name="branch" size={12} /> spectron-prototype · main</Chip></Row>
          <Row label="Inline"><span className="text-lg">Ask <Mention>Dev senior</Mention> to <Command>create-plan</Command> for this issue.</span></Row>
        </Section>

        <Section id="controls" title="Controls" lead="Status is color first, text on hover. Segmented controls switch between a few equal choices.">
          <Row label="Status">{([["opened", "To do"], ["started", "In progress"], ["review", "In review"], ["finished", "Done"], ["blocked", "Blocked"]] as const).map(([t, l]) => <span key={t} className="inline-flex items-center gap-1.5 text-sm"><StatusDot trigger={t} />{l}</span>)}<span className="inline-flex items-center gap-1.5 text-sm"><StatusDot trigger="started" color="#7c5cbf" />Custom color</span></Row>
          <Row label="Segmented"><Segmented label="Filter" value={seg} onChange={setSeg} options={[{ value: "all", label: "All" }, { value: "mine", label: "Mine" }, { value: "unread", label: "Unread" }]} /><Segmented label="View" size="sm" value={view} onChange={setView} options={[{ value: "simple", label: "Simple" }, { value: "dev", label: "Developer" }]} /></Row>
          <Row label="Progress"><Spinner /><Spinner size={16} /><div className="w-60"><ProgressLine /></div></Row>
          <Row label="Project marks"><ProjectMark project={project} size="xs" /><ProjectMark project={project} size="sm" /><ProjectMark project={project} size="md" /><ProjectMark project={project} size="lg" /><ProjectMark project={{ name: "Website", initial: "W", logo: null }} size="md" /><ProjectMark project={{ name: "Mobile app", initial: "M", logo: null }} size="md" /></Row>
          <Row label="Menu"><Menu label="Conversation actions" items={[{ label: "Refresh chat", icon: "refresh", onSelect: () => {} }, { label: "Files", icon: "files", onSelect: () => {} }, { label: "Log work", icon: "clock", onSelect: () => {} }, { label: "Delete issue", icon: "trash", danger: true, onSelect: () => {} }]} /><Menu label="Attach" icon="paperclip" items={[{ label: "Upload files", icon: "paperclip", hint: "⌘U", onSelect: () => {} }, { label: "Files from this issue", icon: "files", onSelect: () => {} }]} /></Row>
          <Row label="Fields">
            <input className="h-8 w-64 rounded-md bg-surface px-2.5 text-base text-ink hairline placeholder:text-ink-3 focus:border-line focus:outline-none" placeholder="Search issues" />
            <select className="h-8 rounded-md bg-surface px-2 text-base text-ink hairline focus:outline-none"><option>In progress</option><option>Done</option></select>
            <label className="inline-flex items-center gap-2 text-base"><input type="checkbox" defaultChecked className="accent-accent" />Include deleted</label>
          </Row>
        </Section>

        <Section id="icons" title="Icons" lead="Stroke icons at 1.75px, 16px default. Play and stop are filled so they read at small sizes.">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {iconNames.map((n) => (
              <div key={n} className="flex flex-col items-center gap-1.5 rounded-lg py-3 hover:bg-surface-2"><Icon name={n} size={18} /><span className="mono text-2xs text-ink-3">{n}</span></div>
            ))}
          </div>
        </Section>

        <Section id="page" title="Page anatomy" lead="Every full-width page shares one quiet frame: a 44px header row with breadcrumbs, section tabs and right-aligned actions; an optional toolbar for filters and display; then the body. No page titles in large type: the last breadcrumb is the title.">
          <div className="overflow-hidden rounded-xl bg-surface hairline">
            <header className="flex h-11 items-center gap-2 px-3 hairline-b">
              <Breadcrumbs items={[{ label: "Spectron", mark: <ProjectMark project={project} size="sm" />, onClick: () => {} }, { label: "Issues", icon: "issues" }]} />
              <div className="ml-2 hidden md:flex">
                <PageTabs label="Sections" value={section} onChange={setSection} tabs={[
                  { value: "overview", label: "Overview", icon: "overview" },
                  { value: "wiki", label: "Wiki", icon: "book" },
                  { value: "issues", label: "Issues", icon: "issues" },
                  { value: "board", label: "Board", icon: "board" },
                  { value: "gantt", label: "Gantt", icon: "gantt" },
                  { value: "settings", label: "Settings", icon: "settings" },
                ]} />
              </div>
              <div className="ml-auto flex items-center gap-1">
                <IconButton icon="search" label="Search" />
                <Button variant="primary" icon="plus">New issue</Button>
              </div>
            </header>
            <PageToolbar trailing={<span className="text-sm text-ink-3 tabular-nums">142</span>}>
              <Button variant="ghost" size="sm" icon="filter">Filter</Button>
              <Chip>Open</Chip>
              <Chip>Assigned to me</Chip>
            </PageToolbar>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <EmptyState icon="widget" title="Section is empty" description="Empty sections say what will live here and offer one action, nothing else." className="py-8" />
              <WidgetSlot disabled hint="Widgets are coming next" />
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-ink-2 sm:grid-cols-3">
            <div><b className="text-ink">Header.</b> Breadcrumbs (mark, project, section) on the left, tabs next, actions on the right: search, view options, one primary button.</div>
            <div><b className="text-ink">Toolbar.</b> Only when a page has filters or display options. Filter chips on the left, counts and sort on the right.</div>
            <div><b className="text-ink">Body.</b> Scrolls on its own. Dashboards use a widget grid, lists use a split with the conversation on the right.</div>
          </div>
        </Section>

        <Section id="list" title="Issue list" lead="Each row is a conversation: who started it and where, then the key line, the title, and who spoke last. Unread rows are bold.">
          <div className="max-w-[340px] rounded-xl bg-surface p-2 hairline">
            <ListGroup>Agents working</ListGroup>
            <IssueRow active unread={3} assignee={people.nikita} project={project} statusTrigger="started" issueKey="SPC-142" time="11:04" title="Agent runs: retries duplicate draft PRs when push times out" preview={<><Avatar name={agents.reviewer.name} kind="agent" size="sm" working /><span className="truncate"><b>Reviewer</b> is reviewing PR #218</span></>} />
            <IssueRow unread={1} assignee={people.marina} project={{ name: "Website", initial: "W", logo: null }} statusTrigger="started" issueKey="WEB-31" time="10:52" title="Pricing page: annual toggle resets on locale switch" preview={<><Avatar name={agents.dev.name} kind="agent" size="sm" /><span className="truncate"><b>Dev senior</b> <span className="font-medium text-warn">needs your input</span></span></>} />
            <ListGroup>Today</ListGroup>
            <IssueRow assignee={null} project={project} statusTrigger="review" issueKey="SPC-139" time="09:47" title="Jira sync: comments published twice after reconnect" preview={<><Avatar name={people.marina.name} size="sm" /><span className="truncate"><b>Marina:</b> Merged. Closing once the nightly passes.</span></>} />
            <IssueRow assignee={people.ilya} project={project} statusTrigger="finished" issueKey="SPC-133" time="Tue" title="Stop button leaves container running after cancel" preview={<><Avatar name={agents.dev.name} kind="agent" size="sm" /><span className="truncate"><b>Dev senior:</b> Fixed and merged in #209.</span></>} />
          </div>
        </Section>

        <div data-view={view} className="contents">
          <div className="sticky top-14 z-10 my-2 flex items-center justify-end gap-2 rounded-lg px-3 py-2 glass">
            <span className="text-sm text-ink-2">Conversation detail</span>
            <Segmented label="View" size="sm" value={view} onChange={setView} options={[{ value: "simple", label: "Simple" }, { value: "dev", label: "Developer" }]} />
          </div>

          <Section id="messages" title="Messages" lead="People and agents share one anatomy. Your own messages are inverted bubbles on the right. Quiet event lines record status changes.">
            <div className="max-w-[760px] rounded-xl bg-surface px-6 py-2 hairline">
              <DaySeparator>Yesterday</DaySeparator>
              <MessageRow author={people.nikita} time="17:20" actions={<><IconButton icon="reply" label="Reply" size="sm" /><IconButton icon="edit" label="Edit" size="sm" /><IconButton icon="more" label="More" size="sm" /></>}>
                <MessageText><p>When <code>git push</code> times out during <Command>implement</Command>, the retry creates a second draft PR from the same branch instead of updating the first one.</p><p>Expected: one PR per repository per run, retries update it.</p></MessageText>
              </MessageRow>
              <MessageRow author={people.marina} time="17:48"><MessageText><p>Reproduced. The second PR appears about 40 s after the first, both pointing at the same branch.</p></MessageText></MessageRow>
              <MessageRow author={people.marina} time="17:49" continued><MessageText><p>Screens attached to the issue.</p></MessageText></MessageRow>
              <MessageRow own author={people.nikita} time="17:56"><MessageText><p><Mention>Dev senior</Mention> <Command>create-plan</Command> Keep it small. One PR per repo per run, retries must be idempotent.</p></MessageText></MessageRow>
              <EventLine icon="check-circle"><b>Marina</b> moved the issue to In progress · 18:10</EventLine>
              <EventLine icon="pr" className="hidden dev:flex">Draft PR <a href="#">#218</a> opened on GitHub · 09:40</EventLine>
            </div>
          </Section>

          <Section id="results" title="Agent results" lead="A plain-language summary first. In Developer view the card grows a request line, fact chips, actions and Details tabs. In Simple view only the summary and human decisions remain.">
            <div className="flex max-w-[760px] flex-col gap-6 rounded-xl bg-surface px-6 py-4 hairline">
              <MessageRow author={{ ...agents.dev, role: "Developer" }} time="09:41">
                <ResultCard>
                  <ResultRequest command={<Command>implement</Command>} requester="Nikita" repo={<><Icon name="branch" size={12} /> spectron-prototype · main</>} state={<ResultState tone="done" icon="check">Done · 26 min</ResultState>} />
                  <ResultSummary><p>Implemented the plan and opened a draft PR. Retries now find the existing PR by branch, and each publish step is recorded on its own, so a late callback can't create a second PR.</p><p>Typecheck and the agent-run tests pass, including the new timeout-then-retry case.</p></ResultSummary>
                  <ResultFacts><Fact tone="ok" icon="check">3 checks passed</Fact><Fact tone="warn" icon="clock">1 skipped</Fact><Fact icon="diff"><span className="mono">+142 −37</span> in 4 files</Fact><Fact icon="branch">3 commits</Fact></ResultFacts>
                  <ResultFooter>
                    <Disclosure label="Details">
                      <Tabs value={tab} onChange={setTab} tabs={[{ value: "checks", label: "Checks" }, { value: "changes", label: "Changes" }, { value: "activity", label: "Activity · 48" }]} />
                      <div className="px-3.5 pt-3 pb-3.5">
                        {tab === "checks" && <div className="flex flex-col gap-1.5"><CheckRow outcome="passed" command="pnpm typecheck" duration="41 s" /><CheckRow outcome="passed" command="pnpm test:agent-runs" duration="1 m 08 s" /><CheckRow outcome="not_run" command="docker compose config --quiet" note="skipped on request" /></div>}
                        {tab === "changes" && <div className="flex flex-col gap-1.5"><CheckRow outcome="passed" command="packages/backend/src/agents/agent-publication.ts" duration="+74 −12" /><CheckRow outcome="passed" command="packages/db/migrations/0031_publication_key.sql" duration="+4 −0" /></div>}
                        {tab === "activity" && <LogBlock lines={[{ time: "09:15:02", text: "Container ready · node 24 · pnpm 9.15" }, { time: "09:24:10", text: <>Run <b>pnpm typecheck</b> · ok</> }, { time: "09:39:30", text: <>Push <b>spectron/SPC-142-idempotent-publish</b> · 3 commits</> }, { time: "09:40:12", text: <>Open draft PR <b>#218</b></> }]} />}
                      </div>
                    </Disclosure>
                    <span className="flex-1" />
                    <Button variant="ghost">Continue</Button>
                    <Button variant="secondary" icon="sparkle">Review with Reviewer</Button>
                  </ResultFooter>
                </ResultCard>
              </MessageRow>

              <MessageRow author={{ ...agents.reviewer, working: true }} time="11:02">
                <ResultCard>
                  <ResultRequest command={<Command>review-code</Command>} requester="Nikita" repo={<><Icon name="pr" size={12} /> #218 @ 9f2c1e0</>} state={<ResultState tone="working" spinning>Working</ResultState>} />
                  <LiveLine simple="Reviewing the pull request against the issue…" detail="Reading agent-publication.ts" elapsed="2:14" />
                  <ResultFooter>
                    <Disclosure label="Activity" count={9}><div className="p-3.5"><LogBlock lines={[{ time: "11:02:10", text: "Container ready · checkout PR #218 @ 9f2c1e0" }, { time: "11:03:40", text: <>Read <span className="path">agent-publication.ts</span></> }]} /></div></Disclosure>
                    <span className="flex-1" />
                    <Button variant="ghost" icon="stop">Stop</Button>
                    <Button variant="secondary">Send instructions</Button>
                  </ResultFooter>
                </ResultCard>
              </MessageRow>

              <MessageRow author={{ ...agents.dev, role: "Developer" }} time="10:40" state={<Pill tone="warn" className="simple:inline-flex dev:hidden"><Icon name="chat" size={11} />Needs your input</Pill>}>
                <ResultCard tone="needs">
                  <ResultRequest command={<Command>implement</Command>} requester="Nikita" state={<ResultState tone="needs" icon="chat">Needs input · waiting 22 min</ResultState>} />
                  <ResultSummary><p>Ilya suggests adding the target branch to the publication key. That is a schema change, so the migration in this PR would need to be rewritten and existing rows backfilled.</p><p>How do you want to handle it?</p></ResultSummary>
                  <Choices><Choice index={1}>Include it in this PR</Choice><Choice index={2}>Open a follow-up issue</Choice><Choice more>Reply with details…</Choice></Choices>
                  <ResultFooter><Disclosure label="Details"><div className="p-3.5 text-sm text-ink-2">Paused · waiting for input. Workspace kept.</div></Disclosure><span className="flex-1" /><span className="text-sm text-ink-3">Workspace kept · resumes when you answer</span></ResultFooter>
                </ResultCard>
              </MessageRow>

              <MessageRow author={{ ...agents.dev, role: "Developer" }} time="09:22" state={<Pill tone="bad" className="simple:inline-flex dev:hidden"><Icon name="close" size={11} />Failed</Pill>}>
                <ResultCard tone="failed">
                  <ResultRequest command={<Command>implement</Command>} requester="Nikita" state={<ResultState tone="failed" icon="close">Failed · 4 min</ResultState>} />
                  <ResultSummary><p>I couldn't finish. Installing dependencies failed three times because the container lost its network connection, so I stopped before touching any code.</p><p>Nothing was pushed and no PR was created. The plan is unchanged, so retrying is safe.</p></ResultSummary>
                  <ResultReason><code>pnpm install</code> exited with <code>ERR_PNPM_FETCH_502</code> after 3 attempts · container <code>run-7f2a</code> stopped</ResultReason>
                  <ResultFooter keep><Disclosure label="Details" panelClassName="hidden dev:block"><div className="p-3.5"><LogBlock lines={[{ time: "09:18:40", text: <>Run <b>pnpm install --frozen-lockfile</b> · fetch failed (502)</> }, { time: "09:22:01", text: "Stopped · no files changed · nothing pushed" }]} /></div></Disclosure><span className="flex-1" /><Button variant="ghost">Continue with instructions</Button><Button variant="primary">Retry</Button></ResultFooter>
                </ResultCard>
              </MessageRow>
            </div>
          </Section>

          <Section id="pull" title="Pull requests" lead="One card per repository. The footer carries checks, reviewers and the comments toggle; review threads expand beneath with Reply, Resolve and Ask agent to address.">
            <div className="max-w-[760px] rounded-xl bg-surface py-4 hairline">
              <PullCard title="Make implementation publication idempotent across retries" number={218} state="draft" branch="spectron/SPC-142-idempotent-publish" target="main" additions={142} deletions={37} url="#"
                actions={<Button variant="secondary" size="sm">Mark ready</Button>}
                footer={<><span className="inline-flex items-center gap-1.5 text-ok"><Icon name="check-circle" size={13} />Checks passing</span><span className="inline-flex items-center gap-1.5"><Avatar name={people.ilya.name} size="xs" />Ilya reviewing</span><Disclosure label="2 comments, 1 open" defaultOpen panelClassName="border-0 bg-transparent">
                  <ReviewThread author={people.ilya} time="on GitHub · 10:22" location="agent-publication.ts:88" actions={<><Button size="sm" variant="ghost" icon="reply">Reply</Button><Button size="sm" variant="ghost" icon="check">Resolve</Button><Button size="sm" variant="ghost" icon="sparkle">Ask Dev senior to address</Button></>}
                    replies={<div className="mt-2 grid grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-sm text-ink-2"><Avatar name="Nikita" size="xs" /><span><b className="font-semibold text-ink">You</b> <Pill tone="warn" className="mx-1.5 h-4 text-2xs">Draft</Pill> Good catch, one PR per target makes sense.</span></div>}>
                    <p>Should the publication key include the target branch? Two runs against different targets from the same branch would collide.</p>
                  </ReviewThread>
                  <ReviewThread author={people.ilya} time="on GitHub · 10:25" location="agent-runs.test.ts:212" resolved><p>Nit: the fake timeout could use <code>AbortSignal.timeout</code> instead of a manual timer.</p></ReviewThread>
                </Disclosure></>} />
              <PullCard title="Fix stop leaving container running" number={209} state="merged" branch="spectron/SPC-133-stop-container" target="main" additions={31} deletions={8} url="#" footer={<span className="inline-flex items-center gap-1.5 text-merged"><Icon name="merge" size={13} />Merged by Nikita · Tue</span>} />
            </div>
          </Section>

          <Section id="composer" title="Composer" lead="Mention, command and repository become chips above the text. The @ and / menus anchor to the caret in the product; here they are shown open.">
            <div className="max-w-[760px] rounded-xl bg-surface-2 p-6 hairline">
              <ComposerShell
                onSubmit={(e) => e.preventDefault()}
                pending={<div className="relative flex h-[46px] max-w-60 items-center gap-2 rounded-lg bg-surface-2 pr-3 pl-1.5 hairline"><span className="size-9 rounded-md bg-[linear-gradient(160deg,#EAF0F3,#B9CBD4)]" /><span className="min-w-0 leading-tight"><b className="block truncate text-sm font-semibold">retry-after-fix.png</b><span className="mono block text-xs text-ink-3">PNG · 840 KB · <span className="text-accent-ink">62%</span></span></span><button type="button" className="absolute -top-2 -right-2 grid size-[18px] place-items-center rounded-full bg-ink text-surface ring-2 ring-surface" aria-label="Remove"><Icon name="close" size={10} strokeWidth={2.5} /></button><span className="absolute inset-x-1.5 bottom-[3px] h-0.5 overflow-hidden rounded-full bg-surface-3"><span className="block h-full w-[62%] bg-accent" /></span></div>}
                chips={<><Chip onRemove={() => {}}>Dev senior</Chip><Chip mono onRemove={() => {}}>/implement</Chip><Chip tone="neutral" mono className="hidden dev:inline-flex"><Icon name="branch" size={12} />spectron-prototype · SPC-142</Chip></>}
                hint="answers Dev senior · continues PR #218"
                tools={<><IconButton icon="paperclip" label="Attach" className="text-ink-3" /><IconButton icon="at" label="Mention" className="text-ink-3" /><IconButton icon="slash" label="Command" className="text-ink-3" /><IconButton icon="mic" label="Record voice" className="text-ink-3" /><span className="ml-auto mr-1.5 text-xs text-ink-3"><kbd className="mono rounded-sm border border-line-soft bg-surface-2 px-1 text-2xs">↵</kbd> send · <kbd className="mono rounded-sm border border-line-soft bg-surface-2 px-1 text-2xs">⇧↵</kbd> newline</span><SendButton /></>}
              >
                <textarea rows={1} defaultValue="Address Ilya's comment: include the target branch in the publication key and update the test." className="block w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-lg text-ink outline-none placeholder:text-ink-3" placeholder="Message, @ to mention, / for a command" />
              </ComposerShell>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-surface p-1.5 shadow-pop hairline">
                  <div className="label-caps flex items-center justify-between px-2.5 pt-2 pb-1"><span>Mention</span><span className="mono rounded-sm bg-accent-soft px-1.5 text-xs font-medium normal-case text-accent-ink">@de</span></div>
                  {[agents.dev, agents.reviewer].map((a, i) => <button key={a.name} type="button" className={cn("grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2", i === 0 && "bg-surface-2")}><Avatar name={a.name} kind="agent" size="md" /><span className="min-w-0"><b className="block text-base font-semibold">{a.name}</b><span className="block text-sm text-ink-3">{a.role} · shared with project</span></span><span className="mono text-xs text-ink-3">@{a.name.split(" ")[0]!.toLowerCase()}</span></button>)}
                  <div className="label-caps px-2.5 pt-2 pb-1">People</div>
                  {[people.marina, people.ilya].map((p) => <button key={p.name} type="button" className="grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2"><Avatar name={p.name} size="md" /><span className="min-w-0"><b className="block text-base font-semibold">{p.name}</b><span className="block text-sm text-ink-3">{p.role}</span></span></button>)}
                </div>
                <div className="rounded-xl bg-surface p-1.5 shadow-pop hairline">
                  <div className="label-caps flex items-center justify-between px-2.5 pt-2 pb-1"><span>Command for Dev senior</span><span className="mono rounded-sm bg-accent-soft px-1.5 text-xs font-medium normal-case text-accent-ink">/</span></div>
                  {([["review-issue", "Find unclear requirements, missing cases, open questions", "chat", false], ["rewrite-issue", "Propose a better title, description and fields", "edit", false], ["create-plan", "Implementation plan and how to verify it", "files", false], ["implement", "Write the code, run checks, push a branch, open a draft PR", "pr", true], ["review-code", "Review the PR against the issue, findings stay as drafts", "check-circle", false]] as const).map(([c, d, ic, w], i) => (
                    <button key={c} type="button" className={cn("grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2", i === 0 && "bg-surface-2")}><span className="grid size-7 place-items-center rounded-md bg-surface-3 text-ink-2"><Icon name={ic} size={14} /></span><span className="min-w-0"><b className="mono block text-sm font-medium text-accent-ink">/{c}</b><span className="block text-sm text-ink-3">{d}</span></span><Pill tone={w ? "warn" : "neutral"}>{w ? "writes code" : "reads code"}</Pill></button>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}
