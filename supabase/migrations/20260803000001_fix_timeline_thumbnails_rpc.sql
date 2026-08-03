-- ============================================================================
-- Migration: Fix get_timeline_thumbnails RPC to return thumbnail variant columns
-- ----------------------------------------------------------------------------
-- The RPC currently returns url and storage_path but NOT the new
-- thumbnail_grid_path and thumbnail_detail_path columns added in
-- 20260801000000_add_thumbnail_variants.sql. This causes the client to fall
-- back to the full-resolution original (url/storage_path) instead of using
-- the small WebP grid thumbnails.
--
-- This migration updates the RPC to include the new thumbnail columns so
-- MemoryThumbnail.tsx can use thumbnail_grid_path for ~15-40KB WebP thumbnails
-- instead of 134-141KB full-resolution images.
--
-- NOTE: We must DROP the function first because CREATE OR REPLACE FUNCTION
-- cannot change the RETURNS TABLE column list (SQLSTATE 42P13). This follows
-- the same pattern as 20260724120000_fix_get_space_list_thumbnails_ambiguity.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS get_timeline_thumbnails(uuid[]);

CREATE OR REPLACE FUNCTION get_timeline_thumbnails(p_memory_ids uuid[])
RETURNS TABLE (
    id uuid,
    memory_id uuid,
    url text,
    storage_path text,
    thumbnail_grid_path text,
    thumbnail_detail_path text,
    type text,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Authentication guard. The real authorization gate is media_select RLS
    -- (is_space_member via the parent memory's space), which filters the
    -- returned rows under SECURITY INVOKER. This guard just gives a clear
    -- error for an unauthenticated call rather than an empty result.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_timeline_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    SELECT m.id, m.memory_id, m.url, m.storage_path, m.thumbnail_grid_path, m.thumbnail_detail_path, m.type, m.created_at
    FROM (
        SELECT
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.thumbnail_grid_path,
            media.thumbnail_detail_path,
            media.type,
            media.created_at,
            ROW_NUMBER() OVER (
                PARTITION BY media.memory_id
                ORDER BY media.created_at ASC
            ) AS rn
        FROM media
        WHERE media.memory_id = ANY(p_memory_ids)
    ) m
    WHERE m.rn <= 2;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_invitation_by_token grant pattern (anon is NOT granted — thumbnails are
-- only for signed-in Space members).
REVOKE ALL ON FUNCTION get_timeline_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;