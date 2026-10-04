import { useState, type ComponentPropsWithRef } from "react";
import { cn } from "../cn";
import { IconButton } from "../button";
import { passwordStrength } from "../../../lib/password-strength";

const field =
  "block w-full min-w-0 bg-surface text-ink hairline placeholder:text-ink-3 focus:border-line-2 focus:outline-none disabled:opacity-60";
export type InputSize = "md" | "lg";
const sizes: Record<InputSize, string> = {
  md: "h-8 rounded-md px-2.5 text-base",
  lg: "h-11 rounded-xl px-3.5 text-base",
};

export type InputProps = ComponentPropsWithRef<"input"> & {
  variant?: "default" | "plain" | undefined;
  /** Control height. `lg` is for full-page forms such as sign in. */
  inputSize?: InputSize | undefined;
};
export function Input({ className = "", variant = "default", inputSize = "md", ...props }: InputProps) {
  return (
    <input
      className={cn(
        variant === "default" ? cn(field, sizes[inputSize]) : "min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

/** Password field with a show/hide eye button inside the control. */
export function PasswordInput({
  className = "",
  inputSize = "md",
  visible,
  onVisibleChange,
  ...props
}: Omit<InputProps, "type" | "variant"> & {
  /** Controlled visibility, so two fields (password + confirmation) can share one toggle. */
  visible?: boolean | undefined;
  onVisibleChange?: ((visible: boolean) => void) | undefined;
}) {
  const [own, setOwn] = useState(false);
  const shown = visible ?? own;
  const toggle = () => (onVisibleChange ?? setOwn)(!shown);
  return (
    <span className={cn("relative block min-w-0", className)}>
      <Input
        inputSize={inputSize}
        type={shown ? "text" : "password"}
        className={inputSize === "lg" ? "pr-11" : "pr-8"}
        {...props}
      />
      <IconButton
        icon={shown ? "eye-off" : "eye"}
        label={shown ? "Hide password" : "Show password"}
        size={inputSize === "lg" ? "md" : "sm"}
        tabIndex={-1}
        onClick={toggle}
        className={cn("absolute top-1/2 -translate-y-1/2 text-ink-3", inputSize === "lg" ? "right-2" : "right-1")}
      />
    </span>
  );
}

const strengthColor = ["", "bg-bad", "bg-warn", "bg-accent", "bg-ok"] as const;
const strengthText = ["text-ink-3", "text-bad", "text-warn", "text-accent-ink", "text-ok"] as const;

/** Four-segment meter under a new-password field. Shows the length hint until the minimum is met. */
export function PasswordStrength({
  password,
  min,
  id,
  className = "",
}: {
  password: string;
  min: number;
  id?: string | undefined;
  className?: string | undefined;
}) {
  const strength = passwordStrength(password, min);
  const empty = password.length === 0;
  return (
    <span id={id} className={cn("flex flex-col gap-1.5", className)} aria-live="polite">
      <span className="grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 rounded-full transition-colors",
              step <= strength.score ? strengthColor[strength.score] : "bg-line",
            )}
          />
        ))}
      </span>
      <span className={cn("text-xs", empty ? "text-ink-3" : strengthText[strength.score])}>
        {empty
          ? `At least ${min} characters`
          : strength.score === 0
            ? `${strength.label} · at least ${min} characters`
            : strength.label}
      </span>
    </span>
  );
}

export type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  variant?: "default" | "plain" | undefined;
};
export function Textarea({ className = "", variant = "default", ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        variant === "default" ? cn(field, "min-h-20 resize-y rounded-md px-2.5 py-1.5 text-base leading-normal") : "min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3",
        className,
      )}
      {...props}
    />
  );
}
export type SelectProps = ComponentPropsWithRef<"select"> & {
  variant?: "default" | "plain" | undefined;
};
export function Select({ className = "", variant = "default", ...props }: SelectProps) {
  return (
    <select
      className={cn(
        variant === "default" ? cn(field, "h-8 rounded-md px-2.5 pr-7 text-base") : "bg-transparent text-base text-ink outline-none",
        className,
      )}
      {...props}
    />
  );
}

/** Label + control stacked, for forms in drawers and dialogs. */
export function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-sm text-ink-2", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
