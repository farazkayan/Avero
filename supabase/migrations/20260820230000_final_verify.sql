-- ============================================================================
-- Migration: Final verification of functions and grants
-- ----------------------------------------------------------------------------
-- ============================================================================

-- Check if functions exist in pg_proc
SELECT 
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    p.prosecdef as security_definer,
    p.prokind as function_kind
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_space_mosaic_thumbnails',
    'get_memory_mosaic_thumbnails',
    'get_timeline_thumbnails',
    'get_space_list_thumbnails'
  )
ORDER BY p.proname;

-- Check grants
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

-- Check media table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'media'
  AND column_name IN ('thumbnail_grid_path', 'thumbnail_path', 'thumbnail_detail_path')
ORDER BY column_name;