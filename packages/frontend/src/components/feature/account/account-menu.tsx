import { useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/icon";
import { Avatar } from "../../ui/avatar";
import type { Theme } from "../../../hooks/use-theme";

type AccountAction = "profile" | "language" | "signout";
export function AccountMenu({
  name,
  theme,
  onThemeChange: setTheme,
  onAction,
}: {
  name: string;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onAction: (action: AccountAction) => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [themeMenu, setThemeMenu] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const openModal = (action: AccountAction) => {
    setAccountOpen(false);
    setThemeMenu(false);
    onAction(action);
  };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
        setThemeMenu(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setThemeMenu(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <div className="sidebar-account" ref={accountRef}>
      {accountOpen && (
        <div className="account-menu" aria-label="Account options">
          <button
            onClick={() => setThemeMenu((value) => !value)}
            aria-expanded={themeMenu}
          >
            <Icon name={theme === "dark" ? "moon" : "sun"} />
            <span>Theme</span>
            <span className="menu-value">{theme}</span>
            <Icon name="chevron" size={13} />
          </button>
          {themeMenu && (
            <div className="theme-options">
              {(["light", "dark", "system"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                >
                  {value}
                  {theme === value && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              openModal("profile");
            }}
          >
            <Icon name="user" />
            <span>Profile</span>
          </button>
          <button onClick={() => openModal("language")}>
            <Icon name="globe" />
            <span>Language</span>
            <span className="menu-value">English</span>
          </button>
          <div className="menu-divider" />
          <button onClick={() => openModal("signout")}>
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      )}
      <button
        className={`account-button ${accountOpen ? "account-active" : ""}`}
        onClick={() => setAccountOpen((value) => !value)}
        aria-expanded={accountOpen}
        aria-label="Open account menu"
        title={name}
      >
        <Avatar initials={name.slice(0, 1).toUpperCase()} />
        <span className="sidebar-label">{name}</span>
        <Icon name="chevron" size={15} />
      </button>
    </div>
  );
}
