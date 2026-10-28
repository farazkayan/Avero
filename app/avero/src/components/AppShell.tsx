import { useState, useEffect } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import { SETTINGS_PATH } from "../constants/routes";
import { getAvatarDownloadUrl } from "../lib/avatar";
import ThemeSwitch from "./ui/theme-switch-button";
import { Settings } from "lucide-react";

type AppShellProps = {
  children: React.ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const { user, avatarUrl, avatarVersion } = useAuth();

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
          <header className="flex items-center justify-between whitespace-nowrap px-4 sm:px-6 py-3.5 sm:py-4 lg:px-12">
            {/* Left: Logo + AVERO wordmark */}
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="size-8">
                <img
                  src="/avero-logo.png"
                  alt="Avero Logo"
                  className="w-full h-full object-contain"
                />
              </div>
              {/* Hide the wordmark below 360px so the header doesn't overflow
                  the viewport on narrow phones. The wordmark reappears
                  alongside the avatar on wider viewports (audit CR-1). */}
              <h2 className="hidden min-[360px]:block text-on-surface dark:text-surface-container-lowest text-lg font-serif font-semibold leading-tight tracking-[0.14em] uppercase">
                AVERO
              </h2>
            </div>

            {/* Right: Theme toggle, Settings, Divider, Avatar + Name */}
            <div className="flex items-center gap-2.5 sm:gap-4 md:gap-6">
              {/* Theme Toggle - animated Sun/Moon switch */}
              <ThemeSwitch />

              {/* Settings - circular button */}
              <Link
                to={SETTINGS_PATH}
                className="group flex cursor-pointer items-center justify-center rounded-full size-10 bg-surface-container hover:bg-surface-container-high dark:bg-inverse-surface dark:hover:bg-outline transition-colors text-on-surface-variant dark:text-surface-container-lowest"
                aria-label="Settings"
              >
                <Settings className="size-5 transition-transform duration-300 group-hover:rotate-45" />
              </Link>

              {/* Vertical divider + Avatar + Name */}
              <div className="flex items-center gap-3 pl-2.5 sm:pl-4 border-l border-surface-variant dark:border-inverse-surface">
                <span className="hidden md:block text-sm font-medium text-on-surface dark:text-surface-container-lowest">
                  {displayName}
                </span>
                {isAvatarLoading ? (
                  // Avatar loading state — same 40×40 footprint as the
                  // loaded avatar so the header layout is stable.
                  // (audit M-2: a previous inline width/height of 10
                  // produced a tiny dot skeleton.)
                  <div
                    className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border border-outline-variant dark:border-outline animate-pulse"
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

      <main className="flex-1 max-w-[1280px] mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 lg:px-12 lg:py-10 flex flex-col gap-6 sm:gap-8">
        {children}
      </main>
    </div>
  );
}