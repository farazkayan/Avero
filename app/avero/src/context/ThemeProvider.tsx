import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ThemePreference } from "../lib/theme";
import { readThemePreference, writeThemePreference } from "../lib/theme";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext";

/**
 * Provides the theme preference to the app (roadmap Phase 6 — Theming).
 *
 * The pre-paint inline script in `index.html` handles the initial theme class
 * on <html> before React mounts, preventing FOUC. This provider:
 * - Reads the persisted value once on first render (lazy initial state)
 * - Syncs the `color-scheme` property on <html> so native form controls and
 *   scrollbars follow the theme
 * - Provides `setTheme` and `toggleTheme` for user-initiated changes
 *
 * Split from `ThemeContext.tsx` so this file exports only a component,
 * satisfying the react-refresh rule (mirrors the `AuthContext` /
 * `AuthProvider` split).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

  // Sync color-scheme on <html> so native controls (scrollbars, form inputs) match.
  // The `dark` class is already managed by the pre-paint script and toggleTheme.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.style.colorScheme = "light";
    } else {
      root.style.colorScheme = "dark";
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    writeThemePreference(next);
    // Also toggle the `dark` class on <html> for Tailwind's darkMode: "class"
    const root = document.documentElement;
    if (next === "light") {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemePreference = prev === "dark" ? "light" : "dark";
      writeThemePreference(next);
      const root = document.documentElement;
      if (next === "light") {
        root.classList.remove("dark");
      } else {
        root.classList.add("dark");
      }
      root.style.colorScheme = next;
      return next;
    });
  }, []);

  const value: ThemeContextValue = { theme, setTheme, toggleTheme };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
