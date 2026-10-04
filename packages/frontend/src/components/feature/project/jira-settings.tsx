import { ExportSettings, type ExportActions } from "./export-settings";
import { IntegrationSyncLog } from "./integration-sync-log";
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
import { Field, Input, Select } from "../../ui/input";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Spinner } from "../../ui/status";
import { Disclosure, Feedback, Note, SettingsSection } from "../../ui/settings";
import { formatDateTime } from "../../../lib/date-format";
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
  async function run(fn: () => Promise<void>, where: FeedbackScope = "sync") {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setScope(where);
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
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditingConnection(true)}>Edit</Button>
          ) : connection && editingConnection ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setConfig(connectionConfig(connection)); setEditingConnection(false); }}>Cancel</Button>
          ) : undefined
        }
      >
      <form
        className="flex max-w-[440px] flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
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
        <fieldset disabled={busy || !editingConnection} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
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
          <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary">
            {connection ? "Save credentials" : "Connect Jira"}
          </Button>
          <Button
            variant="secondary"
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
            }, "connection")}
          >
            {testStatus === "testing" ? <Spinner size={13} /> : <Icon name="check-circle" size={14} className={testStatus === "success" ? "text-ok" : testStatus === "error" ? "text-bad" : "text-ink-3"} />}
            {testStatus === "testing" ? "Testing…" : testStatus === "success" ? "Connection passed" : testStatus === "error" ? "Connection failed" : "Test connection"}
          </Button>
          </div>
        </fieldset>
      </form>
      {scope === "connection" && <Feedback error={error} feedback={feedback} />}
      </SettingsSection>
      {connection && (
        <>
          <SettingsSection
            title="Field mapping"
            description="How Jira statuses, priorities, types, fields and people correspond to this project."
            actions={<>
            <Button variant="ghost" size="sm" disabled={busy || metadataLoading || editingMappings} onClick={() => void run(loadMetadata, "mapping")}>Refresh Jira options</Button>
            {!editingMappings ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditingMappings(true)}>Edit</Button> : <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setMappings(connection.mappings); setConfig(connectionConfig(connection)); setEditingMappings(false); }}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(async () => {
                if (config.issueTypeId !== connection.issueTypeId) {
                  const saved = await actions.save({ ...connectionConfig(connection), issueTypeId: config.issueTypeId });
                  setConnection(saved);
                }
                await actions.mappings(mappings);
                setConnection(c => c ? { ...c, mappings } : c);
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
            return <Disclosure key={kind} summary={kind === "issueTypes" ? "Issue types" : kind[0]!.toUpperCase() + kind.slice(1)} count={`${mapped} / ${metadata ? rows.length : `${rows.length} known`}`}>
              <fieldset disabled={busy || !editingMappings} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
                {kind === "users" && <Note>Map Jira users, including imported historical users, to project members. Unlinked users keep their imported attribution and have no login or project access.</Note>}
                {kind === "fields" && <Note>Unmapped fields are ignored. Mapping labels to Tags replaces issue tags on import and creates missing tags by name.</Note>}
                <div className="flex max-h-[340px] flex-col gap-2 overflow-auto">{rows.map(row => {
                  const rowOptions = row.id === "labels" && kind === "fields" ? [{ id: "issue:tags", name: "Tags" }] : options;
                  const value = mappings[kind]?.[row.id] ?? "";
                  return <label key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(160px,1fr)] items-center gap-3 text-sm text-ink"><span className="truncate" title={row.name}>{row.name}</span><Select aria-label={`Map ${kind} ${row.name}`} value={value} onChange={e => map(kind, row.id, e.target.value)}>
                    <option value="">{kind === "users" ? "Keep as imported user" : kind === "statuses" || kind === "priorities" ? "Create on import" : "Do not map"}</option>
                    {value && !rowOptions.some(o => o.id === value) && <option value={value}>{value} (unavailable)</option>}
                    {rowOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select></label>;
                })}</div>
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
            description="Automatic import brings in issues updated since the last run. A full import scans everything with the saved mappings."
            actions={!editingSchedule ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setScheduleDraft(connection.scheduleMinutes as 15 | 60 | 1440 | null); setEditingSchedule(true); }}>Edit schedule</Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingSchedule(false)}>Cancel</Button>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(async () => { setConnection(await actions.schedule(scheduleDraft)); setEditingSchedule(false); setFeedback("Import schedule saved."); })}>Save</Button>
              </>
            )}
          >
          <Field label="Automatic import" className="max-w-[280px]">
            <Select disabled={busy || !editingSchedule} value={(editingSchedule ? scheduleDraft : connection.scheduleMinutes) ?? ""} onChange={e => setScheduleDraft(e.target.value ? Number(e.target.value) as 15 | 60 | 1440 : null)}><option value="">Off</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="1440">Every day</option></Select>
          </Field>
          <Note>
            The first scheduled run imports all issues; later runs fetch issues updated since the last successful run, with a five-minute overlap. Turning the schedule off prevents future runs; Stop import cancels the current one.
            {connection.nextImportAt && <> Next run {formatDateTime(connection.nextImportAt)}.</>}
            {connection.lastScheduledAt && <> Last run {formatDateTime(connection.lastScheduledAt)}: {connection.lastScheduleResult}.</>}
          </Note>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
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
          {mappingDirty && <Note>Import uses saved mappings. Unsaved mapping edits are not used.</Note>}
          {connection.lastImportedAt && <Note>Last issue imported {formatDateTime(connection.lastImportedAt)}.</Note>}
          {scope === "sync" && <Feedback error={error} feedback={feedback} />}
          </SettingsSection>
          {!!pending.length && (
            <SettingsSection
              title="Needs reconciliation"
              description="A request may have succeeded in Jira before its response was lost. Find the created entity and link its ID before retrying."
              actions={<Button variant={editingReconciliation ? "ghost" : "secondary"} size="sm" disabled={busy} onClick={() => setEditingReconciliation(value => !value)}>{editingReconciliation ? "Cancel" : "Edit"}</Button>}
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
                      disabled={busy || !editingReconciliation}
                      name="externalId"
                      required
                      placeholder="Jira issue ID/key or comment ID"
                    />
                  </Field>
                  <Button variant="primary" disabled={busy || !editingReconciliation} type="submit">
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
          description="An issue may be partially imported. Fix the mapping or the error and retry."
        >
          <ul className="flex flex-col text-sm">
            {failures.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 [&+&]:hairline-t">
                <span className="mono font-medium text-ink">{f.key}</span>
                <span className="min-w-0 flex-1 text-ink-2">{f.error}</span>
                <Button
                  disabled={busy}
                  variant="secondary"
                  size="sm"
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
                    size="sm"
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
        </SettingsSection>
      )}
      {connection && <ExportSettings actions={actions.exports} disabled={busy} onBusyChange={value => { setExportBusy(value); onBusyChange(value); }} />}
      {connection && <IntegrationSyncLog active feedback={feedback} error={error} lastScheduledAt={connection.lastScheduledAt} lastScheduleResult={connection.lastScheduleResult} />}
    </div>
  );
}
