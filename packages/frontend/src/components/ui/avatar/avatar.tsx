import { useState, type CSSProperties } from "react";
import { cn } from "../cn";
import { nameHue } from "./name-color";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarKind = "person" | "agent";

const sizes: Record<AvatarSize, string> = {
  xs: "size-4 text-[7.5px]",
  sm: "size-5 text-[8.5px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[12.5px]",
  xl: "size-10 text-[14px]",
};
const markSizes: Record<AvatarSize, string> = {
  xs: "hidden",
  sm: "size-2 -right-0.5 -bottom-0.5",
  md: "size-[10px] -right-[3px] -bottom-[3px]",
  lg: "size-[11px] -right-[3px] -bottom-[3px]",
  xl: "size-3 -right-1 -bottom-1",
};

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * People are circles, agents are rounded squares with a small AI mark.
 * A `working` agent shows a spinning ring.
 */
export function Avatar({
  name,
  image,
  initials,
  size = "md",
  kind = "person",
  working = false,
  className = "",
  title,
  color,
  small,
}: {
  name?: string | undefined;
  image?: string | null | undefined;
  initials?: string | undefined;
  size?: AvatarSize | undefined;
  kind?: AvatarKind | undefined;
  working?: boolean | undefined;
  className?: string | undefined;
  title?: string | undefined;
  /** Legacy props kept for callers not yet migrated. */
  color?: string | undefined;
  small?: boolean | undefined;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const finalSize: AvatarSize = small ? "sm" : size;
  const label = initials ?? (name ? initialsOf(name) : "?");
  const hue = nameHue(name ?? label);
  const agent = kind === "agent";
  const style = {
    "--avatar-hue": hue,
    background: `linear-gradient(145deg, hsl(${hue} 55% 90%), hsl(${hue + 25} 50% 80%))`,
    color: `hsl(${hue} 45% 26%)`,
  } as CSSProperties;
  void color;
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center font-semibold tracking-[-0.01em] select-none",
        agent ? "rounded-[30%]" : "rounded-full",
        sizes[finalSize],
        className,
      )}
      style={image && failed !== image ? undefined : style}
      title={title ?? name}
      aria-label={name}
    >
      {image && failed !== image ? (
        <img
          src={image}
          alt=""
          onError={() => setFailed(image)}
          className={cn(
            "size-full object-cover",
            agent ? "rounded-[30%]" : "rounded-full",
          )}
        />
      ) : (
        label
      )}
      {agent && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute grid place-items-center rounded-full bg-ink text-surface ring-2 ring-surface",
            markSizes[finalSize],
          )}
        >
          <svg viewBox="0 0 24 24" className="size-[70%]" fill="currentColor">
            <path d="M12 4.5l1.9 5.1 5.1 1.9-5.1 1.9L12 18.5l-1.9-5.1L5 11.5l5.1-1.9z" />
          </svg>
        </span>
      )}
      {working && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -inset-[3px] animate-spin-slow border-[1.5px] border-accent border-r-transparent",
            agent ? "rounded-[34%]" : "rounded-full",
          )}
        />
      )}
    </span>
  );
}
