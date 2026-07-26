-- ============================================================================
-- Migration: get_timeline_thumbnails RPC function
-- ----------------------------------------------------------------------------
-- Returns the first 1–2 media rows per requested Memory, ordered by
-- created_at ASC (oldest first — matches the gallery's reading order, so the
-- "first by created_at" is the first photo added to the Memory).
--
-- Used by the Space timeline card redesign (plans/memory-timeline-card-
-- redesign.md) to show a small photo thumbnail on each Memory card without
-- fetching every photo of every Memory. The per-group LIMIT (1–2 rows per
-- Memory) is the bandwidth mitigation available today; a proper thumbnail/
-- small-size image variant generated at upload time (the "media web
-- optimizer" TODO) is a flagged follow-up, still out of scope here.
--
-- WHY AN RPC (not a flat .in() select):
--   fetchMemoryReactionsBatch uses select(...).in("memory_id", ids) — one
--   round trip, client-side grouping. But that returns ALL rows for all the
--   requested Memories; there is no native per-group LIMIT on a flat .in()
--   query. Fetching every photo of every Memory would directly violate the
--   "do not fetch full presigned URLs for every photo" constraint. The only
--   faithful single-round-trip way to express a per-group limit is
--   ROW_NUMBER() OVER (PARTITION BY memory_id ORDER BY created_at) with a
--   rn <= 2 filter. This honors the *spirit* of the reactions batch (one
--   round trip, client-side grouping into a per-Memory map, calm failure,
--   page-owned state) while using the only mechanism that can express the
--   per-group limit.
--
-- SECURITY — SECURITY INVOKER (not DEFINER):
--   This is a READ-ONLY helper. SECURITY INVOKER means the function executes
--   with the *caller's* privileges, so the existing `media_select` RLS policy
--   (is_space_member via the parent memory's space) filters the returned rows
--   exactly as a plain `select * from media` would. A non-member receives zero
--   rows for that Space's memories — the same calm "not found or no access"
--   path as reactions. SECURITY DEFINER would be WRONG here: it bypasses RLS,
--   which is only appropriate when the function must read tables the caller
--   cannot (e.g. is_space_member itself, which would be circular under INVOKER).
--   This function only reads `media`, which the caller is already authorized
--   to read via media_select, so INVOKER is correct and safe.
--
--   An explicit auth.uid() IS NULL guard is added up front for a clear error
--   if called unauthenticated, but the real authorization gate is RLS on the
--   returned rows (a non-member gets an empty result, not an error).
--
--   SET search_path = public: standard hardening (matches is_space_member /
--   sync_memory_tags), prevents search-path-based privilege escalation even
--   under INVOKER.
--
-- Returns: up to 2 media rows per requested memory_id (id, memory_id, url,
--   storage_path, type, created_at). The client resolves short-lived
--   presigned GET URLs per thumbnail via getMediaDownloadUrl (mirrors
--   MediaGallery) — this RPC returns durable B2 object keys, NOT presigned
--   URLs.
--
-- Source of truth: plans/memory-timeline-card-redesign.md §1.1, §3 Step 1.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_timeline_thumbnails(p_memory_ids uuid[])
RETURNS TABLE (
    id uuid,
    memory_id uuid,
    url text,
    storage_path text,
    type text,
    created_at timestamptz
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
        RAISE EXCEPTION 'get_timeline_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    SELECT m.id, m.memory_id, m.url, m.storage_path, m.type, m.created_at
    FROM (
        SELECT
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.type,
            media.created_at,
            ROW_NUMBER() OVER (
                PARTITION BY media.memory_id
                ORDER BY media.created_at ASC
            ) AS rn
        FROM media
        WHERE media.memory_id = ANY(p_memory_ids)
    ) m
    WHERE m.rn <= 2;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_invitation_by_token grant pattern (anon is NOT granted — thumbnails are
-- only for signed-in Space members).
REVOKE ALL ON FUNCTION get_timeline_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;
