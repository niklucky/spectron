import { useEffect, useState } from "react";
import { Button } from "../../ui/button";

export type IntegrationSummary = {
  provider: string;
  name: string;
  key: string;
  url: string;
  account: string;
  connectedAt?: string;
  lastSyncAt: string | null;
};
const providers = [
  { id: "jira", name: "Jira Cloud", description: "Connect your Jira project and sync issues.", available: true, mark: "J" },
  { id: "yandex", name: "Yandex Tracker", description: "Connect a queue and sync your team's work.", available: true, mark: "Y" },
  { id: "gitlab", name: "GitLab", description: "Bring repositories and development activity together.", available: false, mark: "GL" },
  { id: "github", name: "GitHub", description: "Connect repositories, issues and pull requests.", available: false, mark: "GH" },
];
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

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
  if (!owner) return <p className="muted">Only the project owner can manage integrations.</p>;
  return <div className="integration-overview">
    <div><h2>Integrations</h2><p className="muted">Manage connected services and discover integrations for this project.</p></div>
    <section aria-labelledby="connected-heading">
      <h3 id="connected-heading">Connected {!loading && !error && <span className="integration-count">{connections.length}</span>}</h3>
      {loading ? <p role="status" className="integration-empty">Loading integrations…</p> : error ? <div role="alert" className="project-error">{error} <Button variant="ghost" onClick={() => setRevision(v => v + 1)}>Retry</Button></div> : connections.length ? <div className="integration-connections">{connections.map((connection) => <article className="integration-connection-card" key={connection.provider} onClick={() => onSelect(connection.provider)}>
        <div className="integration-connection-brand"><IntegrationLogo provider={connection.provider} /><div><button className="integration-name" onClick={() => onSelect(connection.provider)}>{connection.name}</button><span className="integration-status">Connected</span></div></div>
        <div className="integration-connection-cell"><span className="muted">Key</span><span>{connection.key}</span></div>
        <div className="integration-connection-cell"><span className="muted">Site</span><a href={connection.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{new URL(connection.url).host}</a></div>
        <div className="integration-connection-cell"><span className="muted">{connection.provider === "yandex" ? "Organization" : "Account"}</span><span>{connection.account}</span></div>
        <div className="integration-connection-cell"><span className="muted">Connected at</span><span>{date(connection.connectedAt)}</span></div>
        <div className="integration-connection-cell"><span className="muted">Last sync at</span><span title={connection.provider === "yandex" ? "Sync time is not recorded yet" : "Latest successfully imported issue"}>{connection.provider === "yandex" ? "Not recorded" : connection.lastSyncAt ? date(connection.lastSyncAt) : "Never"}</span></div>
        <Button variant="ghost" onClick={() => onSelect(connection.provider)} aria-label={`Edit ${connection.name}`}>Edit →</Button>
      </article>)}</div> : <p className="integration-empty muted">No integrations connected yet. Choose a service below to get started.</p>}
    </section>
    <section aria-labelledby="available-heading"><h3 id="available-heading">Available</h3><div className="integration-catalog">
      {providers.filter(provider => !connections.some(c => c.provider === provider.id)).map(provider => <button key={provider.id} className="integration-card" disabled={!provider.available || loading || !!error} onClick={() => onSelect(provider.id)}>
        <IntegrationLogo provider={provider.id} />
        <strong>{provider.name}</strong><span className="muted">{provider.description}</span><span className="integration-card-action">{provider.available ? "Connect →" : "Coming soon"}</span>
      </button>)}
    </div></section>
  </div>;
}

export function IntegrationLogo({ provider }: { provider: string }) {
  if (provider === "github") return <span className="integration-logo" aria-hidden="true"><img className="integration-logo-light" src="/assets/integrations/github-black.svg" alt="" /><img className="integration-logo-dark" src="/assets/integrations/github-white.svg" alt="" /></span>;
  if (provider === "gitlab") return <span className="integration-logo integration-logo-gitlab" aria-hidden="true"><img src="/assets/integrations/gitlab.svg" alt="" /></span>;
  if (provider === "jira" || provider === "yandex") return <img className="integration-logo" src={`/assets/integrations/${provider}.svg`} alt="" />;
  return <span className="integration-mark" aria-hidden="true">Y</span>;
}
