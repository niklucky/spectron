import { useEffect, useState } from "react";
import { apiTokenLifetimes, type ApiTokenSummary } from "@spectron/shared";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";

export type ApiTokenActions = {
  list: () => Promise<ApiTokenSummary[]>;
  create: (input: {
    name: string;
    expiresInDays: number | null;
  }) => Promise<{ token: string; summary: ApiTokenSummary }>;
  revoke: (id: string) => Promise<unknown>;
};

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
const lifetimeLabel = (days: number | null) =>
  days === null ? "No expiry" : days === 365 ? "1 year" : `${days} days`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

/** Personal access tokens for the public API, used by agents, scripts and the CLI. */
export function ApiTokens({ actions }: { actions: ApiTokenActions }) {
  const [tokens, setTokens] = useState<ApiTokenSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenSummary | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    actions
      .list()
      .then((rows) => current && setTokens(rows))
      .catch((cause: unknown) => current && setError(message(cause, "Could not load tokens.")));
    return () => {
      current = false;
    };
  }, [actions, reload]);
  return (
    <section aria-label="API tokens">
      <div className="ai-section-heading">
        <h2>API tokens</h2>
        <Button onClick={() => setCreating(true)}>Create token</Button>
      </div>
      <p>
        Agents, scripts and the CLI use a token to read and update issues as
        you, in every project you belong to. Send it as{" "}
        <code>Authorization: Bearer spk_…</code> to{" "}
        <code>{window.location.origin}/api/v1</code>.
      </p>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      {tokens === null && !error && <p role="status">Loading tokens…</p>}
      {tokens?.length === 0 && (
        <p className="ai-empty">No tokens yet. Create one for each agent or machine.</p>
      )}
      <div className="ai-cards">
        {tokens?.map((token) => (
          <article className="ai-card" key={token.id}>
            <h3>{token.name}</h3>
            <p>
              <code>{token.prefix}…</code> · Created {day(token.createdAt)}
            </p>
            <p>
              {token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}` : "Never used"}
              {" · "}
              {token.expiresAt ? `Expires ${day(token.expiresAt)}` : "No expiry"}
            </p>
            <div className="ai-actions">
              <Button variant="ghost" onClick={() => setRevoking(token)}>
                Revoke
              </Button>
            </div>
          </article>
        ))}
      </div>
      {creating && (
        <CreateTokenDialog
          actions={actions}
          onClose={() => setCreating(false)}
          onCreated={(secret) => {
            setCreating(false);
            setRevealed(secret);
            setReload((v) => v + 1);
          }}
        />
      )}
      {revealed && <RevealDialog token={revealed} onClose={() => setRevealed(null)} />}
      {revoking && (
        <RevokeDialog
          token={revoking}
          actions={actions}
          onClose={() => setRevoking(null)}
          onRevoked={() => {
            setRevoking(null);
            setReload((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}

function CreateTokenDialog({
  actions,
  onClose,
  onCreated,
}: {
  actions: ApiTokenActions;
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const [name, setName] = useState("");
  const [lifetime, setLifetime] = useState<number | null>(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title="Create API token" className="ai-dialog" onClose={() => !busy && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          actions
            .create({ name: name.trim(), expiresInDays: lifetime })
            .then((created) => onCreated(created.token))
            .catch((cause: unknown) => setError(message(cause, "Could not create the token.")))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Name
            <input
              required
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Claude Code on my laptop"
            />
          </label>
          <label>
            Expires
            <select
              value={String(lifetime)}
              onChange={(event) =>
                setLifetime(event.target.value === "null" ? null : Number(event.target.value))
              }
            >
              {apiTokenLifetimes.map((days) => (
                <option key={String(days)} value={String(days)}>
                  {lifetimeLabel(days)}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          <div className="ai-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{busy ? "Creating…" : "Create token"}</Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function RevealDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Copy your token" className="ai-dialog" onClose={onClose}>
      <p>This is the only time the token is shown. Store it somewhere safe.</p>
      <input
        readOnly
        aria-label="API token"
        value={token}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
      />
      <p>Try it:</p>
      <pre className="api-token-example">
        {`curl -H "Authorization: Bearer ${token}" \\\n  ${window.location.origin}/api/v1/me`}
      </pre>
      <div className="ai-actions">
        <Button
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(token).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy token"}
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}

function RevokeDialog({
  token,
  actions,
  onClose,
  onRevoked,
}: {
  token: ApiTokenSummary;
  actions: ApiTokenActions;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={`Revoke ${token.name}?`} className="ai-dialog" onClose={() => !busy && onClose()}>
      <p>Anything using this token loses access immediately. This cannot be undone.</p>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="ai-actions">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            actions
              .revoke(token.id)
              .then(onRevoked)
              .catch((cause: unknown) => setError(message(cause, "Could not revoke the token.")))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Revoking…" : "Revoke"}
        </Button>
      </div>
    </Dialog>
  );
}
