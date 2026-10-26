import { useCallback, useEffect, useState } from "react";
import Spinner from "../ui/Spinner";
import {
  addReaction,
  fetchMemoryReactions,
  removeReaction,
  type MemoryReactionSummary,
} from "../../lib/reactions";
import {
  REACTION_LABELS,
  REACTION_TYPES,
  type ReactionType,
} from "../../types/reaction";
import ReactionIcon from "./ReactionIcon";

type ReactionBarProps = {
  /** The Memory whose reactions should be loaded. */
  memoryId: string;
  /** The current user's id — used to (a) derive which types the user has
   *  already reacted with (the filled/highlighted state) and (b) scope the
   *  add/remove calls. The page is already member-gated by RLS, so if the user
   *  can see the Memory they can react. */
  currentUserId: string;
};

/**
 * The reaction bar for the Memory detail view (feature-specs §5).
 *
 * Renders a row of the six reaction emoji (❤️ 😂 🔥 🥹 👏 😮) below the
 * comments section. Each emoji is a pill button that shows a count (when > 0)
 * and reflects whether the current user has already reacted with that type
 * (a filled/highlighted state). Clicking toggles: add if not reacted, remove
 * if already reacted (feature-specs §5: "Users can change or remove
 * reactions"). No confirm dialog — reactions are low-stakes and instantly
 * reversible, so a single click is the whole interaction (unlike delete, which
 * uses a two-step confirm).
 *
 * **Refresh-based, not realtime.** feature-specs §5 says reactions "update in
 * real time (if possible in MVP, otherwise refresh-based)". The app has no
 * realtime/websocket pattern established yet, and database §14 lists "No
 * real-time systems needed yet" as an MVP constraint. So this bar is plain
 * request/response: the acting user's own add/remove is reflected in local
 * state immediately (same no-reload pattern as Comments/Media), and other
 * users' reactions only appear after a page reload. (Supabase Realtime could
 * be layered on later without changing this component's props.)
 *
 * **Optimistic toggle + revert.** On click the bar updates local state
 * immediately (count ± 1, toggle membership) and fires the add/remove. On
 * failure it reverts to the prior state and shows a calm inline error that
 * clears on the next interaction — the same lightweight, honest pattern used
 * by the comment/media delete flows, minus the confirm step.
 *
 * **Member-gating.** The Memory detail page is already member-gated by RLS
 * (if you can see the Memory you're a Space member), and the `reactions_*`
 * RLS policies re-check membership at the database, so this component does
 * no extra permission work — it simply renders for any authenticated user
 * who reached the page.
 *
 * States mirror `CommentList`: a loading spinner while fetching, a calm
 * load-error box, and the bar itself once loaded. There is no empty state —
 * the bar always shows all six types (with 0 counts), because reacting is a
 * one-tap action, not a list to be empty.
 */
