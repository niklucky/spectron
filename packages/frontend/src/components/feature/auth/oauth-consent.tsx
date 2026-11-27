import { useState } from "react";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { BrandLogo } from "../../ui/brand-logo";

export type OAuthConsentRequest = {
  /** Name the app registered for itself. Self-asserted, so never the only thing shown. */
  clientName: string | null;
  /** Where Spectron sends the browser back to: the part people can check. */
  redirectHost: string;
  /** Host that published the client's metadata document, for URL client ids. */
  clientHost: string | null;
  scopes: string[];
  account: { name: string; email: string };
};

/*
 * Same quiet column as the sign-in screen. The decision rests on facts the
 * app cannot fake: the address it returns to and what it will be able to do.
 */
export function OAuthConsentScreen({
  request,
  onDecision,
}: {
  request: OAuthConsentRequest;
  onDecision: (accept: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState("");
  const name = request.clientName?.trim() || "An app";
  const decide = async (accept: boolean) => {
    if (busy) return;
    setBusy(accept ? "allow" : "deny");
    setError("");
    try {
      await onDecision(accept);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
      setBusy(null);
    }
  };
  const abilities = [
    "Read and change issues, comments and files in all your projects, as you",
    ...(request.scopes.includes("email") || request.scopes.includes("profile")
      ? ["See your name and email address"]
      : []),
    ...(request.scopes.includes("offline_access") ? ["Stay connected until you disconnect it"] : []),
  ];
  return (
    <main className="relative h-dvh overflow-y-auto bg-bg text-ink">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_55%_at_50%_-10%,color-mix(in_srgb,var(--sp-accent)_13%,transparent),transparent_62%)]"
        aria-hidden
      />
      <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-16">
        <section className="flex w-[360px] max-w-full flex-col items-center" aria-labelledby="consent-title">
          <BrandLogo className="size-20" />
          <h1 id="consent-title" className="mt-6 text-center text-xl font-semibold tracking-[-0.015em]">
            Connect {name} to Spectron?
          </h1>
          <p className="mt-2 text-center text-sm text-ink-2">
            Signed in as {request.account.email}
          </p>
          <ul className="mt-8 flex w-full flex-col gap-3 text-sm">
            {abilities.map((ability) => (
              <li key={ability} className="flex items-start gap-2.5">
                <Icon name="check" size={15} className="mt-0.5 shrink-0 text-ink-3" />
                {ability}
              </li>
            ))}
          </ul>
          <dl className="mt-6 grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm">
            <dt className="text-ink-3">Returns to</dt>
            <dd className="truncate font-medium">{request.redirectHost}</dd>
            {request.clientHost && (
              <>
                <dt className="text-ink-3">Published by</dt>
                <dd className="truncate font-medium">{request.clientHost}</dd>
              </>
            )}
          </dl>
          <p className="mt-3 w-full text-xs text-ink-3">
            Only continue if you started this from {name} and recognise the address above. You can disconnect it
            any time in AI connections & agents → API tokens.
          </p>
          {error && (
            <p className="mt-6 w-full rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
              {error}
            </p>
          )}
          <div className="mt-8 flex w-full gap-2">
            <Button
              variant="ghost"
              size="md"
              className="h-11 flex-1 rounded-xl"
              disabled={!!busy}
              onClick={() => void decide(false)}
            >
              {busy === "deny" ? "Cancelling…" : "Cancel"}
            </Button>
            <Button
              variant="primary"
              size="md"
              className="h-11 flex-1 rounded-xl font-medium"
              disabled={!!busy}
              onClick={() => void decide(true)}
            >
              {busy === "allow" ? "Connecting…" : "Allow"}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
