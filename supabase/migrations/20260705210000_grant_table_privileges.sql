-- ============================================================================
-- Migration: Grant Table Privileges to authenticated role
-- ----------------------------------------------------------------------------
-- Grants SELECT, INSERT, UPDATE, DELETE on all 10 application tables to the
-- `authenticated` role so that PostgREST (the Supabase REST API) can access
-- them. RLS policies (Migration 11) still gate every row — these grants only
-- allow the API to *reach* the tables; RLS decides which rows are visible.
--
-- Without these grants, every API request returns:
--   42501 permission denied for table <table_name>
--   "Grant the required privileges to the current role with:
--    GRANT SELECT ON public.<table> TO authenticated;"
--
-- This is the standard Supabase pattern: the dashboard applies these grants
-- automatically when tables are created through the Table Editor, but raw SQL
-- migrations must include them explicitly.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON spaces            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON space_members     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON space_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON memories          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON media            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tags              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON memory_tags       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON comments          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reactions         TO authenticated;

-- USAGE on sequences needed for INSERT into tables with GENERATED ALWAYS AS
-- IDENTITY columns (PostgREST resolves the default by calling nextval()).
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
