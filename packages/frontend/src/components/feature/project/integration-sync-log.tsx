import { useEffect, useState } from "react";
export function IntegrationSyncLog({ active, feedback, error, lastScheduledAt, lastScheduleResult }: {
  active: boolean; feedback: string; error: string; lastScheduledAt?: string | null | undefined; lastScheduleResult?: string | null | undefined;
}) {
  const [entries, setEntries] = useState<{ at: string; message: string; failed: boolean }[]>([]);
  useEffect(() => {
    if (!active || (!feedback && !error)) return;
    setEntries(previous => [{ at: new Date().toLocaleString(), message: [feedback, error].filter(Boolean).join("\n"), failed: !!error }, ...previous].slice(0, 50));
  }, [active, feedback, error]);
  return <section className="integration-sync-log" aria-label="Import and sync log">
    <h3>Import and sync log</h3>
    {lastScheduledAt && <p>Latest scheduled import · {new Date(lastScheduledAt).toLocaleString()}<br />{lastScheduleResult || "No result recorded"}</p>}
    <p className="muted">Recent activity from this settings session. Up to 50 entries; this history clears when you leave this integration.</p>
    {!entries.length ? <p className="muted">No imports or syncs run in this session.</p> : <ul>{entries.map((entry, index) => <li key={`${entry.at}-${index}`}><time className="muted">{entry.at}</time><span className={entry.failed ? "project-error" : undefined}>{entry.message}</span></li>)}</ul>}
  </section>;
}
