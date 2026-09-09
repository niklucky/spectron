import { useEffect, useState } from "react";
import { exportActions, type ExportAction, type ExportConfig, type ExportStatus } from "@spectron/shared";
import { Button } from "../../ui/button";
import { Input, Select } from "../../ui/input";
export type ExportActions = {
  get: () => Promise<ExportStatus>;
  save: (config: ExportConfig) => Promise<void>;
  retry: (id: string) => Promise<void>;
  reconcile: (id: string, remoteId: string) => Promise<void>;
};
const names: Record<ExportAction, string> = {
  "issue.create": "Create issue", "issue.update": "Update issue",
  "comment.create": "Create comment", "comment.update": "Update comment",
  "worklog.create": "Create worklog", "worklog.delete": "Delete worklog",
};
export function ExportSettings({ actions, onBusyChange, disabled = false }: { actions: ExportActions; onBusyChange: (busy: boolean) => void; disabled?: boolean }) {
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [draft, setDraft] = useState<ExportConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reconcile, setReconcile] = useState<string | null>(null);
  const [remoteId, setRemoteId] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => { void actions.get().then(s => { if (active) setStatus(s); }).catch(e => { if (active) setError(e.message); }); };
    load(); const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [actions]);
  async function run(action: () => Promise<void>) {
    setBusy(true); onBusyChange(true); setError(""); setFeedback("");
    try { await action(); setStatus(await actions.get()); }
    catch (e) { setError(e instanceof Error ? e.message : "Export operation failed."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  if (!status) return <p role="status">{error || "Loading export settings…"}</p>;
  const config = draft ?? status.config;
  return <section className="integration-panel export-settings">
    <div className="integration-toolbar"><h3>Export</h3>{draft ? <><Button variant="ghost" disabled={busy || disabled} onClick={() => setDraft(null)}>Cancel</Button><Button disabled={busy || disabled} onClick={() => void run(async () => { await actions.save(draft); setDraft(null); setFeedback("Export settings saved."); })}>Save</Button></> : <Button variant="ghost" disabled={busy || disabled} onClick={() => setDraft({ ...status.config, actions: [...status.config.actions] })}>Edit</Button>}</div>
    <fieldset disabled={!draft || busy || disabled}>
      <label>Export mode<Select value={config.mode} onChange={e => setDraft({ ...config, mode: e.target.value as ExportConfig["mode"] })}><option value="off">Off</option><option value="on_save">On save</option><option value="scheduled">By schedule</option></Select></label>
      {config.mode === "scheduled" && <label>Export schedule<Select value={config.intervalMinutes} onChange={e => setDraft({ ...config, intervalMinutes: Number(e.target.value) as ExportConfig["intervalMinutes"] })}><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="1440">Every day</option></Select></label>}
      <div className="export-action-options">{exportActions.map(action => <label key={action}><input type="checkbox" checked={config.actions.includes(action)} onChange={e => setDraft({ ...config, actions: e.target.checked ? [...config.actions, action] : config.actions.filter(a => a !== action) })} />{names[action]}</label>)}</div>
    </fieldset>
    <p className="muted">Exports new local changes after you enable this setting. On save queues changes immediately; scheduled export runs on the server. Existing issues are not bulk-exported. Turning export off cancels queued jobs; a request already being sent may finish.</p>
    <p className="muted">The connected account performs exports. Issue creation must be enabled to export comments or worklogs on an unlinked issue. Worklog updates are not exported.</p>
    {status.nextRunAt && <p className="muted">Next export: {new Date(status.nextRunAt).toLocaleString()}</p>}
    <h4>Export log</h4>
    <p className="muted">{status.counts.pending} pending · {status.counts.running} running · {status.counts.succeeded} successful · {status.counts.failed} failed · {status.counts.cancelled} cancelled</p>
    {!status.entries.length && <p className="muted">No exports queued yet.</p>}
    <div className="export-log">{status.entries.map(entry => <article key={entry.id}>
      <div><strong>{names[entry.action]}</strong> <span>{entry.status}</span> <time>{new Date(entry.createdAt).toLocaleString()}</time></div>
      <small>{entry.entityId} · {entry.attempts} attempts</small>
      {entry.error && <p>{entry.error}</p>}
      {entry.status === "failed" && <div className="integration-toolbar"><Button variant="ghost" disabled={busy || disabled || status.config.mode === "off"} onClick={() => void run(async () => { await actions.retry(entry.id); setFeedback("Export queued for retry."); })}>Retry</Button>{entry.action.startsWith("worklog.") && entry.error?.includes("reconciliation") && <Button variant="ghost" disabled={busy || disabled} onClick={() => { setReconcile(entry.id); setRemoteId(""); }}>Link remote worklog</Button>}</div>}
      {reconcile === entry.id && <form onSubmit={e => { e.preventDefault(); void run(async () => { await actions.reconcile(entry.id, remoteId); setReconcile(null); setFeedback("Worklog linked. Retry the failed export."); }); }}><label>Remote worklog ID<Input required value={remoteId} onChange={e => setRemoteId(e.target.value)} /></label><Button disabled={busy || disabled} type="submit">Save link</Button><Button variant="ghost" disabled={busy || disabled} onClick={() => setReconcile(null)}>Cancel</Button></form>}
    </article>)}</div>
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert" className="project-error">{error}</p>}
  </section>;
}
