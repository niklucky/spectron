import { type ReactNode } from "react";
import {
  AuthScreen,
  type AuthFields,
  type AuthMode,
} from "@spectron/frontend/components/feature/auth";
import { useTheme } from "@spectron/frontend/hooks/use-theme";
import { Button } from "@spectron/frontend/components/ui/button";
import { authClient } from "./lib/auth-client";
import "@spectron/frontend/auth.css";

type AuthUser = { id: string; name: string; email: string };
export function AuthGate({
  children,
}: {
  children: (user: AuthUser) => ReactNode;
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
  if (isPending)
    return (
      <main className="auth-loading" role="status">
        Loading workspace…
      </main>
    );
  if (error)
    return (
      <main className="auth-loading">
        <p role="alert">Couldn’t connect to Spectron.</p>
        <Button onClick={() => void refetch()}>Try again</Button>
      </main>
    );
  if (data && mode !== "reset-password") return children(data.user);

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
  return (
    <AuthScreen
      key={mode}
      mode={mode}
      onSubmit={submit}
      invalidReset={
        mode === "reset-password" && (!token || params.has("error"))
      }
    />
  );
}
