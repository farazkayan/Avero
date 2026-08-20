-- ============================================================================
-- Migration: Verify RPC functions exist and have grants
-- ----------------------------------------------------------------------------
-- This migration will output the function existence and grants to the console
-- ============================================================================

-- Check if functions exist in pg_proc
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN
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
          )
        ORDER BY p.proname
    LOOP
        RAISE NOTICE 'Function: % | Args: % | Security Definer: %', 
            func_record.proname, func_record.args, func_record.security_definer;
    END LOOP;
    
    IF NOT FOUND THEN
        RAISE NOTICE 'NO THUMBNAIL FUNCTIONS FOUND IN pg_proc';
    END IF;
END $$;

-- Check grants
DO $$
DECLARE
    grant_record RECORD;
BEGIN
    FOR grant_record IN
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
        GROUP BY r.routine_name, r.routine_type, r.security_type
    LOOP
        RAISE NOTICE 'Grant: % | Type: % | Security: % | Privileges: % | Grantees: %', 
            grant_record.routine_name, 
            grant_record.routine_type, 
            grant_record.security_type,
            grant_record.privileges,
            grant_record.grantees;
    END LOOP;
    
    IF NOT FOUND THEN
        RAISE NOTICE 'NO GRANTS FOUND FOR THUMBNAIL FUNCTIONS';
    END IF;
END $$;