import { cn } from "./cn";

/** The spectral wave mark, with transparent space around its halo. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src="/assets/brand/logo-128.png"
      alt=""
      aria-hidden="true"
      width={128}
      height={128}
      draggable={false}
      className={cn("size-8 shrink-0 object-contain", className)}
    />
  );
}
