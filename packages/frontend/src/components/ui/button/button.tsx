import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";
import { Icon } from "../icon";
import type { IconName } from "../icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  icon?: IconName | undefined;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-surface border border-ink hover:not-disabled:opacity-90",
  secondary:
    "bg-surface text-ink hairline hover:not-disabled:bg-surface-2 hover:not-disabled:border-line",
  ghost:
    "bg-transparent text-ink-2 border border-transparent hover:not-disabled:bg-surface-3 hover:not-disabled:text-ink",
  danger:
    "bg-bad-soft text-bad border border-transparent hover:not-disabled:brightness-95",
};
const sizes: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-sm gap-1.5 rounded-sm",
  md: "h-7 px-2.5 text-sm gap-1.5 rounded-md",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 14} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active = false,
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  active?: boolean | undefined;
  size?: ButtonSize | undefined;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:not-disabled:bg-surface-3 hover:not-disabled:text-ink disabled:opacity-40",
        size === "sm" ? "size-6" : "size-7",
        active && "bg-accent-soft text-accent-ink hover:not-disabled:bg-accent-soft",
        className,
      )}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      {...props}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
}
