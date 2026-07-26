/**
 * Shared types for the Comments feature (feature-specs §4, database §8).
 *
 * Co-located in a single module so every screen that touches comments — the
 * Memory detail list, the input, and any future management UI — agrees on the
 * shape of a comment row. Only the fields used by the current scope are
 * declared; the file grows as later screens need more.
 */

/**
 * A Comment — user-generated context tied to a Memory (database §8,
 * migration 20260703170100 §9).
 *
 * `user_id` is the commenting user (always attributed — feature-specs §4:
 * "No anonymous comments"). The `comments_insert` RLS policy enforces
 * `user_id = auth.uid()` at the database, so the client never sets it to
 * anything other than the current user.
 *
 * `content` is free-form text (NOT NULL). There is no server-side length
 * CHECK; a client-side guard (`MAX_COMMENT_LENGTH` in `lib/comments.ts`)
 * keeps the UI calm.
 *
 * Comments are hard-deleted (no `deleted_at`) per feature-specs §4: "Deleted
 * comments are removed permanently (no soft delete for MVP)."
 *
 * `updated_at` exists in the schema to support potential comment editing in a
 * future iteration; the MVP does not edit comments, so it equals `created_at`.
 */
export type Comment = {
  id: string;
  memory_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

/**
 * The `profiles` columns joined onto a `comments` row by the Memory detail
 * fetch:
 *
 *   supabase.from("comments").select("*, profiles(name)").eq("memory_id", id)
 *
 * `profiles` is optional because the commenting user's profile row could
 * theoretically be absent (e.g. mid-cascade after an account deletion — the
 * `user_id` FK is ON DELETE CASCADE, so the comment goes with the profile,
 * but a join returning null is handled defensively). The UI falls back to a
 * calm "Unknown" name when it is missing.
 */
export type CommentAuthor = {
  name: string;
};

/**
 * A `comments` row joined with its `profiles` row, as returned by the
 * Memory detail page's comment-list fetch.
 *
 * The Supabase client is created without a generated `Database` type, so the
 * SDK returns loosely-typed data; this interface gives the comment list a
 * statically-typed view of that joined result. This mirrors the
 * `SpaceMembershipWithSpace` / `SpaceMember` pattern in `types/space.ts`.
 */
export type CommentWithAuthor = Comment & {
  profiles?: CommentAuthor;
};
