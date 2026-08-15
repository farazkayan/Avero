-- ============================================================================
-- Migration: get_memory_mosaic_thumbnails RPC function
-- ----------------------------------------------------------------------------
-- Returns up to 3 most recent media rows within each requested Memory, ordered
-- by media.created_at DESC (newest first — so the mosaic shows the latest
-- photos added to that specific Memory).
--
-- Used by the Space timeline (SpaceDetailPage) to show a multi-photo mosaic
-- on each Memory card when it has 3+ photos, giving a richer preview than the
-- 1–2 thumbnail fallback. The per-Memory LIMIT (up to 3 rows) is the bandwidth
-- mitigation available today; a proper thumbnail/small-size image variant
-- generated at upload time (the "media web optimizer" TODO) is a flagged
-- follow-up, still out of scope here.
--
-- WHY A NEW RPC (not a reuse of get_timeline_thumbnails):
--   get_timeline_thumbnails returns the FIRST 1–2 media rows per Memory
--   (oldest-first, matching gallery reading order). The Memory mosaic needs
--   the MOST RECENT up to 3 rows (newest-first, so the mosaic reflects the
--   latest additions). This is a fundamentally different ordering and limit.
--   A new RPC keeps the concerns clean and leaves the existing timeline
--   thumbnail RPC untouched. It mirrors that RPC's spirit (per-group LIMIT via
--   ROW_NUMBER, SECURITY INVOKER, RLS-gated, returns durable B2 keys — client
--   presigns per thumbnail).
--
-- SECURITY — SECURITY INVOKER (not DEFINER):
--   This is a READ-ONLY helper. SECURITY INVOKER means the function executes
--   with the *caller's* privileges, so the existing `media_select` RLS policy
--   (is_space_member via the parent memory's space) filters the returned rows
--   exactly as a plain `select * from media` would. A non-member receives zero
--   rows for that Space's memories — the same calm "not found or no access"
--   path as the timeline thumbnails RPC.
--   SECURITY DEFINER would be WRONG here: it bypasses RLS, which is only
--   appropriate when the function must read tables the caller cannot (e.g.
--   is_space_member itself, which would be circular under INVOKER). This
--   function only reads `media`, which the caller is already authorized to
--   read via media_select, so INVOKER is correct and safe.
--
--   An explicit auth.uid() IS NULL guard is added up front for a clear error
--   if called unauthenticated, but the real authorization gate is RLS on the
--   returned rows (a non-member gets an empty result, not an error).
--
--   SET search_path = public: standard hardening (matches is_space_member /
--   sync_memory_tags / get_timeline_thumbnails / get_space_list_thumbnails),
--   prevents search-path-based privilege escalation even under INVOKER.
--
-- Returns: up to 3 media rows per requested memory_id (id, memory_id, url,
--   storage_path, type, created_at, thumbnail_grid_path, thumbnail_path).
--   The client groups by memory_id and resolves short-lived presigned GET URLs
--   per thumbnail via getMediaDownloadUrl (mirrors MediaGallery / the timeline
--   thumbnail) — this RPC returns durable B2 object keys, NOT presigned URLs.
--   The client prefers thumbnail_grid_path > thumbnail_path > url for the
--   mosaic display.
--
-- Source of truth: plans/avero-full-visual-redesign-integration.md §3.2
-- ============================================================================

CREATE OR REPLACE FUNCTION get_memory_mosaic_thumbnails(p_memory_ids uuid[])
RETURNS TABLE (
    id                  uuid,
    memory_id           uuid,
    url                 text,
    storage_path        text,
    type                text,
    created_at          timestamptz,
    thumbnail_grid_path text,
    thumbnail_path      text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Authentication guard. The real authorization gate is media_select RLS
    -- (is_space_member via the parent memory's space), which filters the
    -- returned rows under SECURITY INVOKER. This guard just gives a clear
    -- error for an unauthenticated call rather than an empty result.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_memory_mosaic_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    SELECT m.id, m.memory_id, m.url, m.storage_path, m.type, m.created_at,
           m.thumbnail_grid_path, m.thumbnail_path
    FROM (
        SELECT
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.type,
            media.created_at,
            media.thumbnail_grid_path,
            media.thumbnail_path,
            ROW_NUMBER() OVER (
                PARTITION BY media.memory_id
                ORDER BY media.created_at DESC
            ) AS rn
        FROM media
        WHERE media.memory_id = ANY(p_memory_ids)
    ) m
    WHERE m.rn <= 3;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Memory mosaic
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_memory_mosaic_thumbnails(uuid[]) TO authenticated;