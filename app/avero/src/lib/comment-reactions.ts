import { supabase } from "./supabase";
import {
  REACTION_TYPES,
  asReactionType,
  type ReactionType,
} from "../types/reaction";

/**
 * Comment-reactions helpers (feature-specs §4 comments enhancement).
 *
 * This module is the single home for the three comment-reaction operations,
 * mirroring the structure of `lib/reactions.ts` (the Memory-level reactions)
 * but scoped to a `comment_id` instead of a `memory_id`:
 *  - **Fetch**  — `fetchCommentReactions` (select all rows for a Comment, then
 *                 derive per-type counts + the current user's reacted types).
 *  - **Add**    — `addCommentReaction` (insert; RLS enforces
 *                 `user_id = auth.uid()` and Space membership).
 *  - **Remove** — `removeCommentReaction` (hard delete; RLS gates author only).
 *
 * The `comment_reactions` table, its CHECK constraint
 * (`chk_comment_reactions_type` — the same six stable text enum strings as
 * Memory reactions, NOT emoji), its UNIQUE constraint
 * (`uq_comment_reactions_comment_user_type` — one reaction per type per user
 * per Comment), its index (`idx_comment_reactions_comment_id`), its RLS
 * policies (`comment_reactions_select` = Space member via the comment's
 * memory's space, `comment_reactions_insert` = member + own,
 * `comment_reactions_delete` = own, no UPDATE by design), and its grants all
 * exist in the migration `20260727120000_comment_reactions.sql` — this is a
 * frontend-only feature on top of that table.
 *
 * Like `lib/reactions.ts`, the mutating helpers never throw: they return a
 * calm `{ ok, error }` result so callers can use a plain `if`/`else`
 * without a try/catch (auth-design §7 voice).
 *
 * **Refresh-based, not realtime.** Same as Memory-level reactions: the acting
 * user's own add/remove is reflected in local state immediately, and other
 * users' reactions only appear after a reload. (Supabase Realtime could be
 * layered on later without changing these helpers' signatures.)
 *
 * The six reaction types are REUSED from `types/reaction.ts` — comment
 * reactions use the exact same set as Memory reactions (heart, laugh, fire,
 * tearful, clap, surprised), so no new type module is needed.
 */

/** Calm, honest fallback message for a failed add (auth-design §7 voice). */
const GENERIC_ADD_ERROR = "We couldn't save your reaction. Please try again.";

/** Calm, honest fallback message for a failed remove (auth-design §7 voice). */
const GENERIC_REMOVE_ERROR =
  "We couldn't remove your reaction. Please try again.";

// ============================================================================
// Fetch (per-type counts + the current user's reactions)
// ============================================================================

/**
 * The derived view of reactions for a single Comment, as needed by a
 * per-comment reaction control: a count per type (0 when a type is unused)
 * and the set of types the current user has already reacted with.
 *
 * Structurally identical to `MemoryReactionSummary` but kept as its own type
 * so a comment-reaction control and a Memory-reaction bar can't be silently
 * mixed up (the underlying table differs: `comment_id` vs `memory_id`).
 */
export type CommentReactionSummary = {
  /** Count of reactions for each type, keyed by {@link ReactionType}. A type
   *  with no reactions is present with a count of 0 (the control always shows
   *  all six types). */
  counts: Record<ReactionType, number>;
  /** The reaction types the current user has given on this Comment. Drives the
   *  filled/highlighted state and the toggle direction (add vs. remove). */
  mine: Set<ReactionType>;
};

/**
 * Creates a fresh counts record with every reaction type seeded at 0, so a
 * Comment with no reactions (or one where only some types are used) still has
 * a well-formed {@link CommentReactionSummary} with all six slots present.
 */
function createEmptyCounts(): Record<ReactionType, number> {
  return {
    heart: 0,
    laugh: 0,
    fire: 0,
    tearful: 0,
    clap: 0,
    surprised: 0,
  };
}

/**
 * A single raw `comment_reactions` row as selected by the fetch helper — only
 * the two columns the client needs to derive counts and the current user's
 * reactions.
 */
type CommentReactionRow = {
  type: string;
  user_id: string;
};

/**
 * Accumulates one raw comment-reaction row into the running `counts` and
 * `mine` set.
 *
 * Rows whose `type` isn't one of the six allowed values are dropped
 * (defensive against malformed/future types — see `asReactionType`),
 * matching how `lib/reactions.ts` drops malformed Memory-reaction rows.
 * Mutates the passed `counts` and `mine` in place for efficiency.
 */
function accumulateCommentReactionRow(
  row: CommentReactionRow,
  currentUserId: string,
  counts: Record<ReactionType, number>,
  mine: Set<ReactionType>,
): void {
  const type = asReactionType(row.type);
  if (type === null) {
    // Unknown type — drop it (defensive, mirrors asReactionType).
    return;
  }
  counts[type] += 1;
  if (row.user_id === currentUserId) {
    mine.add(type);
  }
}

/**
 * Fetches all reaction rows for a Comment and derives the
 * {@link CommentReactionSummary} the per-comment control needs: per-type
 * counts and the current user's reacted types.
 *
 * RLS on `comment_reactions` (`comment_reactions_select` = `is_space_member`
 * via the comment's memory's space) ensures only members of the Comment's
 * Space receive rows — a non-member gets an empty result, which renders as an
 * all-zero control (the same calm "not found or no access" pattern as
 * comments and Memory reactions).
 *
 * Rows whose `type` isn't one of the six allowed values are dropped from the
 * counts (defensive against malformed/future types — see `asReactionType`).
 *
 * @throws the underlying Supabase error if the query fails. Callers are
 *   expected to handle this gracefully (the comment reaction control treats a
 *   fetch failure as a calm load error and renders the rest of the comment).
 */
