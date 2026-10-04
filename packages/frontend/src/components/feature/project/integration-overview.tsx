import { useEffect, useState } from "react";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Pill } from "../../ui/pill";
import { cn } from "../../ui/cn";
import { formatDateTime } from "../../../lib/date-format";

export type IntegrationSummary = {
  id?: string;
  status?: string;
  provider: string;
  name: string;
  key: string;
  url: string;
  account: string;
  connectedAt?: string;
  lastSyncAt: string | null;
};
export const integrationProviders = [
  { id: "jira", name: "Jira Cloud", description: "Import a Jira project, map its people and fields, export changes back." },
  { id: "yandex", name: "Yandex Tracker", description: "Connect a queue and sync your team’s work." },
  { id: "gitlab", name: "GitLab", description: "Repositories from your own GitLab instance, for agents." },
  { id: "github", name: "GitHub", description: "Repositories your project’s agents can work in." },
] as const;
export const integrationName = (provider: string) =>
  integrationProviders.find((p) => p.id === provider)?.name ?? provider;

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function lastSync(connection: IntegrationSummary) {
  if (connection.provider === "github" || connection.provider === "gitlab") return null;
  if (connection.provider === "yandex") return null;
  return connection.lastSyncAt ? `Last sync ${formatDateTime(connection.lastSyncAt)}` : "Never synced";
}

export function IntegrationOverview({ owner, load, onSelect }: {
  owner: boolean;
  load: () => Promise<IntegrationSummary[]>;
  onSelect: (provider: string) => void;
}) {
  const [connections, setConnections] = useState<IntegrationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    setLoading(true);
    setError("");
    load().then((result) => { if (active) setConnections(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load integrations."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, owner, revision]);
  if (!owner) return <p className="text-sm text-ink-2">Only the project owner can manage integrations.</p>;
  const available = integrationProviders.filter((provider) => !connections.some((c) => c.provider === provider.id));
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="connected-heading" className="flex flex-col gap-2">
        <h3 id="connected-heading" className="label-caps">Connected</h3>
        {loading ? (
          <p role="status" className="py-3 text-sm text-ink-3">Loading integrations…</p>
        ) : error ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-bad">
            {error}
            <Button variant="ghost" size="sm" onClick={() => setRevision((v) => v + 1)}>Retry</Button>
          </p>
        ) : connections.length ? (
          <ul className="overflow-hidden rounded-xl hairline">
            {connections.map((connection) => {
              const meta = [host(connection.url), connection.account, lastSync(connection)].filter(Boolean).join(" · ");
              return (
                <li key={connection.id ?? connection.provider} className="[&+&]:hairline-t">
                  <button
                    type="button"
                    onClick={() => onSelect(connection.provider)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <IntegrationLogo provider={connection.provider} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-base font-medium text-ink">{connection.name}</span>
                        <Pill tone="ok">{connection.status ?? "Connected"}</Pill>
                      </span>
                      <span className="truncate text-sm text-ink-2">{meta}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm text-ink-3">
                      Manage <Icon name="chevron-right" size={14} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-4 py-5 text-sm text-ink-2">
            Nothing connected yet. Pick a service below.
          </p>
        )}
      </section>
      {!!available.length && (
        <section aria-labelledby="available-heading" className="flex flex-col gap-2">
          <h3 id="available-heading" className="label-caps">Available</h3>
          <ul className="flex flex-col">
            {available.map((provider) => (
              <li key={provider.id} className="[&+&]:hairline-t">
                <button
                  type="button"
                  disabled={loading || !!error}
                  onClick={() => onSelect(provider.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors enabled:hover:bg-surface-2 disabled:opacity-60"
                >
                  <IntegrationLogo provider={provider.id} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-ink">{provider.name}</span>
                    <span className="truncate text-sm text-ink-2">{provider.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm text-ink-3 group-enabled:group-hover:text-ink">
                    Connect <Icon name="chevron-right" size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function IntegrationLogo({ provider, size = "md", className = "" }: { provider: string; size?: "sm" | "md"; className?: string }) {
  const box = cn("relative inline-block shrink-0 overflow-hidden", size === "sm" ? "size-7" : "size-9", className);
  const img = "absolute inset-0 size-full object-contain";
  if (provider === "github")
    return (
      <span className={box} aria-hidden="true">
        <img className={cn(img, "dark:hidden")} src="/assets/integrations/github-black.svg" alt="" />
        <img className={cn(img, "hidden dark:block")} src="/assets/integrations/github-white.svg" alt="" />
      </span>
    );
  if (provider === "gitlab")
    return (
      <span className={box} aria-hidden="true">
        <img className={cn(img, "scale-[2.4]")} src="/assets/integrations/gitlab.svg" alt="" />
      </span>
    );
  if (provider === "jira" || provider === "yandex")
    return (
      <span className={box} aria-hidden="true">
        <img className={img} src={`/assets/integrations/${provider}.svg`} alt="" />
      </span>
    );
  return (
    <span className={cn(box, "grid place-items-center rounded-lg bg-surface-3 text-xs font-semibold text-ink-2")} aria-hidden="true">
      {provider.slice(0, 1).toUpperCase()}
    </span>
  );
}
