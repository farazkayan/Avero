-- ============================================================================
-- Migration: Fix ambiguous column reference in get_space_mosaic_thumbnails
-- ----------------------------------------------------------------------------
-- Drops and recreates the function with explicit column qualification to
-- avoid ambiguity errors.
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
        SELECT id AS memory_id, space_id
        FROM memories
        WHERE space_id = ANY(p_space_ids)
          AND deleted_at IS NULL
    ),
    space_media AS (
        -- All media rows for those Memories. We will pick the earliest photo
        -- in each Memory (by media.created_at ASC) to represent that Memory.
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
            media.thumbnail_detail_path,
            ROW_NUMBER() OVER (
                PARTITION BY media.memory_id
                ORDER BY media.created_at ASC
            ) AS media_rn
        FROM space_memories sm
        JOIN media ON media.memory_id = sm.memory_id
    ),
    earliest_media AS (
        -- Keep only the earliest photo per Memory.
        SELECT
            space_id,
            id,
            memory_id,
            url,
            storage_path,
            type,
            created_at,
            thumbnail_grid_path,
            thumbnail_path,
            thumbnail_detail_path,
            media_rn
        FROM space_media
        WHERE media_rn = 1
    ),
    ranked_memories AS (
        -- Rank the Memories by their recency (most recently updated first).
        SELECT
            space_id,
            id,
            memory_id,
            url,
            storage_path,
            type,
            created_at,
            thumbnail_grid_path,
            thumbnail_path,
            thumbnail_detail_path,
            media_rn,
            ROW_NUMBER() OVER (
                PARTITION BY space_id
                ORDER BY updated_at DESC
            ) AS memory_rn
        FROM earliest_media
    )
    -- Select up to 3 Memories per Space (one photo per Memory).
    SELECT
        ranked_memories.space_id,
        ranked_memories.id,
        ranked_memories.memory_id,
        ranked_memories.url,
        ranked_memories.storage_path,
        ranked_memories.type,
        ranked_memories.created_at,
        ranked_memories.thumbnail_grid_path,
        ranked_memories.thumbnail_path,
        ranked_memories.thumbnail_detail_path
    FROM ranked_memories
    WHERE ranked_memories.memory_rn <= 3;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;