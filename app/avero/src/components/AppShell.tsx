import { useState, useEffect } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import { SETTINGS_PATH } from "../constants/routes";
import { useTheme } from "../context/ThemeContext";
import { getAvatarDownloadUrl } from "../lib/avatar";

type AppShellProps = {
  children: React.ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const { user, avatarUrl, avatarVersion } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Prefer the profile name captured at sign-up (stored in user_metadata)
  // and fall back to the email — the canonical identity that is always
  // present for an authenticated user.
  const displayName =
    (user?.user_metadata?.name as string | undefined) || user?.email || "";

  // Avatar URL state - we need to resolve the B2 object key to a presigned URL
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(null);
  const [prevAvatarUrl, setPrevAvatarUrl] = useState(avatarUrl ?? null);

  // Reset the cached avatar URL when the source avatar changes
  if (avatarUrl !== prevAvatarUrl) {
    setPrevAvatarUrl(avatarUrl);
    setResolvedAvatarUrl(null);
  }

  // Loading is true while we have an avatar path but haven't resolved its
  // download URL yet
  const isAvatarLoading = !!avatarUrl && !resolvedAvatarUrl;

  // Fetch avatar download URL when the avatar changes
  useEffect(() => {
    if (!avatarUrl) {
      setResolvedAvatarUrl(null);
      return;
    }

    let cancelled = false;

    getAvatarDownloadUrl(avatarUrl).then((result) => {
      if (!cancelled) {
        setResolvedAvatarUrl(result.ok ? result.url : null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [avatarUrl, avatarVersion]);

  return (
    <div className="min-h-screen bg-canvas-warm dark:bg-canvas-dark text-on-surface dark:text-surface-container-lowest transition-colors duration-300 flex flex-col">
      {/* Top Nav Bar - matches Stitch source exactly */}
      <div className="w-full bg-surface-container-lowest dark:bg-card-dark border-b border-surface-variant dark:border-inverse-surface transition-colors duration-300">
        <div className="max-w-[1280px] mx-auto flex h-full grow flex-col">
          <header className="flex items-center justify-between whitespace-nowrap px-6 py-4 lg:px-12">
            {/* Left: Logo + AVERO wordmark */}
            <div className="flex items-center gap-4">
              <div className="size-8">
                <img
                  src="/avero-logo.png"
                  alt="Avero Logo"
                  className="w-full h-full object-contain"
                />
              </div>
              <h2 className="text-on-surface dark:text-surface-container-lowest text-lg font-bold leading-tight tracking-[0.1em] uppercase">
                AVERO
              </h2>
            </div>

            {/* Right: Theme toggle, Settings, Divider, Avatar + Name */}
            <div className="flex items-center gap-6">
              {/* Theme Toggle - circular button */}
              <button
                onClick={toggleTheme}
                className="flex cursor-pointer items-center justify-center rounded-full size-10 bg-surface-container hover:bg-surface-container-high dark:bg-inverse-surface dark:hover:bg-outline transition-colors text-on-surface-variant dark:text-surface-container-lowest"
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {/* Sun icon - show in light theme (dark:hidden) */}
                <svg className="w-5 h-5 dark:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
                {/* Moon icon - show in dark theme (hidden dark:block) */}
                <svg className="w-5 h-5 hidden dark:block" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </button>

              {/* Settings - circular button */}
              <Link
                to={SETTINGS_PATH}
                className="flex cursor-pointer items-center justify-center rounded-full size-10 bg-surface-container hover:bg-surface-container-high dark:bg-inverse-surface dark:hover:bg-outline transition-colors text-on-surface-variant dark:text-surface-container-lowest"
                aria-label="Settings"
              >
                <span className="material-symbols-outlined">settings</span>
              </Link>

{/* Vertical divider + Avatar + Name */}
               <div className="flex items-center gap-3 pl-4 border-l border-surface-variant dark:border-inverse-surface">
                 <span className="hidden md:block text-sm font-medium text-on-surface dark:text-surface-container-lowest">
                   {displayName}
                 </span>
                 {isAvatarLoading ? (
                   // Avatar loading state
                   <div
                     className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border border-outline-variant dark:border-outline"
                     style={{ width: 10, height: 10 }}
                     aria-hidden="true"
                   />
                 ) : (
                   resolvedAvatarUrl ? (
                     // Avatar image
                     <div
                       className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border border-outline-variant dark:border-outline"
                       style={{
                         backgroundImage: `url(${resolvedAvatarUrl})`,
                         backgroundSize: "cover",
                         backgroundPosition: "center",
                       }}
                     />
                   ) : (
                     // No avatar - fallback to initials or default avatar
                     <div
                       className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border border-outline-variant dark:border-outline"
                     />
                   )
                 )}
               </div>
            </div>
          </header>
        </div>
      </div>

      <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-10 lg:px-12 flex flex-col gap-8">
        {children}
      </main>
    </div>
  );
}