-- ============================================================================
-- Migration: revoke anon EXECUTE on thumbnail RPCs (H-1)
-- ----------------------------------------------------------------------------
-- Earlier debug/grant migrations (20260820240000_force_grants.sql and
-- 20260821110000_grant_mosaic_rpc.sql) granted EXECUTE on the thumbnail RPCs
-- to the `anon` role. The functions themselves are SECURITY INVOKER and rely
-- on row-level RLS (memories_select / media_select, both TO authenticated) to
-- filter results — so an anonymous call currently returns zero rows. However,
-- the function surface was reachable from an unauthenticated browser via
-- PostgREST (e.g. POST /rest/v1/rpc/get_timeline_thumbnails), and any future
-- RLS slip on the underlying tables would become a real data leak through
-- these RPCs.
--
-- This migration revokes anon EXECUTE on all four thumbnail RPCs while
-- preserving the authenticated grant (the application's normal client path).
-- Idempotent: re-running is a no-op.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION get_space_mosaic_thumbnails(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) FROM anon;