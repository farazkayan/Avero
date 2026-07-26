-- ============================================================================
-- Migration: Fix media_delete RLS policy (creator OR Space owner)
-- ----------------------------------------------------------------------------
-- Previously the `media_delete` policy only allowed `is_memory_creator(memory_id)`,
-- which blocked Space owners from deleting media on Memories they did not
-- personally create. This was inconsistent with:
--   - `memories_delete` (20260703171000) — `is_space_owner(space_id) OR created_by = auth.uid()`
--   - the Storage `media_delete` policy (20260703170800) — `is_memory_creator(...) OR is_space_owner(...)`
--
-- The Memory Detail page's media management UI (add/remove media) gates the
-- delete affordance on the same `canEdit` logic used by the Edit Memory page
-- (creator OR Space owner). Without this fix, a Space owner who sees the
-- delete control would have the DB row delete silently denied by RLS.
--
-- The new policy mirrors `memories_delete` and the Storage delete policy:
-- the Memory's creator OR an owner of the Memory's Space may delete a media
-- row. The `space_id` is re-derived from the parent memory via the same
-- subquery pattern used by `media_select` / `media_insert`, which is subject
-- to memories RLS (so media for soft-deleted memories is also protected).
--
-- Source of truth: docs/backend-implementation.md §11.4 (media DELETE) and
-- §13.4 (Media Deletion). The §11.4 matrix lists media DELETE as "Creator of
-- the parent memory"; this migration extends that to "Creator OR Space owner"
-- to match the Storage policy and the memories_delete policy, and to support
-- the owner-cleanup use case (§13.4: "Storage allows owner cleanup of orphaned
-- files").
-- ============================================================================

DROP POLICY IF EXISTS media_delete ON media;

CREATE POLICY media_delete
    ON media
    FOR DELETE
    TO authenticated
    USING (
        is_memory_creator(memory_id)
        OR is_space_owner(
            (SELECT space_id FROM memories WHERE id = media.memory_id)
        )
    );
