-- ============================================================================
-- Migration: Simple grants for all thumbnail RPCs
-- ----------------------------------------------------------------------------
-- Direct GRANT statements without DO block to ensure they execute.
-- ============================================================================

-- Grant for get_space_mosaic_thumbnails
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;

-- Grant for get_memory_mosaic_thumbnails
GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO authenticated;

-- Grant for get_timeline_thumbnails
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;

-- Grant for get_space_list_thumbnails
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;