import { useEffect, useState } from "react";
export type Theme = "light" | "dark" | "system";
const readTheme = (): Theme => {
  try {
    const value = localStorage.getItem("spectron-theme");
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("spectron-theme", theme);
    } catch {
      /* Theme still works without storage. */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return { theme, setTheme };
}
