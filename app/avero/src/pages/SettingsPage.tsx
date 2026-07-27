import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import TextField from "../components/ui/TextField";
import GhostLink from "../components/ui/GhostLink";
import { AvatarUpload } from "../components/ui/AvatarUpload";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";
import { AUTHENTICATED_HOME_PATH } from "../constants/routes";
import type { ThemePreference } from "../lib/theme";

/**
 * Maximum length for a display name.
 *
 * The `profiles.name` column is `text NOT NULL` with no CHECK constraint
 * (database §3). The sign-up flow stores the name from `user_metadata`, which
 * Supabase Auth caps at a generous length; 100 characters matches the Space
 * name ceiling used elsewhere in the app so a name edited here can never
 * exceed what the rest of the UI comfortably renders.
 */
const MAX_NAME_LENGTH = 100;

/**
 * Account Settings (roadmap Phase 6 — Identity & account).
 *
 * A single, calm screen for the signed-in user's personal preferences
 * (design-system §5: "one primary focus per screen"). Three sections, each
 * visually separated and independently actionable:
 *
 *  - **Profile** — avatar (reuses the existing `AvatarUpload` pipeline: file
 *    pick → validate → resize → WebP → upload → `profiles.avatar_url` update,
 *    no duplicated logic) and an editable display name written to
 *    `profiles.name` (the only user-editable column on the profiles table —
 *    database §3). Email is read-only: it lives on `auth.users`, not
 *    `profiles`, and changing it is an auth-level operation out of scope for
 *    the Settings page.
 *  - **Theme** — a light/dark selector persisted via `useTheme` (Phase A
 *    builds the UI; Phase B wires the actual token application).
 *  - **Sign out** — the same Supabase `signOut` path used by `AppShell`,
 *    relocated here so the header can stay minimal. The `AuthProvider`
 *    `onAuthStateChange` listener redirects the now-unauthenticated user to
 *    sign-in automatically.
 *
 * Authenticated-only: the route is registered inside `ProtectedRoute`, so
 * reaching it while logged out redirects to sign-in rather than rendering a
 * confusing half-state. Every save action gives clear success/failure
 * feedback inline (design-system §8: "Never leave user uncertain").
 */
