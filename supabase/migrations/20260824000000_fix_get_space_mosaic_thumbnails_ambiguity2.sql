-- ============================================================================
-- Migration: Fix ambiguous column reference in get_space_mosaic_thumbnails (take 2)
-- ----------------------------------------------------------------------------
-- Drops and recreates the function with fully explicit column selection to
-- avoid any ambiguity.
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
    thumbnail_path      text,
    thumbnail_detail_path text
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
            mem.id AS memory_id,
            mem.space_id
        FROM memories mem
        WHERE mem.space_id = ANY(p_space_ids)
          AND mem.deleted_at IS NULL
    ),
    space_media AS (
        -- All media rows for those Memories. We will pick the earliest photo
        -- in each Memory (by media.created_at ASC) to represent that Memory.
        SELECT
            sm.space_id,
            md.id,
            md.memory_id,
            md.url,
            md.storage_path,
            md.type,
            md.created_at,
            md.thumbnail_grid_path,
            md.thumbnail_path,
            md.thumbnail_detail_path,
            ROW_NUMBER() OVER (
                PARTITION BY md.memory_id
                ORDER BY md.created_at ASC
            ) AS media_rn
        FROM space_memories sm
        JOIN media md ON md.memory_id = sm.memory_id
    ),
    earliest_media AS (
        -- Keep only the earliest photo per Memory.
        SELECT
            sm.space_id,
            sm.id,
            sm.memory_id,
            sm.url,
            sm.storage_path,
            sm.type,
            sm.created_at,
            sm.thumbnail_grid_path,
            sm.thumbnail_path,
            sm.thumbnail_detail_path,
            sm.media_rn
        FROM space_media sm
        WHERE sm.media_rn = 1
    ),
    ranked_memories AS (
        -- Rank the Memories by their recency (most recently updated first).
        SELECT
            em.space_id,
            em.id,
            em.memory_id,
            em.url,
            em.storage_path,
            em.type,
            em.created_at,
            em.thumbnail_grid_path,
            em.thumbnail_path,
            em.thumbnail_detail_path,
            em.media_rn,
            ROW_NUMBER() OVER (
                PARTITION BY em.space_id
                ORDER BY em.updated_at DESC
            ) AS memory_rn
        FROM earliest_media em
    )
    -- Select up to 3 Memories per Space (one photo per Memory).
    SELECT
        rm.space_id,
        rm.id,
        rm.memory_id,
        rm.url,
        rm.storage_path,
        rm.type,
        rm.created_at,
        rm.thumbnail_grid_path,
        rm.thumbnail_path,
        rm.thumbnail_detail_path
    FROM ranked_memories rm
    WHERE rm.memory_rn <= 3;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;