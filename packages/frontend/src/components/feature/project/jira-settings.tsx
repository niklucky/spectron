import { ExportSettings, type ExportActions } from "./export-settings";
import { IntegrationTabs, type IntegrationTab } from "./integration-tabs";
import { IntegrationSyncLog } from "./integration-sync-log";
import { IntegrationLogo } from "./integration-overview";
import { useEffect, useRef, useState } from "react";
import { builtInIssueFields } from "@spectron/shared";
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
  exports: ExportActions;
  test: (config: JiraConfigInput) => Promise<{ issueTypes: { id: string; name: string }[] }>;
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
  "labels",
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
  const [exportBusy, setExportBusy] = useState(false);
  const [editingReconciliation, setEditingReconciliation] = useState(false);
  const [editingConnection, setEditingConnection] = useState(false);
  const [editingMappings, setEditingMappings] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<15 | 60 | 1440 | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [tab, setTab] = useState<IntegrationTab>("connection");
  const [issueTypes, setIssueTypes] = useState<{ id: string; name: string }[]>([]);
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
          setMetadataLoading(true);
          void actions.discover().then(data => {
            if (active) { setMetadata(data); setIssueTypes(data.issueTypes); }
          }).catch(e => { if (active) setMetadataError(e.message); })
            .finally(() => { if (active) setMetadataLoading(false); });
          void actions.pending().then(rows => { if (active) setPending(rows); }).catch(() => {});
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
  const set = (key: keyof JiraConfigInput, value: string) => {
    if (key !== "issueTypeId") setTestStatus("idle");
    setConfig((c) => ({ ...c, [key]: value }));
  };
  async function loadMetadata() {
    setMetadataError("");
    const metadata = await actions.discover();
    const settings = await actions.settings();
    setMetadata(metadata);
    setIssueTypes(metadata.issueTypes);
    setSettings(settings);
    setPending(await actions.pending());
  }
  const map = (kind: keyof JiraMappings, id: string, value: string) =>
    setMappings((previous) => {
      const next = { ...previous, [kind]: { ...previous[kind] } };
      if (value === "") delete next[kind]![id];
      else if (kind === "fields" && value === "ignore") next.fields[id] = null;
      else next[kind]![id] = value;
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
      <div className="integration-connection-brand"><IntegrationLogo provider="jira" /><h2>Jira Cloud</h2></div>
      <p className="muted">
        Connect a Jira project, map its users and fields, then import issues.
        Configure automatic export in Sync, or send an issue or comment manually.
      </p>
      <IntegrationTabs value={tab} onChange={(value) => { setFeedback(""); setError(""); setTab(value); }} busy={busy || exportBusy} connected={!!connection} />
      <div hidden={tab !== "connection"} className="integration-connection-form">
      <div className="integration-toolbar"><h3>Credentials</h3>{!editingConnection && <Button variant="ghost" disabled={busy} onClick={() => setEditingConnection(true)}>Edit</Button>}{editingConnection && <Button variant="ghost" disabled={busy} onClick={() => { if (connection) setConfig(connectionConfig(connection)); setEditingConnection(false); }}>Cancel</Button>}</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const c = await actions.save({ ...config, issueTypeId: connection?.issueTypeId ?? "" });
            setConnection(c);
            setMappings(c.mappings);
            setConfig(connectionConfig(c));
            setEditingConnection(false);
            setFeedback("Connection saved.");
          });
        }}
      >
        <fieldset disabled={busy || !editingConnection}>
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
          <div className="integration-connection-actions">
          <Button
            variant="ghost"
            onClick={() => void run(async () => {
              setTestStatus("testing");
              try {
                const result = await actions.test(config);
                setIssueTypes(result.issueTypes);
                setTestStatus("success");
                setFeedback("Connection successful.");
              } catch (error) {
                setTestStatus("error");
                throw error;
              }
            })}
          >
            <svg className={`connection-check connection-check-${testStatus}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
            {testStatus === "testing" ? "Testing…" : "Test connection"}
            <span className="connection-test-status">{testStatus === "success" ? "Passed" : testStatus === "error" ? "Failed" : ""}</span>
          </Button>
          <Button type="submit">
            {connection ? "Save credentials" : "Connect Jira"}
          </Button>
          </div>
        </fieldset>
      </form>
      </div>
      {connection && (
        <>
          <div hidden={tab !== "sync"} className="integration-panel">
          <div className="integration-toolbar"><h3>Automatic import</h3>{!editingSchedule ? <Button variant="ghost" disabled={busy} onClick={() => { setScheduleDraft(connection.scheduleMinutes as 15 | 60 | 1440 | null); setEditingSchedule(true); }}>Edit</Button> : <><Button variant="ghost" disabled={busy} onClick={() => setEditingSchedule(false)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { setConnection(await actions.schedule(scheduleDraft)); setEditingSchedule(false); setFeedback("Import schedule saved."); })}>Save</Button></>}</div>
          <label>Schedule<Select disabled={busy || !editingSchedule} value={(editingSchedule ? scheduleDraft : connection.scheduleMinutes) ?? ""} onChange={e => setScheduleDraft(e.target.value ? Number(e.target.value) as 15 | 60 | 1440 : null)}><option value="">Off</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="1440">Every day</option></Select></label>
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
                    if (!editingMappings) setMappings(prepared.mappings);
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
                      if (!editingMappings) setMappings(c.mappings);
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
                      if (!editingMappings) setMappings(latest.mappings);
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
              Import uses saved mappings. Your unsaved mapping edits will not be used.
            </p>
          )}
          {connection.lastImportedAt && (
            <p className="muted">
              Last issue imported{" "}
              {new Date(connection.lastImportedAt).toLocaleString()}
            </p>
          )}
          </div>
          <div hidden={tab !== "mapping"} className="integration-panel">
          <div className="integration-toolbar">
            <h3>Mapping</h3>
            <Button variant="ghost" disabled={busy || metadataLoading || editingMappings} onClick={() => void run(loadMetadata)}>Refresh Jira options</Button>
            {!editingMappings ? <Button variant="ghost" disabled={busy} onClick={() => setEditingMappings(true)}>Edit</Button> : <>
              <Button variant="ghost" disabled={busy} onClick={() => { setMappings(connection.mappings); setConfig(connectionConfig(connection)); setEditingMappings(false); }}>Cancel</Button>
              <Button disabled={busy} onClick={() => void run(async () => {
                if (config.issueTypeId !== connection.issueTypeId) {
                  const saved = await actions.save({ ...connectionConfig(connection), issueTypeId: config.issueTypeId });
                  setConnection(saved);
                }
                await actions.mappings(mappings);
                setConnection(c => c ? { ...c, mappings } : c);
                setSettings(await actions.settings());
                setEditingMappings(false);
                setFeedback("Mappings saved.");
              })}>Save</Button>
            </>}
          </div>
          {metadataLoading && <p role="status" className="muted">Refreshing Jira options… Saved mappings are shown below.</p>}
          {metadataError && <p role="status" className="muted">Could not refresh Jira options: {metadataError}. Saved mappings remain available.</p>}
          {(["statuses", "priorities", "issueTypes", "fields", "users"] as const).map(kind => {
            const remote = kind === "users"
              ? [...(settings.externalIdentities ?? []).map(i => ({ id: i.externalId, name: i.displayName })), ...(metadata?.users ?? []).map(u => ({ id: u.accountId, name: u.displayName }))]
              : kind === "issueTypes" ? (metadata?.issueTypes ?? issueTypes) : (metadata?.[kind] ?? []).filter(r => kind !== "fields" || !reserved.has(r.id));
            const rows = [...new Map([
              ...Object.keys(mappings[kind] ?? {}).filter(id => kind !== "fields" || !reserved.has(id)).map(id => ({ id, name: id })),
              ...remote,
              ...(kind === "fields" ? [{ id: "labels", name: "Labels (tags)" }] : []),
            ].map(row => [row.id, row])).values()];
            const options = kind === "statuses" ? settings.states.filter(s => !s.deletedAt)
              : kind === "priorities" ? settings.priorities.filter(s => !s.deletedAt)
              : kind === "issueTypes" ? (settings.issueTypes ?? []).filter(s => !s.deletedAt)
              : kind === "fields" ? [...builtInIssueFields, ...(settings.fields ?? [])] : members;
            const mapped = rows.filter(row => !!mappings[kind]?.[row.id]).length;
            return <details className="integration-mapping-section" key={kind}>
              <summary><span>{kind === "issueTypes" ? "Issue types" : kind[0]!.toUpperCase() + kind.slice(1)}</span><span className="integration-mapping-count">{mapped} / {metadata ? rows.length : `${rows.length} known`}</span></summary>
              <fieldset disabled={busy || !editingMappings}>
                {kind === "users" && <p className="muted">Map Jira users, including imported historical users, to project members. Unlinked users keep their imported attribution and have no login or project access.</p>}
                {kind === "fields" && <p className="muted">Unmapped fields are ignored. Mapping labels to Tags replaces issue tags on import and creates missing tags by name.</p>}
                <div className="integration-mapping">{rows.map(row => {
                  const rowOptions = row.id === "labels" && kind === "fields" ? [{ id: "issue:tags", name: "Tags" }] : options;
                  const value = mappings[kind]?.[row.id] ?? "";
                  return <label key={row.id}><span>{row.name}</span><Select aria-label={`Map ${kind} ${row.name}`} value={value} onChange={e => map(kind, row.id, e.target.value)}>
                    <option value="">{kind === "users" ? "Keep as imported user" : kind === "statuses" || kind === "priorities" ? "Create on import" : "Do not map"}</option>
                    {value && !rowOptions.some(o => o.id === value) && <option value={value}>{value} (unavailable)</option>}
                    {rowOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select></label>;
                })}</div>
                {!rows.length && <p className="muted">No saved mappings{metadata ? " or available Jira options" : "; Jira options have not loaded yet"}.</p>}
                {kind === "issueTypes" && <label>Fallback Jira type<Select value={config.issueTypeId} onChange={e => set("issueTypeId", e.target.value)}>
                  {!issueTypes.some(t => t.id === config.issueTypeId) && <option value={config.issueTypeId}>{config.issueTypeId}</option>}
                  {issueTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select><span className="muted">Jira requires a type when creating an issue. This fallback is used when the issue has no mapped local type.</span></label>}
                {kind === "users" && <div className="integration-toolbar"><Input aria-label="Historical Jira user account ID" value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="Historical Jira account ID" /><Button variant="ghost" disabled={!accountId.trim()} onClick={() => { setMetadata(m => ({ ...(m ?? { statuses: [], priorities: [], fields: [], issueTypes: [], users: [] }), users: [...(m?.users ?? []), { accountId: accountId.trim(), displayName: accountId.trim() }] })); setAccountId(""); }}>Add user</Button></div>}
              </fieldset>
            </details>;
          })}
          </div>
          <div hidden={tab !== "sync"} className="integration-panel">
          {!!pending.length && (
            <>
              <div className="integration-toolbar"><h3>Creates needing reconciliation</h3><Button variant="ghost" disabled={busy} onClick={() => setEditingReconciliation(value => !value)}>{editingReconciliation ? "Cancel" : "Edit"}</Button></div>
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
                      setEditingReconciliation(false);
                      setFeedback("Linked. You can now retry sending.");
                    });
                  }}
                >
                  <label>
                    {p.kind} · {p.id}
                    <Input
                      disabled={busy || !editingReconciliation}
                      name="externalId"
                      required
                      placeholder="Jira issue ID/key or comment ID"
                    />
                  </label>
                  <Button disabled={busy || !editingReconciliation} type="submit">
                    Link existing Jira entity
                  </Button>
                </form>
              ))}
            </>
          )}
          </div>
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
      {tab === "sync" && !!failures.length && (
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
      {connection && tab === "sync" && <ExportSettings actions={actions.exports} disabled={busy} onBusyChange={value => { setExportBusy(value); onBusyChange(value); }} />}
      <div hidden={tab !== "sync"}><IntegrationSyncLog active={tab === "sync"} feedback={feedback} error={error} lastScheduledAt={connection?.lastScheduledAt} lastScheduleResult={connection?.lastScheduleResult} /></div>
    </div>
  );
}
