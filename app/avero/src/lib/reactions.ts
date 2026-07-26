import { supabase } from "./supabase";
import {
  REACTION_TYPES,
  asReactionType,
  type ReactionType,
} from "../types/reaction";

/**
 * Reactions helpers (feature-specs §5, database §9).
 *
 * This module is the single home for the three reaction operations, mirroring
 * the structure of `lib/comments.ts` / `lib/media.ts`:
 *  - **Fetch**  — `fetchMemoryReactions` (select all rows for a Memory, then
 *                 derive per-type counts + the current user's reacted types).
 *  - **Add**    — `addReaction` (insert; RLS enforces `user_id = auth.uid()`
 *                 and Space membership).
 *  - **Remove** — `removeReaction` (hard delete; RLS gates author only).
 *
 * The `reactions` table, its CHECK constraint (`chk_reactions_type` — stable
 * text enum strings, NOT emoji), its UNIQUE constraint
 * (`uq_reactions_memory_user_type` — one reaction per type per user per
 * Memory), its index (`idx_reactions_memory_id`), its RLS policies
 * (`reactions_select` = Space member, `reactions_insert` = member + own,
 * `reactions_delete` = own, no UPDATE by design), and its grants all already
 * exist in the migrations (20260703170100 / 20260703170200 / 20260703170300 /
 * 20260703170900 / 20260703171000 / 20260705210000) — this is a frontend-only
 * feature.
 *
 * Like `lib/comments.ts`, the mutating helpers never throw: they return a calm
 * `{ ok, error }` result so callers can use a plain `if`/`else` without a
 * try/catch (auth-design §7 voice).
 *
 * **Refresh-based, not realtime.** feature-specs §5 says reactions "update in
 * real time (if possible in MVP, otherwise refresh-based)". The app has no
 * realtime/websocket pattern established anywhere yet, and database §14
 * explicitly lists "No real-time systems needed yet" as an MVP constraint. So
 * this module is plain request/response: the acting user's own add/remove is
 * reflected in local state immediately (same as Comments/Media), and other
 * users' reactions only appear after a page reload. (Supabase Realtime could be
 * layered on later without changing these helpers' signatures.)
 */

/** Calm, honest fallback message for a failed add (auth-design §7 voice). */
const GENERIC_ADD_ERROR = "We couldn't save your reaction. Please try again.";

/** Calm, honest fallback message for a failed remove (auth-design §7 voice). */
const GENERIC_REMOVE_ERROR =
  "We couldn't remove your reaction. Please try again.";

// ============================================================================
// Fetch (feature-specs §5 — per-type counts + the current user's reactions)
// ============================================================================

/**
 * The derived view of reactions for a single Memory, as needed by the
 * reaction bar: a count per type (0 when a type is unused) and the set of types
 * the current user has already reacted with.
 *
 * Built client-side from the raw `reactions` rows rather than via a
 * `count()` RPC so a single select gives both the counts and the current
 * user's own reactions in one round trip (mirrors how `CommentList` fetches
 * rows and derives display state locally).
 */
export type MemoryReactionSummary = {
  /** Count of reactions for each type, keyed by {@link ReactionType}. A type
   *  with no reactions is present with a count of 0 (the bar always shows all
   *  six types). */
  counts: Record<ReactionType, number>;
  /** The reaction types the current user has given on this Memory. Drives the
   *  filled/highlighted state and the toggle direction (add vs. remove). */
  mine: Set<ReactionType>;
};

/**
 * Creates a fresh counts record with every reaction type seeded at 0, so a
 * Memory with no reactions (or one where only some types are used) still has a
 * well-formed {@link MemoryReactionSummary} with all six slots present.
 *
 * Shared by {@link fetchMemoryReactions} and {@link fetchMemoryReactionsBatch}
 * so the "always show all six types" invariant lives in one place.
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
 * A single raw `reactions` row as selected by the fetch helpers — only the two
 * columns the client needs to derive counts and the current user's reactions.
 */
type ReactionRow = {
  type: string;
  user_id: string;
};

/**
 * Accumulates one raw reaction row into the running `counts` and `mine` set.
 *
 * Rows whose `type` isn't one of the six allowed values are dropped
 * (defensive against malformed/future types — see `asReactionType`), matching
 * how `MediaGallery` drops rows whose `type` isn't image/video. Mutates the
 * passed `counts` and `mine` in place for efficiency over many rows.
 *
 * Shared by {@link fetchMemoryReactions} and {@link fetchMemoryReactionsBatch}
 * so the per-row derivation logic is written exactly once.
 */
