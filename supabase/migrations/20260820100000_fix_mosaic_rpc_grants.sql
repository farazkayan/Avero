-- ============================================================================
-- Migration: Fix grants for mosaic thumbnail RPCs
-- ----------------------------------------------------------------------------
-- The GRANT statements in 20260815100000 and 20260815100001 may not have
-- executed successfully on the remote database. This migration re-applies
-- the necessary grants so the authenticated role can execute these functions.
-- ============================================================================

-- Fix grants for get_space_mosaic_thumbnails
REVOKE ALL ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;

-- Fix grants for get_memory_mosaic_thumbnails
REVOKE ALL ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO authenticated;

-- Also ensure the older thumbnail RPCs have correct grants (defensive)
REVOKE ALL ON FUNCTION get_timeline_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;