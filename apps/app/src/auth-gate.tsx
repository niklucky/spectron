import { useEffect, useState, type ReactNode } from "react";
import {
  AuthScreen,
  OAuthConsentScreen,
  type AuthFields,
  type AuthMode,
  type OAuthConsentRequest,
} from "@spectron/frontend/components/feature/auth";
import { useTheme } from "@spectron/frontend/hooks/use-theme";
import { Button } from "@spectron/frontend/components/ui/button";
import { authClient } from "./lib/auth-client";

type AuthUser = { id: string; name: string; email: string };

/*
 * MCP clients (Claude, Codex, …) connect through OAuth. Spectron's authorize
 * endpoint sends people here with a signed copy of the client's request:
 * /login when they need to sign in, /oauth/consent to approve the client.
 */
const OAUTH_INTERNAL = new Set(["sig", "exp", "ba_iat", "ba_param"]);
function oauthRequest(search: string) {
  const params = new URLSearchParams(search);
  if (!params.has("sig") || !params.has("client_id")) return null;
  return params;
}
/** The client's original authorize request, to resume it once signed in. */
function authorizeURL(params: URLSearchParams) {
  const signed = new Set(params.getAll("ba_param"));
  const original = new URLSearchParams();
  for (const [key, value] of params)
    if (signed.has(key) && !OAUTH_INTERNAL.has(key)) original.append(key, value);
  // A prompt=login request has just been satisfied; repeating it would loop.
  const prompt = original.get("prompt")?.split(" ").filter((p) => p && p !== "login");
  if (prompt?.length) original.set("prompt", prompt.join(" "));
  else original.delete("prompt");
  return `/api/auth/oauth2/authorize?${original}`;
}
export function AuthGate({
  children,
}: {
  children: (user: AuthUser, sessionId: string) => ReactNode;
}) {
  useTheme();
  const { data, isPending, error, refetch } = authClient.useSession();
  const path = window.location.pathname.slice(1);
  const mode: AuthMode =
    path === "register" ||
    path === "forgot-password" ||
    path === "reset-password"
      ? path
      : "login";
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const oauth = path === "login" || path === "oauth/consent" ? oauthRequest(window.location.search) : null;
  const isConsent = path === "oauth/consent";
  // Where a successful sign-in goes next.
  const afterSignIn = () =>
    oauth && !isConsent ? authorizeURL(oauth) : isConsent ? window.location.href : `/${window.location.hash}`;
  const resumeOAuth = !!data && !!oauth && !isConsent;
  const oauthSearch = oauth ? window.location.search : "";
  useEffect(() => {
    const request = oauthRequest(oauthSearch);
    if (resumeOAuth && request) window.location.replace(authorizeURL(request));
  }, [resumeOAuth, oauthSearch]);
  const continueHash = /^#invite\/[a-f0-9]{64}$/.test(window.location.hash)
    ? window.location.hash
    : "";
  // The magic-link verifier redirects here with ?error= when a link is stale.
  const linkError =
    mode === "login" && params.has("error")
      ? "That login link has expired or was already used. Request a new one."
      : "";
  if (isPending)
    return (
      <main
        className="grid h-dvh place-content-center bg-surface text-ink-2"
        role="status"
      >
        Loading workspace…
      </main>
    );
  if (error)
    return (
      <main className="grid h-dvh place-content-center gap-4 bg-surface text-ink-2">
        <p role="alert">Couldn’t connect to Spectron.</p>
        <Button variant="primary" onClick={() => void refetch()}>
          Try again
        </Button>
      </main>
    );
  if (resumeOAuth)
    return (
      <main className="grid h-dvh place-content-center bg-surface text-ink-2" role="status">
        Continuing to the app…
      </main>
    );
  if (data && isConsent) return <ConsentGate user={data.user} />;
  if (data && mode !== "reset-password")
    return children(data.user, data.session.id);

  async function submit(fields: AuthFields) {
    const result =
      mode === "register"
        ? await authClient.signUp.email(fields)
        : mode === "forgot-password"
          ? await authClient.requestPasswordReset({
              email: fields.email,
              redirectTo: `${window.location.origin}/reset-password`,
            })
          : mode === "reset-password"
            ? await authClient.resetPassword({
                token: token || "",
                newPassword: fields.password,
              })
            : await authClient.signIn.email({
                email: fields.email,
                password: fields.password,
              });
    if (result.error) {
      if (result.error.status === 429)
        throw new Error(
          "Too many attempts. Please wait a minute and try again.",
        );
      if (result.error.status >= 500)
        throw new Error(
          "The request couldn’t be completed. Please try again later.",
        );
      throw new Error(
        result.error.message || "The request couldn’t be completed.",
      );
    }
    if (mode === "login" || mode === "register")
      window.location.replace(afterSignIn());
    if (mode === "reset-password")
      window.history.replaceState(null, "", "/reset-password");
  }
  async function sendMagicLink(email: string) {
    const result = await authClient.signIn.magicLink({
      email,
      // Only used when the address is new: a readable name until they edit it.
      name: email.split("@")[0] || email,
      callbackURL: oauth || isConsent ? afterSignIn().replace(window.location.origin, "") : `/${continueHash}`,
      errorCallbackURL: "/login",
    });
    if (result.error) {
      if (result.error.status === 429)
        throw new Error(
          "Too many attempts. Please wait a minute and try again.",
        );
      throw new Error("The login link couldn’t be sent. Please try again.");
    }
  }
  return (
    <AuthScreen
      key={mode}
      mode={mode}
      continueHash={continueHash}
      notice={linkError}
      onSubmit={submit}
      onMagicLink={sendMagicLink}
      invalidReset={
        mode === "reset-password" && (!token || params.has("error"))
      }
    />
  );
}

function ConsentGate({ user }: { user: AuthUser }) {
  const [request, setRequest] = useState<OAuthConsentRequest | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const params = oauthRequest(window.location.search);
    // Another site could frame this page and trick a click on Allow.
    if (window.top !== window.self) {
      setFailure("For your safety, approve connections in their own browser window.");
      return;
    }
    if (!params) {
      setFailure("This connection request is incomplete. Start again from the app you were connecting.");
      return;
    }
    const clientId = params.get("client_id")!;
    const host = (value: string | null) => {
      try {
        return value ? new URL(value).host : null;
      } catch {
        return null;
      }
    };
    void fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const client = (await response.json()) as { client_name?: string };
        setRequest({
          clientName: client.client_name ?? null,
          redirectHost: host(params.get("redirect_uri")) ?? "unknown address",
          clientHost: /^https:\/\//.test(clientId) ? host(clientId) : null,
          scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
          account: { name: user.name, email: user.email },
        });
      })
      .catch(() => setFailure("This app is not registered with Spectron, or the request expired. Start again from the app."));
  }, [user]);
  if (failure)
    return (
      <main className="grid h-dvh place-content-center bg-surface px-6 text-center text-ink-2" role="alert">
        {failure}
      </main>
    );
  if (!request)
    return (
      <main className="grid h-dvh place-content-center bg-surface text-ink-2" role="status">
        Loading…
      </main>
    );
  return (
    <OAuthConsentScreen
      request={request}
      onDecision={async (accept) => {
        const response = await fetch("/api/auth/oauth2/consent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accept, oauth_query: window.location.search.slice(1) }),
        });
        const body = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
        if (!response.ok || !body.url)
          throw new Error(
            response.status === 400 || response.status === 401
              ? "This request expired. Start again from the app you were connecting."
              : body.message || "Couldn’t complete the connection. Please try again.",
          );
        window.location.assign(body.url);
      }}
    />
  );
}
