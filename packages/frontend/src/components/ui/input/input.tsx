import type { ComponentPropsWithRef } from "react";
import { cn } from "../cn";

const field =
  "block w-full min-w-0 rounded-md bg-surface px-2.5 text-base text-ink hairline placeholder:text-ink-3 focus:border-line-2 focus:outline-none disabled:opacity-60";

export type InputProps = ComponentPropsWithRef<"input"> & {
  variant?: "default" | "plain" | undefined;
};
export function Input({ className = "", variant = "default", ...props }: InputProps) {
  return (
    <input
      className={cn(
        variant === "default" ? cn(field, "h-8") : "min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3",
        className,
      )}
      {...props}
    />
  );
}
export type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  variant?: "default" | "plain" | undefined;
};
export function Textarea({ className = "", variant = "default", ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        variant === "default" ? cn(field, "min-h-20 resize-y py-1.5 leading-normal") : "min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3",
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
        variant === "default" ? cn(field, "h-8 pr-7") : "bg-transparent text-base text-ink outline-none",
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
