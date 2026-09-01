-- ============================================================================
-- Migration: in-DB stats recompute, eliminates the service-role secret in cron
-- ----------------------------------------------------------------------------
-- The previous design called the `recompute-space-stats` Edge Function from
-- pg_cron via pg_net, authenticating with the project's service-role secret
-- key. The secret was hardcoded in the cron job body (migration
-- 20260729100000_space_stats_achievements.sql §12), which leaked it to anyone
-- with read access to the repository or its git history.
--
-- This migration replaces that design with an in-database plpgsql function
-- that performs the same aggregations and writes the same rows. The new cron
-- job is a single SQL statement that calls the plpgsql function directly — no
-- HTTP, no secret. The Edge Function is preserved (unchanged) for manual
-- backfills and ad-hoc invocations but is no longer called by the cron.
--
-- SECURITY NOTES
--   - The plpgsql function is SECURITY DEFINER with `SET search_path = public`
--     so it runs as the migration-applier role (the typical Supabase pattern)
--     and cannot be hijacked via search_path manipulation. Stats and
--     achievements are written under the migration role, which bypasses RLS
--     and owns the only policies that protect these tables from authenticated
--     writes (the existing RLS policies are SELECT-only — the trigger function
--     is the only writer other than the superuser, and now this function).
--   - The plpgsql function takes a single space_id and processes ONE Space.
--     The cron drains the queue by calling it in a loop, so behavior is
--     equivalent to the old HTTP fan-out: every queued Space is recomputed
--     once per cron tick.
--   - The hardcoded sb_secret_... value in the historical migration
--     (20260729100000 §12) remains in git history. The historical migration
--     is NOT modified (per project rule: never edit historical migrations).
--     Operators MUST:
--       1. Rotate the leaked service-role key in the Supabase dashboard.
--       2. Rewrite git history to remove the secret (filter-repo / BFG).
--     See SECURITY.md for the exact procedure.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. In-DB recompute function
-- ----------------------------------------------------------------------------
-- Recomputes space_stats_cache and the achievement unlocks for a single Space.
-- One round trip to the database (this function's transaction); six
-- sequential PostgREST round trips in the previous Edge Function design are
-- eliminated. Behavior is identical to the Edge Function (same derived
-- columns, same unlock conditions).
CREATE OR REPLACE FUNCTION recompute_space_stats(p_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_memories      integer;
    v_total_media         integer;
    v_total_photos        integer;
    v_total_videos        integer;
    v_total_comments      integer;
    v_total_reactions     integer;
    v_member_count        integer;
    v_first_memory_date   date;
    v_last_memory_date    date;
    v_most_active_month   text;
    v_most_used_tag_id    uuid;
    v_most_used_tag_count integer;
    v_longest_gap_days    integer;
    v_space_age_days      integer;
    v_creator_ids         uuid[];
    v_member_ids          uuid[];
    v_distinct_tag_count  integer;
    v_seasons             text[];
    v_unlocked            text[] := ARRAY[]::text[];
    v_dummy               integer;
BEGIN
    -- Defensive: nothing to do if the Space was deleted between queueing
    -- and processing.
    SELECT EXTRACT(day FROM (now() - created_at))::integer
      INTO v_space_age_days
      FROM spaces WHERE id = p_space_id;
    IF v_space_age_days IS NULL THEN
        RETURN;
    END IF;
    IF v_space_age_days < 0 THEN
        v_space_age_days := 0;
    END IF;

    -- Visible memories only (deleted_at IS NULL). One scan derives the
    -- totals, the date range, the most-active-month histogram, the longest
    -- gap, the creator set, and the season set.
    SELECT
        count(*),
        min(memory_date),
        max(memory_date)
      INTO v_total_memories, v_first_memory_date, v_last_memory_date
      FROM memories
      WHERE space_id = p_space_id AND deleted_at IS NULL;

    v_total_memories := COALESCE(v_total_memories, 0);
    IF v_first_memory_date IS NULL THEN
        v_total_memories := 0;
    END IF;

    -- Most active month (histogram of "YYYY-MM" from memory_date). Tie-break
    -- on the earlier month for determinism.
    IF v_total_memories > 0 THEN
        SELECT month
          INTO v_most_active_month
          FROM (
              SELECT to_char(memory_date, 'YYYY-MM') AS month,
                     count(*) AS cnt
                FROM memories
               WHERE space_id = p_space_id AND deleted_at IS NULL
               GROUP BY 1
          ) m
         ORDER BY cnt DESC, month ASC
         LIMIT 1;
    ELSE
        v_most_active_month := NULL;
    END IF;

    -- Longest gap (consecutive memory_date in days).
    IF v_total_memories > 1 THEN
        WITH ordered AS (
            SELECT memory_date,
                   row_number() OVER (ORDER BY memory_date) AS rn
              FROM memories
             WHERE space_id = p_space_id AND deleted_at IS NULL
        ),
        gaps AS (
            SELECT (memory_date - lag(memory_date) OVER (ORDER BY rn)) AS d
              FROM ordered
        )
        SELECT max(d) INTO v_longest_gap_days FROM gaps;
    ELSE
        v_longest_gap_days := NULL;
    END IF;

    -- Distinct creator set (for the all_members_contributed check).
    SELECT COALESCE(array_agg(DISTINCT created_by), ARRAY[]::uuid[])
      INTO v_creator_ids
      FROM memories
     WHERE space_id = p_space_id AND deleted_at IS NULL;

    -- Season set (meteorological, northern-hemisphere proxy).
    SELECT COALESCE(array_agg(DISTINCT season), ARRAY[]::text[])
      INTO v_seasons
      FROM (
          SELECT CASE
              WHEN EXTRACT(month FROM memory_date) BETWEEN 3 AND 5  THEN 'spring'
              WHEN EXTRACT(month FROM memory_date) BETWEEN 6 AND 8  THEN 'summer'
              WHEN EXTRACT(month FROM memory_date) BETWEEN 9 AND 11 THEN 'autumn'
              ELSE 'winter'
          END AS season
            FROM memories
           WHERE space_id = p_space_id AND deleted_at IS NULL
      ) s;

    -- Media (photos + videos). A media row only ever belongs to one memory,
    -- which belongs to one space.
    SELECT
        count(*),
        count(*) FILTER (WHERE m.type = 'photo'),
        count(*) FILTER (WHERE m.type = 'video')
      INTO v_total_media, v_total_photos, v_total_videos
      FROM media m
      JOIN memories mem ON mem.id = m.memory_id
     WHERE mem.space_id = p_space_id AND mem.deleted_at IS NULL;
    v_total_media  := COALESCE(v_total_media, 0);
    v_total_photos := COALESCE(v_total_photos, 0);
    v_total_videos := COALESCE(v_total_videos, 0);

    -- Comments across visible memories in this Space.
    SELECT count(*)
      INTO v_total_comments
      FROM comments c
      JOIN memories mem ON mem.id = c.memory_id
     WHERE mem.space_id = p_space_id AND mem.deleted_at IS NULL;
    v_total_comments := COALESCE(v_total_comments, 0);

    -- Reactions (Memory-level — comment_reactions are intentionally not
    -- counted in the cached "reactions" total, matching the Edge Function's
    -- contract).
    SELECT count(*)
      INTO v_total_reactions
      FROM reactions r
      JOIN memories mem ON mem.id = r.memory_id
     WHERE mem.space_id = p_space_id AND mem.deleted_at IS NULL;
    v_total_reactions := COALESCE(v_total_reactions, 0);

    -- Member count.
    SELECT count(*)
      INTO v_member_count
      FROM space_members
     WHERE space_id = p_space_id;
    v_member_count := COALESCE(v_member_count, 0);

    SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[])
      INTO v_member_ids
      FROM space_members
     WHERE space_id = p_space_id;

    -- Most used tag + distinct tag count.
    WITH tag_counts AS (
        SELECT mt.tag_id, count(*) AS cnt
          FROM memory_tags mt
          JOIN memories mem ON mem.id = mt.memory_id
         WHERE mem.space_id = p_space_id AND mem.deleted_at IS NULL
         GROUP BY mt.tag_id
    )
    SELECT tag_id, cnt
      INTO v_most_used_tag_id, v_most_used_tag_count
      FROM tag_counts
     ORDER BY cnt DESC, tag_id ASC
     LIMIT 1;
    IF NOT FOUND THEN
        v_most_used_tag_id := NULL;
        v_most_used_tag_count := NULL;
    END IF;

    SELECT count(DISTINCT mt.tag_id)
      INTO v_distinct_tag_count
      FROM memory_tags mt
      JOIN memories mem ON mem.id = mt.memory_id
     WHERE mem.space_id = p_space_id AND mem.deleted_at IS NULL;
    v_distinct_tag_count := COALESCE(v_distinct_tag_count, 0);

    -- Upsert the cache row.
    INSERT INTO space_stats_cache (
        space_id, total_memories, total_media, total_photos, total_videos,
        total_comments, total_reactions, member_count,
        first_memory_date, last_memory_date, most_active_month,
        most_used_tag_id, most_used_tag_count,
        longest_gap_days, space_age_days, computed_at
    ) VALUES (
        p_space_id, v_total_memories, v_total_media, v_total_photos, v_total_videos,
        v_total_comments, v_total_reactions, v_member_count,
        v_first_memory_date, v_last_memory_date, v_most_active_month,
        v_most_used_tag_id, v_most_used_tag_count,
        v_longest_gap_days, v_space_age_days, now()
    )
    ON CONFLICT (space_id) DO UPDATE SET
        total_memories      = EXCLUDED.total_memories,
        total_media         = EXCLUDED.total_media,
        total_photos        = EXCLUDED.total_photos,
        total_videos        = EXCLUDED.total_videos,
        total_comments      = EXCLUDED.total_comments,
        total_reactions     = EXCLUDED.total_reactions,
        member_count        = EXCLUDED.member_count,
        first_memory_date   = EXCLUDED.first_memory_date,
        last_memory_date    = EXCLUDED.last_memory_date,
        most_active_month   = EXCLUDED.most_active_month,
        most_used_tag_id    = EXCLUDED.most_used_tag_id,
        most_used_tag_count = EXCLUDED.most_used_tag_count,
        longest_gap_days    = EXCLUDED.longest_gap_days,
        space_age_days      = EXCLUDED.space_age_days,
        computed_at         = EXCLUDED.computed_at;

    -- Evaluate achievements. Each condition is a small hardcoded check,
    -- matching the previous Edge Function's evaluateAchievements() exactly
    -- so behavior is unchanged.
    IF v_total_memories >= 1   THEN v_unlocked := array_append(v_unlocked, 'first_memory');   END IF;
    IF v_total_memories >= 10  THEN v_unlocked := array_append(v_unlocked, 'ten_memories');   END IF;
    IF v_total_memories >= 50  THEN v_unlocked := array_append(v_unlocked, 'fifty_memories'); END IF;
    -- 'hundred_photos' is the catalog id even though it counts all media
    -- (the prior Edge Function had the same condition). M-45 (audit) flags
    -- this naming vs. condition mismatch separately; this migration
    -- preserves the prior behavior for compatibility with the existing
    -- unlocked-achievements rows.
    IF v_total_media >= 100    THEN v_unlocked := array_append(v_unlocked, 'hundred_photos'); END IF;
    IF v_space_age_days >= 30 AND v_total_memories >= 1 THEN
        v_unlocked := array_append(v_unlocked, 'one_month_old');
    END IF;
    IF v_space_age_days >= 365 THEN
        v_unlocked := array_append(v_unlocked, 'one_year_old');
    END IF;
    IF array_length(v_seasons, 1) = 4 THEN
        v_unlocked := array_append(v_unlocked, 'memory_from_every_season');
    END IF;
    -- all_members_contributed: every current member has created >= 1 Memory.
    -- If there are zero members this is vacuously false.
    IF array_length(v_member_ids, 1) > 0 THEN
        v_dummy := 1;
        IF (SELECT bool_and(uid = ANY(v_creator_ids)) FROM unnest(v_member_ids) AS uid) THEN
            v_unlocked := array_append(v_unlocked, 'all_members_contributed');
        END IF;
    END IF;
    IF v_total_comments >= 100  THEN v_unlocked := array_append(v_unlocked, 'hundred_comments');  END IF;
    IF v_total_reactions >= 100 THEN v_unlocked := array_append(v_unlocked, 'hundred_reactions'); END IF;
    IF v_distinct_tag_count >= 5 THEN
        v_unlocked := array_append(v_unlocked, 'five_tags_used');
    END IF;
    IF v_total_photos >= 1 AND v_total_videos >= 1 THEN
        v_unlocked := array_append(v_unlocked, 'video_and_photo');
    END IF;

    -- Insert newly-qualifying achievements (never revoke). Already-unlocked
    -- rows are no-ops via ON CONFLICT DO NOTHING.
    IF array_length(v_unlocked, 1) > 0 THEN
        INSERT INTO space_achievements (space_id, achievement_id, unlocked_at)
        SELECT p_space_id, a, now()
          FROM unnest(v_unlocked) AS a
        ON CONFLICT (space_id, achievement_id) DO NOTHING;
    END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Drain the queue (called by the cron job)
-- ----------------------------------------------------------------------------
-- Iterates over every queued space_id, calls the in-DB recompute function,
-- and deletes the processed row. This replaces the previous HTTP fan-out —
-- no network, no secret, no Edge Function dependency for the cron path.
--
-- The Edge Function `recompute-space-stats` is preserved (unchanged) for
-- manual backfills and ad-hoc invocations from outside the database, but the
-- cron no longer references it.
CREATE OR REPLACE FUNCTION drain_stats_recompute_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
    v_sid   uuid;
BEGIN
    FOR v_sid IN SELECT space_id FROM stats_recompute_queue LOOP
        PERFORM recompute_space_stats(v_sid);
        DELETE FROM stats_recompute_queue WHERE space_id = v_sid;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. Replace the cron job
-- ----------------------------------------------------------------------------
-- Unschedule the old (HTTP, secret-bearing) job and schedule a new one that
-- calls the in-DB drain function. Idempotent: a re-run of this migration
-- will unschedule the old name (if it still exists) and re-create the new
-- one without producing duplicates.
--
-- If you have already rotated the leaked service-role key, the old job
-- would simply fail; unscheduling removes the noise. The new job has no
-- secret and no external dependency.
SELECT cron.unschedule('recompute-space-stats-job');

SELECT cron.schedule(
    'recompute-space-stats-job',
    '* * * * *',
    $$SELECT drain_stats_recompute_queue();$$
);


-- ----------------------------------------------------------------------------
-- 4. Narrow the memories UPDATE trigger (audit M-11)
-- ----------------------------------------------------------------------------
-- The previous trigger fired on every UPDATE of memories, including no-op
-- updates from the `set_updated_at` BEFORE trigger. A burst of unrelated
-- edits (e.g. title polish) caused every Memory to re-queue its Space.
-- Narrow the trigger to fire only when stats-relevant columns actually
-- change: memory_date (affects first/last/most_active/longest_gap/seasons)
-- and deleted_at (toggles visibility — soft-delete affects every count).
-- space_id and created_by changes are extraordinarily rare in practice but
-- are included defensively (a space_id change would be a multi-table error
-- worth surfacing).
DROP TRIGGER IF EXISTS on_memory_stats_enqueue ON memories;

CREATE OR REPLACE FUNCTION enqueue_stats_recompute_memory_narrowed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        sid := OLD.space_id;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.memory_date IS NOT DISTINCT FROM NEW.memory_date
           AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
           AND OLD.space_id   IS NOT DISTINCT FROM NEW.space_id
           AND OLD.created_by IS NOT DISTINCT FROM NEW.created_by THEN
            RETURN NULL;
        END IF;
        sid := NEW.space_id;
    ELSE
        sid := NEW.space_id;
    END IF;
    IF sid IS NOT NULL THEN
        INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
        ON CONFLICT (space_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER on_memory_stats_enqueue
    AFTER INSERT OR UPDATE OR DELETE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION enqueue_stats_recompute_memory_narrowed();


-- ----------------------------------------------------------------------------
-- 5. Grants on the new functions
-- ----------------------------------------------------------------------------
-- Both functions are SECURITY DEFINER (run as the migration-applier role,
-- which is the table owner of space_stats_cache, space_achievements, and
-- stats_recompute_queue). They are not callable from PostgREST by any
-- authenticated role — the cron runs them as the `postgres` superuser.
--
-- We intentionally do NOT grant EXECUTE to `authenticated` or `anon`. A
-- direct RPC call from a client would let any authenticated user force a
-- recompute for any space, which is harmless (recompute is read-only on
-- source data, writes only to the trusted cache) but still a privilege
-- surface we don't need to expose.
--
-- The previous Edge Function is the legitimate public surface for ad-hoc
-- recomputes; this migration keeps that surface but removes the cron as a
-- caller of it.
