-- ============================================================================
-- Migration: Profile Creation Trigger
-- ----------------------------------------------------------------------------
-- Attaches the handle_new_user() function (defined in Migration 5) as an
-- AFTER INSERT trigger on Supabase's auth.users table.
--
-- Source of truth: docs/backend-implementation.md §12, §16.8.
--
-- When Supabase Auth creates a new user (auth.users INSERT), this trigger
-- fires handle_new_user(), which creates the matching profiles row from
-- raw_user_meta_data->>'name'. This establishes the 1:1 relationship between
-- auth.users and profiles.
--
-- Per §16.8: the trigger fires on user creation, NOT on email verification.
-- If Supabase Auth configuration changes (e.g. enabling/disabling email
-- confirmation), the trigger behavior remains the same.
--
-- This migration contains ONLY the trigger attachment. The function is
-- defined in Migration 5.
-- ============================================================================

-- Idempotency guard: drop the trigger if it already exists so the migration
-- can be re-run safely without a "trigger already exists" error.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Attach handle_new_user() as an AFTER INSERT, FOR EACH ROW trigger.
-- AFTER INSERT (not BEFORE) because the function needs NEW.id to exist to
-- insert into profiles, and the auth.users row must be persisted first.
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();
