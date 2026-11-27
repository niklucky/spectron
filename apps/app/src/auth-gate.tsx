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

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null | undefined;
};

/*
 * MCP clients (Claude, Codex, …) connect through OAuth. Spectron's authorize
 * endpoint sends people here with a signed copy of the client's request:
 * /login (or /register) when they need to sign in, /oauth/consent to approve
 * the client. Once signed in by any method, the browser goes to
 * /api/oauth/resume with the signed query; the server verifies it, checks the
 * session is fresh enough for prompt=login/create and max_age, and continues
 * the authorization. Sign-in requests themselves never carry the query.
 */
/** The signed OAuth request alone, without page-specific params like ?token=. */
function oauthSearch(params: URLSearchParams) {
  const kept = new URLSearchParams(params);
  for (const key of ["token", "error", "oauth_expired"]) kept.delete(key);
  return `?${kept}`;
}
const resumeURL = () => {
  const params = signedOAuthRequest(window.location.search);
  return `/api/oauth/resume${params ? oauthSearch(params) : window.location.search}`;
};
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
  // The signed request is page state on every auth page, so it survives
  // detours such as password recovery; only sign-in and sign-up resume it.
  const oauth = mode !== "login" || path === "login" || isConsent ? signedOAuthRequest(window.location.search) : null;
  const signInPage = path === "login" || path === "register";
  // Same token rules as Better Auth: space-delimited, trimmed.
  const prompts = (oauth?.get("prompt") ?? "").split(/\s+/).map((p) => p.trim()).filter(Boolean);
  // The client asked for a fresh sign-in (prompt=login, or max_age that the
  // current session is too old for): an existing session must not satisfy it.
  const reauth = !!oauth && signInPage && (prompts.includes("login") || oauth.has("max_age"));
  // The client asked for a new account (prompt=create): show sign-up.
  const wantsCreate = !!oauth && signInPage && prompts.includes("create");
  useEffect(() => {
    if (wantsCreate && path === "login") window.location.replace(`/register${window.location.search}`);
  }, [wantsCreate, path]);
  // Signed out on any other page: go to the sign-in URL, which is protected
  // against framing, keeping the deep link.
  const toLogin = !isPending && !error && !data && mode === "login" && path !== "login" && !isConsent;
  useEffect(() => {
    if (toLogin) window.location.replace(`/login${window.location.search}${window.location.hash}`);
  }, [toLogin]);
  // Someone already signed in (another tab): resume the client's request.
  // If it still needs a fresh sign-in or a new account, the server sends the
  // browser back here, where reauth/wantsCreate show the form instead.
  const resumeOAuth = !!data && !!oauth && signInPage && !reauth && !wantsCreate;
  useEffect(() => {
    if (resumeOAuth) window.location.replace(resumeURL());
  }, [resumeOAuth]);
  const invite = /^#invite\/[a-f0-9]{64}$/.test(window.location.hash)
    ? window.location.hash
    : "";
  // Links between the auth pages keep the OAuth request with them. It is
  // only page state: no auth request sends it, so it never blocks sign-in
  // or password recovery, even once expired.
  const continueHash = oauth ? oauthSearch(oauth) : invite;
  // The magic-link verifier redirects here with ?error= when a link is stale.
  const linkError =
    mode === "login" && params.has("error")
      ? "That login link has expired or was already used. Request a new one."
      : params.has("oauth_expired")
        ? "That connection request expired. Start again from the app you were connecting."
        : (reauth
            ? "The app you are connecting asked you to sign in again."
            : wantsCreate
              ? "The app you are connecting asked you to create an account."
              : "");
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
  if (resumeOAuth || toLogin || (wantsCreate && path === "login"))
    return (
      <main className="grid h-dvh place-content-center bg-surface text-ink-2" role="status">
        Continuing to the app…
      </main>
    );
  if (data && isConsent) return <ConsentGate user={data.user} />;
  // Signed in by the time the request turned out to be expired: say so
  // instead of silently opening the workspace.
  if (data && path === "login" && params.has("oauth_expired"))
    return (
      <main className="grid h-dvh place-content-center gap-4 bg-surface px-6 text-center text-ink-2">
        <p role="alert">That connection request expired. Start again from the app you were connecting.</p>
        <Button variant="primary" onClick={() => window.location.replace("/")}>
          Open Spectron
        </Button>
      </main>
    );
  if (data && mode !== "reset-password" && !oauth)
    return children(data.user, data.session.id);

  async function submit(fields: AuthFields) {
    const result =
      mode === "register"
        ? await authClient.signUp.email(fields)
        : mode === "forgot-password"
          ? await authClient.requestPasswordReset({
              email: fields.email,
              // Better Auth adds ?token= to this, keeping the OAuth request.
              redirectTo: `${window.location.origin}/reset-password${oauth ? oauthSearch(oauth) : ""}`,
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
      // A fresh session satisfies prompt=login/create and max_age on resume.
      window.location.replace(oauth ? resumeURL() : `/${window.location.hash}`);
    if (mode === "reset-password")
      window.history.replaceState(null, "", "/reset-password");
  }
  async function sendMagicLink(email: string) {
    const result = await authClient.signIn.magicLink({
      email,
      // Only used when the address is new: a readable name until they edit it.
      name: email.split("@")[0] || email,
      // The server verifies the signed request and the new session's
      // freshness, then resumes the client's authorization.
      callbackURL: oauth ? resumeURL() : `/${invite}`,
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
