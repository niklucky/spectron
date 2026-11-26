import { JiraImportProgressPopover } from "./jira-import-progress";
import { JiraFieldPicker } from "./jira-field-picker";
import { ExportSettings, type ExportActions } from "./export-settings";
import { IntegrationSyncLog } from "./integration-sync-log";
import { useEffect, useRef, useState } from "react";
import { jiraImportActivity, builtInIssueFields, jiraProjectFieldType } from "@spectron/shared";
import type {
  JiraConfigInput,
  JiraConnection,
  JiraMappings,
  JiraMetadata,
  IssueSettings,
  ProjectMemberSummary,
} from "@spectron/shared";
import { Field, Input, Select } from "../../ui/input";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Spinner } from "../../ui/status";
import { Disclosure, Feedback, Note, SettingsSection } from "../../ui/settings";
import { formatDateTime } from "../../../lib/date-format";
import { availableMappingOptions, jiraMappingRows } from "../../../lib/jira-mapping-rows";
export type JiraActions = {
  exports: ExportActions;
  test: (config: JiraConfigInput) => Promise<{ issueTypes: { id: string; name: string }[] }>;
  get: () => Promise<JiraConnection | null>;
  save: (config: JiraConfigInput) => Promise<JiraConnection>;
  discover: (config?: JiraConfigInput) => Promise<JiraMetadata>;
  mappings: (mappings: JiraMappings) => Promise<void>;
  schedule: (minutes: 15 | 60 | 1440 | null) => Promise<JiraConnection>;
  startFullImport: () => Promise<JiraConnection>;
  startImport: () => Promise<{ runId: string }>;
  stopImport: (runId: string) => Promise<void>;
  finishImport: (runId: string) => Promise<void>;
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
type FeedbackScope = "connection" | "mapping" | "sync";
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
function fieldCreationInfo(id: string, field?: JiraMetadata["fields"][number]) {
  const jiraType = field?.schema?.type || "Unknown";
  if (id === "labels") return { jiraType, reason: "Map labels to Tags." };
  if (!field) return { jiraType, reason: "Jira field type is unknown." };
  const createType = jiraProjectFieldType(field);
  const name = field.name.trim();
  if (!name || name.length > 80) return { jiraType, reason: "Field names must be 1–80 characters." };
  return { jiraType, createType };
}

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
  const [fieldFilter, setFieldFilter] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState("");
  const testing = testStatus === "testing";
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
    // Which section the last operation belonged to, so its outcome shows
    // beside the controls that triggered it instead of further down the page.
    [scope, setScope] = useState<FeedbackScope>("connection"),
    [accountId, setAccountId] = useState(""),
    [pending, setPending] = useState<{ id: string; kind: string }[]>([]);
  const cancel = useRef(false);
  const activeRun = useRef<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const foregroundBusy = busy || exportBusy;
  const locked = foregroundBusy || !!connection?.importRunId;
  useEffect(() => {
    onBusyChange(foregroundBusy);
  }, [foregroundBusy, onBusyChange]);
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
        // Nothing to edit yet: the form is the create form, so it is open.
        if (!c) setEditingConnection(true);
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
  const pollInterval = connection ? (connection.importRunId ? 2500 : 15000) : 0;
  useEffect(() => {
    if (!owner || !pollInterval) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const latest = await actions.get();
        if (active) setConnection(latest);
      } catch { /* Keep the last known progress while reconnecting. */ }
      if (active) timer = setTimeout(poll, pollInterval);
    }
    timer = setTimeout(poll, pollInterval);
    return () => { active = false; clearTimeout(timer); };
  }, [actions, owner, pollInterval]);

  const progress = connection?.importProgress;
  const failures = progress?.errors ?? [];
  const activity = connection && jiraImportActivity(connection);
  const terminalRun = progress && !["queued", "running"].includes(progress.status) ? progress.id : null;
  useEffect(() => {
    if (!terminalRun) return;
    let active = true;
    void Promise.all([actions.settings(), actions.refresh()]).then(([s]) => {
      if (active) setSettings(s);
    }).catch(() => {});
    return () => { active = false; };
  }, [terminalRun, actions]);
  const savedMappings = connection?.mappings;
  useEffect(() => {
    if (!editingMappings && savedMappings) setMappings(savedMappings);
  }, [savedMappings, editingMappings]);

  async function run(fn: () => Promise<void>, where: FeedbackScope = "sync") {
    if (locked) return;
    setBusy(true);
    setScope(where);
    setError("");
    setFeedback("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Jira operation failed.");
    } finally {
      setBusy(false);
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
  async function testConnection() {
    if (testing) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const credentials = connection && !editingConnection ? connectionConfig(connection) : config;
      const result = await actions.test(credentials);
      setIssueTypes(result.issueTypes);
      setTestStatus("success");
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : "Could not connect to Jira.");
      setTestStatus("error");
    }
  }
  async function loadMetadata() {
    setMetadataError("");
    const metadata = await actions.discover();
    const settings = await actions.settings();
    setMetadata(metadata);
    setIssueTypes(metadata.issueTypes);
    setSettings(settings);
    setPending(await actions.pending());
  }
  const jiraFields = new Map(metadata?.fields.map(field => [field.id, field]));
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
      <p className="text-sm text-ink-2">
        Only the project owner can manage Jira credentials and synchronization.
      </p>
    );
  if (loading) return <p role="status" className="text-sm text-ink-3">Loading integration…</p>;
  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Connection"
        description="The connected account performs imports and exports. Credentials are encrypted on the server."
        actions={
          connection && !editingConnection ? (
            <Button variant="secondary" size="sm" disabled={locked || testing} onClick={() => setEditingConnection(true)}>Edit</Button>
          ) : connection && editingConnection ? (
            <Button variant="ghost" size="sm" disabled={locked || testing} onClick={() => { setTestStatus("idle"); setConfig(connectionConfig(connection)); setEditingConnection(false); }}>Cancel</Button>
          ) : undefined
        }
      >
      <form
        className="flex max-w-[440px] flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!editingConnection || testing) return;
          void run(async () => {
            const c = await actions.save({ ...config, issueTypeId: connection?.issueTypeId ?? "" });
            setConnection(c);
            setMappings(c.mappings);
            setConfig(connectionConfig(c));
            setEditingConnection(false);
            setFeedback("Connection saved.");
          }, "connection");
        }}
      >
        <fieldset disabled={locked || testing || !editingConnection} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <Field label="Jira site">
            <Input
              type="url"
              required
              placeholder="https://team.atlassian.net"
              value={config.baseUrl}
              disabled={!!connection}
              onChange={(e) => set("baseUrl", e.target.value)}
            />
          </Field>
          <Field label="Project key">
            <Input
              required
              placeholder="TEAM"
              value={config.projectKey}
              disabled={!!connection}
              onChange={(e) => set("projectKey", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Account email">
            <Input
              type="email"
              required
              autoComplete="username"
              placeholder="you@company.com"
              value={config.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="API token" hint="An unscoped Jira API token with access to this project.">
            <Input
              type="password"
              required={!connection}
              autoComplete="new-password"
              placeholder={
                connection
                  ? "Leave blank to keep the saved token"
                  : "Paste the token"
              }
              value={config.apiToken ?? ""}
              onChange={(e) => set("apiToken", e.target.value)}
            />
          </Field>
        </fieldset>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {editingConnection && <Button type="submit" disabled={locked || testing}>
            {connection ? "Save credentials" : "Connect Jira"}
          </Button>}
          <Button variant="secondary" disabled={testing} onClick={() => void testConnection()}>
            {testing ? <Spinner size={13} /> : <Icon name="check-circle" size={14} />}
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </form>
      <Feedback
        error={testStatus === "error" ? testError : undefined}
        feedback={testStatus === "success" ? "Connection successful." : undefined}
      />
      {scope === "connection" && <Feedback error={error} feedback={feedback} />}
      </SettingsSection>
      {connection && (
        <>
          <SettingsSection
            title="Field mapping"
            description="How Jira statuses, priorities, types, fields and people correspond to this project."
            actions={<>
            <Button variant="ghost" size="sm" disabled={locked || metadataLoading || editingMappings} onClick={() => void run(loadMetadata, "mapping")}>Refresh Jira options</Button>
            {!editingMappings ? <Button variant="secondary" size="sm" disabled={locked} onClick={() => setEditingMappings(true)}>Edit</Button> : <>
              <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setMappings(connection.mappings); setConfig(connectionConfig(connection)); setEditingMappings(false); }}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={locked} onClick={() => void run(async () => {
                if (config.issueTypeId !== connection.issueTypeId) {
                  const saved = await actions.save({ ...connectionConfig(connection), issueTypeId: config.issueTypeId });
                  setConnection(saved);
                }
                await actions.mappings(mappings);
                const latest = await actions.get();
                if (latest) {
                  setConnection(latest);
                  setMappings(latest.mappings);
                }
                setSettings(await actions.settings());
                setEditingMappings(false);
                setFeedback("Mappings saved.");
              }, "mapping")}>Save</Button>
            </>}
            </>}
          >
          {metadataLoading && <p role="status" className="text-sm text-ink-3">Refreshing Jira options… Saved mappings are shown below.</p>}
          {metadataError && <p role="status" className="text-sm text-warn">Could not refresh Jira options: {metadataError}. Saved mappings remain available.</p>}
          <div className="flex flex-col gap-2">
          {(["statuses", "priorities", "issueTypes", "fields", "users"] as const).map(kind => {
            const remote = kind === "users"
              ? [...(settings.externalIdentities ?? []).map(i => ({ id: i.externalId, name: i.displayName })), ...(metadata?.users ?? []).map(u => ({ id: u.accountId, name: u.displayName }))]
              : kind === "issueTypes" ? (metadata?.issueTypes ?? issueTypes) : (metadata?.[kind] ?? []).filter(r => kind !== "fields" || !reserved.has(r.id));
            const rows = jiraMappingRows([
              ...remote,
              ...(kind === "fields" ? [{ id: "labels", name: "Labels (tags)" }] : []),
            ], Object.keys(mappings[kind] ?? {}).filter(id => kind !== "fields" || !reserved.has(id)));
            const options = kind === "statuses" ? settings.states.filter(s => !s.deletedAt)
              : kind === "priorities" ? settings.priorities.filter(s => !s.deletedAt)
              : kind === "issueTypes" ? (settings.issueTypes ?? []).filter(s => !s.deletedAt)
              : kind === "fields" ? [...builtInIssueFields, ...(settings.fields ?? [])] : members;
            const optionsForValue = availableMappingOptions(mappings[kind]);
            const query = kind === "fields" ? fieldFilter.trim().toLowerCase() : "";
            const visibleRows = query ? rows.filter(row =>
              row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query)
            ) : rows;
            const mapped = rows.filter(row => !!mappings[kind]?.[row.id]).length;
            return <Disclosure key={kind} summary={kind === "issueTypes" ? "Issue types" : kind[0]!.toUpperCase() + kind.slice(1)} count={`${mapped} / ${metadata ? rows.length : `${rows.length} known`}`}>
              {kind === "fields" && <Input type="search" aria-label="Filter Jira fields" placeholder="Filter by field name or ID…" value={fieldFilter} onChange={event => setFieldFilter(event.target.value)} />}
              <fieldset disabled={locked || !editingMappings} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
                {kind === "users" && <Note>Map Jira users, including imported historical users, to project members. Unlinked users keep their imported attribution and have no login or project access.</Note>}
                {kind === "fields" && <Note>Choose an existing field or create one on import for supported Jira types. Mapping labels to Tags replaces issue tags on import.</Note>}
                <div className="flex max-h-[340px] flex-col gap-2 overflow-auto">{visibleRows.map(row => {
                  const candidates = row.id === "labels" && kind === "fields" ? [{ id: "issue:tags", name: "Tags" }] : options;
                  const value = mappings[kind]?.[row.id] ?? "";
                  const rowOptions = optionsForValue(candidates, value);
                  const info = kind === "fields" ? fieldCreationInfo(row.id, jiraFields.get(row.id)) : undefined;
                  const createType = info?.createType;
                  const hintId = info ? `jira-field-info-${row.id}` : undefined;
                  return <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(160px,1fr)] items-center gap-3 text-sm text-ink">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate" title={row.name}>{row.name}</span>
                      {info && <span id={hintId} className="text-xs text-ink-2">
                        Jira type: {info.jiraType}
                        {info.reason && <span className="flex items-start gap-1"><Icon name="warning" size={13} className="mt-0.5 shrink-0 text-warn" />Auto-creation unavailable. {info.reason}</span>}
                      </span>}
                    </span>
                    {kind === "fields" ? <JiraFieldPicker name={row.name} value={value} options={rowOptions}
                      createType={createType} hintId={hintId} onChange={id => map(kind, row.id, id)} /> :
                    <Select aria-label={`Map ${kind} ${row.name}`} aria-describedby={hintId} value={value} onChange={e => map(kind, row.id, e.target.value)}>
                    <option value="">{kind === "users" ? "Keep as imported user" : kind === "statuses" || kind === "priorities" ? "Create on import" : "Do not map"}</option>
                    {value && !rowOptions.some(o => o.id === value) && <option value={value}>{value} (unavailable)</option>}
                    {rowOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>}</div>;
                })}</div>
                {rows.length > 0 && !visibleRows.length && <p role="status" className="text-sm text-ink-2">No fields match your search.</p>}
                {!rows.length && <p className="text-sm text-ink-3">No saved mappings{metadata ? " or available Jira options" : "; Jira options have not loaded yet"}.</p>}
                {kind === "issueTypes" && <Field label="Fallback Jira type" hint="Jira requires a type when creating an issue. Used when the issue has no mapped local type." className="max-w-[320px]"><Select value={config.issueTypeId} onChange={e => set("issueTypeId", e.target.value)}>
                  {!issueTypes.some(t => t.id === config.issueTypeId) && <option value={config.issueTypeId}>{config.issueTypeId}</option>}
                  {issueTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select></Field>}
                {kind === "users" && <div className="flex max-w-[440px] items-center gap-2"><Input aria-label="Historical Jira user account ID" value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="Historical Jira account ID" /><Button variant="secondary" disabled={!accountId.trim()} onClick={() => { setMetadata(m => ({ ...(m ?? { statuses: [], priorities: [], fields: [], issueTypes: [], users: [] }), users: [...(m?.users ?? []), { accountId: accountId.trim(), displayName: accountId.trim() }] })); setAccountId(""); }}>Add user</Button></div>}
              </fieldset>
            </Disclosure>;
          })}
          </div>
          {scope === "mapping" && <Feedback error={error} feedback={feedback} />}
          </SettingsSection>
          <SettingsSection
            title="Sync"
            description="Automatic import brings in issues updated since the last run. A full import uses your saved mappings and continues when you leave this page."
            actions={!editingSchedule ? (
              <Button variant="secondary" size="sm" disabled={locked} onClick={() => { setScheduleDraft(connection.scheduleMinutes as 15 | 60 | 1440 | null); setEditingSchedule(true); }}>Edit schedule</Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" disabled={locked} onClick={() => setEditingSchedule(false)}>Cancel</Button>
                <Button variant="primary" size="sm" disabled={locked} onClick={() => void run(async () => { setConnection(await actions.schedule(scheduleDraft)); setEditingSchedule(false); setFeedback("Import schedule saved."); })}>Save</Button>
              </>
            )}
          >
          <Field label="Automatic import" className="max-w-[280px]">
            <Select disabled={locked || !editingSchedule} value={(editingSchedule ? scheduleDraft : connection.scheduleMinutes) ?? ""} onChange={e => setScheduleDraft(e.target.value ? Number(e.target.value) as 15 | 60 | 1440 : null)}><option value="">Off</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="1440">Every day</option></Select>
          </Field>
          <Note>
            The first scheduled run imports all issues; later runs fetch issues updated since the last successful run, with a five-minute overlap. Turning the schedule off prevents future runs; Stop import cancels the current one.
            {connection.nextImportAt && <> Next run {formatDateTime(connection.nextImportAt)}.</>}
            {connection.lastScheduledAt && <> Last run {formatDateTime(connection.lastScheduledAt)}: {connection.lastScheduleResult}.</>}
          </Note>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={locked}
              onClick={() => void run(async () => {
                setConnection(await actions.startFullImport());
              })}>
              Full import
            </Button>
            {(importing || connection.importRunId) && (
              <Button
                variant="ghost"
                disabled={stopping || connection.importCancelled}
                onClick={async () => {
                  cancel.current = true;
                  setStopping(true);
                  setScope("sync");
                  setError("");
                  setFeedback("");
                  const runId = activeRun.current ?? connection.importRunId;
                  try {
                    if (runId) await actions.stopImport(runId);
                    if (!importing) {
                      setConnection(await actions.get());
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
                {stopping || connection.importCancelled ? "Stopping…" : "Stop import"}
              </Button>
            )}
          </div>
          {progress && (progress.id === connection.importRunId || !connection.importRunId) ? (
            <div><JiraImportProgressPopover stopping={connection.importCancelled} progress={progress} /></div>
          ) : activity && <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner size={13} />{activity}</p>}
          {terminalRun && progress?.message && <Note>{progress.message}</Note>}
          {mappingDirty && <Note>Import uses saved mappings. Unsaved mapping edits are not used.</Note>}
          {connection.lastImportedAt && <Note>Last issue imported {formatDateTime(connection.lastImportedAt)}.</Note>}
          {scope === "sync" && <Feedback error={error} feedback={feedback} />}
          </SettingsSection>
          {!!pending.length && (
            <SettingsSection
              title="Needs reconciliation"
              description="A request may have succeeded in Jira before its response was lost. Find the created entity and link its ID before retrying."
              actions={<Button variant={editingReconciliation ? "ghost" : "secondary"} size="sm" disabled={locked} onClick={() => setEditingReconciliation(value => !value)}>{editingReconciliation ? "Cancel" : "Edit"}</Button>}
            >
              {pending.map((p) => (
                <form
                  className="flex max-w-[520px] flex-wrap items-end gap-2"
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
                  <Field label={`${p.kind} · ${p.id}`} className="min-w-0 flex-1">
                    <Input
                      disabled={locked || !editingReconciliation}
                      name="externalId"
                      required
                      placeholder="Jira issue ID/key or comment ID"
                    />
                  </Field>
                  <Button variant="primary" disabled={locked || !editingReconciliation} type="submit">
                    Link
                  </Button>
                </form>
              ))}
            </SettingsSection>
          )}
        </>
      )}
      {connection && !!failures.length && (
        <SettingsSection
          title="Import errors"
          description={progress && progress.failed > 100
            ? `Showing retry details from the first 100 of ${progress.failed} failures. Fix the cause and run a full import to retry them all.`
            : "An issue may be partially imported. Fix the mapping or the error and retry."}
        >
          <ul className="flex flex-col text-sm">
            {failures.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 [&+&]:hairline-t">
                <span className="mono font-medium text-ink">{f.key}</span>
                <span className="min-w-0 flex-1 text-ink-2">{f.error}</span>
                <Button
                  disabled={locked}
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      await importSingle(f.id);
                      await actions.refresh();
                      setFeedback(`${f.key} imported.`);
                    })
                  }
                >
                  Retry
                </Button>
                {f.error.includes("Both Spectron and Jira changed") && (
                  <Button
                    disabled={locked}
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await importSingle(f.id, true);
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
        </SettingsSection>
      )}
      {connection && <ExportSettings actions={actions.exports} disabled={locked} onBusyChange={setExportBusy} />}
      {connection && <IntegrationSyncLog active feedback={feedback} error={error} lastScheduledAt={connection.lastScheduledAt} lastScheduleResult={connection.lastScheduleResult} />}
    </div>
  );
}
