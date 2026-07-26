import { supabase } from "./supabase";
import type { Comment, CommentWithAuthor } from "../types/comment";

/**
 * Comments helpers (feature-specs §4, database §8).
 *
 * This module is the single home for the three comment operations, mirroring
 * the structure of `lib/media.ts`:
 *  - **Fetch**  — `fetchMemoryComments` (select + join profiles, chronological).
 *  - **Add**    — `addComment` (insert; RLS enforces `user_id = auth.uid()`).
 *  - **Delete** — `deleteComment` (hard delete; RLS gates author OR owner).
 *
 * The `comments` table, its RLS policies, its index, and its grants all
 * already exist in the migrations (20260703170100 / 20260703171000 /
 * 20260703170300 / 20260705210000) — this is a frontend-only feature.
 *
 * Like `lib/media.ts`, the mutating helpers never throw: they return a calm
 * `{ ok, error }` result so callers can use a plain `if`/`else` without a
 * try/catch (auth-design §7 voice).
 */

/**
 * Maximum length for a single comment.
 *
 * The `comments.content` column is `text` with no CHECK constraint (database
 * §8), but 1000 characters is ample for a comment and keeps the list calm
 * (Design System §1: "never feel noisy, overwhelming, or addictive"). The
 * guard is client-side only; a future migration could add a server-side
 * CHECK if abuse becomes a concern.
 */
export const MAX_COMMENT_LENGTH = 1000;

/** Calm, honest fallback message for a failed add (auth-design §7 voice). */
const GENERIC_ADD_ERROR = "We couldn't post your comment. Please try again.";

/** Calm, honest fallback message for a failed delete (auth-design §7 voice). */
const GENERIC_DELETE_ERROR = "We couldn't delete this comment. Please try again.";

// ============================================================================
// Fetch (feature-specs §4 — chronological order)
// ============================================================================

/**
 * Fetches the comments for a Memory, for display on the Memory Detail page.
 *
 * Queries the `comments` table joined through to `profiles` so each comment
 * carries its author's display name (feature-specs §4: "No anonymous
 * comments — always attributed to the commenting user"). RLS on both tables
 * ensures only members of the Memory's Space receive rows — a non-member
 * gets an empty result, which renders as no comments (consistent with the
 * calm "not found or no access" pattern on MemoryDetailPage). The
 * `comments_select` policy's subquery against `memories` is itself subject
 * to memories RLS, so comments on soft-deleted memories are hidden too.
 *
 * Comments are ordered by `created_at` ascending (feature-specs §4: "Comments
 * appear in chronological order"), served by the
 * `idx_comments_memory_created` index.
 *
 * @throws the underlying Supabase error if the query fails. Callers are
 *   expected to handle this gracefully (the comment list treats a fetch
 *   failure as a calm load error and renders the rest of the page).
 */
export async function fetchMemoryComments(
  memoryId: string,
): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("comments")
    // Join through to the author's profile row for the display name.
    .select("*, profiles(name)")
    .eq("memory_id", memoryId)
    // Oldest first — chronological order (feature-specs §4).
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as CommentWithAuthor[];
}

// ============================================================================
// Add (feature-specs §4 — any Space member can comment)
// ============================================================================

/** Parameters for {@link addComment}. */
export type AddCommentParams = {
  /** The Memory to comment on. */
  memoryId: string;
  /** The commenting user's id. Set explicitly on the insert row because the
   *  `comments_insert` RLS policy enforces `user_id = auth.uid()` (there is
   *  no database default or trigger that sets it), mirroring how
   *  `CreateMemoryPage` sets `created_by`. */
  userId: string;
  /** The comment text. The caller must trim and enforce
   *  {@link MAX_COMMENT_LENGTH} before calling. */
  content: string;
};

/**
 * Result of {@link addComment}. `ok` carries the inserted comment (with its
 * author name resolved) so the list can append it without a refetch; `error`
 * carries a user-facing message when the insert failed. The function never
 * throws — callers can use a plain `if`/`else` without a try/catch.
 */
export type AddCommentResult =
  | { ok: true; comment: CommentWithAuthor }
  | { ok: false; error: string };

