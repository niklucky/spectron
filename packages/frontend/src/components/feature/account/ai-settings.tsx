import { useEffect, useState, type FormEvent } from "react";
import type {
  AIConnectionInput,
  AIConnectionSummary,
  AIProvider,
  AIProviderDefinition,
  AgentIdentity,
  AgentInput,
  AgentSharing,
  AgentSummary,
  ProjectMemberSummary,
  ProjectSummary,
} from "@spectron/shared";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { Avatar } from "../../ui/avatar";

type Revision = { id: string; revision: number };
export type AISettingsActions = {
  catalog: () => Promise<AIProviderDefinition[]>;
  connections: () => Promise<AIConnectionSummary[]>;
  createConnection: (input: AIConnectionInput) => Promise<unknown>;
  updateConnection: (
    input: Revision & { name: string; apiKey?: string },
  ) => Promise<unknown>;
  deleteConnection: (input: Revision) => Promise<unknown>;
  checkConnection: (
    input: Revision,
  ) => Promise<{ message: string; connection: AIConnectionSummary }>;
  agents: () => Promise<AgentSummary[]>;
  createAgent: (input: AgentInput) => Promise<unknown>;
  updateAgent: (input: AgentInput & Revision) => Promise<unknown>;
  deleteAgent: (input: Revision) => Promise<unknown>;
  sharing: (id: string) => Promise<AgentSharing[]>;
  setSharing: (
    input: Revision & {
      projectId: string;
      visibility: "private" | "selected" | "project";
      memberIds: string[];
    },
  ) => Promise<unknown>;
  available: (projectId: string) => Promise<AgentIdentity[]>;
  members: (projectId: string) => Promise<ProjectMemberSummary[]>;
};
function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete this action. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
function AgentHeading({ agent }: { agent: AgentIdentity }) {
  return (
    <div className="ai-agent-heading">
      {agent.avatar ? (
        <img className="ai-avatar" src={agent.avatar} alt="" />
      ) : (
        <Avatar initials={agent.name.slice(0, 1).toUpperCase()} />
      )}
      <div>
        <strong>{agent.name}</strong> <span className="ai-badge">AI</span>
        <p>
          {agent.role} · {agent.ownerName}
        </p>
      </div>
    </div>
  );
}
export function AISettingsPage({
  actions,
  projects,
  ownerId,
  onClose,
}: {
  actions: AISettingsActions;
  projects: ProjectSummary[];
  ownerId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("agents");
  const [catalog, setCatalog] = useState<AIProviderDefinition[]>([]);
  const [connections, setConnections] = useState<AIConnectionSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [connectionEdit, setConnectionEdit] = useState<
    AIConnectionSummary | "new" | null
  >(null);
  const [agentEdit, setAgentEdit] = useState<AgentSummary | "new" | null>(null);
  const [sharing, setSharing] = useState<AgentSummary | null>(null);
  const [deletion, setDeletion] = useState<{
    kind: "agent" | "connection";
    item: Revision & { name: string };
  } | null>(null);
  const operation = useOperation();
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError("");
    void Promise.all([
      actions.catalog(),
      actions.connections(),
      actions.agents(),
    ])
      .then(([c, cs, as]) => {
        if (current) {
          setCatalog(c);
          setConnections(cs);
          setAgents(as);
        }
      })
      .catch((e: unknown) => {
        if (current)
          setLoadError(
            e instanceof Error ? e.message : "Could not load AI settings.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [actions, reload]);
  const changed = () => {
    setReload((v) => v + 1);
    setFeedback("Changes saved.");
  };
  return (
    <main className="ai-settings-page">
      <header>
        <Button variant="ghost" onClick={onClose}>
          ← Back to workspace
        </Button>
        <h1>AI connections & agents</h1>
        <p>Create helpers for your work and share them with your projects.</p>
      </header>
      <nav aria-label="AI settings sections">
        {[
          ["agents", "My agents"],
          ["connections", "Connections"],
          ["project", "Project agents"],
        ].map(([id, name]) => (
          <Button
            key={id}
            variant="ghost"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id!)}
          >
            {name}
          </Button>
        ))}
      </nav>
      {feedback && <p role="status">{feedback}</p>}
      {(loadError || operation.error) && (
        <p className="ai-error" role="alert">
          {loadError || operation.error}{" "}
          <Button
            variant="ghost"
            disabled={operation.busy}
            onClick={() => {
              operation.setError("");
              setReload((v) => v + 1);
            }}
          >
            Reload
          </Button>
        </p>
      )}
      {loading ? (
        <p role="status">Loading AI settings…</p>
      ) : loadError ? null : tab === "connections" ? (
        <section aria-label="AI connections">
          <div className="ai-section-heading">
            <h2>Your connections</h2>
            <Button onClick={() => setConnectionEdit("new")}>
              Add connection
            </Button>
          </div>
          <p>
            Keys stay private. Several agents can use one connection. Saved keys
            cannot be viewed.
          </p>
          {!connections.length && (
            <p className="ai-empty">
              Add your first connection, then create an agent.
            </p>
          )}
          <div className="ai-cards">
            {connections.map((c) => (
              <article className="ai-card" key={c.id}>
                <h3>{c.name}</h3>
                <p>{catalog.find((p) => p.id === c.provider)?.name}</p>
                <p>
                  {c.checkStatus === "untested"
                    ? "Key saved · Not checked"
                    : c.checkStatus === "passed"
                      ? "Connection check passed"
                      : "Connection check failed"}
                  {c.checkedAt &&
                    ` · ${new Date(c.checkedAt).toLocaleString()}`}
                </p>
                <p>
                  {agents.filter((a) => a.connectionId === c.id).length} agents
                  · Key updated {new Date(c.keyUpdatedAt).toLocaleDateString()}
                </p>
                {c.provider === "zai" && (
                  <p>
                    Checking sends a small GLM-5.3-flash request and may use
                    paid tokens.
                  </p>
                )}
                <div className="ai-actions">
                  <Button
                    variant="ghost"
                    disabled={operation.busy}
                    onClick={() => setConnectionEdit(c)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={operation.busy}
                    onClick={() =>
                      void operation.run(async () => {
                        const result = await actions.checkConnection({
                          id: c.id,
                          revision: c.revision,
                        });
                        setConnections((items) =>
                          items.map((item) =>
                            item.id === c.id ? result.connection : item,
                          ),
                        );
                        setFeedback(result.message);
                      })
                    }
                  >
                    {operation.busy ? "Checking…" : "Check connection"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={operation.busy}
                    onClick={() => setDeletion({ kind: "connection", item: c })}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : tab === "agents" ? (
        <section aria-label="My AI agents">
          <div className="ai-section-heading">
            <h2>Your agents</h2>
            <Button
              disabled={!connections.length}
              onClick={() => setAgentEdit("new")}
            >
              Create agent
            </Button>
          </div>
          <p>
            Agents are private by default. Only you can edit your agents and
            their instructions.
          </p>
          {!connections.length ? (
            <p className="ai-empty">
              Start by{" "}
              <Button
                variant="ghost"
                onClick={() => {
                  setTab("connections");
                  setConnectionEdit("new");
                }}
              >
                adding an AI connection
              </Button>
              .
            </p>
          ) : (
            !agents.length && (
              <p className="ai-empty">
                Create your first agent, such as Dev senior or Issue editor.
              </p>
            )
          )}
          <div className="ai-cards">
            {agents.map((a) => (
              <article className="ai-card" key={a.id}>
                <AgentHeading agent={a} />
                <p>
                  {a.model} ·{" "}
                  {a.effort ? `${a.effort} effort` : "No effort setting"}
                </p>
                <p>
                  Connection:{" "}
                  {connections.find((c) => c.id === a.connectionId)?.name}
                </p>
                <div className="ai-actions">
                  <Button variant="ghost" onClick={() => setAgentEdit(a)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => setSharing(a)}>
                    Sharing
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDeletion({ kind: "agent", item: a })}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <ProjectAgents actions={actions} projects={projects} />
      )}
      {connectionEdit && (
        <ConnectionEditor
          initial={connectionEdit === "new" ? null : connectionEdit}
          catalog={catalog}
          actions={actions}
          onClose={() => setConnectionEdit(null)}
          onSaved={() => {
            setConnectionEdit(null);
            changed();
          }}
        />
      )}
      {agentEdit && (
        <AgentEditor
          initial={agentEdit === "new" ? null : agentEdit}
          catalog={catalog}
          connections={connections}
          actions={actions}
          onClose={() => setAgentEdit(null)}
          onSaved={() => {
            setAgentEdit(null);
            changed();
          }}
        />
      )}
      {sharing && (
        <SharingEditor
          agent={sharing}
          ownerId={ownerId}
          projects={projects}
          actions={actions}
          onClose={() => setSharing(null)}
          onSaved={() => {
            setSharing(null);
            changed();
          }}
        />
      )}
      {deletion && (
        <DeleteDialog
          item={deletion}
          actions={actions}
          onClose={() => setDeletion(null)}
          onDeleted={() => {
            setDeletion(null);
            changed();
          }}
        />
      )}
    </main>
  );
}
function ConnectionEditor({
  initial,
  catalog,
  actions,
  onClose,
  onSaved,
}: {
  initial: AIConnectionSummary | null;
  catalog: AIProviderDefinition[];
  actions: AISettingsActions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [provider, setProvider] = useState<AIProvider>(
    initial?.provider ?? "openai",
  );
  const [key, setKey] = useState("");
  const op = useOperation();
  return (
    <Dialog
      title={initial ? "Edit AI connection" : "Add AI connection"}
      className="ai-dialog"
      onClose={() => {
        if (!op.busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void op.run(async () => {
            if (initial)
              await actions.updateConnection({
                id: initial.id,
                revision: initial.revision,
                name,
                ...(key ? { apiKey: key } : {}),
              });
            else
              await actions.createConnection({ name, provider, apiKey: key });
            setKey("");
            onSaved();
          });
        }}
      >
        <fieldset disabled={op.busy}>
          <label>
            Connection name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My OpenAI account"
            />
          </label>
          <label>
            Provider
            <select
              disabled={!!initial}
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIProvider)}
            >
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {initial ? "Replace API key" : "API key"}
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              required={!initial}
              maxLength={4096}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                initial
                  ? "Leave blank to keep the saved key"
                  : "Enter your API key"
              }
            />
          </label>
          <p>
            {initial
              ? "Replacing the key updates every agent using this connection. "
              : ""}
            Saving validates the key format. Use Check connection afterward to
            verify provider access.
          </p>
          {provider === "zai" && (
            <p>Use a Z.ai API Platform key for the general API endpoint.</p>
          )}
          {op.error && (
            <p className="ai-error" role="alert">
              {op.error}
            </p>
          )}
          <div className="ai-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {op.busy ? "Saving…" : "Save connection"}
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
function AgentEditor({
  initial,
  catalog,
  connections,
  actions,
  onClose,
  onSaved,
}: {
  initial: AgentSummary | null;
  catalog: AIProviderDefinition[];
  connections: AIConnectionSummary[];
  actions: AISettingsActions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstConnection = connections[0]!;
  const firstModel = catalog.find((p) => p.id === firstConnection.provider)!
    .models[0]!;
  const [input, setInput] = useState<AgentInput>(
    initial
      ? {
          name: initial.name,
          avatar: initial.avatar,
          connectionId: initial.connectionId,
          model: initial.model,
          effort: initial.effort,
          role: initial.role,
          instructions: initial.instructions,
        }
      : {
          name: "",
          avatar: null,
          connectionId: firstConnection.id,
          model: firstModel.id,
          effort: firstModel.defaultEffort,
          role: "Developer",
          instructions: "",
        },
  );
  const op = useOperation();
  const provider = catalog.find(
    (p) =>
      p.id === connections.find((c) => c.id === input.connectionId)?.provider,
  )!;
  const model = provider.models.find((m) => m.id === input.model);
  const patch = (values: Partial<AgentInput>) =>
    setInput((v) => ({ ...v, ...values }));
  async function upload(file?: File) {
    if (!file) return;
    await op.run(async () => {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Choose an image smaller than 2 MB.");
      const avatar = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(file);
      });
      patch({ avatar });
    });
  }
  return (
    <Dialog
      title={initial ? "Edit agent" : "Create agent"}
      className="ai-dialog"
      onClose={() => {
        if (!op.busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void op.run(async () => {
            if (initial)
              await actions.updateAgent({
                ...input,
                id: initial.id,
                revision: initial.revision,
              });
            else await actions.createAgent(input);
            onSaved();
          });
        }}
      >
        <fieldset disabled={op.busy}>
          <label>
            Name
            <input
              required
              maxLength={80}
              value={input.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Dev senior"
            />
          </label>
          <div className="ai-actions">
            {input.avatar && (
              <img
                src={input.avatar}
                className="ai-avatar"
                alt="Agent avatar preview"
              />
            )}
            <label>
              Avatar
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {input.avatar && (
              <Button variant="ghost" onClick={() => patch({ avatar: null })}>
                Remove avatar
              </Button>
            )}
          </div>
          <label>
            AI connection
            <select
              value={input.connectionId}
              onChange={(e) => {
                const c = connections.find((v) => v.id === e.target.value)!;
                const m = catalog.find((p) => p.id === c.provider)!.models[0]!;
                patch({
                  connectionId: c.id,
                  model: m.id,
                  effort: m.defaultEffort,
                });
              }}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ai-form-row">
            <label>
              Model
              <select
                value={input.model}
                onChange={(e) => {
                  const m = provider.models.find(
                    (v) => v.id === e.target.value,
                  )!;
                  patch({ model: m.id, effort: m.defaultEffort });
                }}
              >
                {!model && (
                  <option value={input.model}>
                    {input.model} (unavailable)
                  </option>
                )}
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effort
              <select
                disabled={!model?.efforts.length}
                value={input.effort ?? ""}
                onChange={(e) =>
                  patch({ effort: e.target.value as AgentInput["effort"] })
                }
              >
                {!model?.efforts.length ? (
                  <option value="">Not supported</option>
                ) : (
                  model.efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
          <label>
            Role / function
            <input
              required
              list="ai-roles"
              maxLength={80}
              value={input.role}
              onChange={(e) => patch({ role: e.target.value })}
            />
          </label>
          <datalist id="ai-roles">
            {["Developer", "Reviewer", "Planner", "Issue editor"].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <label>
            Instructions
            <textarea
              rows={6}
              maxLength={32000}
              value={input.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="Describe how this agent should approach its work…"
            />
          </label>
          <p>
            Role names guide behavior. Access comes from project permissions and
            sharing settings.
          </p>
          {op.error && (
            <p className="ai-error" role="alert">
              {op.error}
            </p>
          )}
          <div className="ai-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!model}>
              {op.busy ? "Saving…" : "Save agent"}
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
function SharingEditor({
  agent,
  ownerId,
  projects,
  actions,
  onClose,
  onSaved,
}: {
  agent: AgentSummary;
  ownerId: string;
  projects: ProjectSummary[];
  actions: AISettingsActions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [members, setMembers] = useState<ProjectMemberSummary[]>([]);
  const [visibility, setVisibility] = useState<
    "private" | "selected" | "project"
  >("private");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const op = useOperation();
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError("");
    if (!projectId) {
      setLoading(false);
      return;
    }
    void Promise.all([actions.sharing(agent.id), actions.members(projectId)])
      .then(([shares, ms]) => {
        if (!current) return;
        const s = shares.find((item) => item.projectId === projectId);
        setMembers(ms.filter((m) => m.id !== ownerId));
        setVisibility(s?.visibility ?? "private");
        setSelected(s?.memberIds ?? []);
      })
      .catch((e: unknown) => {
        if (current)
          setLoadError(
            e instanceof Error ? e.message : "Could not load sharing.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [agent.id, projectId, actions, ownerId, reload]);
  return (
    <Dialog
      title={`Share ${agent.name}`}
      className="ai-dialog"
      onClose={() => {
        if (!op.busy) onClose();
      }}
    >
      {!projects.length ? (
        <p>Join or create a project to share this agent. It is private.</p>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void op.run(async () => {
              await actions.setSharing({
                id: agent.id,
                revision: agent.revision,
                projectId,
                visibility,
                memberIds: visibility === "selected" ? selected : [],
              });
              onSaved();
            });
          }}
        >
          <fieldset disabled={op.busy}>
            <label>
              Project
              <select
                value={projectId}
                onChange={(e) => {
                  setLoading(true);
                  setProjectId(e.target.value);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Choose who can invoke this agent using your connection. Only you
              can edit it. Each project has its own sharing settings.
            </p>
            {loading ? (
              <p role="status">Loading sharing…</p>
            ) : loadError ? (
              <p role="alert" className="ai-error">
                {loadError}{" "}
                <Button variant="ghost" onClick={() => setReload((v) => v + 1)}>
                  Retry
                </Button>
              </p>
            ) : (
              <>
                <label>
                  Who can invoke this agent?
                  <select
                    value={visibility}
                    onChange={(e) =>
                      setVisibility(e.target.value as typeof visibility)
                    }
                  >
                    <option value="private">Private — only me</option>
                    <option value="selected">Selected members</option>
                    <option value="project">Whole project</option>
                  </select>
                </label>
                {visibility === "selected" && (
                  <div className="ai-member-picker">
                    {!members.length && (
                      <p>No other members in this project yet.</p>
                    )}
                    {members.map((m) => (
                      <label key={m.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(m.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, m.id]
                                : old.filter((id) => id !== m.id),
                            )
                          }
                        />
                        {m.name} <span>{m.email}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            {op.error && (
              <p role="alert" className="ai-error">
                {op.error}
              </p>
            )}
            <div className="ai-actions">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  loading ||
                  !!loadError ||
                  (visibility === "selected" && !selected.length)
                }
              >
                {op.busy ? "Saving…" : "Save sharing"}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
function DeleteDialog({
  item,
  actions,
  onClose,
  onDeleted,
}: {
  item: { kind: "agent" | "connection"; item: Revision & { name: string } };
  actions: AISettingsActions;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const op = useOperation();
  return (
    <Dialog
      title={`Delete ${item.item.name}?`}
      className="ai-dialog"
      onClose={() => {
        if (!op.busy) onClose();
      }}
    >
      <p>
        {item.kind === "agent"
          ? "This agent will no longer be available to you or its shared projects."
          : "The saved key will be removed. Move or delete agents using this connection first."}
      </p>
      {op.error && (
        <p role="alert" className="ai-error">
          {op.error}
        </p>
      )}
      <div className="ai-actions">
        <Button variant="ghost" disabled={op.busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={op.busy}
          onClick={() =>
            void op.run(async () => {
              const revision = {
                id: item.item.id,
                revision: item.item.revision,
              };
              if (item.kind === "agent") await actions.deleteAgent(revision);
              else await actions.deleteConnection(revision);
              onDeleted();
            })
          }
        >
          {op.busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Dialog>
  );
}
function ProjectAgents({
  actions,
  projects,
}: {
  actions: AISettingsActions;
  projects: ProjectSummary[];
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setAgents([]);
    if (!projectId) {
      setLoading(false);
      return;
    }
    void actions
      .available(projectId)
      .then((as) => {
        if (current) setAgents(as);
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : "Could not load agents.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [actions, projectId, reload]);
  return (
    <section aria-label="Project agents">
      <h2>Agents available to you</h2>
      <p>
        Your private agents and agents shared with you in the selected project.
      </p>
      {!projects.length ? (
        <p>Join or create a project to discover shared agents.</p>
      ) : (
        <>
          <label>
            Project
            <select
              value={projectId}
              onChange={(e) => {
                setLoading(true);
                setProjectId(e.target.value);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {loading ? (
            <p role="status">Loading agents…</p>
          ) : error ? (
            <p role="alert" className="ai-error">
              {error}{" "}
              <Button variant="ghost" onClick={() => setReload((v) => v + 1)}>
                Retry
              </Button>
            </p>
          ) : !agents.length ? (
            <p className="ai-empty">No agents available in this project yet.</p>
          ) : (
            <div className="ai-cards">
              {agents.map((a) => (
                <article key={a.id} className="ai-card">
                  <AgentHeading agent={a} />
                  <p>
                    {a.model} · {a.effort ?? "No effort setting"}
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
