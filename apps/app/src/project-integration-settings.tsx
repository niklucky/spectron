import { exportActionsFor } from "./lib/export-actions";
import { ExportSettings } from "@spectron/frontend";
import { IntegrationTabs, IntegrationSyncLog, type IntegrationTab } from "@spectron/frontend";
import {
  issueTriggers,
  type IssueTrigger,
  matchTrackerMappings,
  trackerFieldType,
} from "@spectron/shared";
import { useEffect, useState, useMemo } from "react";
import { trpc } from "./lib/trpc";
type Config = NonNullable<Awaited<ReturnType<typeof trpc.tracker.get.query>>>;
type Metadata = Awaited<ReturnType<typeof trpc.tracker.metadata.mutate>>;
const emptyMappings: Config["mappings"] = {
  statuses: {},
  priorities: {},
  users: {},
  fields: {},
};
export function ProjectIntegrationSettings({
  projectId,
  onChanged,
  onBusyChange,
}: {
  projectId: string;
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [exportBusy, setExportBusy] = useState(false);
  const exports = useMemo(() => exportActionsFor(projectId, "tracker"), [projectId]);
  const [tab, setTab] = useState<IntegrationTab>("connection");
  const [config, setConfig] = useState<Config>({
    organizationId: "",
    organizationType: "cloud",
    queue: "",
    mappings: emptyMappings,
    hasToken: false,
    createdAt: "",
  });
  const [creating, setCreating] = useState<{
    kind: "statuses" | "priorities" | "fields";
    trigger: IssueTrigger;
    remoteId: string;
    name: string;
    type: "text" | "date" | "number" | "user";
  } | null>(null);
  const [token, setToken] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [options, setOptions] = useState<
    Record<
      keyof Config["mappings"],
      Array<{ id: string; name: string; type?: string; position?: number }>
    >
  >({ statuses: [], priorities: [], users: [], fields: [] });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [overwriteConflicts, setOverwriteConflicts] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      trpc.tracker.get.query({ projectId }),
      trpc.issues.settings.query({ projectId }),
      trpc.projects.members.query({ id: projectId }),
    ])
      .then(([saved, settings, users]) => {
        if (!active) return;
        if (saved) {
          setConfig(saved);
        }
        setOptions({
          statuses: settings.states.filter((s) => !s.deletedAt),
          priorities: settings.priorities.filter((s) => !s.deletedAt),
          users,
          fields: settings.fields ?? [],
        });
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    setFeedback("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function save() {
    const mappings = {
      ...config.mappings,
      users: Object.fromEntries(
        Object.entries(config.mappings.users).filter(
          ([id]) => id !== "undefined" && id !== "null" && id !== "",
        ),
      ),
    };

    await trpc.tracker.save.mutate({
      projectId,
      organizationId: config.organizationId,
      organizationType: config.organizationType,
      queue: config.queue,
      mappings,
      ...(token ? { token } : {}),
    });
    setConfig((c) => ({ ...c, mappings, hasToken: true }));
    setToken("");
    setDirty(false);
  }
  if (loading) return <p role="status">Loading integration…</p>;
  return (
    <div className="tracker-settings">
      <h3>Yandex Tracker</h3>
      <p className="muted">
        Connect a queue, map its values, then import issues or push local
        changes. Only project owners can run sync.
      </p>
      <IntegrationTabs value={tab} onChange={(value) => { setFeedback(""); setError(""); setTab(value); }} busy={busy || exportBusy} connected={config.hasToken} />
      <div hidden={tab !== "connection"} className="integration-connection-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await save();
            setFeedback("Connection settings saved.");
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Organization type
            <select
              value={config.organizationType}
              onChange={(e) => {
                setDirty(true);
                setMetadata(null);
                setConfig((c) => ({
                  ...c,
                  organizationType: e.target.value as "cloud" | "360",
                  mappings: emptyMappings,
                }));
              }}
            >
              <option value="cloud">Yandex Cloud / Identity Hub</option>
              <option value="360">Yandex 360</option>
            </select>
          </label>
          <label>
            Organization ID
            <input
              required
              value={config.organizationId}
              onChange={(e) => {
                setDirty(true);
                setMetadata(null);
                setConfig((c) => ({
                  ...c,
                  organizationId: e.target.value,
                  mappings: emptyMappings,
                }));
              }}
            />
          </label>
          <label>
            Queue key
            <input
              required
              placeholder="TEAM"
              value={config.queue}
              onChange={(e) => {
                setDirty(true);
                setMetadata(null);
                setConfig((c) => ({
                  ...c,
                  queue: e.target.value.toUpperCase(),
                  mappings: emptyMappings,
                }));
              }}
            />
          </label>
          <label>
            OAuth token
            <input
              type="password"
              autoComplete="new-password"
              required={!config.hasToken}
              placeholder={
                config.hasToken ? "Saved — leave blank to keep" : "OAuth token"
              }
              value={token}
              onChange={(e) => {
                setDirty(true);
                setToken(e.target.value);
              }}
            />
          </label>
          <p className="muted">
            Find the organization ID in Tracker → Administration →
            Organizations. The token needs access to this queue. Tokens are
            encrypted on the server. You can correct the organization and queue
            until the first sync.
          </p>
          <button type="submit">Save connection</button>{" "}
          <button type="button" onClick={() => void run(async () => {
            await trpc.tracker.test.mutate({ projectId, organizationId: config.organizationId, organizationType: config.organizationType, queue: config.queue, ...(token ? { token } : {}) });
            setFeedback("Connection successful.");
          })}>Test connection</button>
        </fieldset>
      </form>
      </div>
      <div hidden={tab !== "mapping"} className="integration-panel">
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                if (dirty) throw new Error("Save connection and mapping changes before loading mappings.");
                const discovered = await trpc.tracker.metadata.mutate({
                  projectId,
                });
                const [settings, users] = await Promise.all([
                  trpc.issues.settings.query({ projectId }),
                  trpc.projects.members.query({ id: projectId }),
                ]);
                const freshOptions = {
                  statuses: settings.states.filter((s) => !s.deletedAt),
                  priorities: settings.priorities.filter((s) => !s.deletedAt),
                  fields: settings.fields ?? [],
                  users,
                };
                setOptions(freshOptions);
                setMetadata(discovered);
                setConfig((c) => ({
                  ...c,
                  mappings: {
                    ...c.mappings,
                    users: Object.fromEntries(
                      Object.entries(c.mappings.users).filter(
                        ([id]) =>
                          discovered.users.some((user) => user.id === id) &&
                          (c.mappings.users[id] === null ||
                            freshOptions.users.some(
                              (user) => user.id === c.mappings.users[id],
                            )),
                      ),
                    ),
                    statuses: matchTrackerMappings(
                      "statuses",
                      discovered.statuses,
                      freshOptions.statuses,
                      c.mappings.statuses,
                    ),
                    priorities: matchTrackerMappings(
                      "priorities",
                      discovered.priorities,
                      freshOptions.priorities,
                      c.mappings.priorities,
                    ),
                    fields: matchTrackerMappings(
                      "fields",
                      discovered.fields,
                      freshOptions.fields,
                      c.mappings.fields,
                    ),
                  },
                }));
                setDirty(true);
                setFeedback("Mappings loaded. Review and save your choices.");
              })
            }
          >
            Load mappings
          </button>
      {!metadata && <p className="muted">Load fields, statuses, priorities and users from the saved connection.</p>}
      {metadata && (
        <fieldset disabled={busy}>
          {(["statuses", "priorities", "users", "fields"] as const).map(
            (kind) => (
              <section key={kind}>
                <h4>{kind.charAt(0).toUpperCase() + kind.slice(1)}</h4>
                <p className="muted">
                  {kind === "statuses"
                    ? "Every imported status needs a local state."
                    : kind === "fields"
                      ? "Choose a project field, create and map one here, or ignore this Tracker field."
                      : "Map to a project value. Unmapped users import as unassigned or the importing owner."}
                </p>
                {metadata[kind]
                  .filter(
                    (remote) =>
                      kind !== "fields" ||
                      ![
                        "summary",
                        "description",
                        "queue",
                        "status",
                        "priority",
                        "assignee",
                        "createdBy",
                        "unique",
                        "version",
                      ].includes(String(remote.id)),
                  )
                  .map((remote) => (
                    <div
                      key={String(remote.id)}
                      className="tracker-mapping-row"
                    >
                      <span>
                        {String(
                          remote.display ||
                            ("name" in remote ? remote.name : "") ||
                            remote.id,
                        )}{" "}
                        <small className="muted">{String(remote.id)}</small>
                      </span>
                      <select
                        aria-label={`Map ${remote.display || ("name" in remote ? remote.name : remote.id)}`}
                        value={config.mappings[kind][String(remote.id)] ?? ""}
                        onChange={(e) => {
                          if (
                            e.target.value === "__create__" &&
                            kind !== "users"
                          ) {
                            setCreating({
                              kind,
                              trigger: "opened",
                              remoteId: String(remote.id),
                              name: String(
                                remote.display ||
                                  ("name" in remote ? remote.name : remote.id),
                              ).slice(0, 80),
                              type: trackerFieldType(remote) ?? "text",
                            });
                            return;
                          }
                          setDirty(true);
                          setConfig((c) => ({
                            ...c,
                            mappings: {
                              ...c.mappings,
                              [kind]: {
                                ...c.mappings[kind],
                                [String(remote.id)]: e.target.value || null,
                              },
                            },
                          }));
                        }}
                      >
                        <option value="">
                          {kind === "statuses"
                            ? "Choose a state"
                            : "Ignore / leave unmapped"}
                        </option>
                        {kind !== "users" && (
                          <option value="__create__">Create and map…</option>
                        )}
                        {options[kind].map((local) => (
                          <option key={local.id} value={local.id}>
                            {local.name}
                          </option>
                        ))}
                      </select>
                      {creating?.kind === kind &&
                        creating?.remoteId === String(remote.id) && (
                          <div className="tracker-create-field">
                            <label>
                              {kind === "fields"
                                ? "Field name"
                                : kind === "statuses"
                                  ? "Status name"
                                  : "Priority name"}
                              <input
                                value={creating.name}
                                maxLength={80}
                                onChange={(e) =>
                                  setCreating({
                                    ...creating,
                                    name: e.target.value,
                                  })
                                }
                              />
                            </label>
                            {kind === "fields" && (
                              <label>
                                Field type
                                <select
                                  value={creating.type}
                                  onChange={(e) =>
                                    setCreating({
                                      ...creating,
                                      type: e.target
                                        .value as typeof creating.type,
                                    })
                                  }
                                >
                                  <option value="text">Text</option>
                                  <option value="date">Date</option>
                                  <option value="number">Number</option>
                                  <option value="user">User</option>
                                </select>
                              </label>
                            )}
                            {kind === "statuses" && (
                              <label>
                                Status category
                                <select
                                  value={creating.trigger}
                                  onChange={(e) =>
                                    setCreating({
                                      ...creating,
                                      trigger: e.target.value as IssueTrigger,
                                    })
                                  }
                                >
                                  {issueTriggers.map((trigger) => (
                                    <option key={trigger} value={trigger}>
                                      {
                                        {
                                          opened: "Opened",
                                          in_progress: "In progress",
                                          blocked: "Blocked",
                                          cancelled: "Cancelled",
                                          finished: "Finished",
                                        }[trigger]
                                      }
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <div>
                              <button
                                type="button"
                                disabled={!creating.name.trim()}
                                onClick={() =>
                                  void run(async () => {
                                    const name = creating.name.trim();
                                    const targetKind = creating.kind;
                                    const created =
                                      targetKind === "fields"
                                        ? await trpc.fields.save.mutate({
                                            projectId,
                                            name,
                                            type: creating.type,
                                          })
                                        : await trpc.issues.saveOption.mutate({
                                            projectId,
                                            kind:
                                              targetKind === "statuses"
                                                ? "state"
                                                : "priority",
                                            name,
                                            position:
                                              Math.max(
                                                -1,
                                                ...options[targetKind].map(
                                                  (o) => o.position ?? 0,
                                                ),
                                              ) + 1,
                                            color: null,
                                            ...(targetKind === "statuses"
                                              ? {
                                                  trigger: creating.trigger,
                                                  isDefault: false,
                                                }
                                              : {}),
                                          });
                                    setOptions((o) => ({
                                      ...o,
                                      [targetKind]: [
                                        ...o[targetKind],
                                        {
                                          ...created,
                                          name,
                                          ...(targetKind === "fields"
                                            ? { type: creating.type }
                                            : {}),
                                        },
                                      ],
                                    }));
                                    setConfig((c) => ({
                                      ...c,
                                      mappings: {
                                        ...c.mappings,
                                        [targetKind]: {
                                          ...c.mappings[targetKind],
                                          [creating.remoteId]: created.id,
                                        },
                                      },
                                    }));
                                    setDirty(true);
                                    setCreating(null);
                                    setFeedback(
                                      "Created and selected. Save mappings when you are ready.",
                                    );
                                  })
                                }
                              >
                                Create and map
                              </button>
                              <button
                                type="button"
                                onClick={() => setCreating(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                    </div>
                  ))}
              </section>
            ),
          )}
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                await save();
                setFeedback("Mappings saved.");
              })
            }
          >
            Save mappings
          </button>
        </fieldset>
      )}
      </div>
      <section hidden={tab !== "sync"} className="integration-panel">
        <h3>Full import</h3>
        <p className="muted">
          Import updates from Tracker. Push creates and updates issues and
          comments in Tracker. Deleted items are skipped. If both sides changed,
          sync reports a conflict and keeps both versions.
        </p>
        <label className="tracker-checkbox">
          <input
            type="checkbox"
            checked={overwriteConflicts}
            disabled={busy}
            onChange={(e) => setOverwriteConflicts(e.target.checked)}
          />
          Resolve conflicts by replacing destination changes with the selected
          source. Import keeps Tracker values; push keeps local values.
        </label>
        {(["import", "push"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            disabled={busy || !config.hasToken || dirty}
            onClick={() =>
              void run(async () => {
                setFeedback(direction === "import" ? "Full import started…" : "Push started…");
                const result = await trpc.tracker.run.mutate({
                  projectId,
                  direction,
                  overwriteConflicts,
                });
                setOverwriteConflicts(false);
                setFeedback(`${direction === "import" ? "Full import" : "Push"} finished: ${result.processed} issues processed, ${result.errors.length} errors.`);
                setError(result.errors.join("\n"));
                await onChanged();
              })
            }
          >
            {direction === "import"
              ? "Full import"
              : "Push local changes"}
          </button>
        ))}
        {dirty && <p className="muted">Save your changes before syncing.</p>}
      </section>
      {busy && (
        <p role="status">
          Working… Keep this page open until the operation finishes.
        </p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {error && (
        <p
          className="project-error"
          role="alert"
          style={{ whiteSpace: "pre-wrap" }}
        >
          {error}
        </p>
      )}
      {config.hasToken && tab === "sync" && <ExportSettings actions={exports} disabled={busy} onBusyChange={value => { setExportBusy(value); onBusyChange(value); }} />}
      <div hidden={tab !== "sync"}><IntegrationSyncLog active={tab === "sync"} feedback={feedback} error={error} /></div>
    </div>
  );
}
