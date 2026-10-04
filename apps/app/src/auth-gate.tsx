import { type ReactNode } from "react";
import {
  AuthScreen,
  type AuthFields,
  type AuthMode,
} from "@spectron/frontend/components/feature/auth";
import { useTheme } from "@spectron/frontend/hooks/use-theme";
import { Button } from "@spectron/frontend/components/ui/button";
import { authClient } from "./lib/auth-client";

type AuthUser = { id: string; name: string; email: string };
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
      window.location.replace(`/${window.location.hash}`);
    if (mode === "reset-password")
      window.history.replaceState(null, "", "/reset-password");
  }
  async function sendMagicLink(email: string) {
    const result = await authClient.signIn.magicLink({
      email,
      // Only used when the address is new: a readable name until they edit it.
      name: email.split("@")[0] || email,
      callbackURL: `/${continueHash}`,
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
