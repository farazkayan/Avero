-- ============================================================================
-- Migration: updated_at Triggers
-- ----------------------------------------------------------------------------
-- Attaches the generic set_updated_at() function (defined in Migration 5) as a
-- BEFORE UPDATE trigger on the four mutable tables that have an updated_at
-- column: profiles, spaces, memories, comments.
--
-- Source of truth: docs/backend-implementation.md §9 (Timestamp Strategy)
-- and §12 (Triggers & Functions).
--
-- Tables WITHOUT updated_at do not get this trigger:
--   space_members, space_invitations, media, tags, memory_tags, reactions
--
-- This migration contains ONLY trigger attachments. The function is defined
-- in Migration 5 and is not modified here.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_profiles ON profiles;

CREATE TRIGGER set_updated_at_profiles
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------------------------
-- spaces
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_spaces ON spaces;

CREATE TRIGGER set_updated_at_spaces
    BEFORE UPDATE ON spaces
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------------------------
-- memories
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_memories ON memories;

CREATE TRIGGER set_updated_at_memories
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------------------------
-- comments
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_comments ON comments;

CREATE TRIGGER set_updated_at_comments
    BEFORE UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
