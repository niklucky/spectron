import { useEffect, useState } from "react";
import { exportActions, type ExportAction, type ExportConfig, type ExportStatus } from "@spectron/shared";
import { Button } from "../../ui/button";
import { Field, Input, Select } from "../../ui/input";
import { Pill, type Tone } from "../../ui/pill";
import { Feedback, Note, SettingsSection } from "../../ui/settings";
import { formatDateTime } from "../../../lib/date-format";
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
const tone = (status: string): Tone =>
  status === "succeeded" ? "ok" : status === "failed" ? "bad" : status === "running" ? "accent" : status === "cancelled" ? "neutral" : "warn";

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
  if (!status)
    return (
      <SettingsSection title="Export">
        <p role="status" className="text-sm text-ink-3">{error || "Loading export settings…"}</p>
      </SettingsSection>
    );
  const config = draft ?? status.config;
  const locked = busy || disabled;
  const counts = status.counts;
  return (
    <SettingsSection
      title="Export"
      description="Send local changes to the connected service. Only changes made after export is on are sent; existing issues are not bulk-exported."
      actions={draft ? (
        <>
          <Button variant="ghost" size="sm" disabled={locked} onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={locked} onClick={() => void run(async () => { await actions.save(draft); setDraft(null); setFeedback("Export settings saved."); })}>Save</Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" disabled={locked} onClick={() => setDraft({ ...status.config, actions: [...status.config.actions] })}>Edit</Button>
      )}
    >
      <fieldset disabled={!draft || locked} className="m-0 flex max-w-[440px] min-w-0 flex-col gap-3 border-0 p-0">
        <Field label="Export mode">
          <Select value={config.mode} onChange={e => setDraft({ ...config, mode: e.target.value as ExportConfig["mode"] })}>
            <option value="off">Off</option>
            <option value="on_save">On save</option>
            <option value="scheduled">By schedule</option>
          </Select>
        </Field>
        {config.mode === "scheduled" && (
          <Field label="Export schedule">
            <Select value={config.intervalMinutes} onChange={e => setDraft({ ...config, intervalMinutes: Number(e.target.value) as ExportConfig["intervalMinutes"] })}>
              <option value="15">Every 15 minutes</option>
              <option value="60">Every hour</option>
              <option value="1440">Every day</option>
            </Select>
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">What to export</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {exportActions.map(action => (
              <label key={action} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={config.actions.includes(action)} onChange={e => setDraft({ ...config, actions: e.target.checked ? [...config.actions, action] : config.actions.filter(a => a !== action) })} />
                {names[action]}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <Note>
        On save queues changes immediately; a schedule runs on the server. Turning export off cancels queued jobs, though a request already being sent may finish. Issue creation must be on to export comments or worklogs on an unlinked issue. Worklog updates are not exported.
        {status.nextRunAt && <> Next export {formatDateTime(status.nextRunAt)}.</>}
      </Note>
      <Feedback error={error} feedback={feedback} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-ink">Export log</h4>
          <span className="text-xs text-ink-3 tabular-nums">
            {counts.pending} pending · {counts.running} running · {counts.succeeded} done · {counts.failed} failed · {counts.cancelled} cancelled
          </span>
        </div>
        {!status.entries.length ? (
          <p className="text-sm text-ink-3">No exports queued yet.</p>
        ) : (
          <ul className="flex max-h-[480px] flex-col overflow-auto rounded-xl hairline">
            {status.entries.map(entry => (
              <li key={entry.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm [&+&]:hairline-t">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{names[entry.action]}</span>
                  <Pill tone={tone(entry.status)}>{entry.status}</Pill>
                  <span className="mono text-xs text-ink-3">{entry.entityId} · {entry.attempts} attempts</span>
                  <time className="ml-auto text-xs text-ink-3">{formatDateTime(entry.createdAt)}</time>
                </div>
                {entry.error && <p className="whitespace-pre-wrap text-bad">{entry.error}</p>}
                {entry.status === "failed" && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="secondary" size="sm" disabled={locked || status.config.mode === "off"} onClick={() => void run(async () => { await actions.retry(entry.id); setFeedback("Export queued for retry."); })}>Retry</Button>
                    {entry.action.startsWith("worklog.") && entry.error?.includes("reconciliation") && (
                      <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setReconcile(entry.id); setRemoteId(""); }}>Link remote worklog</Button>
                    )}
                  </div>
                )}
                {reconcile === entry.id && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { await actions.reconcile(entry.id, remoteId); setReconcile(null); setFeedback("Worklog linked. Retry the failed export."); }); }}>
                    <Field label="Remote worklog ID" className="w-64"><Input required value={remoteId} onChange={e => setRemoteId(e.target.value)} /></Field>
                    <Button variant="primary" disabled={locked} type="submit">Save link</Button>
                    <Button variant="ghost" disabled={locked} onClick={() => setReconcile(null)}>Cancel</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}
