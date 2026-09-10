import { useEffect, useState, type FormEvent } from "react";
import type { GitConnectionSummary, GitProvider, GitRepository, GitRemoteRepository, GitPage } from "@spectron/shared";
import { Button } from "@spectron/frontend/components/ui/button";
import { Input } from "@spectron/frontend/components/ui/input";
import { trpc } from "./lib/trpc";
import "./git-settings.css";

const providerName = (provider: GitProvider) => provider === "github" ? "GitHub" : "GitLab";
const ref = (value: { id: string; projectId: string; revision: number }) => ({ id: value.id, projectId: value.projectId, revision: value.revision });
export function GitSettings({ projectId, provider, onBusyChange }: { projectId: string; provider: GitProvider; onBusyChange: (value: boolean) => void }) {
  const [connections, setConnections] = useState<GitConnectionSummary[]>([]);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState("");
  const [editing, setEditing] = useState<GitConnectionSummary | "new" | null>(null);
  const [browsing, setBrowsing] = useState<GitConnectionSummary | null>(null);
  const [page, setPage] = useState(1), [catalog, setCatalog] = useState<GitPage<GitRemoteRepository> | null>(null);
  const [filter, setFilter] = useState("");
  async function reload() {
    const [cs, rs] = await Promise.all([trpc.git.connections.query({ projectId }), trpc.git.repositories.query({ projectId })]);
    setConnections(cs); setRepositories(rs);
  }
  useEffect(() => {
    let active = true;
    Promise.all([trpc.git.connections.query({ projectId }), trpc.git.repositories.query({ projectId })])
      .then(([cs, rs]) => { if (active) { setConnections(cs); setRepositories(rs); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load Git settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);
  useEffect(() => { onBusyChange(!!pending); return () => onBusyChange(false); }, [pending, onBusyChange]);
  function clear() { setError(""); setFeedback(""); }
  async function run(key: string, action: () => Promise<void>) {
    if (pending) return;
    setPending(key); clear();
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete this action."); }
    finally { setPending(""); }
  }
  async function browse(connection: GitConnectionSummary, requestedPage: number) {
    setCatalog(null);
    const result = await trpc.git.browse.query({ ...ref(connection), page: requestedPage });
    setBrowsing(connection); setPage(requestedPage); setCatalog(result);
  }
  const busy = !!pending;
  if (loading) return <p role="status">Loading Git connections…</p>;
  return <div className="git-settings">
    <header><div><h2>{providerName(provider)} repositories</h2><p className="muted">Connect a provider account and choose code available to this project's agents.</p></div>
      <Button disabled={busy || !!editing} onClick={() => { clear(); setBrowsing(null); setEditing("new"); }}>Add connection</Button></header>
    <p className="muted">All project members use the connection's provider identity. Only project owners can configure it. Tokens are encrypted and cannot be displayed again.</p>
    {error && <p className="project-error" role="alert">{error} <Button variant="ghost" disabled={busy} onClick={() => void run("refresh", async () => { setBrowsing(null); setEditing(null); await reload(); })}>Reload settings</Button></p>}
    {feedback && <p className="project-feedback" role="status">{feedback}</p>}
    {editing && <ConnectionForm key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`} connection={editing === "new" ? null : editing} provider={provider} busy={busy}
      onCancel={() => { clear(); setEditing(null); }} onSave={values => run("save", async () => {
        if (editing === "new") await trpc.git.createConnection.mutate({ projectId, provider, name: values.name, baseURL: values.baseURL, token: values.token });
        else await trpc.git.updateConnection.mutate({ ...ref(editing), name: values.name, commitAuthorName: values.commitAuthorName, commitAuthorEmail: values.commitAuthorEmail, ...(values.token ? { token: values.token } : {}) });
        setEditing(null); await reload(); setFeedback(values.token ? "Connection saved. Check it to verify the provider identity, then confirm commit authorship." : "Connection saved.");
      })} />}
    <section aria-label="Git connections" className="git-connections">
      {!connections.some(c => c.provider === provider) && !editing && <p className="integration-empty muted">No {providerName(provider)} connections yet.</p>}
      {connections.filter(c => c.provider === provider).map(connection => <article className="git-card" key={connection.id}>
        <div className="git-card-heading"><h3>{connection.name}</h3><span className={`git-check git-check-${connection.checkStatus}`}>{connection.checkStatus === "passed" ? "Identity verified" : connection.checkStatus === "failed" ? "Check failed" : "Not checked"}</span></div>
        <a href={connection.baseURL} target="_blank" rel="noreferrer">{connection.baseURL}</a>
        <dl><dt>Provider account</dt><dd>{connection.actor ? `${connection.actor.name} (@${connection.actor.login})` : "Check connection to identify the account"}</dd>
          <dt>Commit author</dt><dd>{connection.commitAuthorName && connection.commitAuthorEmail ? `${connection.commitAuthorName} <${connection.commitAuthorEmail}>` : "Set name and email before agent execution"}</dd>
          <dt>Last checked</dt><dd>{connection.checkedAt ? new Date(connection.checkedAt).toLocaleString() : "Never"}</dd></dl>
        <div className="git-actions">
          <Button variant="ghost" disabled={busy || !!editing} onClick={() => void run(`check:${connection.id}`, async () => {
            setBrowsing(null); const result = await trpc.git.checkConnection.mutate(ref(connection)); await reload();
            if (result.connection.checkStatus === "failed") setError(result.message); else setFeedback(result.message);
          })}>{pending === `check:${connection.id}` ? "Checking…" : "Check connection"}</Button>
          <Button variant="ghost" disabled={busy || !!editing || connection.checkStatus !== "passed"} onClick={() => void run(`browse:${connection.id}`, async () => { setFilter(""); await browse(connection, 1); })}>{pending === `browse:${connection.id}` ? "Loading…" : "Select repositories"}</Button>
          <Button variant="ghost" disabled={busy || !!editing} onClick={() => { clear(); setBrowsing(null); setEditing(connection); }}>Edit</Button>
          <Button variant="ghost" disabled={busy || !!editing || repositories.some(r => r.connectionId === connection.id)} title="Remove selected repositories before deleting a connection" onClick={() => void run(`delete:${connection.id}`, async () => { await trpc.git.deleteConnection.mutate(ref(connection)); setBrowsing(null); await reload(); setFeedback("Connection deleted."); })}>Delete</Button>
        </div>
      </article>)}
    </section>
    {browsing && <section className="git-card" aria-label="Available repositories">
      <div className="git-card-heading"><h3>Select repositories · {browsing.name}</h3><Button variant="ghost" disabled={busy} onClick={() => { clear(); setBrowsing(null); }}>Close</Button></div>
      <label>Filter this page<Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Repository name" /></label>
      {!catalog ? <p role="status">Repository list unavailable. Retry using Select repositories.</p> : <>
        <ul className="git-repo-picker">{catalog.items.filter(repo => repo.fullName.toLowerCase().includes(filter.toLowerCase())).map(repo => {
          const selected = repositories.some(r => r.externalId === repo.externalId && r.provider === browsing.provider && connections.find(c => c.id === r.connectionId)?.baseURL === browsing.baseURL);
          return <li key={repo.externalId}><div><strong>{repo.fullName}</strong><span className="muted">{repo.defaultBranch || "No default branch"}{repo.archived ? " · Archived" : ""}</span></div>
            <Button variant="ghost" disabled={busy || selected || !repo.defaultBranch} onClick={() => void run(`add:${repo.externalId}`, async () => { await trpc.git.addRepository.mutate({ ...ref(browsing), externalId: repo.externalId, fullName: repo.fullName }); await reload(); setFeedback(`${repo.fullName} added.`); })}>{selected ? "Selected" : pending === `add:${repo.externalId}` ? "Adding…" : "Add"}</Button></li>;
        })}</ul>
        {!catalog.items.length && <p className="muted">No repositories on this page. Check token repository access and organization approval.</p>}
        {!!catalog.items.length && !catalog.items.some(repo => repo.fullName.toLowerCase().includes(filter.toLowerCase())) && <p className="muted">No matching repositories on this page.</p>}
        <div className="git-actions"><Button variant="ghost" disabled={busy || page === 1} onClick={() => void run("page", () => browse(browsing, page - 1))}>Previous</Button><span>Page {page}</span><Button variant="ghost" disabled={busy || !catalog.nextPage} onClick={() => void run("page", () => browse(browsing, catalog.nextPage!))}>Next</Button></div>
      </>}
    </section>}
    <section aria-label="Project repositories"><h3>Project repositories · {repositories.length}</h3><p className="muted">All selected GitHub and GitLab repositories. The project default will be preselected for agent requests. Target branches are verified when saved.</p>
      {!repositories.length && <p className="integration-empty muted">Select repositories from a checked connection to get started.</p>}
      <div className="git-connections">{repositories.map(repository => <RepositoryForm key={`${repository.id}:${repository.revision}`} repository={repository} busy={busy}
        connectionName={connections.find(c => c.id === repository.connectionId)?.name ?? providerName(repository.provider)}
        onSave={(targetBranch, isDefault) => run(`repo:${repository.id}`, async () => { await trpc.git.updateRepository.mutate({ ...ref(repository), targetBranch, isDefault }); await reload(); setFeedback("Repository settings saved."); })}
        onRemove={() => void run(`remove:${repository.id}`, async () => { await trpc.git.removeRepository.mutate(ref(repository)); await reload(); setFeedback("Repository removed. Remaining repositories keep a project default."); })} />)}</div>
    </section>
  </div>;
}
function ConnectionForm({ connection, provider, busy, onSave, onCancel }: { connection: GitConnectionSummary | null; provider: GitProvider; busy: boolean; onSave: (values: { name: string; baseURL: string; token: string; commitAuthorName: string; commitAuthorEmail: string }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(connection?.name ?? ""), [baseURL, setBaseURL] = useState(connection?.baseURL ?? (provider === "github" ? "https://github.com" : ""));
  const [token, setToken] = useState(""), [author, setAuthor] = useState(connection?.commitAuthorName ?? ""), [email, setEmail] = useState(connection?.commitAuthorEmail ?? ""), [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!name.trim()) { setError("Enter a connection name."); return; }
    if ((!connection && !token) || (token && /[\s\x00-\x1f\x7f]/.test(token))) { setError("Enter an access token without whitespace."); return; }
    void onSave({ name: name.trim(), baseURL: baseURL.trim(), token, commitAuthorName: author.trim(), commitAuthorEmail: email.trim() });
  }
  return <form className="git-card git-form" onSubmit={submit}><h3>{connection ? "Edit connection" : `New ${providerName(provider)} connection`}</h3>
    <p className="muted">{provider === "github" ? "Use a personal access token for your selected repositories with Metadata and Contents read access. Pushing changes and creating pull requests requires Contents and Pull requests write access. Organization approval may be required." : "Use a personal access token for the intended GitLab user. Browsing repositories requires read_api; pushes and merge requests need api. The API server must trust the instance's TLS certificate."}</p>
    <fieldset disabled={busy}><label>Connection name<Input required maxLength={255} value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
      {provider === "gitlab" && <label>GitLab instance URL<Input required type="url" maxLength={2048} value={baseURL} disabled={!!connection} onChange={e => setBaseURL(e.target.value)} placeholder="https://gitlab.company.com" /></label>}
      <label>{connection ? "Replacement token (leave blank to keep)" : "Access token"}<Input type="password" autoComplete="new-password" required={!connection} maxLength={4096} value={token} onChange={e => setToken(e.target.value)} /></label>
      {connection && <><p className="muted">Token replacement clears the verified identity and commit author. Check again before using the connection.</p><label>Commit author name<Input maxLength={255} value={author} disabled={!!token} onChange={e => setAuthor(e.target.value)} /></label><label>Commit author email<Input type="email" maxLength={254} value={email} disabled={!!token} onChange={e => setEmail(e.target.value)} placeholder="Email associated with the provider account" /></label><p className="muted">Use the provider user's name and associated email or provider-issued private commit email. Git authentication does not set commit authorship. A connection check fills these fields when available.</p></>}
    </fieldset>{error && <p role="alert" className="project-error">{error}</p>}<div className="git-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save connection"}</Button><Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form>;
}
function RepositoryForm({ repository, connectionName, busy, onSave, onRemove }: { repository: GitRepository; connectionName: string; busy: boolean; onSave: (branch: string, isDefault: boolean) => Promise<void>; onRemove: () => void }) {
  const [branch, setBranch] = useState(repository.targetBranch), [isDefault, setIsDefault] = useState(repository.isDefault);
  return <form className="git-card git-form" onSubmit={e => { e.preventDefault(); void onSave(branch.trim(), isDefault); }}>
    <div className="git-card-heading"><a href={repository.webURL} target="_blank" rel="noreferrer"><strong>{repository.fullName}</strong></a>{repository.isDefault && <span className="git-check">Project default</span>}</div>
    <p className="muted">{providerName(repository.provider)} · {connectionName}{repository.archived ? " · Archived" : ""}</p>
    <label>Target branch<Input required maxLength={255} disabled={busy} value={branch} onChange={e => setBranch(e.target.value)} /></label>
    <label className="git-default"><input type="checkbox" disabled={busy || repository.isDefault} checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />Project default repository</label>
    <div className="git-actions"><Button type="submit" variant="ghost" disabled={busy || (branch === repository.targetBranch && isDefault === repository.isDefault)}>Save repository</Button><Button variant="ghost" disabled={busy} onClick={onRemove}>Remove from project</Button></div>
  </form>;
}
