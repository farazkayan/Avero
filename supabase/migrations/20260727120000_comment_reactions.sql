-- ============================================================================
-- Migration: comment_reactions (roadmap Phase 6 — Comments enhancements)
-- ----------------------------------------------------------------------------
-- Adds per-comment reactions, mirroring the existing Memory-level `reactions`
-- table / CHECK / UNIQUE / index / RLS / grants (migrations 20260703170100,
-- 20260703170200, 20260703170300, 20260703170900, 20260703171000,
-- 20260705210000). The only structural difference is the foreign key target:
-- `comment_id -> comments(id)` instead of `memory_id -> memories(id)`.
--
-- Membership gating: a comment belongs to a memory, which belongs to a space.
-- The RLS policies therefore resolve the space through the comment's memory
-- (`SELECT space_id FROM memories WHERE id = comments.memory_id`), exactly as
-- the comments_select / reactions_select policies do. This keeps the
-- "Space members only" invariant identical to Memory-level reactions.
--
-- Like `reactions`, this table:
--   - has no `updated_at` (reactions are toggles, not editable rows);
--   - has no UPDATE policy (change = DELETE + INSERT);
--   - is hard-deleted (no soft delete);
--   - uses the same six stable text enum strings for `type` (NOT emoji).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE comment_reactions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id  uuid NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    type        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. CHECK constraint — same six stable text enum strings as reactions
--    (§5.10, Gap 7). Emoji are a presentation concern; the stored value is the
--    stable string so it never drifts if the emoji glyph changes.
-- ----------------------------------------------------------------------------
ALTER TABLE comment_reactions
    ADD CONSTRAINT chk_comment_reactions_type
    CHECK (type IN ('heart', 'laugh', 'fire', 'tearful', 'clap', 'surprised'));

-- ----------------------------------------------------------------------------
-- 3. UNIQUE constraint — one reaction per type per user per comment
--    (mirrors uq_reactions_memory_user_type).
-- ----------------------------------------------------------------------------
ALTER TABLE comment_reactions
    ADD CONSTRAINT uq_comment_reactions_comment_user_type
    UNIQUE (comment_id, user_id, type);

-- ----------------------------------------------------------------------------
-- 4. Index — comment_id leading, for per-comment counts/listing
--    (mirrors idx_reactions_memory_id). The UNIQUE index above can serve
--    comment_id-only lookups via its leading column, but a separate
--    (comment_id) index is smaller for count/list queries that do not filter
--    by user or type.
-- ----------------------------------------------------------------------------
CREATE INDEX idx_comment_reactions_comment_id
    ON comment_reactions (comment_id);

-- ----------------------------------------------------------------------------
-- 5. Enable RLS
-- ----------------------------------------------------------------------------
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 6. RLS policies — member-gated, mirroring reactions
--    SELECT:  Space member (via the comment's memory's space).
--    INSERT:  Space member AND user_id = auth.uid() (reactions are personal).
--    UPDATE:  No policy (toggle = DELETE + INSERT, by design).
--    DELETE:  Author only (user_id = auth.uid()).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS comment_reactions_select ON comment_reactions;
CREATE POLICY comment_reactions_select
    ON comment_reactions
    FOR SELECT
    TO authenticated
    USING (
        is_space_member(
            (SELECT space_id FROM memories
             WHERE id = (SELECT memory_id FROM comments WHERE id = comment_reactions.comment_id))
        )
    );

DROP POLICY IF EXISTS comment_reactions_insert ON comment_reactions;
CREATE POLICY comment_reactions_insert
    ON comment_reactions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_member(
            (SELECT space_id FROM memories
             WHERE id = (SELECT memory_id FROM comments WHERE id = comment_reactions.comment_id))
        )
        AND user_id = auth.uid()
    );

DROP POLICY IF EXISTS comment_reactions_delete ON comment_reactions;
CREATE POLICY comment_reactions_delete
    ON comment_reactions
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 7. Grants — same privileges as reactions (20260705210000)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON comment_reactions TO authenticated;
