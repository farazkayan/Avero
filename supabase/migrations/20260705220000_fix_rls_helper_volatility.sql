-- ============================================================================
-- Migration: Fix RLS helper function volatility
-- ----------------------------------------------------------------------------
-- Changes is_space_member, is_space_owner, and is_memory_creator from STABLE to
-- VOLATILE so they can see rows inserted by triggers within the same statement.
--
-- ROOT CAUSE:
--   STABLE functions use a snapshot from the start of the calling query. When
--   PostgREST executes `INSERT ... RETURNING` (which is what supabase-js
--   `.insert().select()` does), the AFTER INSERT trigger `handle_new_space`
--   inserts into `space_members` within the same statement. But the STABLE
--   `is_space_member` function can't see that newly inserted row because its
--   snapshot is from before the trigger fired. This causes the post-INSERT
--   SELECT policy `USING (is_space_member(id))` to return false, resulting in:
--     42501 "new row violates row-level security policy for table spaces"
--
--   The INSERT itself succeeds (the WITH CHECK passes), but the read-back
--   fails because the membership row isn't visible to the STABLE function.
--
-- FIX:
--   VOLATILE functions always read the latest data, including data modified by
--   triggers within the same statement. This is the correct volatility for RLS
--   helper functions that need to see trigger-modified data.
--
-- PERFORMANCE NOTE:
--   VOLATILE prevents the query planner from caching results within a statement.
--   For RLS policies, this is acceptable because the policies are evaluated per-
--   row and the membership check is a simple EXISTS subquery. The correctness
--   benefit far outweighs the minor performance cost.
--
--   This is the standard recommendation from the Supabase community for RLS
--   helper functions that interact with triggers.
-- ============================================================================

-- is_space_member: the single gatekeeper for all content access.
-- Used by: spaces_select, space_members_select, memories_select,
--          media_select, tags_select, memory_tags_select, comments_select,
--          reactions_select, and all INSERT/UPDATE/DELETE policies.
ALTER FUNCTION public.is_space_member(uuid) VOLATILE;

-- is_space_owner: used by spaces_update, spaces_delete, space_members_insert,
--                 space_members_update, space_members_delete, etc.
ALTER FUNCTION public.is_space_owner(uuid) VOLATILE;

-- is_memory_creator: used by memories_update, memories_delete, media_insert,
--                    media_update, media_delete, comments_insert, etc.
ALTER FUNCTION public.is_memory_creator(uuid) VOLATILE;
