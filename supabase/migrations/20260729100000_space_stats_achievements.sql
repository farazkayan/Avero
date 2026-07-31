-- ============================================================================
-- Migration: Space Statistics & Achievements (SPEC A)
-- ----------------------------------------------------------------------------
-- Adds retrospective, reflective Space-level statistics and an unlockable
-- achievement catalog. This is deliberately NOT gamification:
--   - Stats are precomputed (cached), never live COUNT(*) on every page load
--     (backend-implementation.md §15 future path: "Materialized view or
--     counter cache column" — building a live-count stats feature would be a
--     real performance regression, especially alongside the compression work).
--   - Achievements are written ONLY by a trusted server-side process (the
--     recompute-space-stats Edge Function via the service role). There are
--     NO client-side INSERT/UPDATE/DELETE policies on any of these tables,
--     so a malicious client cannot forge an achievement.
--   - Once an achievement is unlocked it is NEVER revoked, even if the
--     qualifying count later drops (a deleted Memory reduces the count) —
--     achievements are permanent, like real achievements.
--   - No streaks, no "you're 2 away from a badge" prompts, no leaderboards,
--     no notifications. Stats are retrospective and reflective, never
--     actionable "do more" prompts (blueprint §10 "Build for the Memory, Not
--     the Moment", §8 "Every Feature Earns Its Place", and the "Avero Is Not"
--     section: no engagement metrics, no algorithms).
--
-- Tables added:
--   space_stats_cache       — one precomputed stats row per Space
--   achievements            — static catalog, seeded once, not user-editable
--   space_achievements      — join: which Spaces unlocked which achievements
--   stats_recompute_queue   — dirty-flag queue consumed by a pg_cron job
--
-- Recompute flow (see supabase/functions/recompute-space-stats):
--   1. A write to memories/media/comments/reactions/space_members fires a
--      trigger that does INSERT ... ON CONFLICT (space_id) DO NOTHING into
--      stats_recompute_queue (cheap, idempotent — rapid-fire writes coalesce
--      into a single queued row).
--   2. A pg_cron job (every 90s) calls the recompute-space-stats Edge Function
--      for each queued space_id, then deletes the processed rows.
--   3. The Edge Function recomputes stats, upserts space_stats_cache, checks
--      the achievement catalog's unlock conditions, and inserts any newly
--      qualifying rows into space_achievements (never deletes).
--
-- RLS: space_stats_cache and space_achievements are SELECT-only, gated by
-- is_space_member() — same pattern as every other table (database §13:
-- "Users cannot access Spaces they are not members of" — no exception for
-- stats). achievements (the catalog) is SELECTable by any authenticated user
-- (it is static reference data, not Space-private). stats_recompute_queue has
-- NO policies at all — it is only ever touched by triggers (SECURITY DEFINER)
-- and the service role.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Extensions — pg_cron (for the debounced recompute job)
-- ----------------------------------------------------------------------------
-- pg_cron lives in the `extensions` schema on Supabase and must be enabled in
-- the Supabase dashboard (Database → Extensions) OR via the SQL below. The
-- cron schema is `cron` (Supabase pre-creates it). We guard with IF NOT EXISTS
-- so re-running is safe; if the extension is unavailable the CREATE JOB
-- statement below will fail loudly, which is the correct signal that the
-- feature's debounce mechanism needs the extension enabled.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
-- pg_net provides net.http_post, used by the cron job to invoke the
-- recompute-space-stats Edge Function. On Supabase it is pre-installed in the
-- `extensions` schema; the IF NOT EXISTS guard makes this safe to re-run.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ----------------------------------------------------------------------------
-- 1. space_stats_cache
-- ----------------------------------------------------------------------------
-- One row per Space, holding precomputed aggregate stats. Written only by the
-- recompute Edge Function (service role). space_id is both PK and FK — there
-- is exactly one cache row per Space (seeded on Space creation, backfilled for
-- existing Spaces in the backfill step below).
CREATE TABLE space_stats_cache (
    space_id            uuid PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
    total_memories      integer NOT NULL DEFAULT 0,
    total_media         integer NOT NULL DEFAULT 0,
    total_photos        integer NOT NULL DEFAULT 0,
    total_videos        integer NOT NULL DEFAULT 0,
    total_comments      integer NOT NULL DEFAULT 0,
    total_reactions     integer NOT NULL DEFAULT 0,
    member_count        integer NOT NULL DEFAULT 0,
    first_memory_date   date,
    last_memory_date    date,
    most_active_month   text,   -- "YYYY-MM" derived from the memory_date histogram
    most_used_tag_id    uuid REFERENCES tags (id) ON DELETE SET NULL,
    most_used_tag_count integer,
    longest_gap_days    integer, -- longest stretch between consecutive memories
    space_age_days      integer, -- days since space creation
    computed_at         timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 2. achievements (static catalog)
-- ----------------------------------------------------------------------------
-- Seeded once, not user-editable. id is a stable text key (e.g.
-- 'first_memory') so the Edge Function's unlock checks and the frontend can
-- reference achievements by a human-readable, immutable id rather than a
-- surrogate uuid. category drives grouping in the UI; sort_order drives
-- display order within a category.
CREATE TABLE achievements (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL,
    icon        text NOT NULL,   -- icon identifier from the frontend icon system
    category    text NOT NULL CHECK (category IN ('milestone', 'time', 'collaboration', 'variety')),
    sort_order  integer NOT NULL
);


-- ----------------------------------------------------------------------------
-- 3. space_achievements (join)
-- ----------------------------------------------------------------------------
-- Which Spaces have unlocked which achievements, and when. Written only by the
-- recompute Edge Function. Composite PK (space_id, achievement_id) makes each
-- (space, achievement) pair unique and naturally idempotent — re-running the
-- recompute for an already-unlocked achievement is a no-op (ON CONFLICT DO
-- NOTHING in the Edge Function). unlocked_at is permanent: rows are never
-- deleted, even if the qualifying condition later becomes false.
CREATE TABLE space_achievements (
    space_id       uuid REFERENCES spaces (id) ON DELETE CASCADE,
    achievement_id text REFERENCES achievements (id),
    unlocked_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, achievement_id)
);


