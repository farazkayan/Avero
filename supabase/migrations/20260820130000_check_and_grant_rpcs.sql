-- ============================================================================
-- Migration: Check function existence and grant execute
-- ----------------------------------------------------------------------------
-- This migration checks if the functions exist and grants execute permission.
-- ============================================================================

-- Check if functions exist
SELECT 
    p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    p.prosecdef as security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_space_mosaic_thumbnails',
    'get_memory_mosaic_thumbnails',
    'get_timeline_thumbnails',
    'get_space_list_thumbnails'
  );

-- Grant execute to authenticated for all thumbnail functions
GRANT EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;

-- Verify grants
SELECT 
    r.routine_name,
    r.routine_type,
    r.security_type,
    array_agg(DISTINCT p.privilege_type) as privileges,
    array_agg(DISTINCT p.grantee) as grantees
FROM information_schema.routines r
LEFT JOIN information_schema.routine_privileges p 
    ON r.routine_name = p.routine_name 
    AND r.routine_schema = p.routine_schema
WHERE r.routine_schema = 'public'
  AND r.routine_name IN (
    'get_space_mosaic_thumbnails',
    'get_memory_mosaic_thumbnails',
    'get_timeline_thumbnails',
    'get_space_list_thumbnails'
  )
GROUP BY r.routine_name, r.routine_type, r.security_type;