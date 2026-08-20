-- ============================================================================
-- Migration: Direct check of pg_proc
-- ----------------------------------------------------------------------------
-- ============================================================================

-- Check if functions exist
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

-- Count
SELECT COUNT(*) as function_count
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_space_mosaic_thumbnails',
    'get_memory_mosaic_thumbnails',
    'get_timeline_thumbnails',
    'get_space_list_thumbnails'
  );