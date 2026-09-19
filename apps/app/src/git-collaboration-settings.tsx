import { useEffect, useState } from "react";
import type { GitProvider } from "@spectron/shared";
import { Button } from "@spectron/frontend/components/ui/button";
import { Input } from "@spectron/frontend/components/ui/input";
import { trpc } from "./lib/trpc";

export function GitCollaborationSettings({
  projectId,
  provider,
}: {
  projectId: string;
  provider: GitProvider;
}) {
  const [members, setMembers] = useState<
    Awaited<ReturnType<typeof trpc.gitWorkflow.permissions.query>>
  >([]);
  const [hooks, setHooks] = useState<
    Awaited<ReturnType<typeof trpc.gitWorkflow.webhookSettings.query>>
  >([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connectionId, setConnectionId] = useState(""),
    [secret, setSecret] = useState("");
  async function load() {
    const [m, h] = await Promise.all([
      trpc.gitWorkflow.permissions.query({ projectId }),
      trpc.gitWorkflow.webhookSettings.query({ projectId }),
    ]);
    setMembers(m);
    setHooks(h);
  }
  useEffect(() => {
    void load().catch((e) =>
      setError(
        e instanceof Error
          ? e.message
          : "Could not load collaboration settings.",
      ),
    );
  }, [projectId]);
  async function act(f: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await f();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="git-card" aria-label="Git collaboration settings">
      <h3>Merge permissions</h3>
      <p>
        Project owners can merge. Grant other members Can merge to enable
        merging when provider requirements pass.
      </p>
      {members.map((m) => (
        <label className="git-default" key={m.userId}>
          <input
            type="checkbox"
            disabled={busy || m.role === "owner"}
            checked={m.role === "owner" || m.canMerge}
            onChange={(e) =>
              void act(() =>
                trpc.gitWorkflow.setMergeGrant.mutate({
                  projectId,
                  userId: m.userId,
                  canMerge: e.target.checked,
                }),
              )
            }
          />
          {m.name}
          {m.role === "owner" ? " · Owner" : " · Can merge"}
        </label>
      ))}
      <h3>Provider webhooks</h3>
      <p>
        Activity refreshes periodically. Configure a webhook for faster updates.
        The endpoint must be reachable from your provider.
      </p>
      {hooks
        .filter((h) => h.provider === provider)
        .map((h) => (
          <div key={h.id}>
            <p>
              {h.name} · {h.configured ? "Secret configured" : "Not configured"}
            </p>
            <code>{`${window.location.origin}/api/git/webhooks/${h.id}`}</code>
            <p>
              Subscribe to{" "}
              {provider === "github"
                ? "pull requests, reviews, review comments, issue comments, pushes, check runs, check suites, and statuses"
                : "merge requests, comments, pushes, pipelines, and jobs"}
              .
            </p>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConnectionId(h.id);
                setSecret("");
              }}
            >
              Set webhook secret
            </Button>
            {h.configured && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    trpc.gitWorkflow.setWebhook.mutate({
                      projectId,
                      connectionId: h.id,
                      secret: null,
                    }),
                  )
                }
              >
                Disable webhook
              </Button>
            )}
          </div>
        ))}
      {connectionId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await trpc.gitWorkflow.setWebhook.mutate({
                projectId,
                connectionId,
                secret,
              });
              setSecret("");
              setConnectionId("");
            });
          }}
        >
          <label>
            Shared secret (at least 32 characters)
            <Input
              type="password"
              autoComplete="new-password"
              minLength={32}
              maxLength={255}
              required
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={busy}
            />
          </label>
          <p>
            Use this same secret in the provider webhook settings. It is
            encrypted and cannot be displayed again.
          </p>
          <Button type="submit" disabled={busy || secret.length < 32}>
            Save secret
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSecret("");
              setConnectionId("");
            }}
          >
            Cancel
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