export default function ReactionBar({
  memoryId,
  currentUserId,
}: ReactionBarProps) {
  const [summary, setSummary] = useState<MemoryReactionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // The reaction type currently in flight (shows a subtle "working" state on
  // that pill and prevents a double-fire while the request is underway).
  const [pendingType, setPendingType] = useState<ReactionType | null>(null);
  // A transient toggle error (shown inline, clears on the next interaction).
  const [toggleError, setToggleError] = useState<string | undefined>(
    undefined,
  );

  // --- Fetch reactions ---

  useEffect(() => {
    if (!memoryId) {
      // React Router guarantees :memoryId on this route; this guard only
      // satisfies the type system and must not setState synchronously.
      return;
    }

    let cancelled = false;

    async function fetchReactions(id: string) {
      setIsLoading(true);
      setLoadError(undefined);

      try {
        const result = await fetchMemoryReactions(id, currentUserId);

        if (cancelled) return;

        setSummary(result);
      } catch {
        if (cancelled) return;
        setLoadError("We couldn't load the reactions for this Memory.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchReactions(memoryId);

    return () => {
      cancelled = true;
    };
  }, [memoryId, currentUserId]);

  // --- Toggle handler (optimistic + revert) ---

  const handleToggle = useCallback(
    async (type: ReactionType) => {
      if (!summary || pendingType === type) {
        // No summary yet, or this pill is already mid-flight — ignore.
        return;
      }

      // Snapshot for revert. `mine` is a Set, so clone it before mutating.
      const prevCounts = { ...summary.counts };
      const prevMine = new Set(summary.mine);
      const hasReacted = summary.mine.has(type);

      // Optimistic update: toggle membership and adjust the count by ±1.
      setSummary((prev) => {
        if (!prev) return prev;
        const nextCounts = { ...prev.counts };
        const nextMine = new Set(prev.mine);
        if (hasReacted) {
          nextMine.delete(type);
          nextCounts[type] = Math.max(0, nextCounts[type] - 1);
        } else {
          nextMine.add(type);
          nextCounts[type] += 1;
        }
        return { counts: nextCounts, mine: nextMine };
      });
      setPendingType(type);
      setToggleError(undefined);

      const result = hasReacted
        ? await removeReaction({ memoryId, userId: currentUserId, type })
        : await addReaction({ memoryId, userId: currentUserId, type });

      setPendingType(null);

      if (!result.ok) {
        // Revert to the pre-toggle snapshot and surface a calm error.
        setSummary({ counts: prevCounts, mine: prevMine });
        setToggleError(result.error);
      }
    },
    [summary, pendingType, memoryId, currentUserId],
  );

  // --- Render ---

  return (
    <section className="mt-10" aria-label="Reactions">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Reactions
      </h2>

      <div className="mt-4">
        {isLoading ? (
          <div
            className="flex items-center justify-center py-4 text-accent-400"
            role="status"
            aria-live="polite"
          >
            <Spinner size={20} />
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-ink/5 bg-canvas-soft p-4 text-center">
            <p className="text-sm text-error">{loadError}</p>
          </div>
        ) : summary ? (
          <>
            <ul className="flex flex-wrap gap-2">
              {REACTION_TYPES.map((type) => (
                <li key={type}>
                  <ReactionPill
                    type={type}
                    count={summary.counts[type]}
                    hasReacted={summary.mine.has(type)}
                    isPending={pendingType === type}
                    onToggle={() => void handleToggle(type)}
                  />
                </li>
              ))}
            </ul>

            {/* Transient toggle error — shown inline, clears on next
                interaction. Low-stakes, so no retry button: just tap again. */}
            {toggleError && (
              <p
                className="mt-3 text-sm text-error"
                role="alert"
              >
                {toggleError}
              </p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// ReactionPill
// ----------------------------------------------------------------------------

type ReactionPillProps = {
  type: ReactionType;
  count: number;
  /** Whether the current user has already reacted with this type — drives the
   *  filled/highlighted state and the toggle direction. */
  hasReacted: boolean;
  /** Whether this pill's add/remove is in flight (subtle "working" state). */
  isPending: boolean;
  onToggle: () => void;
};

/**
 * A single reaction pill: the emoji, an optional count (shown when > 0), and a
 * filled/highlighted state when the current user has reacted with this type.
 *
 * The pill is a button so it is keyboard-focusable and announced as a control;
 * its accessible name reflects the reaction and the current state (e.g.
 * "React with Heart" / "Remove Heart reaction"), so a screen reader conveys
 * the toggle direction. No confirm dialog — reactions are low-stakes and
 * instantly reversible, so a single click is the whole interaction.
 *
 * Visually distinct from Comments: a horizontal row of compact pills rather
 * than a vertical list of cards, so the two sections read as different kinds
 * of input (quick emotional validation vs. written context).
 */
function ReactionPill({
  type,
  count,
  hasReacted,
  isPending,
  onToggle,
}: ReactionPillProps) {
  const label = REACTION_LABELS[type];

  // Accessible name conveys the toggle direction so a screen reader user
  // knows whether the next click adds or removes their reaction.
  const ariaLabel = hasReacted
    ? `Remove ${label} reaction`
    : `React with ${label}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPending}
      aria-pressed={hasReacted}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
        "text-sm transition-colors duration-200 cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
        hasReacted
          ? "border-accent-500/60 bg-accent-soft text-ink"
          : "border-ink/10 bg-canvas-soft text-ink-muted hover:border-ink/20 hover:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-60",
      ].join(" ")}
    >
      <ReactionIcon type={type} size={16} className="shrink-0" />
      {count > 0 && (
        <span
          className="text-xs font-medium tabular-nums"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
      {/* The count is also conveyed via the accessible name context; a
          visually-hidden count keeps it available to AT when > 0 without
          duplicating it for sighted users who already see the number. */}
      {count > 0 && (
        <span className="sr-only">
          {count} {count === 1 ? "reaction" : "reactions"}
        </span>
      )}
    </button>
  );
}
