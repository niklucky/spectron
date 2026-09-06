import { useState } from "react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";

export type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password";
export type AuthFields = { name: string; email: string; password: string };
const titles: Record<AuthMode, string> = {
  login: "Welcome back",
  register: "Create your account",
  "forgot-password": "Forgot your password?",
  "reset-password": "Choose a new password",
};

export function AuthScreen({
  mode,
  onSubmit,
  invalidReset = false,
  continueHash = "",
}: {
  mode: AuthMode;
  onSubmit: (fields: AuthFields) => Promise<void>;
  invalidReset?: boolean;
  continueHash?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isReset = mode === "reset-password";
  const isForgot = mode === "forgot-password";
  const isRegister = mode === "register";
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/">
        Spectron
      </a>
      <section className="auth-content" aria-labelledby="auth-title">
        <h1 id="auth-title">
          {complete
            ? isForgot
              ? "Check your email"
              : "Password updated"
            : invalidReset
              ? "This link is no longer valid"
              : titles[mode]}
        </h1>
        {complete ? (
          <>
            <p role="status">
              {isForgot
                ? "If an account exists for that email, you’ll receive a link to reset your password."
                : "You can now sign in with your new password."}
            </p>
            <a className="auth-link" href={`/login${continueHash}`}>
              Back to sign in
            </a>
          </>
        ) : invalidReset ? (
          <>
            <p>Request a new link to reset your password.</p>
            <a className="auth-link" href={`/forgot-password${continueHash}`}>
              Get a new reset link
            </a>
          </>
        ) : (
          <>
            <p>
              {isForgot
                ? "Enter your email and we’ll send you a reset link."
                : isReset
                  ? "Use at least 12 characters."
                  : isRegister
                    ? "One place for your team’s work."
                    : "Sign in to your workspace."}
            </p>
            <form
              className="auth-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                const data = new FormData(event.currentTarget);
                const password = String(data.get("password") || "");
                if (isReset && password !== data.get("confirmation")) {
                  setError("Passwords don’t match.");
                  return;
                }
                setBusy(true);
                setError("");
                try {
                  await onSubmit({
                    name: String(data.get("name") || "").trim(),
                    email: String(data.get("email") || "").trim(),
                    password,
                  });
                  if (isForgot || isReset) setComplete(true);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Something went wrong. Please try again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                {isRegister && (
                  <label>
                    Name
                    <Input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={80}
                      autoFocus
                    />
                  </label>
                )}
                {!isReset && (
                  <label>
                    Email
                    <Input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      autoFocus={!isRegister}
                    />
                  </label>
                )}
                {!isForgot && (
                  <label>
                    <span className="auth-label-row">
                      {isReset ? "New password" : "Password"}
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </span>
                    <Input
                      aria-label={isReset ? "New password" : "Password"}
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        isRegister || isReset
                          ? "new-password"
                          : "current-password"
                      }
                      required
                      minLength={isRegister || isReset ? 12 : undefined}
                      maxLength={128}
                      aria-describedby={
                        isRegister ? "password-hint" : undefined
                      }
                      autoFocus={isReset}
                    />
                    {isRegister && (
                      <span id="password-hint" className="auth-hint">
                        At least 12 characters
                      </span>
                    )}
                  </label>
                )}
                {isReset && (
                  <label>
                    Confirm password
                    <Input
                      name="confirmation"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                )}
                {mode === "login" && (
                  <a
                    className="auth-forgot auth-link"
                    href={`/forgot-password${continueHash}`}
                  >
                    Forgot password?
                  </a>
                )}
                {error && (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : isRegister
                      ? "Create account"
                      : isForgot
                        ? "Send reset link"
                        : isReset
                          ? "Save new password"
                          : "Sign in"}
                </Button>
              </fieldset>
            </form>
            <p className="auth-footer">
              {mode === "login" ? (
                <>
                  New to Spectron?{" "}
                  <a className="auth-link" href={`/register${continueHash}`}>
                    Create an account
                  </a>
                </>
              ) : (
                <a className="auth-link" href={`/login${continueHash}`}>
                  Back to sign in
                </a>
              )}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
