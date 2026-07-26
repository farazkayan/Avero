-- ============================================================================
-- Migration: Add thumbnail_path to thumbnail RPCs
-- ----------------------------------------------------------------------------
-- Updates get_timeline_thumbnails and get_space_list_thumbnails to also return
-- the new thumbnail_path column (plans/media-web-optimizer.md).
--
-- This is an ADDITIVE change: the RPCs now return one extra column
-- (thumbnail_path). Existing callers that don't reference it are unaffected —
-- they simply ignore the new column. The TypeScript Media type is updated
-- separately to include the field.
--
-- The RPCs are re-created with CREATE OR REPLACE (same SECURITY INVOKER,
-- same search_path, same grants). Only the RETURNS TABLE signature and the
-- SELECT list change — the query logic, ROW_NUMBER partitioning, and security
-- reasoning are identical to the originals. See the original migrations for
-- the full security and design commentary:
--   - 20260723110000_get_timeline_thumbnails_rpc.sql
--   - 20260724120000_fix_get_space_list_thumbnails_ambiguity.sql
--
-- The client uses thumbnail_path to decide which B2 object to presign for a
-- thumbnail display: if non-NULL, it requests a presigned GET for the
-- thumbnail variant (small WebP); if NULL, it falls back to the original
-- (media.url / storage_path) — no regression for old media without thumbnails.
--
-- Source of truth: plans/media-web-optimizer.md §Phase 1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. get_timeline_thumbnails — add thumbnail_path to the return
-- ----------------------------------------------------------------------------

-- DROP first: CREATE OR REPLACE FUNCTION cannot change the RETURNS TABLE
-- column list (PostgreSQL raises SQLSTATE 42P13 "cannot change return type
-- of existing function"). Dropping and recreating is the only way to add a
-- column to the return signature. The function is re-created with identical
-- security settings (SECURITY INVOKER, search_path = public) and re-granted
-- below.
DROP FUNCTION IF EXISTS get_timeline_thumbnails(uuid[]);

CREATE OR REPLACE FUNCTION get_timeline_thumbnails(p_memory_ids uuid[])
RETURNS TABLE (
    id              uuid,
    memory_id       uuid,
    url             text,
    storage_path    text,
    thumbnail_path  text,
    type            text,
    created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_timeline_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT m.id, m.memory_id, m.url, m.storage_path, m.thumbnail_path, m.type, m.created_at
    FROM (
        SELECT
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.thumbnail_path,
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

-- Re-grant (idempotent — CREATE OR REPLACE drops existing grants).
REVOKE ALL ON FUNCTION get_timeline_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_timeline_thumbnails(uuid[]) TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. get_space_list_thumbnails — add thumbnail_path to the return
-- ----------------------------------------------------------------------------

-- DROP first: same reason as above — cannot change RETURNS TABLE column list
-- via CREATE OR REPLACE. The parameter signature is (uuid[]) — see the
-- original migration 20260724110000 and the ambiguity fix 20260724120000.
DROP FUNCTION IF EXISTS get_space_list_thumbnails(uuid[]);

CREATE OR REPLACE FUNCTION get_space_list_thumbnails(p_space_ids uuid[])
RETURNS TABLE (
    space_id        uuid,
    id              uuid,
    memory_id       uuid,
    url             text,
    storage_path    text,
    thumbnail_path  text,
    type            text,
    created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'get_space_list_thumbnails: authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH latest_memory AS (
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
        SELECT
            latest_memory.space_id,
            media.id,
            media.memory_id,
            media.url,
            media.storage_path,
            media.thumbnail_path,
            media.type,
            media.created_at,
            ROW_NUMBER() OVER (
                PARTITION BY latest_memory.space_id
                ORDER BY media.created_at ASC
            ) AS mrn
        FROM latest_memory
        JOIN media ON media.memory_id = latest_memory.memory_id
    )
    SELECT
        top_media.space_id,
        top_media.id,
        top_media.memory_id,
        top_media.url,
        top_media.storage_path,
        top_media.thumbnail_path,
        top_media.type,
        top_media.created_at
    FROM top_media
    WHERE top_media.mrn <= 2;
END;
$$;

-- Re-grant (idempotent — CREATE OR REPLACE drops existing grants).
REVOKE ALL ON FUNCTION get_space_list_thumbnails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_space_list_thumbnails(uuid[]) TO authenticated;
