import { useCallback, useState } from "react";
import type { ThemePreference } from "../lib/theme";
import { readThemePreference, writeThemePreference } from "../lib/theme";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext";

/**
 * Provides the theme preference to the app (roadmap Phase 6 — Theming).
 *
 * Reads the persisted value once on first render (lazy initial state) so
 * there is no flash of the default theme before localStorage is consulted.
 * `setTheme` updates in-memory state and persists; `toggleTheme` flips the
 * two values. Phase B will add the side effect that applies the token set
 * to the document; that belongs here (or a sibling effect) so the Settings
 * toggle stays a pure state setter from the page's perspective.
 *
 * Split from `ThemeContext.tsx` so this file exports only a component,
 * satisfying the react-refresh rule (mirrors the `AuthContext` /
 * `AuthProvider` split).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    writeThemePreference(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemePreference = prev === "dark" ? "light" : "dark";
      writeThemePreference(next);
      return next;
    });
  }, []);

  const value: ThemeContextValue = { theme, setTheme, toggleTheme };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