function accumulateReactionRow(
  row: ReactionRow,
  currentUserId: string,
  counts: Record<ReactionType, number>,
  mine: Set<ReactionType>,
): void {
  const type = asReactionType(row.type);
  if (type === null) {
    // Unknown type — drop it (defensive, mirrors asMediaType).
    return;
  }
  counts[type] += 1;
  if (row.user_id === currentUserId) {
    mine.add(type);
  }
}

/**
 * Fetches all reaction rows for a Memory and derives the {@link
 * MemoryReactionSummary} the bar needs: per-type counts and the current user's
 * reacted types.
 *
 * RLS on `reactions` (`reactions_select` = `is_space_member` via the parent
 * memory's space) ensures only members of the Memory's Space receive rows — a
 * non-member gets an empty result, which renders as an all-zero bar (the same
 * calm "not found or no access" pattern as comments). The subquery in the
 * policy is itself subject to memories RLS, so reactions on soft-deleted
 * memories are hidden too.
 *
 * Rows whose `type` isn't one of the six allowed values are dropped from the
 * counts (defensive against malformed/future types — see `asReactionType`),
 * matching how `MediaGallery` drops rows whose `type` isn't image/video.
 *
 * @throws the underlying Supabase error if the query fails. Callers are
 *   expected to handle this gracefully (the reaction bar treats a fetch
 *   failure as a calm load error and renders the rest of the page).
 */
export async function fetchMemoryReactions(
  memoryId: string,
  currentUserId: string,
): Promise<MemoryReactionSummary> {
  const { data, error } = await supabase
    .from("reactions")
    .select("type, user_id")
    .eq("memory_id", memoryId);

  if (error) {
    throw error;
  }

  const counts = createEmptyCounts();
  const mine = new Set<ReactionType>();

  for (const row of (data ?? []) as ReactionRow[]) {
    accumulateReactionRow(row, currentUserId, counts, mine);
  }

  return { counts, mine };
}

/**
 * Fetches reaction rows for many Memories in a **single** query and derives a
 * {@link MemoryReactionSummary} per Memory, keyed by `memoryId`.
 *
 * This is the batch counterpart to {@link fetchMemoryReactions}, used by the
 * Space timeline so a list of N Memories doesn't trigger N round trips (the
 * N+1 problem). One `select(...).in("memory_id", ids)` returns all rows; the
 * per-Memory counts + the current user's reacted types are derived client-side
 * via the shared {@link accumulateReactionRow} helper.
 *
 * Every requested `memoryId` is present in the result with a well-formed
 * summary (all six types seeded at 0), even Memories with zero reactions — so
 * the timeline can render every card's pill without a separate "no reactions"
 * branch. An empty `memoryIds` array returns `{}` without a round trip
 * (defensive; the timeline only renders controls when there are Memories).
 *
 * RLS (`reactions_select` = Space member) auto-filters the rows exactly as the
 * single fetch does, so a non-member receives nothing and every Memory maps to
 * an all-zero summary.
 *
 * @throws the underlying Supabase error if the query fails. Callers handle
 *   this gracefully (the timeline treats a batch failure as a calm load error
 *   and still renders the cards, just without reaction counts).
 */
export async function fetchMemoryReactionsBatch(
  memoryIds: string[],
  currentUserId: string,
): Promise<Record<string, MemoryReactionSummary>> {
  // Seed every requested Memory with an empty summary so the result is total:
  // a Memory with no reactions (or one not yet returned by RLS) still has a
  // well-formed entry the timeline can render without a special-case branch.
  const summaries: Record<string, MemoryReactionSummary> = {};
  for (const id of memoryIds) {
    summaries[id] = { counts: createEmptyCounts(), mine: new Set() };
  }

  if (memoryIds.length === 0) {
    // No Memories to fetch for — skip the round trip entirely.
    return summaries;
  }

  const { data, error } = await supabase
    .from("reactions")
    .select("memory_id, type, user_id")
    .in("memory_id", memoryIds);

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as (ReactionRow & { memory_id: string })[]) {
    const summary = summaries[row.memory_id];
    if (!summary) {
      // A row for a Memory we didn't request — shouldn't happen given the
      // `.in` filter, but guard anyway so a stray row can't crash the build.
      continue;
    }
    accumulateReactionRow(row, currentUserId, summary.counts, summary.mine);
  }

  return summaries;
}

