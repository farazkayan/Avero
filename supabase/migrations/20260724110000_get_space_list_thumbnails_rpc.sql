-- ============================================================================
-- Migration: get_space_list_thumbnails RPC function
-- ----------------------------------------------------------------------------
-- Returns the first 1–2 media rows of the MOST RECENT Memory for each
-- requested Space, ordered by media.created_at ASC (oldest first — matches the
-- gallery's reading order, so the "first by created_at" is the first photo
-- added to that Memory).
--
-- Used by the Space list card redesign (plans/space-card-redesign.md) to show
-- a small photo preview on each Space card on the "Your Spaces" dashboard, so
-- Spaces feel alive — mirroring the Memory card thumbnail on the Space
-- timeline. The per-Space LIMIT (1–2 rows of the single most recent Memory) is
-- the bandwidth mitigation available today; a proper thumbnail/small-size
-- image variant generated at upload time (the "media web optimizer" TODO) is a
-- flagged follow-up, still out of scope here.
--
-- WHY A NEW RPC (not a reuse of get_timeline_thumbnails):
--   get_timeline_thumbnails(p_memory_ids uuid[]) takes Memory ids the caller
--   already knows. The Spaces Dashboard has NO Memory ids — it fetches
--   space_members → spaces only. Reusing it would require a SECOND round trip
--   to first resolve "most recent Memory per Space" (itself a per-group-latest
--   query needing ROW_NUMBER), violating "as few round trips as possible."
--   Adapting the existing RPC (optional p_space_ids param / branch internally,
--   or changing its signature) would either overload one function with two
--   jobs and muddy its security reasoning, or break the already-shipped,
--   explicitly-out-of-scope timeline caller. A new RPC does BOTH steps (latest
--   Memory per Space → first 1–2 media rows of it) in ONE round trip and
--   leaves get_timeline_thumbnails untouched. It mirrors that RPC's spirit
--   (per-group LIMIT via ROW_NUMBER, SECURITY INVOKER, RLS-gated, returns
--   durable B2 keys — client presigns per thumbnail).
--
-- "Most recent Memory" ordering mirrors the Space timeline (SpaceDetailPage):
--   memory_date DESC, created_at DESC tiebreaker (feature-specs §2). This keeps
--   the list card thumbnail visually consistent with the Memory the user sees
--   first inside the Space.
--
-- SECURITY — SECURITY INVOKER (not DEFINER):
--   This is a READ-ONLY helper. SECURITY INVOKER means the function executes
--   with the *caller's* privileges, so the existing `memories_select` and
--   `media_select` RLS policies filter the returned rows exactly as plain
--   selects would. A non-member receives zero rows for that Space — the same
--   calm "not found or no access" path as the timeline thumbnails RPC.
--   SECURITY DEFINER would be WRONG here: it bypasses RLS, which is only
--   appropriate when the function must read tables the caller cannot (e.g.
--   is_space_member itself, which would be circular under INVOKER). This
--   function only reads `memories` and `media`, which the caller is already
--   authorized to read via the select policies, so INVOKER is correct and safe.
--
--   An explicit auth.uid() IS NULL guard is added up front for a clear error
--   if called unauthenticated, but the real authorization gate is RLS on the
--   returned rows (a non-member gets an empty result, not an error).
--
--   SET search_path = public: standard hardening (matches is_space_member /
--   sync_memory_tags / get_timeline_thumbnails), prevents search-path-based
--   privilege escalation even under INVOKER.
--
-- Returns: up to 2 media rows per requested space_id (space_id, id, memory_id,
--   url, storage_path, type, created_at). The client groups by space_id and
--   resolves short-lived presigned GET URLs per thumbnail via
--   getMediaDownloadUrl (mirrors MediaGallery / the timeline thumbnail) — this
--   RPC returns durable B2 object keys, NOT presigned URLs.
--
-- Source of truth: plans/space-card-redesign.md §1.1, §3 Step 1.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_space_list_thumbnails(p_space_ids uuid[])
RETURNS TABLE (
    space_id     uuid,
    id           uuid,
    memory_id    uuid,
    url          text,
    storage_path text,
    type         text,
    created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    -- Authentication guard. The real authorization gate is memories_select +
    -- media_select RLS (is_space_member via the parent memory's space), which
    -- filter the returned rows under SECURITY INVOKER. This guard just gives a
    -- clear error for an unauthenticated call rather than an empty result.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_space_list_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Empty input short-circuits to no rows (the client also guards this, but
    -- the function is defensive). ANY(uuid[]) on an empty array returns no
    -- rows, so this is belt-and-braces.
    RETURN QUERY
    WITH latest_memory AS (
        -- The single most recent Memory per Space, mirroring the timeline's
        -- ordering (memory_date DESC, created_at DESC tiebreaker). RLS on
        -- `memories` (memories_select: is_space_member OR created_by = auth.uid,
        -- AND deleted_at IS NULL) auto-filters here under SECURITY INVOKER, so
        -- a non-member gets no rows and soft-deleted Memories are excluded.
        SELECT lm.space_id, lm.memory_id
        FROM (
            SELECT
                memories.space_id,
                memories.id AS memory_id,
                ROW_NUMBER() OVER (
                    PARTITION BY memories.space_id
                    ORDER BY memories.memory_date DESC, memories.created_at DESC
                ) AS rn
            FROM memories
            WHERE memories.space_id = ANY(p_space_ids)
        ) lm
        WHERE lm.rn = 1
    ),
    top_media AS (
        -- The first 1–2 media rows of that one Memory, oldest-first (matches
        -- the gallery's reading order, same as get_timeline_thumbnails). RLS on
        -- `media` (media_select: is_space_member via the parent memory's space)
        -- auto-filters here too.
        SELECT
            latest_memory.space_id,
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.type,
            media.created_at,
            ROW_NUMBER() OVER (
                PARTITION BY latest_memory.space_id
                ORDER BY media.created_at ASC
            ) AS mrn
        FROM latest_memory
        JOIN media ON media.memory_id = latest_memory.memory_id
    )
    -- Fully qualify every column with the `top_media` alias. A PL/pgSQL function
    -- declared with `RETURNS TABLE (...)` exposes each output column (space_id,
    -- id, memory_id, url, storage_path, type, created_at) as a PL/pgSQL variable
    -- in the function body, so an unqualified `SELECT space_id, ...` is ambiguous
    -- between the OUT variable and the table column ("column reference 'space_id'
    -- is ambiguous"). Qualifying with the CTE alias resolves it — the same pattern
    -- the working get_timeline_thumbnails RPC uses (it qualifies with `m.`).
    SELECT
        top_media.space_id,
        top_media.id,
        top_media.memory_id,
        top_media.url,
        top_media.storage_path,
        top_media.type,
        top_media.created_at
    FROM top_media
    WHERE top_media.mrn <= 2;
END;
$$;

-- Revoke public access; grant execute to authenticated only. Matches the
-- get_timeline_thumbnails grant pattern (anon is NOT granted — Space list
-- thumbnails are only for signed-in Space members).
REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;
