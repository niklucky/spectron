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
 * /login (or /register) when they need to sign in, /oauth/consent to approve
 * the client. The signed query travels with every step, and the server
 * verifies it before resuming (the oauthProviderClient plugin adds it to
 * sign-in requests; /oauth2/continue takes it for an existing session).
 */
function signedOAuthRequest(search: string) {
  const params = new URLSearchParams(search);
  return params.has("sig") && params.has("client_id") ? params : null;
}
async function postOAuth(path: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/auth/oauth2/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, oauth_query: window.location.search.slice(1) }),
  });
  const result = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
  if (response.ok && result.url) return result.url;
  throw new Error(
    response.status === 400 || response.status === 401
      ? "This request expired. Start again from the app you were connecting."
      : result.message || "Couldn’t continue. Please try again.",
  );
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
  const isConsent = path === "oauth/consent";
  const oauth =
    path === "login" || path === "register" || isConsent ? signedOAuthRequest(window.location.search) : null;
  // The client asked for a fresh sign-in (prompt=login, or max_age that the
  // current session is too old for): an existing session must not satisfy it.
  const reauth = !!oauth && !isConsent && (oauth.get("prompt")?.split(" ").includes("login") || oauth.has("max_age"));
  // Someone already signed in (another tab, or back from a login link):
  // resume the client's request; the server re-verifies its signature.
  const resumeOAuth = !!data && !!oauth && !isConsent && !reauth;
  const [resumeFailed, setResumeFailed] = useState("");
  useEffect(() => {
    if (!resumeOAuth) return;
    // created:true also clears prompt=create, which signing up just satisfied.
    postOAuth("continue", { created: true })
      .then((url) => {
        // A request that still needs a sign-in comes back here; show the form.
        if (new URL(url, window.location.origin).pathname === "/login")
          setResumeFailed("Sign in again to continue.");
        else window.location.replace(url);
      })
      .catch((cause: unknown) => setResumeFailed(cause instanceof Error ? cause.message : "Couldn’t continue."));
  }, [resumeOAuth]);
  const invite = /^#invite\/[a-f0-9]{64}$/.test(window.location.hash)
    ? window.location.hash
    : "";
  // Links between login, sign-up and back keep the OAuth request with them.
  const continueHash = oauth ? window.location.search : invite;
  // The magic-link verifier redirects here with ?error= when a link is stale.
  const linkError =
    mode === "login" && params.has("error")
      ? "That login link has expired or was already used. Request a new one."
      : resumeFailed || (reauth ? "The app you are connecting asked you to sign in again." : "");
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
  if (resumeOAuth && !resumeFailed)
    return (
      <main className="grid h-dvh place-content-center bg-surface text-ink-2" role="status">
        Continuing to the app…
      </main>
    );
  if (data && isConsent) return <ConsentGate user={data.user} />;
  if (data && mode !== "reset-password" && !oauth)
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
    if (mode === "login" || mode === "register") {
      // With a signed OAuth request in the page, the server resumes the
      // authorization as part of sign-in and returns where to go next.
      const next = oauth ? (result.data as { url?: string } | null)?.url : undefined;
      window.location.replace(next ?? (oauth ? window.location.href : `/${invite}`));
    }
    if (mode === "reset-password")
      window.history.replaceState(null, "", "/reset-password");
  }
  async function sendMagicLink(email: string) {
    const result = await authClient.signIn.magicLink({
      email,
      // Only used when the address is new: a readable name until they edit it.
      name: email.split("@")[0] || email,
      // Back to this page, signed request intact, to resume once signed in.
      callbackURL: oauth ? `${window.location.pathname}${window.location.search}` : `/${invite}`,
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
      // A login link cannot prove the fresh sign-in the app asked for.
      onMagicLink={reauth ? undefined : sendMagicLink}
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
    const params = signedOAuthRequest(window.location.search);
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
    // Native apps return to custom schemes without a host
    // (com.example.app:/callback); show those in full.
    const destination = (value: string | null) => {
      if (!value) return "unknown address";
      try {
        const url = new URL(value);
        return url.host || `${url.protocol}${url.pathname}`;
      } catch {
        return value;
      }
    };
    void fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const client = (await response.json()) as { client_name?: string };
        setRequest({
          clientName: client.client_name ?? null,
          redirectHost: destination(params.get("redirect_uri")),
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
        window.location.assign(await postOAuth("consent", { accept }));
      }}
    />
  );
}
