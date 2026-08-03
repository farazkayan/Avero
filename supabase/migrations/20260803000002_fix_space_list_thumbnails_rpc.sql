-- ============================================================================
-- Migration: Fix get_space_list_thumbnails RPC to return thumbnail variant columns
-- ----------------------------------------------------------------------------
-- The RPC currently returns url and storage_path but NOT the new
-- thumbnail_grid_path and thumbnail_detail_path columns added in
-- 20260801000000_add_thumbnail_variants.sql. This causes the client to fall
-- back to the full-resolution original (url/storage_path) instead of using
-- the small WebP grid thumbnails.
--
-- This migration updates the RPC to include the new thumbnail columns so
-- SpaceCard.tsx (via MemoryThumbnail) can use thumbnail_grid_path for
-- ~15-40KB WebP thumbnails instead of 134-141KB full-resolution images.
--
-- NOTE: We must DROP the function first because CREATE OR REPLACE FUNCTION
-- cannot change the RETURNS TABLE column list (SQLSTATE 42P13). This follows
-- the same pattern as 20260724120000_fix_get_space_list_thumbnails_ambiguity.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS get_space_list_thumbnails(uuid[]);

CREATE OR REPLACE FUNCTION get_space_list_thumbnails(p_space_ids uuid[])
RETURNS TABLE (
    space_id     uuid,
    id           uuid,
    memory_id    uuid,
    url          text,
    storage_path text,
    thumbnail_grid_path text,
    thumbnail_detail_path text,
    type         text,
    created_at   timestamptz
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
        RAISE EXCEPTION 'get_space_list_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    WITH latest_memory AS (
        -- The single most recent Memory per Space, mirroring the timeline's
        -- ordering (memory_date DESC, created_at DESC tiebreaker). RLS on
        -- `memories` (memories_select: is_space_member OR created_by = auth.uid,
        -- AND deleted_at IS NULL) auto-filters here under SECURITY INVOKER, so
        -- a non-member gets no rows and soft-deleted Memories are excluded.
        SELECT lm.space_id, lm.memory_id
        FROM (
            SELECT
                memories.space_id,
                memories.id AS memory_id,
                ROW_NUMBER() OVER (
                    PARTITION BY memories.space_id
                    ORDER BY memories.memory_date DESC, memories.created_at DESC
                ) AS rn
            FROM memories
            WHERE memories.space_id = ANY(p_space_ids)
        ) lm
        WHERE lm.rn = 1
    ),
    top_media AS (
        -- The first 1–2 media rows of that one Memory, oldest-first (matches
        -- the gallery's reading order, same as get_timeline_thumbnails). RLS on
        -- `media` (media_select: is_space_member via the parent memory's space)
        -- auto-filters here too.
        SELECT
            latest_memory.space_id,
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.thumbnail_grid_path,
            media.thumbnail_detail_path,
            media.type,
            media.created_at,
            ROW_NUMBER() OVER (
                PARTITION BY latest_memory.space_id
                ORDER BY media.created_at ASC
            ) AS mrn
        FROM latest_memory
        JOIN media ON media.memory_id = latest_memory.memory_id
    )
    -- Fully qualify every column with the `top_media` alias. A PL/pgSQL function
    -- declared with `RETURNS TABLE (...)` exposes each output column (space_id,
    -- id, memory_id, url, storage_path, type, created_at) as a PL/pgSQL variable
    -- in the function body, so an unqualified `SELECT space_id, ...` is ambiguous
    -- between the OUT variable and the table column ("column reference 'space_id' is
    -- ambiguous"). Qualifying with the CTE alias resolves it — the same pattern
    -- the working get_timeline_thumbnails RPC uses (it qualifies with `m.`).
    SELECT
        top_media.space_id,
        top_media.id,
        top_media.memory_id,
        top_media.url,
        top_media.storage_path,
        top_media.thumbnail_grid_path,
        top_media.thumbnail_detail_path,
        top_media.type,
        top_media.created_at
    FROM top_media
    WHERE top_media.mrn <= 2;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space list
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;