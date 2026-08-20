-- ============================================================================
-- Migration: Force grants for all thumbnail RPCs
-- ----------------------------------------------------------------------------
-- Explicitly grant execute to both authenticated and anon roles
-- ============================================================================

-- Grant for get_space_mosaic_thumbnails
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO anon;

-- Grant for get_memory_mosaic_thumbnails
GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO anon;

-- Grant for get_timeline_thumbnails
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO anon;

-- Grant for get_space_list_thumbnails
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO anon;