-- ============================================================================
-- Migration: Grant execute on get_space_mosaic_thumbnails
-- ----------------------------------------------------------------------------
-- The previous migration dropped and recreated the function, which removes
-- all grants. This migration re-applies the necessary grants.
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO anon;