// ============================================================================
// Add (feature-specs §5 — any Space member can react, once per type)
// ============================================================================

/** Parameters for {@link addReaction}. */
export type AddReactionParams = {
  /** The Memory to react on. */
  memoryId: string;
  /** The reacting user's id. Set explicitly on the insert row because the
   *  `reactions_insert` RLS policy enforces `user_id = auth.uid()` (there is
   *  no database default or trigger that sets it), mirroring how `addComment`
   *  sets `user_id`. */
  userId: string;
  /** The reaction type to add. One of the {@link ReactionType} stable
   *  strings (NOT an emoji) — the `chk_reactions_type` CHECK constraint
   *  rejects anything else. */
  type: ReactionType;
};

/**
 * Result of {@link addReaction}. On success `ok` is `true`; on failure `error`
 * carries a user-facing message. The function never throws — callers can use a
 * plain `if`/`else` without a try/catch.
 *
 * The inserted row is not returned to the caller because the bar already
 * knows everything it needs from the optimistic update (the type and the
 * current user). This keeps the helper minimal; a future caller that needs the
 * row id can extend the result.
 */
export type AddReactionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Inserts a single reaction. The `reactions_insert` RLS policy is the real
 * gate: it requires `is_space_member(...)` (via the parent memory's space) AND
 * `user_id = auth.uid()`. The `uq_reactions_memory_user_type` UNIQUE
 * constraint enforces "one reaction per type per user per Memory"
 * (feature-specs §5) — a duplicate insert surfaces as a calm error, which the
 * bar treats as "already reacted" and reverts to the reacted state.
 *
 * @returns `{ ok: true }` on success, or `{ ok: false, error }` on failure.
 */
export async function addReaction(
  params: AddReactionParams,
): Promise<AddReactionResult> {
  const { memoryId, userId, type } = params;

  try {
    const { error } = await supabase.from("reactions").insert({
      memory_id: memoryId,
      // Required by the reactions_insert RLS policy (user_id = auth.uid()).
      user_id: userId,
      // Stable text enum string, NOT an emoji (chk_reactions_type).
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
// Remove (feature-specs §5 — toggle off; author only)
// ============================================================================

/** Parameters for {@link removeReaction}. */
export type RemoveReactionParams = {
  /** The Memory the reaction is on. */
  memoryId: string;
  /** The reacting user's id. Used to scope the delete to the current user's
   *  row — the `reactions_delete` RLS policy is `user_id = auth.uid()`, so a
   *  delete scoped to `(memory_id, user_id, type)` can only ever remove the
   *  current user's own reaction. */
  userId: string;
  /** The reaction type to remove. */
  type: ReactionType;
};

/**
 * Result of {@link removeReaction}. On success `ok` is `true`; on failure
 * `error` carries a user-facing message and the local state is reverted.
 */
export type RemoveReactionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Removes the current user's reaction of a given type from a Memory
 * (feature-specs §5: "Users can change or remove reactions" — toggle off).
 *
 * The delete is scoped to the current user's row by `(memory_id, user_id,
 * type)`. The `reactions_delete` RLS policy (`user_id = auth.uid()`) means only
 * the reactor can ever remove their own reaction — there is no owner-removes-
 * others path for reactions (unlike comments), because reactions are personal
 * and low-stakes. The `uq_reactions_memory_user_type` UNIQUE constraint
 * guarantees at most one row matches, so the delete is unambiguous.
 *
 * Hard delete only — there is no soft delete for reactions (migration
 * 20260703170100 §10), and no UPDATE policy by design (reactions are toggled
 * via DELETE + INSERT, not UPDATE).
 *
 * The function never throws — callers can use a plain `if`/`else` without a
 * try/catch, matching the `deleteComment` pattern.
 *
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function removeReaction(
  params: RemoveReactionParams,
): Promise<RemoveReactionResult> {
  const { memoryId, userId, type } = params;

  try {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("memory_id", memoryId)
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

// Re-export the canonical type list and the row type for callers that only
// need the display constants / row shape without importing the type module
// directly (keeps imports tidy, mirrors `lib/comments.ts` re-exporting
// `Comment`).
export type { Reaction } from "../types/reaction";
export { REACTION_TYPES };
