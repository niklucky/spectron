import type { ReactNode } from "react";
import { cn } from "../cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  title?: string | undefined;
};

/** Two to four mutually exclusive choices, e.g. Simple / Developer. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className = "",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md" | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 rounded-lg bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
            size === "sm" ? "h-6 px-2 text-xs" : "h-[26px] px-2.5 text-sm",
            option.value === value
              ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--sp-line-soft)]"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
