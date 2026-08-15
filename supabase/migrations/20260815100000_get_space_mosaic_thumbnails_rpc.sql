-- ============================================================================
-- Migration: get_space_mosaic_thumbnails RPC function
-- ----------------------------------------------------------------------------
-- Returns up to 3 most recent media rows across ALL Memories in each requested
-- Space, ordered by media.created_at DESC (newest first — so the mosaic shows
-- the latest photos added to the Space).
--
-- Used by the Spaces Dashboard (SpacesDashboardPage) to show a multi-photo
-- mosaic on each Space card, giving a richer "alive" preview than the single
-- Space list thumbnail. The per-Space LIMIT (up to 3 rows across all Memories)
-- is the bandwidth mitigation available today; a proper thumbnail/small-size
-- image variant generated at upload time (the "media web optimizer" TODO) is a
-- flagged follow-up, still out of scope here.
--
-- WHY A NEW RPC (not a reuse of get_space_list_thumbnails):
--   get_space_list_thumbnails returns only the first 1–2 media rows of the
--   SINGLE most recent Memory per Space. The Dashboard mosaic needs up to 3
--   photos drawn from ALL Memories in the Space (not just the latest one),
--   ordered by recency across the entire Space. This is a fundamentally
--   different query shape (no "latest Memory" CTE, just a flat partition by
--   space_id across all media in that Space's memories). A new RPC keeps the
--   concerns clean and leaves the existing Space list thumbnail RPC untouched.
--   It mirrors that RPC's spirit (per-group LIMIT via ROW_NUMBER, SECURITY
--   INVOKER, RLS-gated, returns durable B2 keys — client presigns per
--   thumbnail).
--
-- SECURITY — SECURITY INVOKER (not DEFINER):
--   This is a READ-ONLY helper. SECURITY INVOKER means the function executes
--   with the *caller's* privileges, so the existing `memories_select` and
--   `media_select` RLS policies filter the returned rows exactly as plain
--   selects would. A non-member receives zero rows for that Space — the same
--   calm "not found or no access" path as the other thumbnail RPCs.
--   SECURITY DEFINER would be WRONG here: it bypasses RLS, which is only
--   appropriate when the function must read tables the caller cannot (e.g.
--   is_space_member itself, which would be circular under INVOKER). This
--   function only reads `memories` and `media`, which the caller is already
--   authorized to read via the select policies, so INVOKER is correct and safe.
--
--   An explicit auth.uid() IS NULL guard is added up front for a clear error
--   if called unauthenticated, but the real authorization gate is RLS on the
--   returned rows (a non-member gets an empty result, not an error).
--
--   SET search_path = public: standard hardening (matches is_space_member /
--   sync_memory_tags / get_timeline_thumbnails / get_space_list_thumbnails),
--   prevents search-path-based privilege escalation even under INVOKER.
--
-- Returns: up to 3 media rows per requested space_id (space_id, id, memory_id,
--   url, storage_path, type, created_at, thumbnail_grid_path, thumbnail_path).
--   The client groups by space_id and resolves short-lived presigned GET URLs
--   per thumbnail via getMediaDownloadUrl (mirrors MediaGallery / the timeline
--   thumbnail) — this RPC returns durable B2 object keys, NOT presigned URLs.
--   The client prefers thumbnail_grid_path > thumbnail_path > url for the
--   mosaic display.
--
-- Source of truth: plans/avero-full-visual-redesign-integration.md §3.2
-- ============================================================================

CREATE OR REPLACE FUNCTION get_space_mosaic_thumbnails(p_space_ids uuid[])
RETURNS TABLE (
    space_id            uuid,
    id                  uuid,
    memory_id           uuid,
    url                 text,
    storage_path        text,
    type                text,
    created_at          timestamptz,
    thumbnail_grid_path text,
    thumbnail_path      text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Authentication guard. The real authorization gate is memories_select +
    -- media_select RLS (is_space_member via the parent memory's space), which
    -- filter the returned rows under SECURITY INVOKER. This guard just gives a
    -- clear error for an unauthenticated call rather than an empty result.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_space_mosaic_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    WITH space_memories AS (
        -- All non-deleted Memories in the requested Spaces. RLS on `memories`
        -- (memories_select: is_space_member OR created_by = auth.uid, AND
        -- deleted_at IS NULL) auto-filters here under SECURITY INVOKER, so a
        -- non-member gets no rows and soft-deleted Memories are excluded.
        SELECT id AS memory_id, space_id
        FROM memories
        WHERE space_id = ANY(p_space_ids)
          AND deleted_at IS NULL
    ),
    space_media AS (
        -- All media rows for those Memories, newest-first (so the mosaic shows
        -- the most recent photos added to the Space). RLS on `media`
        -- (media_select: is_space_member via the parent memory's space)
        -- auto-filters here too.
        SELECT
            sm.space_id,
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.type,
            media.created_at,
            media.thumbnail_grid_path,
            media.thumbnail_path,
            ROW_NUMBER() OVER (
                PARTITION BY sm.space_id
                ORDER BY media.created_at DESC
            ) AS rn
        FROM space_memories sm
        JOIN media ON media.memory_id = sm.memory_id
    )
    -- Fully qualify every column with the `space_media` alias. A PL/pgSQL
    -- function declared with `RETURNS TABLE (...)` exposes each output column
    -- as a PL/pgSQL variable in the function body, so an unqualified SELECT
    -- would be ambiguous between the OUT variable and the table column.
    -- Qualifying with the CTE alias resolves it — the same pattern the working
    -- get_timeline_thumbnails and get_space_list_thumbnails RPCs use.
    SELECT
        space_media.space_id,
        space_media.id,
        space_media.memory_id,
        space_media.url,
        space_media.storage_path,
        space_media.type,
        space_media.created_at,
        space_media.thumbnail_grid_path,
        space_media.thumbnail_path
    FROM space_media
    WHERE space_media.rn <= 3;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;