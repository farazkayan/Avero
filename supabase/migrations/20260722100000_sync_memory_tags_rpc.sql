-- ============================================================================
-- Migration: sync_memory_tags RPC function
-- ----------------------------------------------------------------------------
-- Atomic upsert of a Memory's tag set (feature-specs §6, database §10/§11).
--
-- Given a memory_id, space_id, and an array of tag names, this function:
--   1. Normalizes each name (trim, drop empties, dedupe case-insensitively —
--      keeping the original casing of the first occurrence for display).
--   2. INSERTs each tag into `tags` with ON CONFLICT DO NOTHING on the
--      (space_id, lower(name)) unique index — reusing existing Space tags
--      instead of creating duplicates (feature-specs §6: "Tags are shared
--      within a Space").
--   3. Replaces the memory's memory_tags rows: deletes existing links, then
--      inserts fresh links for the resolved tag set. This makes the function
--      idempotent and handles the edit case (add/remove tags) cleanly.
--
-- Why an RPC instead of client-side check-then-insert:
--   - Atomic: a single transaction eliminates the race condition where two
--     concurrent saves both SELECT "no existing tag", both INSERT, and the
--     second throws unique_violation (23505) on uq_tags_space_name_lower.
--   - One round trip instead of N+1 (SELECT existing + INSERT new tags +
--     INSERT memory_tags links).
--   - The RPC itself is all-or-nothing for the tag set; if it fails, the
--     Memory row (already saved by the caller) is unaffected — tags are
--     non-critical metadata.
--
-- SECURITY:
--   - SECURITY DEFINER: executes with the migration owner's privileges,
--     bypassing RLS on tags/memory_tags. This is essential because the
--     function both reads and writes both tables in one transaction; relying
--     on per-statement RLS would be correct but slower and less clear.
--   - SET search_path = public: locks the search path (standard hardening for
--     SECURITY DEFINER functions, matching is_space_member/is_space_owner).
--   - Authorization is enforced explicitly at the top: the caller must be a
--     member of the space (is_space_member). A non-member receives an
--     insufficient_privilege error.
--
-- Returns: void. Errors propagate to the caller as a PostgRESTError.
--
-- Source of truth: plans/tags-feature.md §2.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_memory_tags(
    p_memory_id uuid,
    p_space_id  uuid,
    p_tag_names text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_names text[];
BEGIN
    -- Authorization: the caller must be a member of the space. This mirrors
    -- the tags_insert / memory_tags_insert RLS policies (is_space_member) but
    -- is checked once up front for clarity and a single, clear error.
    IF NOT is_space_member(p_space_id) THEN
        RAISE EXCEPTION 'sync_memory_tags: caller is not a member of space %', p_space_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Normalize the incoming names: trim whitespace, drop empties, and dedupe
    -- case-insensitively. DISTINCT ON (lower(...)) keeps the first-seen
    -- original casing for each name so the display preserves what the user
    -- typed (e.g. "Road Trip" stays "Road Trip", not "road trip").
    SELECT array_agg(name ORDER BY lower(name))
    INTO v_clean_names
    FROM (
        SELECT DISTINCT ON (lower(trim(name))) trim(name) AS name
        FROM unnest(p_tag_names) AS name
        WHERE trim(name) <> ''
    ) AS deduped;

    -- 1. Insert any tags that don't yet exist in this space. ON CONFLICT on
    --    the (space_id, lower(name)) unique index reuses the existing row
    --    instead of creating a duplicate (feature-specs §6: "Duplicate tags
    --    are not allowed within the same Space").
    IF v_clean_names IS NOT NULL THEN
        INSERT INTO tags (space_id, name)
        SELECT p_space_id, name FROM unnest(v_clean_names) AS name
        ON CONFLICT (space_id, lower(name)) DO NOTHING;

        -- 2. Replace the memory's tag links: delete all existing links, then
        --    insert fresh links for the resolved tag set. Resolving by
        --    lower(name) within the space guarantees we link the exact tag
        --    rows (existing or just-inserted) for the requested names.
        DELETE FROM memory_tags WHERE memory_id = p_memory_id;

        INSERT INTO memory_tags (memory_id, tag_id)
        SELECT p_memory_id, t.id
        FROM tags t
        WHERE t.space_id = p_space_id
          AND lower(t.name) IN (
              SELECT lower(name) FROM unnest(v_clean_names) AS name
          );
    ELSE
        -- No tags requested (empty array or all-blank): clear any existing
        -- links so the memory ends up with zero tags.
        DELETE FROM memory_tags WHERE memory_id = p_memory_id;
    END IF;
END;
$$;
