-- Fix set_media_thumbnails RPC: change from SECURITY INVOKER to SECURITY DEFINER
-- This matches the old set_media_thumbnail RPC's pattern exactly:
-- - Bypass RLS (SECURITY DEFINER)
-- - Add explicit is_space_member authorization check inside the function body
-- - Do not rely on media_update RLS policy (that's correctly creator-only for direct client edits)
-- - This RPC is a separate, controlled, system-triggered write path
-- - Keep the general media_update RLS policy as creator-only for regular client-side edits

CREATE OR REPLACE FUNCTION set_media_thumbnails(
  p_media_id uuid,
  p_thumbnail_grid_path text,
  p_thumbnail_detail_path text
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
    RAISE EXCEPTION 'set_media_thumbnails: authentication required'
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
  -- member can set its thumbnail paths (thumbnail generation is triggered by
  -- the upload flow).
  IF v_space_id IS NULL OR NOT is_space_member(v_space_id) THEN
    RAISE EXCEPTION 'set_media_thumbnails: caller is not a member of the space that owns media %', p_media_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Update ONLY the thumbnail columns. This is the entire purpose of
  -- this function — it cannot be used to modify any other field.
  UPDATE media
  SET
    thumbnail_grid_path = p_thumbnail_grid_path,
    thumbnail_detail_path = p_thumbnail_detail_path
  WHERE id = p_media_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media not found (concurrent delete?)';
  END IF;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- sync_memory_tags grant pattern (anon is NOT granted — only signed-in Space
-- members can set thumbnails).
REVOKE ALL ON FUNCTION set_media_thumbnails(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_media_thumbnails(uuid, text, text) TO authenticated;

-- Also update the legacy set_media_thumbnail to use SECURITY DEFINER for consistency
-- (it calls set_media_thumbnails internally, so it inherits the security model)
CREATE OR REPLACE FUNCTION set_media_thumbnail(
  p_media_id uuid,
  p_thumbnail_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- For backward compatibility, update only thumbnail_grid_path (legacy single thumbnail)
  -- Video posters and any existing callers will continue to work
  PERFORM set_media_thumbnails(p_media_id, p_thumbnail_path, NULL);
END;
$$;

REVOKE ALL ON FUNCTION set_media_thumbnail(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_media_thumbnail(uuid, text) TO authenticated;