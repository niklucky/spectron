import { useState, type ReactNode } from "react";
import { Input, PasswordInput, PasswordStrength } from "../../ui/input";
import { Button } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { PASSWORD_MIN_LENGTH } from "../../../lib/password-strength";

export type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password";
export type AuthFields = { name: string; email: string; password: string };

const titles: Record<AuthMode, string> = {
  login: "Log in to Spectron",
  register: "Create your account",
  "forgot-password": "Reset your password",
  "reset-password": "Choose a new password",
};
const actions: Record<AuthMode, string> = {
  login: "Log in",
  register: "Create account",
  "forgot-password": "Send reset link",
  "reset-password": "Save new password",
};

/*
 * One quiet column in the middle of the page, like Linear and Resend: a mark,
 * a title, the controls, and one line to switch between login and sign-up.
 * The only decoration is the background: a soft accent glow on the palette.
 */
export function AuthScreen({
  mode,
  onSubmit,
  onMagicLink,
  invalidReset = false,
  continueHash = "",
  notice = "",
}: {
  mode: AuthMode;
  onSubmit: (fields: AuthFields) => Promise<void>;
  /** Sends a login link. When present, login starts with email only. */
  onMagicLink?: ((email: string) => Promise<void>) | undefined;
  invalidReset?: boolean;
  continueHash?: string;
  /** A message to show above the form on arrival, e.g. a stale-link error. */
  notice?: string;
}) {
  return (
    <main className="relative h-dvh overflow-y-auto bg-bg text-ink">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_55%_at_50%_-10%,color-mix(in_srgb,var(--sp-accent)_13%,transparent),transparent_62%),radial-gradient(50%_40%_at_90%_110%,color-mix(in_srgb,var(--sp-merged)_9%,transparent),transparent_62%)]"
        aria-hidden
      />
      <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-16">
        <section className="flex w-[340px] max-w-full flex-col items-center" aria-labelledby="auth-title">
          <AuthForm
            mode={mode}
            onSubmit={onSubmit}
            onMagicLink={onMagicLink}
            invalidReset={invalidReset}
            continueHash={continueHash}
            notice={notice}
          />
        </section>
      </div>
    </main>
  );
}

function Mark({ icon = "pulse" }: { icon?: IconName }) {
  return (
    <span className="grid size-11 place-items-center rounded-2xl bg-ink text-surface shadow-pop">
      <Icon name={icon} size={22} strokeWidth={2.25} />
    </span>
  );
}

const control = "h-11 rounded-xl text-base";


