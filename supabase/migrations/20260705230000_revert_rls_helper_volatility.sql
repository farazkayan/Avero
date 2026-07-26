-- ============================================================================
-- Migration: Revert RLS helper function volatility back to STABLE
-- ----------------------------------------------------------------------------
-- Reverts the change made in 20260705220000_fix_rls_helper_volatility.sql.
--
-- BACKGROUND:
--   The previous migration changed is_space_member, is_space_owner, and
--   is_memory_creator from STABLE to VOLATILE, claiming that STABLE functions
--   use a snapshot from the start of the calling query and therefore cannot
--   see rows inserted by AFTER triggers within the same statement (specifically
--   the space_members row inserted by handle_new_space during an
--   INSERT ... RETURNING on spaces).
--
--   That diagnosis was incorrect. Within a single PostgreSQL transaction,
--   visibility of rows inserted by earlier commands (including AFTER trigger
--   inserts) is governed by the Command ID (CID), not by the statement snapshot.
--   A later command in the same transaction — such as the SELECT-policy
--   evaluation applied to a RETURNING clause — CAN see rows inserted by an
--   AFTER trigger that fired earlier in the same statement, regardless of
--   whether the reading function is STABLE or VOLATILE. Volatility affects
--   query-planner caching and index usage, not intra-transaction visibility.
--
--   Empirically, the VOLATILE change did NOT fix the spaces INSERT...RETURNING
--   failure, which confirms it was not the root cause. Keeping a blanket
--   VOLATILE on every RLS helper is a performance regression across every RLS
--   policy in the schema (the planner can no longer cache the EXISTS subquery
--   result within a statement), with no correctness benefit.
--
-- THIS MIGRATION:
--   Restores the original STABLE volatility on all three helper functions,
--   matching their definitions in 20260703170400 (is_space_member) and
--   20260703170800 (is_space_owner, is_memory_creator). This returns the
--   schema to the state intended by docs/backend-implementation.md §11.3/§12.
--
--   The actual root cause of the INSERT...RETURNING failure is under active
--   investigation (see supabase/diagnostics/spaces_insert_returning_diagnostic.sql).
--   It is NOT being patched around here.
--
-- NOTE:
--   ALTER FUNCTION ... VOLATILE|STABLE only changes the volatility category;
--   it does not touch the function body, SECURITY DEFINER flag, or search_path
--   setting, so the SECURITY DEFINER hardening is preserved.
-- ============================================================================

-- is_space_member: the single gatekeeper for all content access.
-- Defined in 20260703170400_trigger_functions.sql. Restored to STABLE.
ALTER FUNCTION public.is_space_member(uuid) STABLE;

-- is_space_owner: used by spaces_update, spaces_delete, space_members_insert,
--                 space_members_update, space_members_delete, etc.
-- Defined in 20260703170800_storage.sql. Restored to STABLE.
ALTER FUNCTION public.is_space_owner(uuid) STABLE;

-- is_memory_creator: used by memories_update, memories_delete, media_insert,
--                    media_update, media_delete, comments_insert, etc.
-- Defined in 20260703170800_storage.sql. Restored to STABLE.
ALTER FUNCTION public.is_memory_creator(uuid) STABLE;