-- ----------------------------------------------------------------------------
-- 4. stats_recompute_queue (dirty-flag queue)
-- ----------------------------------------------------------------------------
-- A lightweight queue of space_ids whose stats are stale. Triggers insert
-- here idempotently (ON CONFLICT DO NOTHING) so a burst of writes coalesces
-- into a single row. The pg_cron job drains this table. space_id is both PK
-- (so ON CONFLICT works) and FK (cascade when a Space is deleted).
CREATE TABLE stats_recompute_queue (
    space_id  uuid PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
    queued_at timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 5. Seed the achievement catalog (v1 — deliberately small, 12 entries)
-- ----------------------------------------------------------------------------
-- Per SPEC A.2. Expand later only once real usage shows what feels meaningful.
-- Icons reference identifiers consumed by the frontend icon system
-- (components/ui/icons.tsx); the frontend maps each id to a rendered glyph.
-- sort_order is per-category; the UI sorts by (category, sort_order).
INSERT INTO achievements (id, title, description, icon, category, sort_order) VALUES
    -- Milestone
    ('first_memory',        'First Memory',       'Created the Space''s very first Memory.',            'sparkle',     'milestone',     1),
    ('ten_memories',        'Ten Stories',         '10 Memories in the Space.',                          'stack',       'milestone',     2),
    ('fifty_memories',      'Fifty Stories',       '50 Memories in the Space.',                          'stack',       'milestone',     3),
    ('hundred_photos',      'A Hundred Moments',   '100 media items uploaded.',                          'image',       'milestone',     4),
    -- Time
    ('one_month_old',       'One Month In',        'The Space is 30+ days old with at least 1 Memory.',   'calendar',    'time',          1),
    ('one_year_old',        'A Year of Memories',  'The Space is 365+ days old.',                         'calendar',    'time',          2),
    ('memory_from_every_season', 'Every Season',   'Memories in all four meteorological seasons.',        'leaf',        'time',          3),
    -- Collaboration
    ('all_members_contributed', 'Everyone''s Story', 'Every current member has created at least 1 Memory.', 'people',    'collaboration', 1),
    ('hundred_comments',   'Lots to Say',         '100 comments across the Space.',                      'chat',        'collaboration', 2),
    ('hundred_reactions',   'Well Loved',          '100 reactions across the Space.',                     'heart',       'collaboration', 3),
    -- Variety
    ('five_tags_used',      'Well Organized',      '5+ distinct tags used.',                              'tag',         'variety',       1),
    ('video_and_photo',     'Moving Pictures',     'At least 1 photo and 1 video.',                       'film',        'variety',       2)
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 6. Enable RLS
-- ----------------------------------------------------------------------------
-- Per database §11.2: "RLS enabled on every table — no exceptions."
-- stats_recompute_queue gets RLS enabled too, but with NO policies — so it is
-- unreachable from PostgREST by any role (only triggers + service role touch
-- it). This is the secure default: deny by default.
ALTER TABLE space_stats_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_achievements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats_recompute_queue  ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 7. RLS policies
-- ----------------------------------------------------------------------------
-- space_stats_cache: SELECT only, gated by is_space_member(). No
-- INSERT/UPDATE/DELETE policies — written only by the service role (which
-- bypasses RLS) via the recompute Edge Function. This is the anti-forgery
-- guarantee: a client cannot write its own stats.
DROP POLICY IF EXISTS space_stats_cache_select ON space_stats_cache;
CREATE POLICY space_stats_cache_select
    ON space_stats_cache
    FOR SELECT
    TO authenticated
    USING (is_space_member(space_id));

-- space_achievements: SELECT only, gated by is_space_member(). Same rationale.
DROP POLICY IF EXISTS space_achievements_select ON space_achievements;
CREATE POLICY space_achievements_select
    ON space_achievements
    FOR SELECT
    TO authenticated
    USING (is_space_member(space_id));

-- achievements (catalog): SELECT for any authenticated user. It is static
-- reference data (titles, descriptions, icons) — not Space-private. Every
-- authenticated user can read the catalog so the frontend can render locked
-- achievements' titles without a per-Space round trip.
DROP POLICY IF EXISTS achievements_select ON achievements;
CREATE POLICY achievements_select
    ON achievements
    FOR SELECT
    TO authenticated
    USING (true);

-- stats_recompute_queue: NO policies. Deny by default. Only triggers
-- (SECURITY DEFINER) and the service role touch it.


-- ----------------------------------------------------------------------------
-- 8. Grants
-- ----------------------------------------------------------------------------
-- SELECT only on the three readable tables (RLS still gates rows). No
-- INSERT/UPDATE/DELETE grants — the client must not be able to write stats or
-- achievements. stats_recompute_queue gets NO grants to authenticated (it is
-- not read by the API at all).
GRANT SELECT ON space_stats_cache  TO authenticated;
GRANT SELECT ON achievements       TO authenticated;
GRANT SELECT ON space_achievements TO authenticated;


-- ----------------------------------------------------------------------------
-- 9. Trigger function: enqueue a Space for stats recompute
-- ----------------------------------------------------------------------------
-- A single SECURITY DEFINER trigger function used by every stats-affecting
-- table. It inserts the affected space_id into stats_recompute_queue,
-- idempotently (ON CONFLICT DO NOTHING) so a burst of writes coalesces into one
-- queued row. The function is generic: it reads the space_id from NEW (for
-- INSERT) or OLD (for DELETE) via the appropriate column for each table.
--
-- Because it is SECURITY DEFINER with a pinned search_path, it bypasses the
-- caller's RLS and can always see the space_id — which is correct, because the
-- queue is an internal implementation detail, not user-facing data.
--
-- Note: this function does NOT attach triggers itself; the per-table trigger
-- attachments below choose the right column (NEW.space_id vs OLD.space_id, or
-- the memory_id -> space_id resolution for child tables).
CREATE OR REPLACE FUNCTION enqueue_stats_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- The caller (per-table trigger) sets a session variable
    -- app.recompute_space_id before invoking this function via EXECUTE, OR we
    -- resolve it here from NEW/OLD. To keep this generic and simple, each
    -- per-table trigger function below resolves the space_id itself and
    -- inserts directly. This stub is kept for documentation but the actual
    -- enqueue logic lives in the per-table functions below.
    RETURN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- 9a. Per-table enqueue trigger functions
-- ----------------------------------------------------------------------------
-- Each function resolves the affected space_id from its row(s) and inserts
-- into stats_recompute_queue. For child tables (media, comments, reactions,
-- memory_tags) the space_id is reached through the parent memory; for
-- space_members it is the row's own space_id.

-- memories: space_id is a direct column.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_memory()
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

-- media: resolve space_id through the parent memory. A media row only ever
-- belongs to one memory, which belongs to one space.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    mid uuid;
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        mid := OLD.memory_id;
    ELSE
        mid := NEW.memory_id;
    END IF;
    IF mid IS NOT NULL THEN
        SELECT space_id INTO sid FROM memories WHERE id = mid;
        IF sid IS NOT NULL THEN
            INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
            ON CONFLICT (space_id) DO NOTHING;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

-- comments: resolve space_id through the parent memory.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    mid uuid;
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        mid := OLD.memory_id;
    ELSE
        mid := NEW.memory_id;
    END IF;
    IF mid IS NOT NULL THEN
        SELECT space_id INTO sid FROM memories WHERE id = mid;
        IF sid IS NOT NULL THEN
            INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
            ON CONFLICT (space_id) DO NOTHING;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

-- reactions: resolve space_id through the parent memory.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    mid uuid;
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        mid := OLD.memory_id;
    ELSE
        mid := NEW.memory_id;
    END IF;
    IF mid IS NOT NULL THEN
        SELECT space_id INTO sid FROM memories WHERE id = mid;
        IF sid IS NOT NULL THEN
            INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
            ON CONFLICT (space_id) DO NOTHING;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

-- space_members: space_id is a direct column. Membership changes affect the
-- member_count stat and the all_members_contributed achievement.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_member()
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


-- ----------------------------------------------------------------------------
-- 9b. Attach the triggers (AFTER INSERT / DELETE, FOR EACH ROW)
-- ----------------------------------------------------------------------------
-- AFTER (not BEFORE) so the row exists for any FK resolution the functions do.
-- DELETE is included so removing a Memory/comment/reaction/member marks stats
-- stale (the recompute will then re-evaluate achievement conditions — though
-- unlocked achievements are never revoked, the cached counts update).
-- UPDATE is intentionally NOT triggered: the stats-affecting columns (counts,
-- membership) change via INSERT/DELETE, not UPDATE. memory_date can change on
-- Memory edit, which affects most_active_month / seasons / gaps — so we DO
-- trigger on memories UPDATE as well, but only for that table.

DROP TRIGGER IF EXISTS on_memory_stats_enqueue ON memories;
CREATE TRIGGER on_memory_stats_enqueue
    AFTER INSERT OR UPDATE OR DELETE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION enqueue_stats_recompute_memory();

DROP TRIGGER IF EXISTS on_media_stats_enqueue ON media;
CREATE TRIGGER on_media_stats_enqueue
    AFTER INSERT OR DELETE ON media
    FOR EACH ROW
    EXECUTE FUNCTION enqueue_stats_recompute_media();

DROP TRIGGER IF EXISTS on_comment_stats_enqueue ON comments;
CREATE TRIGGER on_comment_stats_enqueue
    AFTER INSERT OR DELETE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION enqueue_stats_recompute_comment();

DROP TRIGGER IF EXISTS on_reaction_stats_enqueue ON reactions;
CREATE TRIGGER on_reaction_stats_enqueue
    AFTER INSERT OR DELETE ON reactions
    FOR EACH ROW
    EXECUTE FUNCTION enqueue_stats_recompute_reaction();

DROP TRIGGER IF EXISTS on_space_member_stats_enqueue ON space_members;
CREATE TRIGGER on_space_member_stats_enqueue
    AFTER INSERT OR DELETE ON space_members
    FOR EACH ROW
    EXECUTE FUNCTION enqueue_stats_recompute_member();


-- ----------------------------------------------------------------------------
-- 10. Seed a stats cache row on Space creation
-- ----------------------------------------------------------------------------
-- A new Space should have an empty stats row immediately so the Stats page
-- never shows a "missing cache" state for a brand-new Space. This runs in the
-- same transaction as the Space insert (AFTER INSERT trigger).
CREATE OR REPLACE FUNCTION handle_new_space_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO space_stats_cache (space_id, space_age_days)
    VALUES (NEW.id, 0)
    ON CONFLICT (space_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_space_created_stats ON spaces;
CREATE TRIGGER on_space_created_stats
    AFTER INSERT ON spaces
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_space_stats();


-- ----------------------------------------------------------------------------
-- 11. Backfill: seed stats cache rows for all existing Spaces
-- ----------------------------------------------------------------------------
-- Current Avero users must not see an empty stats page for already-populated
-- Spaces after this ships. This inserts an empty cache row for every existing
-- Space that lacks one. The actual numbers are filled in by the first
-- recompute run (the pg_cron job will pick these up if we also enqueue them,
-- which we do next).
INSERT INTO space_stats_cache (space_id, space_age_days)
SELECT
    s.id,
    GREATEST(0, EXTRACT(day FROM (now() - s.created_at))::integer) AS space_age_days
FROM spaces s
WHERE NOT EXISTS (
    SELECT 1 FROM space_stats_cache c WHERE c.space_id = s.id
)
ON CONFLICT (space_id) DO NOTHING;

-- Enqueue every existing Space for an immediate recompute so the backfilled
-- rows get real numbers on the first cron tick, not just zeros.
INSERT INTO stats_recompute_queue (space_id)
SELECT id FROM spaces
ON CONFLICT (space_id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 12. pg_cron job: drain the recompute queue every minute
-- ----------------------------------------------------------------------------
-- Calls the recompute-space-stats Edge Function for each queued Space. The
-- Edge Function is invoked via pg_net's net.http_post against the project's
-- Edge Functions endpoint, authenticated with the service-role secret key.
--
-- IMPORTANT — why the URL and key are HARDCODED here (do not "fix" this):
--   The original approach stored these in database-level GUCs
--   (ALTER DATABASE postgres SET app.edge_functions_url / app.service_role_key)
--   and read them with current_setting('app.*', true). That does NOT work on
--   Supabase managed Postgres: setting custom GUCs returns
--   "permission denied to set parameter". So the URL and the service-role
--   secret key are intentionally inlined into the job's SQL body. This is the
--   confirmed-working approach — persisting it here means a fresh `supabase db
--   push` recreates a WORKING job, not a broken one. If the service-role key
--   is ever rotated, this job must be updated to match (and the Edge Function
--   reads the same key from its SUPABASE_SERVICE_ROLE_KEY env var, which is
--   managed by the Supabase platform).
--
-- Auth key: this project's Edge Function compares the bearer token against
-- Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), which on THIS project holds the
-- new-style secret key (sb_secret_...), NOT the legacy JWT (eyJ...). The
-- legacy JWT is rejected with 403. So the cron job must send the sb_secret_
-- key — which is what is hardcoded below.
--
-- Guaranteed-execution SQL pattern (the subtle bug this avoids):
--   net.http_post is invoked inside a CTE aliased `posted`. Postgres is
--   permitted to skip evaluating a CTE that is never referenced by the final
--   statement. An earlier version had the final DELETE read FROM an earlier
--   `queued` CTE instead of FROM `posted`, so the http_post CTE was never
--   referenced and silently never fired — the job reported "succeeded" while
--   no HTTP request was ever made. The DELETE here reads FROM posted, which
--   forces the posted CTE (and therefore net.http_post) to evaluate. This
--   also guarantees we only delete queue rows that were genuinely included in
--   a posted request (delete-only-after-a-real-post), never blindly.
--
-- The job runs as the `postgres` superuser (cron.schedule requires it), which
-- bypasses RLS — appropriate for an internal maintenance task.
--
-- Schedule: '* * * * *' (every minute). The debounce goal is "not on every
-- write" — minute granularity already coalesces a burst of writes into a
-- single recompute. 5-field cron is supported by every pg_cron version.
--
-- Idempotency: we UNSCHEDULE any existing job of the same name first, so
-- re-running this migration (or a fresh db push) never creates duplicate
-- jobs. (Duplicate stale jobs have repeatedly masked the real job's behavior
-- during debugging — this guard prevents that class of regression.)
SELECT cron.unschedule('recompute-space-stats-job');

SELECT cron.schedule(
    'recompute-space-stats-job',
    '* * * * *',
    $$
    WITH queued AS (
        SELECT space_id FROM stats_recompute_queue
    ),
    posted AS (
        SELECT
            q.space_id,
            net.http_post(
                url     := 'https://lvsgaqykefkvsbnkglpg.functions.supabase.co/recompute-space-stats',
                headers := jsonb_build_object(
                    'Content-Type',  'application/json',
                    'Authorization', 'Bearer sb_secret_cNblx_Jlmq00i0XJpjEqBA_kK4JY-RX'
                ),
                body    := jsonb_build_object('space_id', q.space_id)
            ) AS request_id
        FROM queued q
    )
    -- Delete only the queue rows that were included in a posted request.
    -- Reading FROM posted (not FROM queued) forces the posted CTE to evaluate,
    -- guaranteeing net.http_post actually fires. net.http_post is async
    -- (returns immediately), so we delete on the same tick; the function is
    -- idempotent and re-enqueues on the next relevant write if a POST is lost.
    DELETE FROM stats_recompute_queue
    WHERE space_id IN (SELECT space_id FROM posted);
    $$
);
