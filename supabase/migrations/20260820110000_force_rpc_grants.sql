-- ============================================================================
-- Migration: Force grants for all thumbnail RPCs
-- ----------------------------------------------------------------------------
-- The previous grant migration may not have executed the GRANT statements
-- properly. This migration explicitly re-grants EXECUTE on all thumbnail
-- RPC functions to the authenticated role.
-- ============================================================================

-- Ensure functions exist first (they should from earlier migrations)
-- Then grant execute to authenticated role

DO $$
BEGIN
    -- Grant for get_space_mosaic_thumbnails
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'get_space_mosaic_thumbnails' 
        AND proargtypes[0] = 'uuid[]'::regtype
    ) THEN
        EXECUTE 'REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated';
        RAISE NOTICE 'Granted execute on get_space_mosaic_thumbnails to authenticated';
    ELSE
        RAISE NOTICE 'Function get_space_mosaic_thumbnails(uuid[]) does not exist';
    END IF;

    -- Grant for get_memory_mosaic_thumbnails
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'get_memory_mosaic_thumbnails' 
        AND proargtypes[0] = 'uuid[]'::regtype
    ) THEN
        EXECUTE 'REVOKE ALL ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO authenticated';
        RAISE NOTICE 'Granted execute on get_memory_mosaic_thumbnails to authenticated';
    ELSE
        RAISE NOTICE 'Function get_memory_mosaic_thumbnails(uuid[]) does not exist';
    END IF;

    -- Grant for get_timeline_thumbnails
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'get_timeline_thumbnails' 
        AND proargtypes[0] = 'uuid[]'::regtype
    ) THEN
        EXECUTE 'REVOKE ALL ON FUNCTION get_timeline_thumbnails(uuid[]) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated';
        RAISE NOTICE 'Granted execute on get_timeline_thumbnails to authenticated';
    ELSE
        RAISE NOTICE 'Function get_timeline_thumbnails(uuid[]) does not exist';
    END IF;

    -- Grant for get_space_list_thumbnails
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'get_space_list_thumbnails' 
        AND proargtypes[0] = 'uuid[]'::regtype
    ) THEN
        EXECUTE 'REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC';
        EXECUTE 'GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated';
        RAISE NOTICE 'Granted execute on get_space_list_thumbnails to authenticated';
    ELSE
        RAISE NOTICE 'Function get_space_list_thumbnails(uuid[]) does not exist';
    END IF;
END $$;