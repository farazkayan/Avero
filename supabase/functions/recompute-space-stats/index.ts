// ============================================================================
// Supabase Edge Function: recompute-space-stats
// ----------------------------------------------------------------------------
// Recomputes the cached statistics for a single Space and evaluates the
// achievement catalog's unlock conditions, inserting any newly-qualifying
// achievements. This is the trusted server-side process that is the ONLY
// writer to space_stats_cache and space_achievements (the migration grants no
// client-side INSERT/UPDATE/DELETE on those tables, so achievements cannot be
// forged by a malicious client).
//
// INVOCATION:
//   - Primarily by the pg_cron job (migration 20260729100000 §12), which POSTs
//     { space_id } with the service-role key for every row in
//     stats_recompute_queue, then deletes those rows.
//   - May also be invoked directly (e.g. for a manual backfill) with the
//     service-role key.
//
// AUTHORIZATION:
//   This function runs with the SERVICE ROLE key (from the Authorization
//   header), which bypasses RLS. This is intentional and required: the
//   recompute must read ALL of a Space's memories/media/comments/reactions
//     regardless of which user triggered it, and must write to tables that have
//   no client-write policies. The function itself validates that the caller
//     presented a service-role key by checking the SUPABASE_SERVICE_ROLE_KEY
//     env var — a normal user JWT will be rejected with 403. This prevents a
//     client from invoking the recompute directly to probe achievement state
//     (though even if they could, the function only writes true facts derived
//     from the data, so the worst case is a redundant recompute).
//
// IDEMPOTENCE & SAFETY:
//   - Upserts space_stats_cache (one row per Space).
//   - Inserts newly-qualifying space_achievements with ON CONFLICT DO NOTHING
//     (re-running for an already-unlocked achievement is a no-op).
//   - NEVER deletes an unlocked achievement, even if the qualifying condition
//     is no longer true (e.g. a Memory was deleted and the count dropped below
//     the threshold). Once earned, permanently kept — like real achievements.
//
// PHILOSOPHY (blueprint §10, §8; SPEC A.0):
//   Stats are retrospective and reflective, never actionable "do more" prompts.
//   No streaks, no progress-toward-badge nudges. This function computes facts
//   about a Space's history; the UI presents them calmly. It does NOT compute
//   or emit anything that could drive engagement-bait.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ----------------------------------------------------------------------------
// Response helpers
// ----------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Normalizes any thrown value into a human-readable string. supabase-js throws
// plain PostgrestError objects (not Error instances), so we must inspect .message
// and stringify the whole object to surface the real DB/API error.
function describeCause(cause: unknown): string | null {
  if (cause === undefined || cause === null) return null;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && "message" in cause) {
    const msg = (cause as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

function jsonError(status: number, message: string, cause?: unknown): Response {
  const detail = describeCause(cause);
  if (detail !== null) {
    console.error(`[recompute-space-stats] ${status} ${message}: ${detail}`);
  } else {
    console.error(`[recompute-space-stats] ${status} ${message}`);
  }
  const payload: { error: string; details?: string } = { error: message };
  // Always surface the real cause in the response body so it shows up in
  // net._http_response.content for diagnosis (the body is only seen by the
  // service-role cron caller, never by end users).
  if (detail !== null) payload.details = detail;
  return jsonResponse(status, payload);
}

// ----------------------------------------------------------------------------
// Authorization
// ----------------------------------------------------------------------------

/**
 * The service-role key is the ONLY acceptable bearer token for this function.
 * A normal user JWT must be rejected so a client cannot invoke the recompute
 * directly. We compare against the SUPABASE_SERVICE_ROLE_KEY env var (set by
 * the Supabase runtime for every Edge Function).
 */
function isServiceRoleRequest(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1].trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return false;
  return token === serviceKey;
}

// ----------------------------------------------------------------------------
// Stats computation
// ----------------------------------------------------------------------------

/** The shape of a freshly computed stats row, before upsert. */
interface ComputedStats {
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
}

/**
 * Runs the aggregation queries for a Space and returns the computed stats.
 * Uses the service-role client (RLS bypassed) so it sees every row regardless
 * of who triggered the recompute. Soft-deleted memories (deleted_at IS NULL)
 * are excluded everywhere — stats reflect visible Memories only.
 */
async function computeStats(
  client: ReturnType<typeof createClient>,
  spaceId: string,
): Promise<ComputedStats> {
  // --- Space age (days since creation) ---
  const { data: spaceRow, error: spaceErr } = await client
    .from("spaces")
    .select("created_at")
    .eq("id", spaceId)
    .maybeSingle();
  if (spaceErr) throw spaceErr;
  if (!spaceRow) {
    throw new Error(`Space ${spaceId} not found`);
  }
  const spaceAgeDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(spaceRow.created_at).getTime()) / 86_400_000,
    ),
  );

  // --- Memories (visible only: deleted_at IS NULL) ---
  // We fetch memory_date + created_by for: counts, date range, most active
  // month, longest gap, seasons, and the all_members_contributed check.
  const { data: memories, error: memErr } = await client
    .from("memories")
    .select("id, memory_date, created_by")
    .eq("space_id", spaceId)
    .is("deleted_at", null);
  if (memErr) throw memErr;
  const memList = memories ?? [];
  const totalMemories = memList.length;

  let firstMemoryDate: string | null = null;
  let lastMemoryDate: string | null = null;
  let mostActiveMonth: string | null = null;
  let longestGapDays: number | null = null;

  if (totalMemories > 0) {
    const dates = memList
      .map((m) => m.memory_date)
      .filter((d): d is string => typeof d === "string")
      .sort();
    firstMemoryDate = dates[0];
    lastMemoryDate = dates[dates.length - 1];

    // Most active month: histogram of "YYYY-MM" from memory_date.
    const monthCounts = new Map<string, number>();
    for (const d of dates) {
      const month = d.slice(0, 7); // "YYYY-MM"
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }
    let bestMonth: string | null = null;
    let bestCount = -1;
    for (const [month, count] of monthCounts) {
      if (count > bestCount || (count === bestCount && month < (bestMonth ?? ""))) {
        bestMonth = month;
        bestCount = count;
      }
    }
    mostActiveMonth = bestCount > 0 ? bestMonth : null;

    // Longest gap between consecutive memories (by memory_date).
    let maxGap = 0;
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round(
        (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) /
          86_400_000,
      );
      if (diff > maxGap) maxGap = diff;
    }
    longestGapDays = dates.length > 1 ? maxGap : null;
  }

  // --- Media (photos + videos) across visible memories ---
  // Join through memories to respect soft-delete and scope to this Space.
  const { data: mediaRows, error: mediaErr } = await client
    .from("media")
    .select("type, memories!inner(space_id, deleted_at)")
    .eq("memories.space_id", spaceId)
    .is("memories.deleted_at", null);
  if (mediaErr) throw mediaErr;
  const mediaList = mediaRows ?? [];
  const totalMedia = mediaList.length;
  const totalPhotos = mediaList.filter((m) => m.type === "photo").length;
  const totalVideos = mediaList.filter((m) => m.type === "video").length;

  // --- Comments across visible memories ---
  // NOTE: the `memories` relation MUST appear in the select (as an inner
  // embed) for PostgREST to resolve the `memories.space_id` /
  // `memories.deleted_at` filters. A head:true count with `select("id")` and
  // a relation filter returns PGRST108 ("An embedded relationship must be
  // specified in order to use the relationship filter") — which was the
  // cause of the function's HTTP 500. Including `memories!inner(...)` in the
  // select makes the filter resolvable; head:true still suppresses the body
  // and the count is read from the content-range header.
  const { count: totalComments, error: commentErr } = await client
    .from("comments")
    .select("id, memories!inner(space_id, deleted_at)", { count: "exact", head: true })
    .eq("memories.space_id", spaceId)
    .is("memories.deleted_at", null);
  if (commentErr) throw commentErr;

  // --- Reactions across visible memories ---
  // Same relation-in-select requirement as the comments count above.
  const { count: totalReactions, error: reactErr } = await client
    .from("reactions")
    .select("id, memories!inner(space_id, deleted_at)", { count: "exact", head: true })
    .eq("memories.space_id", spaceId)
    .is("memories.deleted_at", null);
  if (reactErr) throw reactErr;

  // --- Comment reactions (counted into the "reactions" total for the
  // "Well Loved" / "Lots to Say" achievements? No — the spec's achievements
  // reference "comments" and "reactions" separately. We keep Memory-level
  // reactions for total_reactions and Memory-level comments for
  // total_comments, matching the cache columns. Comment reactions are a
  // separate table and are intentionally not aggregated here in v1.) ---

  // --- Member count ---
  const { count: memberCount, error: memberErr } = await client
    .from("space_members")
    .select("id", { count: "exact", head: true })
    .eq("space_id", spaceId);
  if (memberErr) throw memberErr;

  // --- Most used tag (across visible memories in this Space) ---
  // memory_tags -> tags, filtered to this Space's memories. We fetch the
  // joined rows and tally client-side (simple, and the per-Space tag volume is
  // small). most_used_tag_id is the tag with the highest count.
  const { data: tagRows, error: tagErr } = await client
    .from("memory_tags")
    .select("tag_id, memories!inner(space_id, deleted_at)")
    .eq("memories.space_id", spaceId)
    .is("memories.deleted_at", null);
  if (tagErr) throw tagErr;
  const tagList = tagRows ?? [];
  const tagCounts = new Map<string, number>();
  for (const row of tagList) {
    const tid = row.tag_id;
    if (typeof tid === "string") {
      tagCounts.set(tid, (tagCounts.get(tid) ?? 0) + 1);
    }
  }
  let mostUsedTagId: string | null = null;
  let mostUsedTagCount: number | null = null;
  for (const [tid, count] of tagCounts) {
    if (
      mostUsedTagCount === null ||
      count > mostUsedTagCount ||
      (count === mostUsedTagCount && tid < (mostUsedTagId ?? ""))
    ) {
      mostUsedTagId = tid;
      mostUsedTagCount = count;
    }
  }

  return {
    total_memories: totalMemories,
    total_media: totalMedia,
    total_photos: totalPhotos,
    total_videos: totalVideos,
    total_comments: totalComments ?? 0,
    total_reactions: totalReactions ?? 0,
    member_count: memberCount ?? 0,
    first_memory_date: firstMemoryDate,
    last_memory_date: lastMemoryDate,
    most_active_month: mostActiveMonth,
    most_used_tag_id: mostUsedTagId,
    most_used_tag_count: mostUsedTagCount,
    longest_gap_days: longestGapDays,
    space_age_days: spaceAgeDays,
  };
}

