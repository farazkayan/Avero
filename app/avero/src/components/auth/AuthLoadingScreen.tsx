import BrandWordmark from "./BrandWordmark";
import Spinner from "../ui/Spinner";

/**
 * Calm, centered full-screen loader shown while the Supabase session is being
 * resolved (auth-design §7: "a calm, centered loader — wordmark + subtle
 * spinner — until the session is resolved").
 *
 * Used by both route guards so the loading experience is identical everywhere
 * and the user never sees protected or auth content flash before authentication
 * is confirmed. Reuses the existing design language (canvas background, brand
 * wordmark, and the shared Spinner) rather than introducing new visuals.
 */
export default function AuthLoadingScreen() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas text-ink"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <BrandWordmark />
      <Spinner size={24} className="text-ink-muted" />
    </div>
  );
}
