import { useEffect, useState, type ReactNode } from "react";
import type {
  CreateProjectInput,
  ProjectSummary,
  ProjectMemberSummary,
  InvitationSummary,
} from "@spectron/shared";
import { IntegrationLogo, IntegrationOverview, integrationName, type IntegrationSummary } from "./integration-overview";
import { Button } from "../../ui/button";
import { Avatar } from "../../ui/avatar";
import { Input } from "../../ui/input";
import { Pill } from "../../ui/pill";
import { Breadcrumbs } from "../../ui/page-shell";
import { Feedback, SettingsLayout, SettingsNav, SettingsSection, SettingsTitle } from "../../ui/settings";
import {
  ProjectIssueSettings,
  type IssueSettingsActions,
} from "./issue-settings";
import { ProjectForm } from "./project-form";
import { JiraSettings, type JiraActions } from "./jira-settings";
import { ProjectFields, type FieldActions } from "./project-fields";
import { formatDateTime } from "../../../lib/date-format";

export type ProjectSettingsActions = {
  jira: JiraActions;
  fields: FieldActions;
  issueSettings: IssueSettingsActions;
  update: (input: CreateProjectInput) => Promise<void>;
  members: () => Promise<ProjectMemberSummary[]>;
  invitations: () => Promise<InvitationSummary[]>;
  invite: (email: string) => Promise<InvitationSummary>;
  cancel: (id: string) => Promise<InvitationSummary>;
  discoverLogo: (url: string) => Promise<{ logo: string | null }>;
};

const tabs = ["general", "members", "states", "priorities", "types", "tags", "fields", "integrations"] as const;
type Tab = (typeof tabs)[number];
const titles: Record<Tab, { label: string; description: string }> = {
  general: { label: "General", description: "Name, issue prefix, website and logo." },
  members: { label: "Members", description: "Who works in this project, and who has been invited." },
  states: { label: "States", description: "The workflow an issue moves through." },
  priorities: { label: "Priorities", description: "How urgent an issue is." },
  types: { label: "Types", description: "Kinds of work: bugs, features, chores." },
  tags: { label: "Tags", description: "Free labels for grouping issues." },
  fields: { label: "Fields", description: "Custom fields on this project’s issues." },
  integrations: { label: "Integrations", description: "Services connected to this project, and what else is available." },
};
const providerDescriptions: Record<string, string> = {
  jira: "Connect a Jira project, map its people and fields, then import issues or export changes back.",
  yandex: "Connect a queue, map its values, then import issues or push local changes.",
  github: "Connect an account and choose the repositories this project’s agents may work in.",
  gitlab: "Connect your GitLab instance and choose the repositories this project’s agents may work in.",
};

export function ProjectSettingsPage({
  project,
  actions,
  onClose,
  onArchive,
  yandexSettings,
  gitSettings,
  externalBusy = false,
  loadIntegrations,
}: {
  loadIntegrations: () => Promise<IntegrationSummary[]>;
  /** Owner-only. Archives the project; the caller navigates away afterwards. */
  onArchive?: (() => Promise<void>) | undefined;
  yandexSettings?: ReactNode;
  gitSettings?: (provider: "github" | "gitlab") => ReactNode;
  externalBusy?: boolean;
  project: ProjectSummary;
  actions: ProjectSettingsActions;
  onClose?: (() => void) | undefined;
}) {
  const [provider, setProvider] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [busy, setBusy] = useState(false);
  // Archiving is tracked apart from a save, so neither can end the other's
  // lock: the form stays disabled while archiving, and navigation stays
  // locked until both are done.
  const [archiving, setArchiving] = useState(false);
  const [saved, setSaved] = useState(false);
  const locked = busy || archiving || externalBusy;
  const owner = project.role === "owner";
  return (
    <SettingsLayout
      nav={
        <SettingsNav
          label="Project settings sections"
          items={tabs.map((value) => ({ value, label: titles[value].label }))}
          value={tab}
          disabled={locked}
          onChange={(value) => { setTab(value); setProvider(null); }}
        />
      }
    >
      {tab === "integrations" && provider ? (
        <SettingsTitle
          title={
            <Breadcrumbs
              items={[
                { label: "Integrations", onClick: locked ? undefined : () => setProvider(null) },
                { label: integrationName(provider), mark: <IntegrationLogo provider={provider} size="sm" className="size-5" /> },
              ]}
            />
          }
          description={providerDescriptions[provider]}
        />
      ) : (
        <SettingsTitle
          leading={onClose && (
            <Button variant="ghost" size="sm" icon="back" className="-ml-2 w-fit" disabled={locked} onClick={onClose}>Back to project</Button>
          )}
          title={titles[tab].label}
          description={titles[tab].description}
        />
      )}
      {tab === "general" ? (
        <>
          {!owner && <p className="text-sm text-ink-2">Only the project owner can edit these settings.</p>}
          <ProjectForm
            initialValues={project}
            submitLabel="Save changes"
            readOnly={!owner || archiving}
            onBusyChange={setBusy}
            onCancel={onClose ?? (() => setTab("general"))}
            onDiscoverLogo={actions.discoverLogo}
            onSubmit={async (input) => {
              setSaved(false);
              await actions.update(input);
              setSaved(true);
            }}
          />
          {saved && <Feedback feedback="Changes saved." />}
          {owner && onArchive && (
            <ArchiveProject
              name={project.name}
              disabled={busy || externalBusy}
              onArchive={onArchive}
              onBusyChange={setArchiving}
            />
          )}
        </>
      ) : tab === "fields" ? (
        <ProjectFields actions={actions.fields} owner={owner} onBusyChange={setBusy} />
      ) : tab === "integrations" ? (
        provider ? (
          provider === "jira" ? (
            <JiraSettings actions={actions.jira} owner={owner} onBusyChange={setBusy} />
          ) : provider === "github" || provider === "gitlab" ? (
            gitSettings?.(provider)
          ) : (
            yandexSettings
          )
        ) : (
          <IntegrationOverview owner={owner} load={loadIntegrations} onSelect={setProvider} />
        )
      ) : tab === "members" ? (
        <ProjectMembers owner={owner} actions={actions} onBusyChange={setBusy} />
      ) : (
        <ProjectIssueSettings
          key={tab}
          projectId={project.id}
          owner={owner}
          kind={tab === "states" ? "state" : tab === "types" ? "type" : tab === "tags" ? "tag" : "priority"}
          actions={actions.issueSettings}
          onBusyChange={setBusy}
        />
      )}
    </SettingsLayout>
  );
}

