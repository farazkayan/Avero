-- ============================================================================
-- Migration: Fix get_space_mosaic_thumbnails - correct memory ranking
-- ----------------------------------------------------------------------------
-- The previous fix (20260824020000) had a bug: the second window function
-- partitioned by m.id (memory_id), which means each partition has exactly
-- 1 row, so memory_rn is always 1. This returned one photo per ALL memories
-- instead of the top 3 most recently updated memories.
--
-- Correct logic:
-- 1. First, rank memories within each space by updated_at DESC (memory_rank)
-- 2. Then, for the top 3 memories, get the earliest media (media_rn = 1)
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
    WITH ranked_memories AS (
        -- Rank memories within each space by updated_at DESC (most recent first)
        SELECT
            m.id AS memory_id,
            m.space_id,
            m.updated_at,
            ROW_NUMBER() OVER (
                PARTITION BY m.space_id
                ORDER BY m.updated_at DESC
            ) AS memory_rank
        FROM memories m
        WHERE m.space_id = ANY(p_space_ids)
          AND m.deleted_at IS NULL
    ),
    ranked_media AS (
        -- For the top 3 memories per space, get the earliest media in each
        SELECT
            rm.space_id,
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
        FROM ranked_memories rm
        JOIN media md ON md.memory_id = rm.memory_id
        WHERE rm.memory_rank <= 3
    )
    SELECT
        ranked_media.space_id,
        ranked_media.id,
        ranked_media.memory_id,
        ranked_media.url,
        ranked_media.storage_path,
        ranked_media.type,
        ranked_media.created_at,
        ranked_media.thumbnail_grid_path,
        ranked_media.thumbnail_path,
        ranked_media.thumbnail_detail_path
    FROM ranked_media
    WHERE ranked_media.media_rn = 1;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;