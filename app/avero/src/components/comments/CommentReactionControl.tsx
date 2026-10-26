import { useCallback, useEffect, useState } from "react";
import {
  addCommentReaction,
  fetchCommentReactions,
  removeCommentReaction,
  type CommentReactionSummary,
} from "../../lib/comment-reactions";
import {
  REACTION_LABELS,
  REACTION_TYPES,
  type ReactionType,
} from "../../types/reaction";
import ReactionIcon from "../reactions/ReactionIcon";

type CommentReactionControlProps = {
  /** The Comment whose reactions should be loaded. */
  commentId: string;
  /** The current user's id — used to (a) derive which types the user has
   *  already reacted with (the filled/highlighted state) and (b) scope the
   *  add/remove calls. The page is already member-gated by RLS, so if the user
   *  can see the Comment they can react. */
  currentUserId: string;
};

/**
 * A compact, inline reaction control for a single comment (feature-specs §4
 * comments enhancement).
 *
 * Mirrors {@link ReactionBar} (the Memory-level reaction bar) but is:
 *  - **Inline** — no section heading, no loading spinner block, no load-error
 *    box. A comment is a small surface; a heavy reaction UI would overwhelm
 *    it. On fetch failure the control simply renders the six pills at 0
 *    (calm — the user can still try to react, and the optimistic toggle
 *    works regardless of the initial fetch).
 *  - **Compact** — smaller pills, tighter spacing, so a row of six fits
 *    comfortably under a comment without dominating it.
 *
 * Same optimistic-toggle + revert pattern as `ReactionBar`: on click the
 * control updates local state immediately (count ± 1, toggle membership) and
 * fires the add/remove; on failure it reverts and shows a calm inline error
 * that clears on the next interaction.
 *
 * **Refresh-based, not realtime** — same as Memory reactions: the acting
 * user's own add/remove is reflected immediately; other users' reactions
 * appear after a reload.
 *
 * The six reaction types are REUSED from `types/reaction.ts` (same set as
 * Memory-level reactions) — comment reactions use the exact same emoji.
 */
export default function CommentReactionControl({
  commentId,
  currentUserId,
}: CommentReactionControlProps) {
  const [summary, setSummary] = useState<CommentReactionSummary | null>(null);
  // The reaction type currently in flight (prevents a double-fire while the
  // request is underway).
  const [pendingType, setPendingType] = useState<ReactionType | null>(null);
  // A transient toggle error (shown inline, clears on the next interaction).
  const [toggleError, setToggleError] = useState<string | undefined>(
    undefined,
  );

  // --- Fetch reactions ---

  useEffect(() => {
    if (!commentId) {
      // Guard only satisfies the type system; must not setState synchronously.
      return;
    }

    let cancelled = false;

    async function fetchReactions(id: string) {
      try {
        const result = await fetchCommentReactions(id, currentUserId);
        if (cancelled) return;
        setSummary(result);
      } catch {
        // Calm: leave summary null → the pills render at 0 and the user can
        // still react (optimistic toggle works regardless of the initial
        // fetch). No loud error box on a small comment surface.
        if (cancelled) return;
        setSummary({
          counts: {
            heart: 0,
            laugh: 0,
            fire: 0,
            tearful: 0,
            clap: 0,
            surprised: 0,
          },
          mine: new Set(),
        });
      }
    }

    void fetchReactions(commentId);

    return () => {
      cancelled = true;
    };
  }, [commentId, currentUserId]);

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
        ? await removeCommentReaction({
            commentId,
            userId: currentUserId,
            type,
          })
        : await addCommentReaction({
            commentId,
            userId: currentUserId,
            type,
          });

      setPendingType(null);

      if (!result.ok) {
        // Revert to the pre-toggle snapshot and surface a calm error.
        setSummary({ counts: prevCounts, mine: prevMine });
        setToggleError(result.error);
      }
    },
    [summary, pendingType, commentId, currentUserId],
  );

  // --- Render ---

  if (!summary) {
    // Brief pre-fetch state: render the six pills at 0 (non-interactive
    // visually, but present so the layout doesn't jump once loaded). Kept
    // minimal — no spinner on a small comment surface.
    return (
      <ul className="flex flex-wrap gap-1" aria-label="Comment reactions">
        {REACTION_TYPES.map((type) => (
          <li key={type}>
            <CommentReactionPill
              type={type}
              count={0}
              hasReacted={false}
              isPending={false}
              onToggle={() => void handleToggle(type)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-1" aria-label="Comment reactions">
        {REACTION_TYPES.map((type) => (
          <li key={type}>
            <CommentReactionPill
              type={type}
              count={summary.counts[type]}
              hasReacted={summary.mine.has(type)}
              isPending={pendingType === type}
              onToggle={() => void handleToggle(type)}
            />
          </li>
        ))}
      </ul>

      {/* Transient toggle error — shown inline, clears on next interaction.
          Low-stakes, so no retry button: just tap again. */}
      {toggleError && (
        <p className="mt-1.5 text-xs text-error" role="alert">
          {toggleError}
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// CommentReactionPill
// ----------------------------------------------------------------------------

type CommentReactionPillProps = {
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
 * A single compact reaction pill for a comment: the emoji, an optional count
 * (shown when > 0), and a filled/highlighted state when the current user has
 * reacted with this type.
 *
 * Smaller than the Memory-level {@link ReactionPill} (tighter padding, no
 * count text when 0) so a row of six fits comfortably under a comment. Same
 * accessible-name convention conveying the toggle direction.
 */
function CommentReactionPill({
  type,
  count,
  hasReacted,
  isPending,
  onToggle,
}: CommentReactionPillProps) {
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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-xs transition-colors duration-200 cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
        hasReacted
          ? "border-accent-500/60 bg-accent-soft text-ink"
          : "border-ink/10 bg-canvas-soft text-ink-muted hover:border-ink/20 hover:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-60",
      ].join(" ")}
    >
      <ReactionIcon type={type} size={14} className="shrink-0" />
      {count > 0 && (
        <span
          className="text-xs font-medium tabular-nums"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
      {count > 0 && (
        <span className="sr-only">
          {count} {count === 1 ? "reaction" : "reactions"}
        </span>
      )}
    </button>
  );
}
