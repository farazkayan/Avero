import { createContext, useContext } from "react";
import type { ThemePreference } from "../lib/theme";

/**
 * Theme preference context (roadmap Phase 6 — Theming).
 *
 * A single source of truth for the user's light/dark choice, shared by the
 * Settings page toggle (Phase A) and the actual token application (Phase B).
 * Keeping the preference in context — rather than each consumer reading
 * localStorage directly — means a change in one place propagates everywhere
 * instantly, and the persistence layer (`lib/theme.ts`) is exercised through
 * one well-defined seam.
 *
 * The provider component lives in `ThemeProvider.tsx` (split so this file
 * exports only the context + hook, mirroring `AuthContext` /
 * `AuthProvider` — the react-refresh rule requires a file that exports a
 * component to export *only* components).
 */
export type ThemeContextValue = {
  /** The currently selected theme preference. */
  theme: ThemePreference;
  /** Sets and persists the theme preference. */
  setTheme: (theme: ThemePreference) => void;
  /** Convenience toggle: flips between dark and light. */
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

/**
 * Reads the theme preference context. Throws if used outside a
 * `ThemeProvider`, matching the `useAuth` pattern so misuse fails loudly.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