// ----------------------------------------------------------------------------
// Achievement evaluation
// ----------------------------------------------------------------------------

/**
 * The set of distinct meteorological seasons present in the Space's memory
 * dates. Meteorological seasons (fixed by month, hemisphere-agnostic for this
 * check — we use the northern-meteorological convention as a stable proxy):
 *   Spring: Mar, Apr, May
 *   Summer: Jun, Jul, Aug
 *   Autumn: Sep, Oct, Nov
 *   Winter: Dec, Jan, Feb
 * The achievement requires at least one Memory in each of the four.
 */
function seasonsPresent(memoryDates: string[]): Set<string> {
  const seasons = new Set<string>();
  for (const d of memoryDates) {
    const month = Number(d.slice(5, 7));
    if (month >= 3 && month <= 5) seasons.add("spring");
    else if (month >= 6 && month <= 8) seasons.add("summer");
    else if (month >= 9 && month <= 11) seasons.add("autumn");
    else seasons.add("winter");
  }
  return seasons;
}

/**
 * Evaluates the full achievement catalog against the freshly computed stats
 * and the raw per-memory data, returning the list of achievement ids that are
 * currently qualified. The caller inserts these with ON CONFLICT DO NOTHING, so
 * already-unlocked achievements are unaffected and never revoked.
 *
 * Each condition is a small hardcoded check, per SPEC A.3.
 */