export async function fetchCommentReactions(
  commentId: string,
  currentUserId: string,
): Promise<CommentReactionSummary> {
  const { data, error } = await supabase
    .from("comment_reactions")
    .select("type, user_id")
    .eq("comment_id", commentId);

  if (error) {
    throw error;
  }

  const counts = createEmptyCounts();
  const mine = new Set<ReactionType>();

  for (const row of (data ?? []) as CommentReactionRow[]) {
    accumulateCommentReactionRow(row, currentUserId, counts, mine);
  }

  return { counts, mine };
}

// ============================================================================
// Add (any Space member can react, once per type)
// ============================================================================

/** Parameters for {@link addCommentReaction}. */
export type AddCommentReactionParams = {
  /** The Comment to react on. */
  commentId: string;
  /** The reacting user's id. Set explicitly on the insert row because the
   *  `comment_reactions_insert` RLS policy enforces `user_id = auth.uid()`
   *  (there is no database default or trigger that sets it), mirroring how
   *  `addReaction` sets `user_id`. */
  userId: string;
  /** The reaction type to add. One of the {@link ReactionType} stable
   *  strings (NOT an emoji) — the `chk_comment_reactions_type` CHECK
   *  constraint rejects anything else. */
  type: ReactionType;
};

/**
 * Result of {@link addCommentReaction}. On success `ok` is `true`; on failure
 * `error` carries a user-facing message. The function never throws — callers
 * can use a plain `if`/`else` without a try/catch.
 */
export type AddCommentReactionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Inserts a single comment reaction. The `comment_reactions_insert` RLS
 * policy is the real gate: it requires `is_space_member(...)` (via the
 * comment's memory's space) AND `user_id = auth.uid()`. The
 * `uq_comment_reactions_comment_user_type` UNIQUE constraint enforces "one
 * reaction per type per user per Comment" — a duplicate insert surfaces as a
 * calm error, which the control treats as "already reacted" and reverts to
 * the reacted state.
 *
 * @returns `{ ok: true }` on success, or `{ ok: false, error }` on failure.
 */
export async function addCommentReaction(
  params: AddCommentReactionParams,
): Promise<AddCommentReactionResult> {
  const { commentId, userId, type } = params;

  try {
    const { error } = await supabase.from("comment_reactions").insert({
      comment_id: commentId,
      // Required by the comment_reactions_insert RLS policy
      // (user_id = auth.uid()).
      user_id: userId,
      // Stable text enum string, NOT an emoji (chk_comment_reactions_type).
      type,
    });

    if (error) {
      return { ok: false, error: GENERIC_ADD_ERROR };
    }

    return { ok: true };
  } catch {
    // Network failures and unexpected thrown errors resolve to the same calm,
    // honest message (auth-design §7). The caller never sees a raw exception.
    return { ok: false, error: GENERIC_ADD_ERROR };
  }
}

// ============================================================================
// Remove (toggle off; author only)
// ============================================================================

/** Parameters for {@link removeCommentReaction}. */
export type RemoveCommentReactionParams = {
  /** The Comment the reaction is on. */
  commentId: string;
  /** The reacting user's id. Used to scope the delete to the current user's
   *  row — the `comment_reactions_delete` RLS policy is
   *  `user_id = auth.uid()`, so a delete scoped to
   *  `(comment_id, user_id, type)` can only ever remove the current user's
   *  own reaction. */
  userId: string;
  /** The reaction type to remove. */
  type: ReactionType;
};

/**
 * Result of {@link removeCommentReaction}. On success `ok` is `true`; on
 * failure `error` carries a user-facing message and the local state is
 * reverted.
 */
export type RemoveCommentReactionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Removes the current user's reaction of a given type from a Comment
 * (toggle off).
 *
 * The delete is scoped to the current user's row by `(comment_id, user_id,
 * type)`. The `comment_reactions_delete` RLS policy (`user_id = auth.uid()`)
 * means only the reactor can ever remove their own reaction. The
 * `uq_comment_reactions_comment_user_type` UNIQUE constraint guarantees at
 * most one row matches, so the delete is unambiguous.
 *
 * Hard delete only — there is no soft delete for comment reactions, and no
 * UPDATE policy by design (reactions are toggled via DELETE + INSERT, not
 * UPDATE), exactly mirroring Memory-level reactions.
 *
 * The function never throws — callers can use a plain `if`/`else` without a
 * try/catch, matching the `removeReaction` pattern.
 *
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function removeCommentReaction(
  params: RemoveCommentReactionParams,
): Promise<RemoveCommentReactionResult> {
  const { commentId, userId, type } = params;

  try {
    const { error } = await supabase
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId)
      .eq("type", type);

    if (error) {
      return { ok: false, error: GENERIC_REMOVE_ERROR };
    }

    return { ok: true };
  } catch {
    // Network failures and unexpected thrown errors resolve to the same calm,
    // honest message (auth-design §7). The caller never sees a raw exception.
    return { ok: false, error: GENERIC_REMOVE_ERROR };
  }
}

// Re-export the canonical type list for callers that only need the display
// constants without importing the type module directly (keeps imports tidy,
// mirrors `lib/reactions.ts` re-exporting `REACTION_TYPES`).
export { REACTION_TYPES };
