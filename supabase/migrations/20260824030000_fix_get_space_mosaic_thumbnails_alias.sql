-- ============================================================================
-- Migration: Fix ambiguous column reference by qualifying with CTE alias
-- ----------------------------------------------------------------------------
-- Qualifies all column references in the final SELECT with the CTE alias to
-- avoid any ambiguity between PL/pgSQL variables and table columns.
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
    WITH ranked AS (
        SELECT
            m.space_id,
            m.updated_at AS memory_updated_at,
            md.id,
            md.memory_id,
            md.url,
            md.storage_path,
            md.type,
            md.created_at,
            md.thumbnail_grid_path,
            md.thumbnail_path,
            md.thumbnail_detail_path,
            -- Rank media within each memory by created_at ASC (earliest first)
            ROW_NUMBER() OVER (
                PARTITION BY md.memory_id
                ORDER BY md.created_at ASC
            ) AS media_rn,
            -- Rank memories by updated_at DESC (most recent first)
            ROW_NUMBER() OVER (
                PARTITION BY m.id
                ORDER BY m.updated_at DESC
            ) AS memory_rn
        FROM memories m
        JOIN media md ON md.memory_id = m.id
        WHERE m.space_id = ANY(p_space_ids)
          AND m.deleted_at IS NULL
    )
    -- Select the earliest media (media_rn = 1) for the top 3 memories (memory_rn <= 3).
    SELECT
        ranked.space_id,
        ranked.id,
        ranked.memory_id,
        ranked.url,
        ranked.storage_path,
        ranked.type,
        ranked.created_at,
        ranked.thumbnail_grid_path,
        ranked.thumbnail_path,
        ranked.thumbnail_detail_path
    FROM ranked
    WHERE ranked.media_rn = 1
      AND ranked.memory_rn <= 3;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;