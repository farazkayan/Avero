-- ============================================================================
-- Migration: Fix memories_select RLS policy
-- ----------------------------------------------------------------------------
-- Preventative fix mirroring the spaces_select fix applied in
--   20260705240000_fix_spaces_select_policy.sql.
--
-- Root cause (preventative): The memories_select policy only allowed access
--   via is_space_member(space_id). A Memory's creator is normally already a
--   member of the Space at insert time (memories_insert requires it), so
--   is_space_member(space_id) is true and INSERT...RETURNING works today.
--   However, any future flow that reads a newly-inserted Memory back (a
--   success toast, a "view it now" navigation, etc.) could hit the same
--   trigger-timing / membership-visibility race we debugged for spaces if
--   membership visibility is ever delayed or re-evaluated under RLS.
--
-- Fix: Allow the creator to read their own Memory row via
--   created_by = auth.uid(), independent of is_space_member(). This is
--   consistent with §11.4 (memories SELECT: "Member of the space") and §5.5
--   (created_by is audit metadata that is always set to the authenticated
--   creator at insert time per the memories_insert WITH CHECK). The
--   deleted_at IS NULL soft-delete exclusion is preserved for all readers,
--   including the creator, so soft-deleted memories remain hidden from
--   normal queries (§16.7).
--
-- Source of truth: docs/backend-implementation.md §11 (RLS Strategy).
-- ============================================================================

DROP POLICY IF EXISTS memories_select ON memories;

CREATE POLICY memories_select
    ON memories
    FOR SELECT
    TO authenticated
    USING (
        (is_space_member(space_id) OR created_by = auth.uid())
        AND deleted_at IS NULL
    );