function ArchiveProject({
  name,
  disabled,
  onArchive,
  onBusyChange,
}: {
  name: string;
  disabled: boolean;
  onArchive: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <SettingsSection
      title="Archive project"
      description={`${name} disappears from everyone’s sidebar and stops accepting changes. Issues and history are kept, but there is no way to restore it from the app yet.`}
    >
      <Feedback error={error} />
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="danger"
            disabled={busy || disabled}
            onClick={() => {
              setBusy(true);
              onBusyChange(true);
              setError("");
              onArchive().catch((cause) => {
                setError(cause instanceof Error ? cause.message : "Couldn’t archive the project.");
                setBusy(false);
                onBusyChange(false);
                setConfirming(false);
              });
            }}
          >
            {busy ? "Archiving…" : `Yes, archive ${name}`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button>
        </div>
      ) : (
        <div>
          <Button variant="secondary" disabled={disabled} onClick={() => setConfirming(true)}>Archive project…</Button>
        </div>
      )}
    </SettingsSection>
  );
}

function ProjectMembers({
  owner,
  actions,
  onBusyChange,
}: {
  owner: boolean;
  actions: ProjectSettingsActions;
  onBusyChange: (busy: boolean) => void;
}) {
  const [members, setMembers] = useState<ProjectMemberSummary[]>([]);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([actions.members(), owner ? actions.invitations() : Promise.resolve([])])
      .then(([people, invites]) => {
        if (active) {
          setMembers(people);
          setInvitations(invites);
        }
      })
      .catch(() => {
        if (active) setError("Couldn’t load members. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actions, owner, reload]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const refresh = () => {
      if (!busy) setReload((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [busy]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t complete this action.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {owner && (
        <SettingsSection title="Invite" description="They get an email with a link. Signing in with that address joins the project.">
          <form
            className="flex max-w-[520px] items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const invitation = await actions.invite(email.trim());
                setInvitations((previous) => [invitation, ...previous]);
                setEmail("");
                setFeedback("Invitation sent.");
              });
            }}
          >
            <Input
              aria-label="Invite by email"
              type="email"
              placeholder="name@company.com"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" variant="primary" disabled={busy || loading || !email.trim()}>
              {busy ? "Please wait…" : "Send invitation"}
            </Button>
          </form>
          <Feedback error={error} feedback={feedback} />
          {error && (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setReload((value) => value + 1)} disabled={busy}>Refresh</Button>
            </div>
          )}
        </SettingsSection>
      )}
      <SettingsSection title="People" description={loading ? undefined : `${members.length} ${members.length === 1 ? "member" : "members"}`}>
        {loading ? (
          <p className="text-sm text-ink-3" role="status">Loading members…</p>
        ) : (
          <ul className="overflow-hidden rounded-xl hairline">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-3 py-2.5 [&+&]:hairline-t">
                <Avatar name={member.name} size="md" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{member.name}</span>
                  <span className="truncate text-sm text-ink-2">{member.email}</span>
                </div>
                <Pill tone={member.role === "owner" ? "accent" : "neutral"}>{member.role === "owner" ? "Owner" : "Member"}</Pill>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      {owner && !loading && (
        <SettingsSection title="Invitations">
          {!invitations.length ? (
            <p className="text-sm text-ink-3">No invitations yet.</p>
          ) : (
            <ul className="overflow-hidden rounded-xl hairline">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center gap-3 px-3 py-2.5 [&+&]:hairline-t">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{invitation.email}</span>
                    <span className="truncate text-sm text-ink-2">
                      {invitation.status === "pending"
                        ? `Pending · expires ${formatDateTime(invitation.expiresAt)}`
                        : invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)}
                    </span>
                  </div>
                  {["pending", "sending"].includes(invitation.status) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Cancel invitation to ${invitation.email}`}
                      onClick={() =>
                        void run(async () => {
                          const result = await actions.cancel(invitation.id);
                          setInvitations((previous) => previous.map((item) => (item.id === result.id ? result : item)));
                          setFeedback("Invitation cancelled.");
                        })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      )}
    </>
  );
}
