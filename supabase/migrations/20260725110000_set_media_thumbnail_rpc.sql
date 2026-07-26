-- ============================================================================
-- Migration: set_media_thumbnail RPC function
-- ----------------------------------------------------------------------------
-- Sets the thumbnail_path on a media row after the thumbnail variant has been
-- generated and uploaded to B2 (plans/media-web-optimizer.md).
--
-- WHY A SECURITY DEFINER RPC (not a plain UPDATE):
--   The existing `media_update` RLS policy only allows `is_memory_creator` —
--   i.e. only the Memory's creator can UPDATE media rows. But any Space member
--   can upload media (`media_insert` = `is_space_member`). This asymmetry means
--   a non-creator member who uploads a photo cannot update its thumbnail_path
--   via a plain UPDATE — RLS would block it.
--
--   A narrowly-scoped SECURITY DEFINER function bridges this safely:
--   - It bypasses RLS (SECURITY DEFINER) but enforces authorization explicitly
--     (is_space_member, re-derived from the media row's parent memory).
--   - It ONLY updates the thumbnail_path column — nothing else. A caller cannot
--     use it to change url, storage_path, type, or any other field.
--   - This matches the sync_memory_tags pattern (SECURITY DEFINER, explicit
--     is_space_member check, SET search_path = public).
--
-- SECURITY:
--   - SECURITY DEFINER: executes with the migration owner's privileges,
--     bypassing RLS on media. Safe because the function only updates
--     thumbnail_path and enforces authorization explicitly.
--   - SET search_path = public: standard hardening for SECURITY DEFINER
--     functions (matches is_space_member / sync_memory_tags).
--   - Authorization: the caller must be a member of the space that owns the
--     media's parent memory. The space_id is re-derived from the media row
--     via a subquery to memories (same pattern as media_select / media_insert
--     RLS policies), so the check is consistent with the read/insert gates.
--   - auth.uid() IS NULL guard: clear error for unauthenticated calls.
--
-- Idempotent: calling it twice with the same key is a no-op (the second call
-- just sets the same value again). Calling it with NULL clears the thumbnail
-- path (useful if a thumbnail is deleted and should fall back to original).
--
-- Returns: void. Errors propagate to the caller as a PostgRESTError.
--
-- Source of truth: plans/media-web-optimizer.md §Phase 1.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_media_thumbnail(
    p_media_id        uuid,
    p_thumbnail_path  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_space_id uuid;
BEGIN
    -- Authentication guard. The real authorization gate is the is_space_member
    -- check below, but this gives a clear error for an unauthenticated call.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'set_media_thumbnail: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Re-derive the space_id from the media row's parent memory. This is the
    -- same subquery pattern used by media_select / media_insert / media_delete
    -- RLS policies, so the authorization check is consistent with the existing
    -- read/insert/delete gates. If the media row doesn't exist (or the parent
    -- memory is soft-deleted), v_space_id stays NULL and the is_space_member
    -- check fails — a calm "not found or no access" path.
    SELECT m.space_id
    INTO v_space_id
    FROM memories m
    JOIN media ON media.memory_id = m.id
    WHERE media.id = p_media_id
      AND m.deleted_at IS NULL;

    -- Authorization: the caller must be a member of the space that owns this
    -- media's parent memory. This mirrors the media_insert RLS policy
    -- (is_space_member) — any Space member can upload media, so any Space
    -- member can set its thumbnail_path (thumbnail generation is triggered by
    -- the upload flow).
    IF v_space_id IS NULL OR NOT is_space_member(v_space_id) THEN
        RAISE EXCEPTION 'set_media_thumbnail: caller is not a member of the space that owns media %', p_media_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Update ONLY the thumbnail_path column. This is the entire purpose of
    -- this function — it cannot be used to modify any other field.
    UPDATE media
    SET thumbnail_path = p_thumbnail_path
    WHERE id = p_media_id;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- sync_memory_tags grant pattern (anon is NOT granted — only signed-in Space
-- members can set thumbnails).
REVOKE ALL ON FUNCTION set_media_thumbnail(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_media_thumbnail(uuid, text) TO authenticated;
