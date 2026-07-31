-- SPEC B.1: Add set_media_thumbnails RPC to update both thumbnail columns atomically
-- This replaces the single-column set_media_thumbnail RPC
-- Uses SECURITY INVOKER pattern (like get_timeline_thumbnails) so RLS policies apply

CREATE OR REPLACE FUNCTION set_media_thumbnails(
  p_media_id uuid,
  p_thumbnail_grid_path text,
  p_thumbnail_detail_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_space_id uuid;
BEGIN
  -- Verify the media row exists and get its space_id for membership check
  SELECT m.space_id INTO v_space_id
  FROM media m
  JOIN memories mem ON mem.id = m.memory_id
  WHERE m.id = p_media_id;

  IF v_space_id IS NULL THEN
    RAISE EXCEPTION 'Media not found';
  END IF;

  -- Verify the caller is a member of the space (RLS would do this on a direct UPDATE,
  -- but SECURITY INVOKER means the UPDATE runs with the caller's permissions,
  -- so we must check explicitly before attempting the update)
  IF NOT EXISTS (
    SELECT 1 FROM space_members
    WHERE space_id = v_space_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this space';
  END IF;

  -- Update both thumbnail columns
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

-- Keep the old single-column RPC for backward compatibility (video posters still use it)
-- but make it call the new one
CREATE OR REPLACE FUNCTION set_media_thumbnail(
  p_media_id uuid,
  p_thumbnail_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- For backward compatibility, update only thumbnail_grid_path (legacy single thumbnail)
  -- Video posters and any existing callers will continue to work
  PERFORM set_media_thumbnails(p_media_id, p_thumbnail_path, NULL);
END;
$$;
