-- ============================================================================
-- Migration: Enable Row Level Security
-- ----------------------------------------------------------------------------
-- Enables Row Level Security (RLS) on all 10 application tables.
--
-- Source of truth: docs/backend-implementation.md §11.2 (Design Principles).
--
-- NO POLICIES ARE CREATED IN THIS MIGRATION. With RLS enabled but no policies,
-- all access is DENIED BY DEFAULT for non-superuser roles (anon, authenticated).
-- This is the secure starting state. Policies are created in Migration 11.
--
-- Per §11.2: "RLS enabled on every table — no exceptions."
-- Per §11.2: "Deny by default — no policy means no access."
--
-- This migration does NOT:
--   - create any policies
--   - modify storage policies, functions, tables, or triggers
--   - use FORCE ROW LEVEL SECURITY (the table owner bypasses RLS by default,
--     which is correct for migrations and admin operations)
-- ============================================================================

ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE media              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags               ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions          ENABLE ROW LEVEL SECURITY;
