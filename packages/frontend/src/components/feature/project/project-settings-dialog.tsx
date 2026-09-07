import { useEffect, useState, type ReactNode } from "react";
import type {
  CreateProjectInput,
  ProjectSummary,
  ProjectMemberSummary,
  InvitationSummary,
} from "@spectron/shared";
import { Dialog } from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
  ProjectIssueSettings,
  type IssueSettingsActions,
} from "./issue-settings";
import { ProjectForm } from "./project-form";

export type ProjectSettingsActions = {
  issueSettings: IssueSettingsActions;
  update: (input: CreateProjectInput) => Promise<void>;
  members: () => Promise<ProjectMemberSummary[]>;
  invitations: () => Promise<InvitationSummary[]>;
  invite: (email: string) => Promise<InvitationSummary>;
  cancel: (id: string) => Promise<InvitationSummary>;
  discoverLogo: (url: string) => Promise<{ logo: string | null }>;
};
export function ProjectSettingsDialog({
  project,
  actions,
  onClose,
  extraSections,
  externalBusy = false,
}: {
  externalBusy?: boolean;
  extraSections?: { fields: ReactNode; integrations: ReactNode };
  project: ProjectSummary;
  actions: ProjectSettingsActions;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("general");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <Dialog
      title={`${project.name} settings`}
      className="project-settings-dialog"
      onClose={() => {
        if (!busy && !externalBusy) onClose();
      }}
    >
      <div className="project-settings-layout">
        <nav
          className="project-settings-nav"
          aria-label="Project settings sections"
        >
          {(
            [
              "general",
              "members",
              "states",
              "priorities",
              ...(extraSections ? ["fields", "integrations"] : []),
            ] as const
          ).map((item) => (
            <button
              key={item}
              aria-current={tab === item ? "page" : undefined}
              disabled={busy || externalBusy}
              onClick={() => setTab(item)}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <section
          className="project-settings-content"
          aria-label={`${tab} settings`}
        >
          {tab === "fields" ? (
            extraSections?.fields
          ) : tab === "integrations" ? (
            extraSections?.integrations
          ) : tab === "general" ? (
            <>
              {project.role !== "owner" && (
                <p className="muted">
                  Only the project owner can edit these settings.
                </p>
              )}
              <ProjectForm
                initialValues={project}
                submitLabel="Save changes"
                readOnly={project.role !== "owner"}
                onBusyChange={setBusy}
                onCancel={onClose}
                onDiscoverLogo={actions.discoverLogo}
                onSubmit={async (input) => {
                  setSaved(false);
                  await actions.update(input);
                  setSaved(true);
                }}
              />
              {saved && (
                <p className="project-feedback" role="status">
                  Changes saved.
                </p>
              )}
            </>
          ) : tab === "states" || tab === "priorities" ? (
            <ProjectIssueSettings
              key={tab}
              projectId={project.id}
              owner={project.role === "owner"}
              kind={tab === "states" ? "state" : "priority"}
              actions={actions.issueSettings}
              onBusyChange={setBusy}
            />
          ) : (
            <ProjectMembers
              owner={project.role === "owner"}
              actions={actions}
              onBusyChange={setBusy}
            />
          )}
        </section>
      </div>
    </Dialog>
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
    Promise.all([
      actions.members(),
      owner ? actions.invitations() : Promise.resolve([]),
    ])
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
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {owner && (
        <form
          className="project-invite-form"
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
          <label htmlFor="invite-email">Invite by email</label>
          <div>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@company.com"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || loading || !email.trim()}>
              {busy ? "Please wait…" : "Send invitation"}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="project-error" role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            onClick={() => setReload((value) => value + 1)}
            disabled={busy}
          >
            Refresh
          </Button>
        </p>
      )}
      {feedback && (
        <p className="project-feedback" role="status">
          {feedback}
        </p>
      )}
      {loading ? (
        <p className="muted" role="status">
          Loading members…
        </p>
      ) : (
        <>
          <h3 className="project-section-title">Team members</h3>
          <ul className="project-people-list">
            {members.map((member) => (
              <li key={member.id}>
                <span className="project-person-initial" aria-hidden="true">
                  {member.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{member.name}</strong>
                  <span>{member.email}</span>
                </div>
                <span className="project-person-role">
                  {member.role === "owner" ? "Owner" : "Member"}
                </span>
              </li>
            ))}
          </ul>
          {owner && (
            <>
              <h3 className="project-section-title">Invitations</h3>
              {!invitations.length ? (
                <p className="muted">No invitations yet.</p>
              ) : (
                <ul className="project-people-list">
                  {invitations.map((invitation) => (
                    <li key={invitation.id}>
                      <div>
                        <strong>{invitation.email}</strong>
                        <span>
                          {invitation.status === "pending"
                            ? `Pending · Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`
                            : invitation.status.charAt(0).toUpperCase() +
                              invitation.status.slice(1)}
                        </span>
                      </div>
                      {["pending", "sending"].includes(invitation.status) && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Cancel invitation to ${invitation.email}`}
                          onClick={() =>
                            void run(async () => {
                              const result = await actions.cancel(
                                invitation.id,
                              );
                              setInvitations((previous) =>
                                previous.map((item) =>
                                  item.id === result.id ? result : item,
                                ),
                              );
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
            </>
          )}
        </>
      )}
    </>
  );
}
