import { useState } from "react";
import { Link } from "react-router";
import BrandWordmark from "./auth/BrandWordmark";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { AUTHENTICATED_HOME_PATH } from "../constants/routes";
import { AvatarUpload } from "./ui/AvatarUpload";

type AppShellProps = {
  children: React.ReactNode;
};

/**
 * The shared frame for the authenticated area (spaces-design §5.1).
 *
 * Unlike `AuthShell` — the two-panel ambient frame unique to the
 * unauthenticated threshold experience — `AppShell` is the authenticated
 * layout: a top bar carrying the wordmark, user identity, and sign-out
 * action, above a centered, width-constrained content area
 * (design-system §5: "Max width for content areas", "centered content for
 * readability"). Responsive: mobile single-column, desktop centered with a
 * comfortable max width.
 *
 * Sign-out uses Supabase directly. The existing `AuthProvider`
 * `onAuthStateChange` listener updates authentication state automatically,
 * and the route guards then redirect the now-unauthenticated user to
 * sign-in — no manual navigation is performed here (the same pattern used
 * by `SpacesPlaceholderPage`).
 *
 * `AppShell` renders only the frame; each page supplies its own heading and
 * content via `children`, so there is exactly one H1 per screen
 * (auth-design §8).
 */
export default function AppShell({ children }: AppShellProps) {
  const { user } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }
    setIsSigningOut(true);
    await supabase.auth.signOut();
    // No finally reset: the auth listener triggers a redirect away from the
    // authenticated area on success, so the loading state should persist
    // until that happens.
  }

  // Prefer the profile name captured at sign-up (stored in user_metadata)
  // and fall back to the email — the canonical identity that is always
  // present for an authenticated user.
  const displayName =
    (user?.user_metadata?.name as string | undefined) || user?.email || "";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-canvas">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link
            to={AUTHENTICATED_HOME_PATH}
            className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
            aria-label="Avero home"
          >
            <BrandWordmark />
          </Link>

          <div className="flex items-center gap-4">
            <AvatarUpload name={displayName} size={32} />
            {displayName && (
              <span className="hidden text-sm text-ink-muted sm:block">
                {displayName}
              </span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              aria-busy={isSigningOut || undefined}
              className="inline-flex items-center rounded-md text-sm font-medium text-ink-muted transition-colors duration-200 hover:text-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
