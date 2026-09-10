import type { CSSProperties } from "react";
import { nameHue } from "./name-color";
export function Avatar({
  initials,
  name,
  color = "sage",
  small = false,
}: {
  initials: string;
  name?: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${name ? "avatar-named" : color} ${small ? "avatar-small" : ""}`}
      style={name ? { "--avatar-hue": nameHue(name) } as CSSProperties : undefined}>
      {initials}
    </span>
  );
}
