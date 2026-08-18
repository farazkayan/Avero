import { useTheme } from "../../context/ThemeContext";
import BrandWordmark from "./BrandWordmark";

type AuthShellProps = {
  children: React.ReactNode;
  /** Brand-voice copy shown on the ambient panel (desktop only). */
  ambientCopy?: string;
};

/**
 * The shared frame for every auth screen (auth-design §1, §5).
 *
 * Desktop: a two-panel split — a warm ambient panel carrying
 * a stacked polaroid photo visual and brand-voice copy, beside a form panel.
 * Mobile: the ambient panel stacks above the form; the wordmark sits at the top
 * and the form is centered with generous side margins.
 *
 * The ambient panel is purely decorative, so it is hidden from assistive
 * technology (auth-design §8).
 *
 * Theme handling: the app uses `html.light` (dark is the default, no class).
 * Tailwind `dark:` variants are NOT used here — instead we drive theme via the
 * app's CSS-variable token system (`bg-canvas`, `text-ink`, etc.) which already
 * resolves to the correct palette under `:root` / `:root.light`. A few
 * Stitch-source hex values that don't map to a token are handled with
 * `.light`-scoped overrides in index.css (see `.auth-*` helpers below).
 */
export default function AuthShell({ children, ambientCopy }: AuthShellProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="auth-shell min-h-screen flex flex-col md:flex-row overflow-x-hidden relative">
      {/* Theme Toggle (Global) — matches Stitch source placement */}
      <button
        type="button"
        className="auth-theme-toggle absolute top-4 md:top-12 right-4 md:right-12 z-50 p-2 rounded-full transition-colors group"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? (
          <span className="material-symbols-outlined auth-icon-dark">light_mode</span>
        ) : (
          <span className="material-symbols-outlined auth-icon-light">dark_mode</span>
        )}
      </button>

      {/* Left Panel (Emotional Space) */}
      <aside
        aria-hidden="true"
        className="auth-left-panel relative w-full md:w-[55%] min-h-[409px] md:min-h-screen flex flex-col p-4 md:p-12 border-b md:border-b-0 md:border-r"
      >
        {/* Noise overlay */}
        <div className="noise" />

        {/* Wordmark */}
        <div className="auth-wordmark relative z-20 mb-auto">
          AVERO
        </div>

        {/* Photo Stack */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden md:overflow-visible pt-16 md:pt-0">
          <div className="relative w-[240px] h-[290px] md:w-[300px] md:h-[360px]">
            {/* Bottom Polaroid */}
            <div className="auth-polaroid-bottom absolute top-4 -right-8 w-full h-full p-3 pb-12 md:p-4 md:pb-16 rounded-sm shadow-xl shadow-black/25 rotate-[6deg] blur-[2px] opacity-70">
              <div className="w-full h-full bg-gradient-to-br from-[#d2b89f] to-[#8d6f46]"></div>
            </div>
            {/* Middle Polaroid */}
            <div className="auth-polaroid-middle absolute -top-2 -left-6 w-full h-full p-3 pb-12 md:p-4 md:pb-16 rounded-sm shadow-xl shadow-black/25 -rotate-[4deg] blur-[1px] opacity-85">
              <div className="w-full h-full bg-gradient-to-tr from-[#8d6f46] to-[#e5c190]"></div>
            </div>
            {/* Top Polaroid */}
            <div className="auth-polaroid-top absolute top-0 left-0 w-full h-full p-3 pb-12 md:p-4 md:pb-16 rounded-sm shadow-xl shadow-black/25 rotate-[2deg] transition-transform duration-700 hover:rotate-[1deg] hover:scale-[1.01]">
              <img
                alt="Candid polaroid"
                className="w-full h-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCNTSfBNu6_zfZbOGRefVMCMjOE-Z9Xx4kxCnxrDbWAEqEyEVrBTOd1FdL7ZFWJjnDkQmcC0ncX72qlGvm0wEVJVoNXAuiushjW5rl39g-_I0Qv2kXo3E2uynmZR1obEk3deLWwFYIip7EOi07OTBnUKTWoq1S9VDKwCli1iF0MYqGa1hnK98mjxJLGE1xZ6JmcXUdCZdEjs-wEfDg-2uxSVrd4dslmvxpSh0hguVtXE1OwsW9TjrcY"
              />
            </div>
          </div>
        </div>

        {/* Emotional Text */}
        <div className="relative z-20 mt-auto md:mb-[15%] pt-12 md:pt-0">
          <h1 className="auth-headline mb-4">
            {ambientCopy || "A private home for the moments that matter."}
          </h1>
          <p className="auth-subhead max-w-md">
            Preserve shared stories with the people who matter most.
          </p>
        </div>
      </aside>

      {/* Right Panel (Auth Form) */}
      <main className="auth-right-panel w-full md:w-[45%] min-h-screen flex items-center justify-center p-4 md:p-12 relative z-20">
        <div className="w-full max-w-[400px]">
          {/* Wordmark at top on mobile (ambient panel absent) */}
          <div className="lg:hidden mb-8">
            <BrandWordmark />
          </div>

          <div className="flex flex-1 items-center justify-center lg:flex-none">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