/**
 * Inserts a single comment and returns the new row (with author name) so the
 * list can append it immediately — no full reload (feature-specs §4 UI:
 * "New comments appear immediately without a full page reload").
 *
 * The `comments_insert` RLS policy is the real gate: it requires
 * `is_space_member(...)` AND `user_id = auth.uid()`. A non-member or a
 * mismatched `user_id` is rejected at the database; the function surfaces
 * that as a calm error.
 *
 * @returns the inserted comment (with `profiles.name` resolved) on success,
 *   or a calm error message on failure.
 */
export async function addComment(
  params: AddCommentParams,
): Promise<AddCommentResult> {
  const { memoryId, userId, content } = params;

  try {
    const { data, error } = await supabase
      .from("comments")
      .insert({
        memory_id: memoryId,
        // Required by the comments_insert RLS policy (user_id = auth.uid()).
        user_id: userId,
        content,
      })
      // Return the row joined to profiles so the list can append it with the
      // author name already resolved — no second round trip.
      .select("*, profiles(name)")
      .single();

    if (error || !data) {
      return { ok: false, error: GENERIC_ADD_ERROR };
    }

    return { ok: true, comment: data as CommentWithAuthor };
  } catch {
    // Network failures and unexpected thrown errors resolve to the same calm,
    // honest message (auth-design §7). The caller never sees a raw exception.
    return { ok: false, error: GENERIC_ADD_ERROR };
  }
}

// ============================================================================
// Delete (feature-specs §4 — hard delete, author OR Space owner)
// ============================================================================

/**
 * Result of {@link deleteComment}. On success `ok` is `true`; on failure
 * `error` carries a user-facing message and the row is untouched.
 */
export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Hard-deletes a single comment (feature-specs §4: "Deleted comments are
 * removed permanently (no soft delete for MVP)").
 *
 * The `comments_delete` RLS policy is the real gate:
 *
 *   USING (
 *     user_id = auth.uid()
 *     OR is_space_owner((SELECT space_id FROM memories WHERE id = comments.memory_id))
 *   )
 *
 * i.e. the **comment author OR a Space owner** may delete. This mirrors the
 * media-delete precedent (`media_delete` = memory creator OR owner). The UI
 * gates the delete affordance to the same set so the button only appears for
 * users the database would actually allow.
 *
 * The function never throws — callers can use a plain `if`/`else` without a
 * try/catch, matching the `deleteMedia` pattern.
 *
 * @param commentId the `comments.id` of the row to delete.
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function deleteComment(
  commentId: string,
): Promise<DeleteCommentResult> {
  try {
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId);

    if (error) {
      return { ok: false, error: GENERIC_DELETE_ERROR };
    }

    return { ok: true };
  } catch {
    // Network failures and unexpected thrown errors resolve to the same calm,
    // honest message (auth-design §7). The caller never sees a raw exception.
    return { ok: false, error: GENERIC_DELETE_ERROR };
  }
}

// ============================================================================
// Display helpers
// ============================================================================

/**
 * Resolves a comment's author display name from its joined profile, with a
 * calm fallback. A missing profile (e.g. mid-cascade after an account
 * deletion — though `user_id` is ON DELETE CASCADE so the comment goes with
 * it) reads as "Unknown" rather than rendering a blank or a broken layout.
 */
export function commentAuthorName(comment: CommentWithAuthor): string {
  return comment.profiles?.name?.trim() || "Unknown";
}

/**
 * Formats a comment's `created_at` (timestamptz) into a readable,
 * locale-aware label. Returns a calm fallback if the value can't be parsed
 * rather than rendering "Invalid Date".
 *
 * Uses a relative label ("just now", "5m ago", "3h ago", "2d ago") for recent
 * comments and falls back to an absolute date for older ones — a common,
 * calm pattern that orients the reader without a wall of timestamps.
 */
export function formatCommentTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // Future-dated (clock skew) or within the last minute reads as "just now"
  // so a freshly posted comment doesn't flash "0m ago" / a negative value.
  if (diffMs < 0 || seconds < 60) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 7) {
    return `${days}d ago`;
  }

  // Older than a week: absolute, locale-aware date (no time — comments are
  // context, not a log).
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Re-export the base Comment type for callers that only need the row shape
// without the joined author (keeps imports tidy).
export type { Comment };
