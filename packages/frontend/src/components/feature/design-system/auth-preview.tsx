import { AuthScreen, type AuthMode } from "../auth";

const modes: AuthMode[] = [
  "login",
  "register",
  "forgot-password",
  "reset-password",
];
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `#design/auth/<mode>` renders an auth screen with fake handlers, so the
 * states can be checked while logged in. Add `?invalid` for the stale reset
 * link state, or `?password` to start login on the password step.
 */
export function AuthPreview({ hash }: { hash: string }) {
  const [path, query = ""] = hash.replace(/^#design\/auth\/?/, "").split("?");
  const mode = modes.find((m) => m === path) ?? "login";
  const params = new URLSearchParams(query);
  return (
    <AuthScreen
      key={hash}
      mode={mode}
      onSubmit={async () => {
        await wait(600);
        if (mode === "login") throw new Error("Invalid email or password");
      }}
      onMagicLink={params.has("password") ? undefined : () => wait(600)}
      invalidReset={params.has("invalid")}
      notice={params.has("stale") ? "That login link has expired or was already used. Request a new one." : ""}
    />
  );
}
