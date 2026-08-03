import Spinner from "./Spinner";

/**
 * Calm, on-brand Suspense fallback for lazy-loaded routes.
 *
 * Design System §6 "Feedback for Every Action" + §7 "Motion & Animation":
 * - Uses the same visual language as AuthLoadingScreen (canvas bg, subtle spinner)
 * - No jarring spinner — the shared Spinner component is small, subtle, and
 *   respects the "calm, personal, intentional" philosophy
 * - Centered, minimal, consistent with the rest of the app's loading patterns
 * - Respects prefers-reduced-motion via the Spinner's functional animation
 */
export default function RouteLoadingFallback() {
  return (
    <div
      className="flex min-h-[200px] flex-col items-center justify-center gap-4 bg-canvas text-ink"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <Spinner size={24} className="text-ink-muted" />
      <p className="text-sm text-ink-muted">Loading…</p>
    </div>
  );
}