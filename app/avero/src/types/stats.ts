/**
 * Shared types for Space Statistics & Achievements (SPEC A).
 *
 * Stats are retrospective and reflective — never actionable "do more" prompts
 * (blueprint §10 "Build for the Memory, Not the Moment", §8 "Every Feature
 * Earns Its Place"). These types describe the precomputed cache row and the
 * static achievement catalog the UI renders.
 */

/** The four achievement categories, matching the DB CHECK constraint. */
export type AchievementCategory =
  | "milestone"
  | "time"
  | "collaboration"
  | "variety";

/**
 * A row from the static `achievements` catalog. Seeded once via migration,
 * not user-editable. `icon` is an identifier the frontend maps to a rendered
 * glyph (see {@link AchievementIcon}).
 */
export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  sort_order: number;
};

/**
 * A row from `space_achievements` — which achievement a Space has unlocked and
 * when. `unlocked_at` is permanent: once earned, an achievement is never
 * revoked, even if the qualifying condition later becomes false.
 */
export type SpaceAchievement = {
  space_id: string;
  achievement_id: string;
  unlocked_at: string;
};

/**
 * A row from `space_stats_cache` — the precomputed aggregate stats for one
 * Space. Written only by the recompute-space-stats Edge Function (service
 * role); the client has SELECT-only access (RLS-gated by is_space_member).
 *
 * `most_active_month` is a "YYYY-MM" string derived from the memory_date
 * histogram. `most_used_tag_id` / `most_used_tag_count` describe the single
 * most-used tag. `longest_gap_days` is the longest stretch between consecutive
 * memories. `space_age_days` is days since Space creation.
 */
export type SpaceStats = {
  space_id: string;
  total_memories: number;
  total_media: number;
  total_photos: number;
  total_videos: number;
  total_comments: number;
  total_reactions: number;
  member_count: number;
  first_memory_date: string | null;
  last_memory_date: string | null;
  most_active_month: string | null;
  most_used_tag_id: string | null;
  most_used_tag_count: number | null;
  longest_gap_days: number | null;
  space_age_days: number;
  computed_at: string;
};

/**
 * An achievement joined with its unlock state for a specific Space, as
 * assembled by the Stats page from the catalog + the Space's unlocked rows.
 * `unlockedAt` is null when the achievement is still locked.
 */
export type AchievementWithState = Achievement & {
  unlockedAt: string | null;
};