export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  // --- Profile: display name ---
  // Seeded from the user_metadata name captured at sign-up (then email) so
  // the field is never empty for an authenticated user on first paint. The
  // effect below overwrites it with the profile row's `name` (the source of
  // truth for `profiles.name`) once fetched.
  const initialName =
    (user?.user_metadata?.name as string | undefined) || user?.email || "";
  const [displayName, setDisplayName] = useState(initialName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [nameSuccess, setNameSuccess] = useState<string | undefined>(
    undefined,
  );

  // Load the profile's display name once on mount (and when the user id
  // changes, e.g. account switch). The avatar is handled separately by
  // AvatarUpload via AuthContext, so this only fetches `name`. The route is
  // protected, so `user` is present; the guard only satisfies the type
  // system and must not setState synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    async function loadName(userId: string) {
      const { data } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;

      const profileName = (data as { name?: string } | null)?.name?.trim();
      if (profileName) {
        setDisplayName(profileName);
      }
    }

    void loadName(user.id);

    return () => {
      cancelled = true;
    };
  }, [user]);

  function validateName(value: string): string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Enter a display name.";
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Keep your name under ${MAX_NAME_LENGTH} characters.`;
    }
    return undefined;
  }

  async function handleSaveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSavingName || !user) {
      return;
    }

    const nextError = validateName(displayName);
    setNameError(nextError);
    setNameSuccess(undefined);
    if (nextError) {
      return;
    }

    setIsSavingName(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ name: displayName.trim() })
        .eq("id", user.id);

      if (error) {
        setNameError("We couldn't save your name. Please try again.");
        return;
      }

      setNameSuccess("Name saved.");
    } catch {
      setNameError("We couldn't save your name. Please try again.");
    } finally {
      setIsSavingName(false);
    }
  }

  // --- Theme ---
  function handleSelectTheme(next: ThemePreference) {
    if (next === theme) {
      return;
    }
    setTheme(next);
    // The preference is persisted inside setTheme; Phase B will apply the
    // token set. No explicit success message here — the selector's own
    // selected state is the immediate visual confirmation (design-system §8).
  }

  // --- Sign out ---
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }
    setIsSigningOut(true);
    await supabase.auth.signOut();
    // No finally reset: the auth listener redirects away on success, so the
    // loading state should persist until that happens (same pattern as
    // AppShell).
  }

  const email = user?.email ?? "";

  return (
    <AppShell>
      <div className="mb-6">
        <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
      </div>

      <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
        Settings
      </h1>

      {/* ---------------------------------------------------------------- */}
      {/* Profile                                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">Profile</h2>

        {/* Avatar — reuse the existing upload pipeline (no duplicated logic).
            Rendered larger than the header affordance so it reads as the
            primary identity control on this screen. */}
        <div className="mt-4 flex items-center gap-5">
          <AvatarUpload
            name={displayName || email}
            size={96}
          />
          <div className="min-w-0">
            <p className="text-sm text-ink">
              Profile picture
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Click the avatar to upload a new image. PNG, JPG, or WebP up to
              2&nbsp;MB.
            </p>
          </div>
        </div>

        {/* Display name — the only user-editable column on `profiles`. */}
        <form
          className="mt-6 max-w-[420px] space-y-4"
          onSubmit={handleSaveName}
          noValidate
        >
          <TextField
            id="display-name"
            name="name"
            type="text"
            label="Display name"
            autoComplete="name"
            maxLength={MAX_NAME_LENGTH}
            value={displayName}
            disabled={isSavingName}
            error={nameError}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (nameError) setNameError(undefined);
              if (nameSuccess) setNameSuccess(undefined);
            }}
            onBlur={() => setNameError(validateName(displayName))}
          />

          {/* Read-only email — lives on auth.users, not profiles. Editing it
              is an auth-level operation out of scope here, so it is shown as
              a non-editable reference rather than a disabled input (a
              disabled input implies it *could* be edited). */}
          <div>
            <span className="block text-sm font-medium text-ink-muted mb-2">
              Email
            </span>
            <p className="rounded-lg border border-ink/10 bg-canvas px-3.5 py-2.5 text-base text-ink-muted">
              {email || "—"}
            </p>
          </div>

          {nameSuccess && (
            <p className="text-sm text-accent-400" role="status">
              {nameSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={isSavingName}
            aria-busy={isSavingName || undefined}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingName ? "Saving…" : "Save name"}
          </button>
        </form>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Theme                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">Theme</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Choose how Avero looks. Your choice is remembered on this device.
        </p>

        {/* A two-option segmented selector. The selected option carries the
            accent fill so the current choice is unambiguous; the other is a
            calm outline. Two real <button>s (not a hidden radio group) so
            the affordance is obvious and keyboard-accessible. */}
        <div
          className="mt-4 inline-flex rounded-lg border border-ink/10 p-1"
          role="group"
          aria-label="Theme preference"
        >
          <ThemeOption
            label="Dark"
            value="dark"
            current={theme}
            onSelect={handleSelectTheme}
          />
          <ThemeOption
            label="Light"
            value="light"
            current={theme}
            onSelect={handleSelectTheme}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Sign out                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">Account</h2>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            aria-busy={isSigningOut || undefined}
            className="inline-flex items-center justify-center rounded-lg border border-error/40 bg-error-soft px-4 py-2 text-sm font-semibold text-error transition-colors duration-200 hover:border-error/60 hover:bg-error/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>
    </AppShell>
  );
}

// ----------------------------------------------------------------------------
// ThemeOption
// ----------------------------------------------------------------------------

type ThemeOptionProps = {
  label: string;
  value: ThemePreference;
  current: ThemePreference;
  onSelect: (value: ThemePreference) => void;
};

/**
 * A single segment of the theme selector. The selected segment takes the
 * accent fill (the design system's single restrained accent — §2) so the
 * active choice reads as the primary state; the unselected segment is a
 * calm outline that lifts to the accent on hover.
 */
function ThemeOption({ label, value, current, onSelect }: ThemeOptionProps) {
  const isSelected = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={isSelected}
      className={[
        "rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
        isSelected
          ? "bg-accent-600 text-white"
          : "text-ink-muted hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
