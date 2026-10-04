import { useEffect, useState } from "react";
import { SettingsSection } from "../../ui/settings";
import { formatDateTime } from "../../../lib/date-format";

export function IntegrationSyncLog({ active, feedback, error, lastScheduledAt, lastScheduleResult }: {
  active: boolean; feedback: string; error: string; lastScheduledAt?: string | null | undefined; lastScheduleResult?: string | null | undefined;
}) {
  const [entries, setEntries] = useState<{ at: string; message: string; failed: boolean }[]>([]);
  useEffect(() => {
    if (!active || (!feedback && !error)) return;
    setEntries(previous => [{ at: formatDateTime(new Date()), message: [feedback, error].filter(Boolean).join("\n"), failed: !!error }, ...previous].slice(0, 50));
  }, [active, feedback, error]);
  return (
    <SettingsSection
      title="Activity"
      description="Imports and syncs from this visit, newest first. Up to 50 entries; the list clears when you leave."
    >
      {lastScheduledAt && (
        <p className="text-sm text-ink-2">
          Latest scheduled import {formatDateTime(lastScheduledAt)} · {lastScheduleResult || "No result recorded"}
        </p>
      )}
      {!entries.length ? (
        <p className="text-sm text-ink-3">Nothing has run yet.</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 py-2 [&+&]:hairline-t">
              <time className="mono text-xs text-ink-3">{entry.at}</time>
              <span className={entry.failed ? "whitespace-pre-wrap text-bad" : "whitespace-pre-wrap text-ink-2"}>{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
