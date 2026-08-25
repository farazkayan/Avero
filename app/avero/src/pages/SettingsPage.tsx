import { useEffect, useState } from "react";
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
    <main className="max-w-[600px] mx-auto px-6 py-12 md:py-16">
      {/* Page Header */}
      <div className="mb-12">
        <GhostLink to={AUTHENTICATED_HOME_PATH} className="inline-flex items-center gap-2 text-on-surface-variant dark:text-secondary-fixed-dim hover:text-accent-warm dark:hover:text-primary-fixed-dim transition-colors mb-6 font-mono-label text-mono-label group">
          <span className="material-symbols-outlined text-[16px] group-hover:-translate-x-1 transition-transform">arrow_back</span>
          Back to Spaces
        </GhostLink>
        <h2 className="font-headline-lg text-headline-lg md:text-[32px] text-on-surface dark:text-surface-container-lowest">Settings</h2>
      </div>
      {/* Profile Section */}
      <section className="mb-16">
        <h3 className="font-headline-md text-headline-md mb-8 text-on-surface dark:text-surface-container-lowest pb-4 border-b border-outline-variant/30 dark:border-white/10">Profile</h3>
        <div className="flex flex-col sm:flex-row gap-8 items-start mb-8">
          {/* Avatar Upload */}
          <div className="flex-shrink-0 relative group cursor-pointer">
            <div className="w-24 h-24 rounded-full overflow-hidden border border-outline-variant dark:border-white/20 bg-surface-container-highest dark:bg-[#1a1c1e] shadow-stone dark:shadow-none transition-transform group-hover:scale-[1.02]">
              <AvatarUpload
                name={displayName || email}
                size={96}
              />
            </div>
            <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-surface dark:bg-[#1e2020] border border-outline-variant dark:border-white/20 shadow-sm flex items-center justify-center text-on-surface-variant dark:text-secondary-fixed-dim hover:text-accent-warm dark:hover:text-primary-fixed-dim transition-colors">
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </div>
          </div>
          <div className="flex flex-col justify-center h-24">
            <p className="font-medium text-on-surface dark:text-surface-container-lowest mb-1">Profile picture</p>
            <p className="text-body-sm font-body-sm text-on-surface-variant dark:text-secondary-fixed-dim/70 max-w-xs">Click the avatar to upload a new image. PNG, JPG, or WebP up to 2 MB.</p>
          </div>
        </div>
        {/* Form Fields */}
        <form
          className="mt-6 max-w-[420px] space-y-4"
          onSubmit={handleSaveName}
          noValidate
        >
          <div>
            <label className="block font-mono-label text-mono-label mb-2 text-on-surface-variant dark:text-secondary-fixed-dim/80 uppercase tracking-wider" for="display-name">Display name</label>
            <TextField
              id="display-name"
              label="Display name"
              value={displayName}
              disabled={isSavingName}
              error={nameError}
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (nameError) setNameError(undefined);
                if (nameSuccess) setNameSuccess(undefined);
              }}
              onBlur={() => setNameError(validateName(displayName))}
              maxLength={MAX_NAME_LENGTH}
            />
          </div>

          {/* Read-only email — lives on auth.users, not profiles. Editing it
              is an auth-level operation out of scope here, so it is shown as
              a non-editable reference rather than a disabled input (a
              disabled input implies it *could* be edited). */}
          <div>
            <span className="block text-sm font-medium text-on-surface-variant dark:text-secondary-fixed-dim/80 mb-2">
              Email
            </span>
            <div className="relative">
              <input
                className="w-full bg-surface-container-low dark:bg-[#161818] border border-outline-variant/30 dark:border-white/5 rounded-DEFAULT px-4 py-3 font-body-md text-on-surface-variant/70 dark:text-secondary-fixed-dim/50 cursor-not-allowed"
                id="email"
                type="email"
                value={email}
                readOnly
              />
              <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[20px]">lock</span>
            </div>
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
            className="bg-accent-warm dark:bg-[#f7d6ac] text-on-primary dark:text-black font-medium px-6 py-2.5 rounded-DEFAULT hover:opacity-90 active:scale-95 transition-all shadow-sm"
          >
            {isSavingName ? "Saving…" : "Save name"}
          </button>
        </form>
      </section>
      {/* Theme Section */}
      <section className="mb-16">
        <h3 className="font-headline-md text-headline-md mb-2 text-on-surface dark:text-surface-container-lowest pb-4 border-b border-outline-variant/30 dark:border-white/10">Theme</h3>
        <p className="text-body-sm font-body-sm text-on-surface-variant dark:text-secondary-fixed-dim/70 mb-6 mt-4">Choose how Avero looks. Your choice is remembered on this device.</p>
        <div className="bg-surface-container-highest dark:bg-[#1a1c1e] p-1 rounded-lg inline-flex shadow-inner">
          <button
            className="px-6 py-2 rounded-DEFAULT text-sm font-medium transition-colors w-24 flex items-center justify-center gap-2 text-on-surface-variant dark:text-secondary-fixed-dim hover:text-accent-warm dark:hover:text-primary-fixed-dim"
            onClick={() => handleSelectTheme('light')}
          >
            <span className="material-symbols-outlined text-[18px]">light_mode</span>
            Light
          </button>
          <button
            className="px-6 py-2 rounded-DEFAULT text-sm font-medium transition-colors w-24 flex items-center justify-center gap-2 bg-[#2a2c2c] text-white shadow-sm border border-white/10"
            onClick={() => handleSelectTheme('dark')}
          >
            <span className="material-symbols-outlined text-[18px]">dark_mode</span>
            Dark
          </button>
        </div>
      </section>
      {/* Account Section */}
      <section>
        <h3 className="font-headline-md text-headline-md mb-6 text-on-surface dark:text-surface-container-lowest pb-4 border-b border-outline-variant/30 dark:border-white/10">Account</h3>
        <button
          className="border border-error text-error dark:border-error/70 dark:text-error/90 font-medium px-6 py-2.5 rounded-DEFAULT hover:bg-error/5 dark:hover:bg-error/10 active:scale-95 transition-all flex items-center gap-2"
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          Sign out
        </button>
      </section>
    </main>
  );
}