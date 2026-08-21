-- ============================================================================
-- Migration: Fix get_space_mosaic_thumbnails ambiguous column reference
-- ----------------------------------------------------------------------------
-- The function get_space_mosaic_thumbnails has an ambiguous column reference
-- (PostgreSQL error 42702) when invoked. This is the same class of bug that
-- affected get_space_list_thumbnails (fixed in 20260724120000 and
-- 20260803000002): a PL/pgSQL function declared with RETURNS TABLE exposes
-- each output column as a variable in the function body, so any unqualified
-- column reference in the query body that matches an OUT parameter name is
-- ambiguous between the variable and the table/CTE column.
--
-- The original migration (20260815100000) attempted to qualify columns with
-- the `space_media` CTE alias in the final SELECT, but the ambiguity can also
-- occur in the CTE definitions themselves if column names match OUT parameters.
--
-- Fix: Drop and recreate the function with all column references in CTEs and
-- the final SELECT fully qualified with their CTE/table aliases. This follows
-- the exact same pattern used to fix get_space_list_thumbnails in
-- 20260724120000 and 20260803000002.
-- ============================================================================

DROP FUNCTION IF EXISTS get_space_mosaic_thumbnails(uuid[]);

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
        SELECT
            memories.id AS memory_id,
            memories.space_id
        FROM memories
        WHERE memories.space_id = ANY(p_space_ids)
          AND memories.deleted_at IS NULL
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