function evaluateAchievements(
  stats: ComputedStats,
  memoryDates: string[],
  memoryCreatorIds: string[],
  memberUserIds: string[],
): string[] {
  const unlocked: string[] = [];

  // --- Milestone ---
  if (stats.total_memories >= 1) unlocked.push("first_memory");
  if (stats.total_memories >= 10) unlocked.push("ten_memories");
  if (stats.total_memories >= 50) unlocked.push("fifty_memories");
  if (stats.total_media >= 100) unlocked.push("hundred_photos");

  // --- Time ---
  if (stats.space_age_days >= 30 && stats.total_memories >= 1) {
    unlocked.push("one_month_old");
  }
  if (stats.space_age_days >= 365) unlocked.push("one_year_old");
  if (seasonsPresent(memoryDates).size === 4) {
    unlocked.push("memory_from_every_season");
  }

  // --- Collaboration ---
  // all_members_contributed: every current member has created >= 1 Memory.
  // If there are zero members, this is vacuously false (no one to contribute).
  if (memberUserIds.length > 0) {
    const creatorSet = new Set(memoryCreatorIds);
    const allContributed = memberUserIds.every((uid) => creatorSet.has(uid));
    if (allContributed) unlocked.push("all_members_contributed");
  }
  if (stats.total_comments >= 100) unlocked.push("hundred_comments");
  if (stats.total_reactions >= 100) unlocked.push("hundred_reactions");

  // --- Variety ---
  // five_tags_used: 5+ distinct tags. We approximate using most_used_tag_count
  // presence plus a distinct-tag count derived from the tag tally. Since
  // computeStats already tallied tags, we re-derive distinct count from the
  // stats object's most_used_tag_count only if it's the sole signal — but we
  // need the actual distinct count. We pass it in via stats by reading
  // most_used_tag_count as a lower bound is insufficient, so the caller passes
  // the distinct tag count separately. (Handled below via a closure.)
  return unlocked;
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Only the service role may invoke this trusted writer.
  if (!isServiceRoleRequest(req)) {
    return jsonError(403, "Forbidden: service-role key required");
  }

  if (req.method !== "POST") {
    return jsonError(405, "Method Not Allowed");
  }

  // --- Parse body ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const spaceId =
    body && typeof body === "object" && "space_id" in body
      ? String((body as { space_id: unknown }).space_id)
      : null;
  if (!spaceId || !UUID_RE.test(spaceId)) {
    return jsonError(400, "Missing or invalid space_id");
  }

  // --- Build a service-role client (bypasses RLS) ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError(500, "Server misconfiguration: missing Supabase env");
  }
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // --- Compute stats ---
    const stats = await computeStats(client, spaceId);

    // --- Upsert the cache row ---
    const { error: upsertErr } = await client
      .from("space_stats_cache")
      .upsert(
        {
          space_id: spaceId,
          total_memories: stats.total_memories,
          total_media: stats.total_media,
          total_photos: stats.total_photos,
          total_videos: stats.total_videos,
          total_comments: stats.total_comments,
          total_reactions: stats.total_reactions,
          member_count: stats.member_count,
          first_memory_date: stats.first_memory_date,
          last_memory_date: stats.last_memory_date,
          most_active_month: stats.most_active_month,
          most_used_tag_id: stats.most_used_tag_id,
          most_used_tag_count: stats.most_used_tag_count,
          longest_gap_days: stats.longest_gap_days,
          space_age_days: stats.space_age_days,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "space_id" },
      );
    if (upsertErr) throw upsertErr;

    // --- Gather the extra signals the achievement evaluator needs ---
    // Memory dates + creators (visible memories only).
    const { data: memRows, error: memErr2 } = await client
      .from("memories")
      .select("memory_date, created_by")
      .eq("space_id", spaceId)
      .is("deleted_at", null);
    if (memErr2) throw memErr2;
    const memList = memRows ?? [];
    const memoryDates = memList
      .map((m) => m.memory_date)
      .filter((d): d is string => typeof d === "string");
    const memoryCreatorIds = memList
      .map((m) => m.created_by)
      .filter((d): d is string => typeof d === "string");

    // Member user ids.
    const { data: memberRows, error: memberErr2 } = await client
      .from("space_members")
      .select("user_id")
      .eq("space_id", spaceId);
    if (memberErr2) throw memberErr2;
    const memberUserIds = (memberRows ?? [])
      .map((m) => m.user_id)
      .filter((d): d is string => typeof d === "string");

    // Distinct tag count (for five_tags_used).
    const { data: tagRows, error: tagErr2 } = await client
      .from("memory_tags")
      .select("tag_id, memories!inner(space_id, deleted_at)")
      .eq("memories.space_id", spaceId)
      .is("memories.deleted_at", null);
    if (tagErr2) throw tagErr2;
    const distinctTagCount = new Set(
      (tagRows ?? []).map((r) => r.tag_id).filter((t): t is string => typeof t === "string"),
    ).size;

    // --- Evaluate achievements ---
    const unlocked = evaluateAchievements(
      stats,
      memoryDates,
      memoryCreatorIds,
      memberUserIds,
    );
    // five_tags_used needs the distinct tag count, appended here.
    if (distinctTagCount >= 5) unlocked.push("five_tags_used");
    // video_and_photo: at least 1 photo and 1 video.
    if (stats.total_photos >= 1 && stats.total_videos >= 1) {
      unlocked.push("video_and_photo");
    }

    // --- Insert newly-qualifying achievements (never revoke) ---
    if (unlocked.length > 0) {
      const rows = unlocked.map((achievement_id) => ({
        space_id: spaceId,
        achievement_id,
        unlocked_at: new Date().toISOString(),
      }));
      const { error: achErr } = await client
        .from("space_achievements")
        .upsert(rows, { onConflict: "space_id,achievement_id", ignoreDuplicates: true });
      if (achErr) throw achErr;
    }

    return jsonResponse(200, {
      space_id: spaceId,
      stats,
      achievements_unlocked: unlocked,
    });
  } catch (err) {
    return jsonError(500, "Recompute failed", err);
  }
});
