import { useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/icon";
import { Avatar } from "../../ui/avatar";
import { cn } from "../../ui/cn";
import type { Palette, Theme } from "../../../hooks/use-theme";

type AccountAction = "profile" | "language" | "signout" | "ai";
export function AccountMenu({
  name,
  email,
  image,
  theme,
  palette,
  collapsed = false,
  onThemeChange: setTheme,
  onPaletteChange: setPalette,
  onAction,
}: {
  name: string;
  email?: string | undefined;
  image?: string | null | undefined;
  theme: Theme;
  palette?: Palette | undefined;
  collapsed?: boolean | undefined;
  onThemeChange: (theme: Theme) => void;
  onPaletteChange?: ((palette: Palette) => void) | undefined;
  onAction: (action: AccountAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const act = (action: AccountAction) => {
    setOpen(false);
    onAction(action);
  };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-base text-ink hover:bg-surface-2";
  return (
    <div className="relative mt-1" ref={ref}>
      {open && (
        <div
          className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl bg-surface p-1.5 shadow-pop hairline"
          aria-label="Account options"
          role="menu"
        >
          <div className="px-2.5 pt-1.5 pb-2">
            <div className="truncate text-base font-semibold">{name}</div>
            {email && <div className="truncate text-sm text-ink-3">{email}</div>}
          </div>
          <div className="label-caps px-2.5 pt-1 pb-1">Appearance</div>
          <div className="flex gap-1 px-1.5 pb-1.5">
            {(["light", "dark", "system"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-sm capitalize",
                  theme === value
                    ? "bg-surface-3 font-medium text-ink"
                    : "text-ink-2 hover:bg-surface-2",
                )}
              >
                <Icon
                  name={value === "dark" ? "moon" : value === "light" ? "sun" : "globe"}
                  size={13}
                />
                {value}
              </button>
            ))}
          </div>
          {setPalette && palette && (
            <div className="flex gap-1 px-1.5 pb-1.5">
              {(["warm", "slate"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={palette === value}
                  onClick={() => setPalette(value)}
                  className={cn(
                    "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-sm capitalize",
                    palette === value
                      ? "bg-surface-3 font-medium text-ink"
                      : "text-ink-2 hover:bg-surface-2",
                  )}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: value === "warm" ? "#0f766e" : "#3b5ba9" }}
                  />
                  {value}
                </button>
              ))}
            </div>
          )}
          <div className="my-1 h-px bg-line-soft" />
          <button type="button" role="menuitem" className={item} onClick={() => act("profile")}>
            <Icon name="user" size={15} className="text-ink-2" />
            Profile
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => act("ai")}>
            <Icon name="sparkle" size={15} className="text-ink-2" />
            AI connections & agents
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => act("language")}>
            <Icon name="globe" size={15} className="text-ink-2" />
            <span className="flex-1">Language</span>
            <span className="text-xs text-ink-3">English</span>
          </button>
          <div className="my-1 h-px bg-line-soft" />
          <button type="button" role="menuitem" className={item} onClick={() => act("signout")}>
            <Icon name="logout" size={15} className="text-ink-2" />
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left hover:bg-surface-3",
          collapsed ? "justify-center px-0" : "px-2",
          open && "bg-surface-3",
        )}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open account menu"
        title={name}
      >
        <Avatar name={name} image={image} size="md" />
        {!collapsed && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-base font-semibold">{name}</span>
            {email && <span className="block truncate text-xs text-ink-3">{email}</span>}
          </span>
        )}
        {!collapsed && <Icon name="chevron" size={14} className="text-ink-3" />}
      </button>
    </div>
  );
}
