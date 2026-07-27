import { useCallback, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ThemePreference } from "../lib/theme";
import { readThemePreference, writeThemePreference } from "../lib/theme";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext";

/**
 * Provides the theme preference to the app (roadmap Phase 6 — Theming).
 *
 * Reads the persisted value once on first render (lazy initial state) so
 * there is no flash of the default theme before localStorage is consulted.
 * `setTheme` updates in-memory state and persists; `toggleTheme` flips the
 * two values. A layout effect applies the choice to the document: it toggles
 * the `light` class on <html> so the CSS-variable token set in `index.css`
 * (`:root` = dark, `:root.light` = light) resolves to the right palette, and
 * sets `color-scheme` so native form controls and scrollbars follow. Using
 * `useLayoutEffect` (via the `useIsomorphicLayoutEffect`-style guard below)
 * avoids a one-frame flash of the wrong theme on first paint.
 *
 * Split from `ThemeContext.tsx` so this file exports only a component,
 * satisfying the react-refresh rule (mirrors the `AuthContext` /
 * `AuthProvider` split).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

  // Apply the theme to the document whenever it changes (and on mount).
  // `useLayoutEffect` runs before paint so the `light` class is on <html>
  // before the first frame — no flash of the wrong theme. The `light` class
  // drives the `:root.light` token overrides in `index.css`; `color-scheme`
  // (set in `index.css` via `html` / `html.light`) makes native controls
  // (scrollbars, form inputs) match.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme]);

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
