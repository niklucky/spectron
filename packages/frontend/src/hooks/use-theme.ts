import { useEffect, useState } from "react";
export type Theme = "light" | "dark" | "system";
export type Palette = "warm" | "slate";
const readTheme = (): Theme => {
  try {
    const value = localStorage.getItem("spectron-theme");
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
};
const readPalette = (): Palette => {
  try {
    return localStorage.getItem("spectron-palette") === "slate"
      ? "slate"
      : "warm";
  } catch {
    return "warm";
  }
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [palette, setPalette] = useState<Palette>(readPalette);
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
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem("spectron-palette", palette);
    } catch {
      /* Palette still works without storage. */
    }
  }, [palette]);

  return { theme, setTheme, palette, setPalette };
}
