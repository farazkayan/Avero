import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import { SETTINGS_PATH } from "../constants/routes";
import { useTheme } from "../context/ThemeContext";

type AppShellProps = {
  children: React.ReactNode;
};

/**
 * The shared frame for the authenticated area (spaces-design §5.1).
 *
 * Matches the Stitch source exactly: full-width top bar with bottom border,
 * max-w-[1280px] centered content, logo + "AVERO" wordmark left-aligned,
 * then on the right: circular theme-toggle button, circular settings button,
 * vertical divider, then avatar + name.
 */
export default function AppShell({ children }: AppShellProps) {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Prefer the profile name captured at sign-up (stored in user_metadata)
  // and fall back to the email — the canonical identity that is always
  // present for an authenticated user.
  const displayName =
    (user?.user_metadata?.name as string | undefined) || user?.email || "";

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
                <span className="material-symbols-outlined dark:hidden">light_mode</span>
                <span className="material-symbols-outlined hidden dark:block">dark_mode</span>
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
                <div
                  className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border border-outline-variant dark:border-outline"
                  style={{
                    backgroundImage: user?.user_metadata?.avatar_url
                      ? `url(${user.user_metadata.avatar_url})`
                      : undefined,
                  }}
                  aria-hidden="true"
                />
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
