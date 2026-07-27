// ============================================================================
// Avero Theme Preference
// ----------------------------------------------------------------------------
// Client-side light/dark theme preference (roadmap Phase 6 — Theming).
//
// The `profiles` table has no `theme_preference` column, and the design
// system (§2) is dark-only by default. Phase 6 adds a light theme as a
// *personal* preference, so it is persisted client-side in localStorage —
// the same place the reaction-hint "seen" flag lives (useReactionHint).
// This keeps the preference per-browser/per-device, which matches the
// "personal layer" framing in the roadmap and avoids a schema change for a
// purely cosmetic, non-shared value.
//
// Phase A (Settings page) builds the toggle UI and reads/writes this
// preference. Phase B (Light Theme) wires the preference to actually apply
// the token set across the app. The two concerns are deliberately split so
// the toggle can ship before the light palette exists.
// ============================================================================

/** The two supported themes. `dark` is the default and the existing palette. */
export type ThemePreference = "dark" | "light";

/** localStorage key for the persisted theme preference. */
export const THEME_STORAGE_KEY = "avero:theme-preference";

/** The default theme when no preference is stored yet (design-system §2). */
export const DEFAULT_THEME: ThemePreference = "dark";

/**
 * Reads the persisted theme preference, falling back to {@link DEFAULT_THEME}
 * when none is stored or the stored value is not one of the two allowed
 * strings (defensive against manual tampering / older formats).
 *
 * Safe to call during render and on the server (SSR / initial mount): it
 * guards `localStorage` access and never throws.
 */
export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private mode, disabled storage) —
    // fall back to the default rather than crashing the app.
  }
  return DEFAULT_THEME;
}

/**
 * Persists the theme preference to localStorage. Silently no-ops when
 * storage is unavailable so the toggle still works in-memory for the
 * current session even if persistence fails.
 */
export function writeThemePreference(theme: ThemePreference): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore — see readThemePreference.
  }
}
