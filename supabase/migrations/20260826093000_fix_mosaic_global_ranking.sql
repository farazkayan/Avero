-- ============================================================================
-- Migration: Fix get_space_mosaic_thumbnails - 3 most recent images from distinct memories
-- ----------------------------------------------------------------------------
-- Returns up to 3 photos, each from a distinct Memory, ordered by the media's
-- recency (most recent media first). For each Memory, we select the most recent
-- photo (by media.created_at DESC).
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
    WITH ranked_media AS (
        -- All media rows for memories in the requested Spaces, newest-first.
        -- RLS on memories (memories_select) and media (media_select) auto-filters
        -- under SECURITY INVOKER.
        SELECT
            m.space_id,
            md.id,
            md.memory_id,
            md.url,
            md.storage_path,
            md.type,
            md.created_at,
            md.thumbnail_grid_path,
            md.thumbnail_path,
            md.thumbnail_detail_path,
            -- Rank media within each memory by created_at DESC (newest first)
            ROW_NUMBER() OVER (
                PARTITION BY md.memory_id
                ORDER BY md.created_at DESC
            ) AS media_rn,
            -- Rank all media globally by created_at DESC (newest first)
            ROW_NUMBER() OVER (
                PARTITION BY m.space_id
                ORDER BY md.created_at DESC
            ) AS global_rn
        FROM memories m
        JOIN media md ON md.memory_id = m.id
        WHERE m.space_id = ANY(p_space_ids)
          AND m.deleted_at IS NULL
    )
    -- Select the newest media (media_rn = 1) for each memory, then take top 3 globally
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
    WHERE ranked_media.media_rn = 1
    ORDER BY ranked_media.global_rn
    LIMIT 3;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;