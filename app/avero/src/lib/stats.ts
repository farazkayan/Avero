import { supabase } from "./supabase";
import type {
  Achievement,
  AchievementWithState,
  SpaceAchievement,
  SpaceStats,
} from "../types/stats";

/**
 * Space Statistics & Achievements data access (SPEC A).
 *
 * All reads here are RLS-gated by is_space_member(): a non-member receives no
 * rows for the cache or unlocked achievements, and the memories query returns
 * nothing — so the Stats page resolves to a calm "not found / no access" state
 * rather than leaking anything. The cache and achievements tables are
 * SELECT-only from the client; they are written solely by the
 * recompute-space-stats Edge Function (service role), so achievements cannot
 * be forged by a malicious client.
 *
 * Stats are retrospective and reflective — never actionable prompts. This
 * module only fetches facts; the UI presents them calmly (blueprint §10, §8).
 */

/**
 * Fetches the precomputed stats cache row for a Space.
 *
 * Returns null when the Space doesn't exist, the user isn't a member (RLS
 * returns no rows), or the cache row hasn't been seeded yet. The page treats
 * null as "no stats available" and renders the empty state.
 */
export async function fetchSpaceStats(
  spaceId: string,
): Promise<SpaceStats | null> {
  const { data, error } = await supabase
    .from("space_stats_cache")
    .select("*")
    .eq("space_id", spaceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as SpaceStats | null) ?? null;
}

/**
 * Fetches the full static achievement catalog, ordered by category then
 * sort_order. The catalog is identical for every Space (it is static reference
 * data, SELECTable by any authenticated user), so the UI can render locked
 * achievements' titles without a per-Space round trip.
 */
export async function fetchAchievementCatalog(): Promise<Achievement[]> {
  const { data, error } = await supabase
    .from("achievements")
    .select("*")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) {
    throw error;
  }
  return (data as Achievement[]) ?? [];
}

/**
 * Fetches the achievements a Space has unlocked, keyed by achievement_id.
 * Used to join unlock state onto the catalog.
 */
export async function fetchSpaceAchievements(
  spaceId: string,
): Promise<Map<string, SpaceAchievement>> {
  const { data, error } = await supabase
    .from("space_achievements")
    .select("*")
    .eq("space_id", spaceId);
  if (error) {
    throw error;
  }
  const map = new Map<string, SpaceAchievement>();
  for (const row of (data as SpaceAchievement[]) ?? []) {
    map.set(row.achievement_id, row);
  }
  return map;
}

/**
 * Joins the achievement catalog with a Space's unlock state, returning the
 * full ordered list with `unlockedAt` set (or null when still locked). This is
 * the single shape the achievements grid consumes.
 */
export async function fetchAchievementsWithState(
  spaceId: string,
): Promise<AchievementWithState[]> {
  const [catalog, unlocked] = await Promise.all([
    fetchAchievementCatalog(),
    fetchSpaceAchievements(spaceId),
  ]);
  return catalog.map((achievement) => {
    const row = unlocked.get(achievement.id);
    return {
      ...achievement,
      unlockedAt: row ? row.unlocked_at : null,
    };
  });
}

/**
 * A single month bucket in the timeline density visualization: the "YYYY-MM"
 * key and the count of Memories whose memory_date falls in that month.
 */
export type MonthBucket = {
  month: string; // "YYYY-MM"
  year: number;
  monthIndex: number; // 0-11
  count: number;
};

/**
 * Fetches the per-month Memory count for a Space, used by the timeline density
 * visualization. The histogram is NOT stored in the cache (only the single
 * most-active month is), so we fetch the visible memories' memory_date values
 * and bucket them client-side. RLS auto-filters to members and excludes
 * soft-deleted rows, so this is safe and consistent with the rest of the page.
 *
 * The returned list spans every month from the Space's first memory to its
 * last (inclusive), with zero-count months filled in so the visualization
 * shows the true shape of the timeline — not just months that have memories.
 * Returns an empty array when the Space has no memories.
 */
export async function fetchMemoryMonthHistogram(
  spaceId: string,
): Promise<MonthBucket[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("memory_date")
    .eq("space_id", spaceId)
    .is("deleted_at", null);
  if (error) {
    throw error;
  }
  const dates = (data ?? [])
    .map((m) => m.memory_date)
    .filter((d): d is string => typeof d === "string")
    .sort();
  if (dates.length === 0) {
    return [];
  }

  // Tally counts per "YYYY-MM".
  const counts = new Map<string, number>();
  for (const d of dates) {
    const month = d.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  // Build a contiguous month range from first to last memory date, filling
  // zero-count months so the visualization shows the full timeline shape.
  const first = dates[0];
  const last = dates[dates.length - 1];
  const buckets: MonthBucket[] = [];
  const cursor = new Date(first.slice(0, 4) + "-" + first.slice(5, 7) + "-01T00:00:00Z");
  const end = new Date(last.slice(0, 4) + "-" + last.slice(5, 7) + "-01T00:00:00Z");
  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    buckets.push({
      month,
      year,
      monthIndex,
      count: counts.get(month) ?? 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}
