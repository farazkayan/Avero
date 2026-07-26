-- ============================================================================
-- Migration: fix get_space_list_thumbnails OUT-parameter column ambiguity
-- ----------------------------------------------------------------------------
-- The original migration (20260724110000) created the function with a final
-- unqualified `SELECT space_id, id, memory_id, url, storage_path, type,
-- created_at FROM top_media WHERE mrn <= 2`. A PL/pgSQL function declared with
-- `RETURNS TABLE (...)` exposes each output column as a PL/pgSQL variable in
-- the function body, so the unqualified `space_id` (and the other column
-- names) were ambiguous between the OUT variable and the `top_media` table
-- column — at call time Postgres raised:
--   column reference "space_id" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- The function applied cleanly (CREATE OR REPLACE succeeded) but errored on
-- every invocation, so the Spaces Dashboard thumbnail batch returned no rows.
--
-- Fix: fully qualify every column in the final SELECT with the `top_media`
-- CTE alias, the same pattern the working get_timeline_thumbnails RPC uses
-- (it qualifies with `m.`). This re-runs CREATE OR REPLACE with the corrected
-- body; the grants are idempotent (REVOKE + GRANT again).
--
-- The original migration's source file has also been corrected in place so
-- future fresh clones get the fixed version; this migration exists to repair
-- the already-pushed remote function.
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
    -- Fully qualify every column with the `top_media` alias. A PL/pgSQL
    -- function declared with RETURNS TABLE(...) exposes each output column as
    -- a PL/pgSQL variable, so an unqualified `SELECT space_id, ...` is
    -- ambiguous between the OUT variable and the table column. Qualifying with
    -- the CTE alias resolves it — the same pattern the working
    -- get_timeline_thumbnails RPC uses (it qualifies with `m.`).
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

-- Re-grant (idempotent). Matches the original migration's grant pattern.
REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;