function AuthForm({
  mode,
  onSubmit,
  onMagicLink,
  invalidReset,
  continueHash,
  notice,
}: {
  mode: AuthMode;
  onSubmit: (fields: AuthFields) => Promise<void>;
  onMagicLink: ((email: string) => Promise<void>) | undefined;
  invalidReset: boolean;
  continueHash: string;
  notice: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice);
  const [complete, setComplete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  // Login starts with a link; the password is one click away.
  const [withPassword, setWithPassword] = useState(!onMagicLink);
  const [linkSentTo, setLinkSentTo] = useState("");
  const [email, setEmail] = useState("");
  const isReset = mode === "reset-password";
  const isForgot = mode === "forgot-password";
  const isRegister = mode === "register";
  const isLogin = mode === "login";
  const newPassword = isRegister || isReset;
  const linkLogin = isLogin && !withPassword && !!onMagicLink;

  const sendLink = async (to: string) => {
    if (!onMagicLink || busy) return;
    setBusy(true);
    setError("");
    try {
      await onMagicLink(to);
      setLinkSentTo(to);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (linkSentTo)
    return (
      <Outcome
        icon="send"
        title="Check your email"
        lead={`We sent a login link to ${linkSentTo}. It expires in 10 minutes and signs in the device that opens it.`}
      >
        {error && <Alert className="mt-6">{error}</Alert>}
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-sm text-ink-3">
          <button
            type="button"
            className="text-ink-3 transition-colors hover:text-ink disabled:opacity-50"
            disabled={busy}
            onClick={() => void sendLink(linkSentTo)}
          >
            {busy ? "Sending…" : "Send it again"}
          </button>
          <button
            type="button"
            className="text-ink-3 transition-colors hover:text-ink"
            onClick={() => {
              setLinkSentTo("");
              setWithPassword(true);
            }}
          >
            Use a password instead
          </button>
        </p>
      </Outcome>
    );
  if (complete)
    return (
      <Outcome
        title={isForgot ? "Check your email" : "Password updated"}
        lead={
          isForgot
            ? "If an account exists for that email, a reset link is on its way."
            : "You can now log in with your new password."
        }
      >
        <OutcomeButton href={`/login${continueHash}`}>Back to log in</OutcomeButton>
      </Outcome>
    );
  if (invalidReset)
    return (
      <Outcome
        icon="alert"
        title="This link is no longer valid"
        lead="Reset links expire after 30 minutes. Request a new one to continue."
      >
        <OutcomeButton href={`/forgot-password${continueHash}`}>
          Get a new reset link
        </OutcomeButton>
      </Outcome>
    );

  return (
    <>
      <Mark />
      <h1
        id="auth-title"
        className="mt-6 text-center text-xl font-semibold tracking-[-0.015em]"
      >
        {titles[mode]}
      </h1>
      <p className="mt-2 text-center text-sm text-ink-2">
        {mode === "login" ? (
          <>
            New to Spectron?{" "}
            <Swap href={`/register${continueHash}`}>Create an account</Swap>.
          </>
        ) : isRegister ? (
          <>
            Already have an account?{" "}
            <Swap href={`/login${continueHash}`}>Log in</Swap>.
          </>
        ) : isForgot ? (
          "Enter your email and we’ll send you a link."
        ) : (
          `Use at least ${PASSWORD_MIN_LENGTH} characters.`
        )}
      </p>
      <form
        className="mt-8 w-full"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          if (linkLogin) {
            await sendLink(String(data.get("email") || "").trim());
            return;
          }
          const value = String(data.get("password") || "");
          if (isReset && value !== data.get("confirmation")) {
            setError("Passwords don’t match.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await onSubmit({
              name: String(data.get("name") || "").trim(),
              email: String(data.get("email") || "").trim(),
              password: value,
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
        <fieldset
          disabled={busy}
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
        >
          {isRegister && (
            <Input
              inputSize="lg"
              name="name"
              placeholder="Your name"
              aria-label="Name"
              autoComplete="name"
              required
              maxLength={80}
              autoFocus
            />
          )}
          {!isReset && (
            <Input
              inputSize="lg"
              name="email"
              type="email"
              placeholder="Email"
              aria-label="Email"
              autoComplete="email"
              required
              maxLength={254}
              autoFocus={!isRegister}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          )}
          {!isForgot && !linkLogin && (
            <div className="flex flex-col gap-2">
              <PasswordInput
                inputSize="lg"
                name="password"
                placeholder={isReset ? "New password" : "Password"}
                aria-label={isReset ? "New password" : "Password"}
                visible={showPassword}
                onVisibleChange={setShowPassword}
                autoComplete={newPassword ? "new-password" : "current-password"}
                required
                minLength={newPassword ? PASSWORD_MIN_LENGTH : undefined}
                maxLength={128}
                aria-describedby={newPassword ? "password-strength" : undefined}
                autoFocus={isReset}
                onChange={
                  newPassword
                    ? (event) => setPassword(event.currentTarget.value)
                    : undefined
                }
              />
              {newPassword && (
                <PasswordStrength
                  id="password-strength"
                  password={password}
                  min={PASSWORD_MIN_LENGTH}
                  className="px-0.5"
                />
              )}
            </div>
          )}
          {isReset && (
            <PasswordInput
              inputSize="lg"
              name="confirmation"
              placeholder="Confirm new password"
              aria-label="Confirm new password"
              visible={showPassword}
              onVisibleChange={setShowPassword}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={128}
            />
          )}
          {error && <Alert>{error}</Alert>}
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy}
            className={`${control} mt-1 w-full font-medium`}
          >
            {busy
              ? "Please wait…"
              : linkLogin
                ? "Continue with email"
                : actions[mode]}
          </Button>
        </fieldset>
      </form>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-sm text-ink-3">
        {isLogin && linkLogin ? (
          <button
            type="button"
            className="text-ink-3 transition-colors hover:text-ink"
            onClick={() => setWithPassword(true)}
          >
            Use a password instead
          </button>
        ) : isLogin ? (
          <>
            <Swap href={`/forgot-password${continueHash}`} muted>
              Forgot your password?
            </Swap>
            {onMagicLink && (
              <button
                type="button"
                className="text-ink-3 transition-colors hover:text-ink"
                onClick={() => setWithPassword(false)}
              >
                Email me a login link
              </button>
            )}
          </>
        ) : isRegister ? (
          <>
            By continuing you agree to keep your workspace’s data private and
            secure.
          </>
        ) : (
          <Swap href={`/login${continueHash}`} muted>
            Back to log in
          </Swap>
        )}
      </p>
    </>
  );
}

function Swap({
  href,
  muted = false,
  children,
}: {
  href: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        muted
          ? "text-ink-3 no-underline transition-colors hover:text-ink"
          : "font-medium text-ink no-underline hover:underline"
      }
    >
      {children}
    </a>
  );
}

function Alert({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <p
      className={`flex w-full items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-left text-sm text-bad ${className}`}
      role="alert"
    >
      <Icon name="alert" size={15} className="mt-0.5" />
      {children}
    </p>
  );
}

function OutcomeButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      variant="primary"
      size="md"
      className={`${control} mt-8 w-full font-medium`}
      onClick={() => window.location.assign(href)}
    >
      {children}
    </Button>
  );
}

function Outcome({
  icon = "check",
  title,
  lead,
  children,
}: {
  icon?: IconName;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <>
      <Mark icon={icon} />
      <h1
        id="auth-title"
        className="mt-6 text-center text-xl font-semibold tracking-[-0.015em]"
      >
        {title}
      </h1>
      <p className="mt-2 text-center text-sm text-ink-2" role="status">
        {lead}
      </p>
      {children}
    </>
  );
}
