import { useEffect, useState } from "react";
import { trpc } from "./lib/trpc";
type Config = NonNullable<Awaited<ReturnType<typeof trpc.tracker.get.query>>>;
type Metadata = Awaited<ReturnType<typeof trpc.tracker.metadata.mutate>>;
type Field = Awaited<ReturnType<typeof trpc.projectFields.list.query>>[number];
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
  const [config, setConfig] = useState<Config>({
    organizationId: "",
    organizationType: "cloud",
    queue: "",
    mappings: emptyMappings,
    hasToken: false,
  });
  const [token, setToken] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [options, setOptions] = useState<
    Record<keyof Config["mappings"], Array<{ id: string; name: string }>>
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
      trpc.projectFields.list.query({ projectId }),
    ])
      .then(([saved, settings, users, fields]) => {
        if (!active) return;
        if (saved) setConfig(saved);
        setOptions({
          statuses: settings.states.filter((s) => !s.deletedAt),
          priorities: settings.priorities.filter((s) => !s.deletedAt),
          users,
          fields,
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
    await trpc.tracker.save.mutate({
      projectId,
      organizationId: config.organizationId,
      organizationType: config.organizationType,
      queue: config.queue,
      mappings: config.mappings,
      ...(token ? { token } : {}),
    });
    setConfig((c) => ({ ...c, hasToken: true }));
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
          <button type="submit">Save settings and mappings</button>{" "}
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                if (!config.hasToken || token || dirty) await save();
                setMetadata(await trpc.tracker.metadata.mutate({ projectId }));
                setFeedback("Connected. Review the mappings below.");
              })
            }
          >
            Test connection and load mappings
          </button>
        </fieldset>
      </form>
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
                      ? "Choose a project field, or ignore this Tracker field. Create project fields in the Fields tab."
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
                    <label
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
                        value={config.mappings[kind][String(remote.id)] ?? ""}
                        onChange={(e) => {
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
                        {options[kind].map((local) => (
                          <option key={local.id} value={local.id}>
                            {local.name}
                          </option>
                        ))}
                      </select>
                    </label>
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
      <section>
        <h4>Sync</h4>
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
                const result = await trpc.tracker.run.mutate({
                  projectId,
                  direction,
                  overwriteConflicts,
                });
                setOverwriteConflicts(false);
                setFeedback(`${result.processed} issues processed.`);
                setError(result.errors.join("\n"));
                await onChanged();
              })
            }
          >
            {direction === "import"
              ? "Import issues and comments"
              : "Push local changes"}
          </button>
        ))}
        {dirty && <p className="muted">Save your changes before syncing.</p>}
      </section>
      {busy && (
        <p role="status">
          Working… Keep this dialog open until the operation finishes.
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
    </div>
  );
}
export function ProjectFieldsSettings({
  projectId,
  owner,
}: {
  projectId: string;
  owner: boolean;
}) {
  const [fields, setFields] = useState<Field[]>([]),
    [name, setName] = useState("");
  const [type, setType] = useState<Field["type"]>("text"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    trpc.projectFields.list
      .query({ projectId })
      .then((v) => {
        if (active) setFields(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <div className="tracker-settings">
      <h3>Issue fields</h3>
      <p className="muted">
        Fields belong to this project and can be filled in on any of its issues.
        Field types are fixed after creation.
      </p>
      <ul>
        {fields.map((f) => (
          <li key={f.id}>
            {f.name} · {f.type}
          </li>
        ))}
      </ul>
      {owner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void trpc.projectFields.create
              .mutate({ projectId, name, type })
              .then(async () => {
                setFields(await trpc.projectFields.list.query({ projectId }));
                setName("");
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Field name
              <input
                value={name}
                required
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as Field["type"])}
              >
                {(["text", "date", "number", "user"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Create field</button>
          </fieldset>
        </form>
      )}
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
    </div>
  );
}
