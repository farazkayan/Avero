-- ============================================================================
-- Migration: Grant privileges to service_role for the recompute pipeline
-- ----------------------------------------------------------------------------
-- ROOT CAUSE of the recompute-space-stats Edge Function returning HTTP 500
-- {"error":"Recompute failed"} on every cron tick:
--
--   The Edge Function builds a supabase-js client with the SERVICE ROLE key
--   and queries the REST API (PostgREST). On Supabase, the service_role
--   BYPASSES Row Level Security, but PostgREST STILL ENFORCES TABLE/COLUMN
--   GRANT PRIVILEGES for every role — including service_role. The earlier
--   migration 20260705210000_grant_table_privileges.sql granted privileges
--   ONLY to `authenticated`, never to `service_role`. So every query the
--   recompute function made returned:
--
--     42501 permission denied for table memories
--     "Grant the required privileges to the current role with:
--      GRANT SELECT ON public.memories TO service_role;"
--
--   The function's catch block turned that PostgrestError into a 500, and
--   the original jsonError() only attached `details` for Error instances
--   (a PostgrestError is a plain object), so the response body showed only
--   {"error":"Recompute failed"} with no clue — masking the real cause.
--
-- FIX: grant service_role the privileges the recompute function needs.
--   - SELECT on every table it reads (spaces, memories, media, comments,
--     reactions, space_members, memory_tags, tags).
--   - INSERT + UPDATE on the two tables it writes via upsert
--     (space_stats_cache, space_achievements). It never deletes from these.
--   - SELECT on stats_recompute_queue is NOT needed: the cron job drains the
--     queue with a server-side DELETE (postgres superuser, bypasses grants),
--     not via PostgREST. The function does not touch the queue.
--
-- These grants are safe: service_role is a server-side-only key that is never
-- exposed to clients. RLS is bypassed for service_role by design (that is how
-- trusted server functions read across all Spaces regardless of the caller).
-- The grants simply let PostgREST reach the tables at all.
--
-- Idempotent: GRANT is safe to re-run.
-- ============================================================================

-- Tables the recompute Edge Function READS (computeStats + achievement signals).
GRANT SELECT ON spaces          TO service_role;
GRANT SELECT ON memories        TO service_role;
GRANT SELECT ON media           TO service_role;
GRANT SELECT ON comments        TO service_role;
GRANT SELECT ON reactions       TO service_role;
GRANT SELECT ON space_members   TO service_role;
GRANT SELECT ON memory_tags     TO service_role;
GRANT SELECT ON tags            TO service_role;

-- Tables the recompute Edge Function WRITES (upserts). It never deletes.
-- NOTE: PostgREST requires SELECT too for an upsert, because the
-- onConflict / merge-duplicates resolution must read the existing conflicting
-- row to decide whether to INSERT or UPDATE. Without SELECT the upsert fails
-- with 42501 "permission denied for table space_stats_cache" (hint: GRANT
-- SELECT). So we grant SELECT + INSERT + UPDATE on both write tables.
GRANT SELECT, INSERT, UPDATE ON space_stats_cache   TO service_role;
GRANT SELECT, INSERT, UPDATE ON space_achievements  TO service_role;

-- USAGE on sequences: required if any of these tables had identity/serial
-- columns the service role inserts into. space_stats_cache / space_achievements
-- have no identity columns (PKs are uuid FKs / text), but granting USAGE is
-- harmless and future-proof for any later service-role writes.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
