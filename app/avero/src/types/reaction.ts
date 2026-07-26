/**
 * Shared types for the Reactions feature (feature-specs §5, database §9).
 *
 * Co-located in a single module so every screen that touches reactions — the
 * Memory detail bar, and any future management UI — agrees on the shape of a
 * reaction row and the allowed reaction types. Only the fields used by the
 * current scope are declared; the file grows as later screens need more.
 *
 * **Storage vs. display.** The `reactions.type` column stores **stable text
 * enum strings** (`heart`, `laugh`, `fire`, `tearful`, `clap`, `surprised`),
 * NOT the emoji themselves (migration 20260703170200 §`chk_reactions_type`,
 * backend-implementation Gap 7). Storing emoji in the DB would couple data
 * integrity to a rendering choice and break on any emoji font change. The UI
 * maps each stable string to its emoji for display via {@link REACTION_EMOJI}.
 */

/**
 * The six reaction types allowed on a Memory (feature-specs §5).
 *
 * These are the **stable text enum strings** stored in `reactions.type`. The
 * order here is the canonical display order of the reaction bar (matches the
 * order listed in feature-specs §5: ❤️ 😂 🔥 🥹 👏 😮).
 */
export type ReactionType =
  | "heart"
  | "laugh"
  | "fire"
  | "tearful"
  | "clap"
  | "surprised";

/**
 * The full, ordered set of reaction types. Used to render the bar (every type
 * is always shown, with a count of 0 when unused) and to validate fetched rows.
 * Declared `as const` so the tuple type is exact and the array length is fixed.
 */
export const REACTION_TYPES: readonly ReactionType[] = [
  "heart",
  "laugh",
  "fire",
  "tearful",
  "clap",
  "surprised",
] as const;

/**
 * Maps each stable reaction type to the emoji shown in the UI (feature-specs
 * §5). The emoji are a display concern only — they never touch the database.
 */
export const REACTION_EMOJI: Record<ReactionType, string> = {
  heart: "❤️",
  laugh: "😂",
  fire: "🔥",
  tearful: "🥹",
  clap: "👏",
  surprised: "😮",
};

/**
 * Maps each stable reaction type to a short, human-readable label used for
 * accessible names (e.g. "React with Heart") and any future tooltip/list. Kept
 * distinct from the emoji so screen readers get words, not emoji descriptions
 * that vary by platform/voice.
 */
export const REACTION_LABELS: Record<ReactionType, string> = {
  heart: "Heart",
  laugh: "Laugh",
  fire: "Fire",
  tearful: "Tearful",
  clap: "Clap",
  surprised: "Surprised",
};

/**
 * A Reaction — a single user's emotional validation of a Memory (database
 * §9, migration 20260703170100 §10).
 *
 * `user_id` is the reacting user. The `reactions_insert` RLS policy enforces
 * `user_id = auth.uid()` at the database, so the client never sets it to
 * anything other than the current user.
 *
 * `type` is one of the {@link ReactionType} stable strings (NOT emoji). The
 * `chk_reactions_type` CHECK constraint and the `uq_reactions_memory_user_type`
 * UNIQUE constraint enforce the feature-specs §5 rules: "one user = one
 * reaction per type per Memory".
 *
 * Reactions are hard-deleted (no `deleted_at`, no soft delete) — they are
 * toggles, removed by deleting the row (migration 20260703170100 §10, RLS
 * `reactions_delete` = author only). There is no UPDATE policy by design
 * (backend-implementation §11.4: "— (delete + re-insert)").
 */
export type Reaction = {
  id: string;
  memory_id: string;
  user_id: string;
  type: string;
  created_at: string;
};

/**
 * Narrows an arbitrary string (e.g. a raw `reactions.type` value from the DB)
 * to a {@link ReactionType}, or returns `null` if it isn't one of the six
 * allowed values.
 *
 * Defensive against malformed/future types: a row whose `type` isn't in the
 * known set is dropped from display rather than crashing the bar (mirrors the
 * `asMediaType` guard in `types/media.ts`).
 */
export function asReactionType(value: string): ReactionType | null {
  return REACTION_TYPES.includes(value as ReactionType)
    ? (value as ReactionType)
    : null;
}
