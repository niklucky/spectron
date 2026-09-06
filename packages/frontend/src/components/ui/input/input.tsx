import type { ComponentPropsWithRef } from "react";

export type InputProps = ComponentPropsWithRef<"input"> & {
  variant?: "default" | "plain";
};
export function Input({
  className = "",
  variant = "default",
  ...props
}: InputProps) {
  return (
    <input
      className={`${variant === "default" ? "text-input" : "input-plain"} ${className}`}
      {...props}
    />
  );
}
export type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  variant?: "default" | "plain";
};
export function Textarea({
  className = "",
  variant = "default",
  ...props
}: TextareaProps) {
  return (
    <textarea
      className={`${variant === "default" ? "text-input" : "input-plain"} ${className}`}
      {...props}
    />
  );
}
export type SelectProps = ComponentPropsWithRef<"select"> & {
  variant?: "default" | "plain";
};
export function Select({
  className = "",
  variant = "default",
  ...props
}: SelectProps) {
  return (
    <select
      className={`${variant === "default" ? "select-input" : "input-plain"} ${className}`}
      {...props}
    />
  );
}
