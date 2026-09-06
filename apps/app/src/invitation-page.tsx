import { useEffect, useState } from "react";
import type { InvitationPreview } from "@spectron/shared";
import { Button } from "@spectron/frontend/components/ui/button";
import { trpc } from "./lib/trpc";
import { authClient } from "./lib/auth-client";

export function InvitationPage({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError("This invitation link is invalid.");
      setLoading(false);
      return;
    }
    trpc.invitations.preview
      .mutate({ token })
      .then((result) => {
        if (active) setInvitation(result);
      })
      .catch((cause) => {
        if (active) setError(cause.message || "Couldn’t load this invitation.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        Spectron
      </a>
      <section className="auth-content">
        {invitation?.logo && (
          <img
            src={invitation.logo}
            alt=""
            width={48}
            height={48}
            style={{ objectFit: "contain", marginBottom: 20 }}
          />
        )}
        <h1>
          {loading
            ? "Loading invitation…"
            : invitation
              ? `Join ${invitation.projectName}`
              : "Project invitation"}
        </h1>
        <p>Signed in as {email}</p>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {invitation && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await trpc.invitations.accept.mutate({ token });
                window.location.replace(`/#project/${result.projectId}`);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Couldn’t accept this invitation.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Joining…"
              : invitation.status === "accepted"
                ? "Open project"
                : "Accept invitation"}
          </Button>
        )}
        <p className="auth-footer">
          <a className="auth-link" href="/">
            Back to workspace
          </a>
        </p>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await authClient.signOut();
              if (result.error) throw new Error("Couldn’t sign out.");
              window.location.replace(`/login#invite/${token}`);
            } catch {
              setError("Couldn’t sign out. Please try again.");
              setBusy(false);
            }
          }}
        >
          Use another account
        </Button>
      </section>
    </main>
  );
}
