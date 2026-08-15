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
 * a subtle brass gradient and brand-voice copy, beside a form panel.
 * Mobile: the ambient panel is removed entirely; the wordmark sits at the top
 * and the form is centered with generous side margins.
 *
 * The ambient panel is purely decorative, so it is hidden from assistive
 * technology (auth-design §8).
 */
export default function AuthShell({ children, ambientCopy }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        {/* Ambient / brand-voice panel — desktop only, decorative */}
        <aside
          aria-hidden="true"
          className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-canvas p-12 lg:flex border-r border-ink/5"
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 30% 20%, rgba(var(--accent-rgb), 0.12), transparent 60%)",
            }}
          />
          <div className="relative">
            <BrandWordmark />
          </div>
          {ambientCopy && (
            <p className="relative max-w-sm text-2xl font-semibold leading-relaxed text-ink">
              {ambientCopy}
            </p>
          )}
        </aside>

        {/* Form panel */}
        <main className="flex flex-1 flex-col bg-canvas-soft px-6 py-10 sm:px-10 lg:items-center lg:justify-center">
          {/* Wordmark at top on mobile (ambient panel absent) */}
          <div className="lg:hidden">
            <BrandWordmark />
          </div>

          <div className="flex flex-1 items-center justify-center lg:flex-none">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
