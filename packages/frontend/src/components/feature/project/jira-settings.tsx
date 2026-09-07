import { useEffect, useRef, useState } from "react";
import { builtInIssueFields, matchJiraStatuses } from "@spectron/shared";
import type {
  JiraConfigInput,
  JiraConnection,
  JiraMappings,
  JiraMetadata,
  IssueSettings,
  ProjectMemberSummary,
} from "@spectron/shared";
import { Input, Select } from "../../ui/input";
import { Button } from "../../ui/button";
export type JiraActions = {
  get: () => Promise<JiraConnection | null>;
  save: (config: JiraConfigInput) => Promise<JiraConnection>;
  discover: (config?: JiraConfigInput) => Promise<JiraMetadata>;
  mappings: (mappings: JiraMappings) => Promise<void>;
  schedule: (minutes: 15 | 60 | 1440 | null) => Promise<JiraConnection>;
  startImport: () => Promise<{ runId: string }>;
  stopImport: (runId: string) => Promise<void>;
  finishImport: (runId: string) => Promise<void>;
  prepare: (runId?: string) => Promise<JiraConnection>;
  search: (
    token?: string,
    runId?: string,
  ) => Promise<{
    issues: { id: string; key: string }[];
    nextPageToken: string | null;
  }>;
  import: (
    id: string,
    overwriteLocal?: boolean,
    runId?: string,
  ) => Promise<unknown>;
  settings: () => Promise<IssueSettings>;
  members: () => Promise<ProjectMemberSummary[]>;
  refresh: () => Promise<void>;
  pending: () => Promise<{ id: string; kind: string }[]>;
  reconcile: (
    kind: "issue" | "comment",
    id: string,
    externalId: string,
  ) => Promise<void>;
};
const connectionConfig = (c: JiraConnection): JiraConfigInput => ({
  baseUrl: c.baseUrl,
  projectKey: c.projectKey,
  email: c.email,
  issueTypeId: c.issueTypeId,
  apiToken: "",
});
const empty = (): JiraMappings => ({
  statuses: {},
  priorities: {},
  fields: {},
  users: {},
});
const reserved = new Set([
  "summary",
  "description",
  "status",
  "priority",
  "assignee",
  "reporter",
  "project",
  "issuetype",
  "comment",
  "worklog",
  "attachment",
  "created",
  "updated",
]);
export function JiraSettings({
  actions,
  owner,
  onBusyChange,
}: {
  actions: JiraActions;
  owner: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [connection, setConnection] = useState<JiraConnection | null>(null),
    [config, setConfig] = useState<JiraConfigInput>({
      baseUrl: "",
      projectKey: "",
      email: "",
      apiToken: "",
      issueTypeId: "",
    });
  const [metadata, setMetadata] = useState<JiraMetadata | null>(null),
    [mappings, setMappings] = useState<JiraMappings>(empty),
    [settings, setSettings] = useState<IssueSettings>({
      states: [],
      priorities: [],
    }),
    [members, setMembers] = useState<ProjectMemberSummary[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [failures, setFailures] = useState<
      { id: string; key: string; error: string }[]
    >([]),
    [accountId, setAccountId] = useState(""),
    [pending, setPending] = useState<{ id: string; kind: string }[]>([]);
  const cancel = useRef(false);
  const activeRun = useRef<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const mappingDirty =
    !!connection &&
    JSON.stringify(mappings) !== JSON.stringify(connection.mappings);
  useEffect(() => {
    if (!owner) {
      setLoading(false);
      return;
    }
    let active = true;
    Promise.all([actions.get(), actions.settings(), actions.members()])
      .then(([c, s, m]) => {
        if (!active) return;
        setConnection(c);
        if (c) {
          setConfig(connectionConfig(c));
          setMappings(c.mappings);
        }
        setSettings(s);
        setMembers(m);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      cancel.current = true;
    };
  }, [actions, owner]);
  useEffect(() => {
    if (!owner) return;
    const timer = setInterval(() => {
      void actions
        .get()
        .then(setConnection)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [actions, owner]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setFeedback("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Jira operation failed.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function importSingle(id: string, overwriteLocal = false) {
    cancel.current = false;
    setImporting(true);
    let runId: string | undefined;
    try {
      runId = (await actions.startImport()).runId;
      activeRun.current = runId;
      if (cancel.current) await actions.stopImport(runId);
      await actions.import(id, overwriteLocal, runId);
    } finally {
      if (runId) await actions.finishImport(runId).catch(() => {});
      activeRun.current = null;
      setImporting(false);
      setStopping(false);
      await actions.refresh();
      setSettings(await actions.settings());
      const latest = await actions.get();
      if (latest) setConnection(latest);
    }
  }
  const set = (key: keyof JiraConfigInput, value: string) =>
    setConfig((c) => ({ ...c, [key]: value }));
  async function loadMetadata() {
    const metadata = await actions.discover();
    const settings = await actions.settings();
    setMetadata(metadata);
    setSettings(settings);
    setMappings((previous) => ({
      ...previous,
      statuses: matchJiraStatuses(
        metadata.statuses,
        settings.states,
        previous.statuses,
      ),
    }));
    setPending(await actions.pending());
  }
  const map = (kind: keyof JiraMappings, id: string, value: string) =>
    setMappings((previous) => {
      const next = { ...previous, [kind]: { ...previous[kind] } };
      if (value === "") delete next[kind][id];
      else if (kind === "fields" && value === "ignore") next.fields[id] = null;
      else next[kind][id] = value;
      return next;
    });
  if (!owner)
    return (
      <p className="muted">
        Only the project owner can manage Jira credentials and synchronization.
      </p>
    );
  if (loading) return <p role="status">Loading integration…</p>;
  return (
    <div className="integration-settings">
      <h3>Jira Cloud</h3>
      <p className="muted">
        Connect a Jira project, map its users and fields, then import issues.
        Sending local changes is a separate action on each issue or comment.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const c = await actions.save(config);
            setConnection(c);
            setMappings(c.mappings);
            setConfig(connectionConfig(c));
            await loadMetadata();
            setFeedback("Connection tested and saved.");
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Jira site
            <Input
              type="url"
              required
              placeholder="https://team.atlassian.net"
              value={config.baseUrl}
              disabled={!!connection}
              onChange={(e) => set("baseUrl", e.target.value)}
            />
          </label>
          <label>
            Jira project key
            <Input
              required
              placeholder="TEAM"
              value={config.projectKey}
              disabled={!!connection}
              onChange={(e) => set("projectKey", e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Account email
            <Input
              type="email"
              required
              autoComplete="username"
              value={config.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </label>
          <label>
            API token
            <Input
              type="password"
              required={!connection}
              autoComplete="new-password"
              placeholder={
                connection
                  ? "Leave blank to keep saved token"
                  : "Jira API token"
              }
              value={config.apiToken ?? ""}
              onChange={(e) => set("apiToken", e.target.value)}
            />
          </label>
          <p className="muted">
            Use an unscoped Jira API token with access to this project.
            Credentials are encrypted on the server.
          </p>
          <Button
            variant="ghost"
            onClick={() =>
              void run(async () => {
                const metadata = await actions.discover(
                  connection && !config.apiToken ? undefined : config,
                );
                setMetadata(metadata);
                setMappings((previous) => ({
                  ...previous,
                  statuses: matchJiraStatuses(
                    metadata.statuses,
                    settings.states,
                    previous.statuses,
                  ),
                }));
                setFeedback(
                  "Connection successful. Choose the default issue type.",
                );
              })
            }
          >
            Test connection & load options
          </Button>
          <label>
            Default Jira issue type
            {metadata ? (
              <Select
                required
                value={config.issueTypeId}
                onChange={(e) => set("issueTypeId", e.target.value)}
              >
                <option value="">Choose an issue type</option>
                {metadata.issueTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                required
                placeholder="Load options first, or enter an issue type ID"
                value={config.issueTypeId}
                onChange={(e) => set("issueTypeId", e.target.value)}
              />
            )}
          </label>
          <Button type="submit">
            {connection ? "Save credentials" : "Connect Jira"}
          </Button>
        </fieldset>
      </form>
      {connection && (
        <>
          <label>
            Automatic import
            <Select
              disabled={busy || mappingDirty}
              value={connection.scheduleMinutes ?? ""}
              onChange={(e) => {
                const minutes = e.target.value
                  ? (Number(e.target.value) as 15 | 60 | 1440)
                  : null;
                void run(async () => {
                  setConnection(await actions.schedule(minutes));
                  setFeedback(
                    minutes
                      ? "Import schedule saved."
                      : "Automatic import disabled.",
                  );
                });
              }}
            >
              <option value="">Disabled</option>
              <option value="15">Every 15 minutes</option>
              <option value="60">Every hour</option>
              <option value="1440">Every day</option>
            </Select>
          </label>
          <p className="integration-help">
            The first scheduled run imports all issues; later runs fetch issues
            updated since the last successful run, with a five-minute overlap.
            Full import below always scans all issues using saved mappings and
            the same conflict checks. Disabling the schedule prevents future
            runs; use Stop import to cancel the current run.
          </p>
          {connection.nextImportAt && (
            <p>
              Next scheduled import:{" "}
              {new Date(connection.nextImportAt).toLocaleString()}
            </p>
          )}
          {connection.lastScheduledAt && (
            <p>
              Last scheduled import:{" "}
              {new Date(connection.lastScheduledAt).toLocaleString()} —{" "}
              {connection.lastScheduleResult}
            </p>
          )}
          <div className="integration-toolbar">
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => void run(loadMetadata)}
            >
              Load mappings
            </Button>
            <Button
              disabled={busy || mappingDirty}
              onClick={() =>
                void run(async () => {
                  cancel.current = false;
                  setImporting(true);
                  let runId: string | undefined;
                  try {
                    runId = (await actions.startImport()).runId;
                    activeRun.current = runId;
                    if (cancel.current) {
                      await actions.stopImport(runId);
                      return;
                    }
                    const prepared = await actions.prepare(runId);
                    setMappings(prepared.mappings);
                    setFailures([]);
                    let token: string | undefined;
                    let done = 0;
                    const failed: { id: string; key: string; error: string }[] =
                      [];
                    do {
                      const page = await actions.search(token, runId);
                      for (const issue of page.issues) {
                        if (cancel.current) break;
                        setFeedback(
                          `Importing ${issue.key} · ${done} completed`,
                        );
                        try {
                          await actions.import(issue.id, false, runId);
                          done++;
                        } catch (e) {
                          if (
                            cancel.current ||
                            (e instanceof Error &&
                              e.message.includes("Import stopped"))
                          ) {
                            cancel.current = true;
                            break;
                          }
                          failed.push({
                            ...issue,
                            error:
                              e instanceof Error ? e.message : "Import failed",
                          });
                          setFailures([...failed]);
                        }
                      }
                      token = page.nextPageToken ?? undefined;
                    } while (token && !cancel.current);
                    await actions.refresh();
                    setSettings(await actions.settings());
                    const c = await actions.get();
                    if (c) {
                      setConnection(c);
                      setMappings(c.mappings);
                    }
                    setFeedback(
                      `${cancel.current ? "Stopped" : "Import finished"}: ${done} issues imported, ${failed.length} failed. Completed records are saved; retrying imports is safe.`,
                    );
                  } catch (e) {
                    if (
                      cancel.current ||
                      (e instanceof Error &&
                        e.message.includes("Import stopped"))
                    )
                      setFeedback(
                        "Import stopped. Completed records are saved; you can start again.",
                      );
                    else throw e;
                  } finally {
                    if (runId)
                      await actions.finishImport(runId).catch(() => {});
                    activeRun.current = null;
                    setImporting(false);
                    setStopping(false);
                    await actions.refresh();
                    setSettings(await actions.settings());
                    const latest = await actions.get();
                    if (latest) {
                      setConnection(latest);
                      setMappings(latest.mappings);
                    }
                  }
                })
              }
            >
              Full import
            </Button>
            {(importing || connection.importRunId) && (
              <Button
                variant="ghost"
                disabled={stopping}
                onClick={async () => {
                  cancel.current = true;
                  setStopping(true);
                  setFeedback("Stopping import…");
                  const runId = activeRun.current ?? connection.importRunId;
                  try {
                    if (runId) await actions.stopImport(runId);
                    if (!importing) {
                      setFeedback(
                        "Stop requested. Completed records are saved.",
                      );
                      setStopping(false);
                    }
                  } catch (e) {
                    setStopping(false);
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not stop import. Retry Stop.",
                    );
                  }
                }}
              >
                {stopping ? "Stopping…" : "Stop import"}
              </Button>
            )}
          </div>
          {mappingDirty && (
            <p className="muted">
              Save your mapping changes before importing issues.
            </p>
          )}
          {connection.lastImportedAt && (
            <p className="muted">
              Last issue imported{" "}
              {new Date(connection.lastImportedAt).toLocaleString()}
            </p>
          )}
          {!!settings.externalIdentities?.length && (
            <section className="integration-settings">
              <h3>External users</h3>
              <p className="muted">
                Imported identities have no login or project access. Optionally
                link them to existing members; their comments and worklogs keep
                their attribution.
              </p>
              <div className="integration-mapping">
                {settings.externalIdentities.map((identity) => (
                  <label key={identity.id}>
                    <span>
                      {identity.displayName}
                      <small>{identity.externalId}</small>
                    </span>
                    <Select
                      aria-label={`Link external user ${identity.displayName}`}
                      disabled={busy}
                      value={mappings.users[identity.externalId] ?? ""}
                      onChange={(e) =>
                        map("users", identity.externalId, e.target.value)
                      }
                    >
                      <option value="">Keep as imported user</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
              <Button
                disabled={busy || !mappingDirty}
                onClick={() =>
                  void run(async () => {
                    await actions.mappings(mappings);
                    setConnection((c) => (c ? { ...c, mappings } : c));
                    setSettings(await actions.settings());
                    setFeedback("External user mappings saved.");
                  })
                }
              >
                Save user mappings
              </Button>
            </section>
          )}
          {metadata && (
            <>
              <h3>Mapping</h3>
              <p className="muted">
                Fields can map to built-in Estimate time, Start at and Finish at
                / deadline, or to project fields. Estimates use seconds; Jira
                Original estimate is converted automatically. Date-only values
                use midnight UTC.
              </p>
              <p className="muted">
                Statuses with matching names are selected automatically
                (ignoring capitalization and surrounding spaces). Existing
                mappings are kept. Review the remaining differences and save
                your mappings. Unmatched statuses and priorities are created
                during import. Unmapped fields are ignored. Missing Jira users
                are imported automatically without login or project access.
                Linking them to project members is optional.
              </p>
              {(["statuses", "priorities", "fields", "users"] as const).map(
                (kind) => {
                  const rows =
                    kind === "users"
                      ? [
                          ...new Map(
                            [
                              ...(settings.externalIdentities ?? []).map(
                                (i) => ({
                                  id: i.externalId,
                                  name: i.displayName,
                                }),
                              ),
                              ...metadata.users.map((u) => ({
                                id: u.accountId,
                                name: u.displayName,
                              })),
                              ...Object.keys(mappings.users).map((id) => ({
                                id,
                                name:
                                  metadata.users.find((u) => u.accountId === id)
                                    ?.displayName ?? id,
                              })),
                            ].map((x) => [x.id, x]),
                          ).values(),
                        ]
                      : metadata[kind].filter(
                          (r) => kind !== "fields" || !reserved.has(r.id),
                        );
                  const options =
                    kind === "statuses"
                      ? settings.states.filter((s) => !s.deletedAt)
                      : kind === "priorities"
                        ? settings.priorities.filter((s) => !s.deletedAt)
                        : kind === "fields"
                          ? [
                              ...builtInIssueFields.map((f) => ({
                                ...f,
                                name: `${f.name} (built-in)`,
                              })),
                              ...(settings.fields ?? []),
                            ]
                          : members;
                  return (
                    <details key={kind} open={kind === "users"}>
                      <summary>
                        {kind[0]!.toUpperCase() + kind.slice(1)}
                      </summary>
                      <div className="integration-mapping">
                        {rows.map((row) => (
                          <label key={row.id}>
                            <span>
                              {row.name}
                              <small>{row.id}</small>
                            </span>
                            <Select
                              aria-label={`Map ${kind} ${row.name}`}
                              disabled={busy}
                              value={
                                mappings[kind][row.id] === null
                                  ? "ignore"
                                  : (mappings[kind][row.id] ?? "")
                              }
                              onChange={(e) =>
                                map(kind, row.id, e.target.value)
                              }
                            >
                              <option value="">
                                {kind === "fields"
                                  ? "Ignore"
                                  : kind === "users"
                                    ? "Keep as imported user"
                                    : "Create on import"}
                              </option>
                              {kind === "fields" && (
                                <option value="ignore">
                                  Ignore explicitly
                                </option>
                              )}
                              {options.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                  {"type" in o ? ` (${o.type})` : ""}
                                </option>
                              ))}
                            </Select>
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                },
              )}
              <label>
                Historical Jira user account ID
                <Input
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="Optional: map a Jira account before importing"
                />
              </label>
              <Button
                disabled={busy || !accountId.trim()}
                variant="ghost"
                onClick={() => {
                  setMetadata((m) =>
                    m
                      ? {
                          ...m,
                          users: [
                            ...m.users,
                            {
                              accountId: accountId.trim(),
                              displayName: accountId.trim(),
                            },
                          ],
                        }
                      : m,
                  );
                  setAccountId("");
                }}
              >
                Add user to mapping
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await actions.mappings(mappings);
                    setConnection((c) => (c ? { ...c, mappings } : c));
                    setSettings(await actions.settings());
                    setFeedback("Mappings saved.");
                  })
                }
              >
                Save mappings
              </Button>
            </>
          )}
          {!!pending.length && (
            <>
              <h3>Creates needing reconciliation</h3>
              <p className="muted">
                A request may have succeeded in Jira before its response was
                lost. Find the created entity and link its ID before retrying.
              </p>
              {pending.map((p) => (
                <form
                  key={p.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void run(async () => {
                      await actions.reconcile(
                        p.kind as "issue" | "comment",
                        p.id,
                        String(data.get("externalId")),
                      );
                      setPending(await actions.pending());
                      setFeedback("Linked. You can now retry sending.");
                    });
                  }}
                >
                  <label>
                    {p.kind} · {p.id}
                    <Input
                      name="externalId"
                      required
                      placeholder="Jira issue ID/key or comment ID"
                    />
                  </label>
                  <Button disabled={busy} type="submit">
                    Link existing Jira entity
                  </Button>
                </form>
              ))}
            </>
          )}
        </>
      )}
      {feedback && (
        <p role="status" className="project-feedback">
          {feedback}
        </p>
      )}
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
      {!!failures.length && (
        <section>
          <h3>Import errors</h3>
          <p className="muted">
            An issue may be partially imported. Fix the mapping or error and
            retry.
          </p>
          <ul>
            {failures.map((f) => (
              <li key={f.id}>
                <strong>{f.key}</strong>: {f.error}{" "}
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() =>
                    void run(async () => {
                      await importSingle(f.id);
                      setFailures((rows) => rows.filter((r) => r.id !== f.id));
                      await actions.refresh();
                      setFeedback(`${f.key} imported.`);
                    })
                  }
                >
                  Retry
                </Button>
                {f.error.includes("Both Spectron and Jira changed") && (
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() =>
                      void run(async () => {
                        await importSingle(f.id, true);
                        setFailures((rows) =>
                          rows.filter((r) => r.id !== f.id),
                        );
                        await actions.refresh();
                        setFeedback(
                          `${f.key}: replaced local edits with Jira values.`,
                        );
                      })
                    }
                  >
                    Replace local edits with Jira values
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
