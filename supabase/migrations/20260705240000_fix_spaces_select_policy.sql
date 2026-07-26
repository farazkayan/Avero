-- ============================================================================
-- Migration: Fix spaces_select RLS policy
-- ----------------------------------------------------------------------------
-- Root cause: The spaces_select policy only allowed access via
--   is_space_member(id). When a user creates a Space, the handle_new_space
--   trigger adds them as an owner in space_members — but that membership row
--   is inserted AFTER the spaces INSERT within the same transaction. Under
--   RLS, the INSERT's RETURNING clause re-evaluates the spaces_select policy
--   to return the newly inserted row, and at that point is_space_member(id)
--   is not yet visible to the authenticated role, so the row is filtered out
--   and RETURNING yields nothing.
--
-- Fix: Allow the creator to read their own newly-created Space row via
--   created_by = auth.uid(). This is consistent with §11.4 (spaces SELECT:
--   "Member of the space") and §5.2 (created_by is audit metadata that is
--   always set to the authenticated creator at insert time per the
--   spaces_insert WITH CHECK). The creator is auto-added as owner by the
--   handle_new_space trigger, so is_space_member(id) will also be true for
--   subsequent reads; this clause specifically covers the insert-returning
--   window and any edge case where membership is not yet visible.
--
-- Source of truth: docs/backend-implementation.md §11 (RLS Strategy).
-- ============================================================================

DROP POLICY IF EXISTS spaces_select ON spaces;

CREATE POLICY spaces_select
    ON spaces
    FOR SELECT
    TO authenticated
    USING (is_space_member(id) OR created_by = auth.uid());
