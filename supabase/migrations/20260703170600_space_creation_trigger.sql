-- ============================================================================
-- Migration: Space Creation Trigger
-- ----------------------------------------------------------------------------
-- Attaches the handle_new_space() function (defined in Migration 5) as an
-- AFTER INSERT trigger on the spaces table.
--
-- Source of truth: docs/backend-implementation.md §12.
--
-- When a new Space is inserted, this trigger fires handle_new_space(), which
-- auto-adds the creator (NEW.created_by) as an 'owner' in space_members.
-- This guarantees every Space always has at least one owner (feature-specs §1:
-- "Every Space must have at least 1 owner").
--
-- This migration contains ONLY the trigger attachment. The function is
-- defined in Migration 5 and is not modified here.
-- ============================================================================

-- Idempotency guard: drop the trigger if it already exists so the migration
-- can be re-run safely without a "trigger already exists" error.
DROP TRIGGER IF EXISTS on_space_created ON spaces;

-- Attach handle_new_space() as an AFTER INSERT, FOR EACH ROW trigger.
-- AFTER INSERT (not BEFORE) because the function needs NEW.id to exist to
-- insert into space_members, and the spaces row must be persisted first so
-- the FK space_members.space_id -> spaces.id is satisfiable.
CREATE TRIGGER on_space_created
    AFTER INSERT ON spaces
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_space();
