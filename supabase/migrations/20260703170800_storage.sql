-- ============================================================================
-- Migration: Storage Bucket & Policies
-- ----------------------------------------------------------------------------
-- Creates the private `media` storage bucket and Storage object policies
-- (upload/read/delete) that mirror the database RLS.
--
-- Source of truth: docs/backend-implementation.md §13 (Supabase Storage
-- Strategy).
--
-- Path convention (§13.2):
--   spaces/{space_id}/memories/{memory_id}/{media_id}.{ext}
--
-- This migration also defines two additional SECURITY DEFINER helper functions
-- (is_space_owner, is_memory_creator) required by the delete policy. They are
-- created here (not in Migration 12) because:
--   1. The delete Storage policy needs them NOW.
--   2. They will be reused in Migration 11 (RLS policies), where many policies
--      check for ownership and creator status.
--   3. They follow the same SECURITY DEFINER pattern as is_space_member() —
--      they bypass RLS to avoid circular dependencies when querying
--      space_members and memories from within policies.
--
-- This migration does NOT enable table RLS or create table policies.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Helper functions required by the delete Storage policy
-- ----------------------------------------------------------------------------
-- These two functions follow the exact same pattern as is_space_member()
-- (defined in Migration 5): STABLE, SECURITY DEFINER, SET search_path = public.
-- They are needed because Storage policies that query application tables
-- (memories, space_members) would be subject to RLS once enabled, creating
-- a circular dependency. SECURITY DEFINER bypasses RLS for the internal
-- check only.
-- ----------------------------------------------------------------------------

-- is_space_owner(p_space_id uuid)
-- Returns true if the current authenticated user is an OWNER of the given
-- space (role = 'owner' in space_members). Companion to is_space_member().
CREATE OR REPLACE FUNCTION is_space_owner(p_space_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.space_members
        WHERE space_id = p_space_id
          AND user_id = auth.uid()
          AND role = 'owner'
    );
END;
$$;


-- is_memory_creator(p_memory_id uuid)
-- Returns true if the current authenticated user is the creator of the given
-- memory (memories.created_by = auth.uid()). Handles NULL created_by
-- gracefully: if the creator's account was deleted (SET NULL), this returns
-- false for everyone — only a Space owner can then delete the media (via
-- is_space_owner).
CREATE OR REPLACE FUNCTION is_memory_creator(p_memory_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.memories
        WHERE id = p_memory_id
          AND created_by = auth.uid()
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- Storage bucket: media (private)
-- ----------------------------------------------------------------------------
-- A private bucket for user-uploaded photos and videos. Private means files
-- are NOT publicly readable — access is controlled entirely by Storage
-- policies (which mirror the database RLS).
--
-- Source: §13.1.
-- ON CONFLICT DO NOTHING makes this idempotent.
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false)
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- Storage policies
-- ----------------------------------------------------------------------------
-- All policies are TO authenticated (no public access — §16.9).
--
-- Path format guard: each policy checks
--   name ~ '^spaces/[0-9a-fA-F-]+/memories/[0-9a-fA-F-]+/'
-- before extracting UUIDs from the path. PostgreSQL short-circuits AND
-- evaluation, so the ::uuid cast is never evaluated if the regex does not
-- match, preventing cast errors on malformed paths.
--
-- Path segment mapping:
--   split_part(name, '/', 2) = space_id
--   split_part(name, '/', 4) = memory_id
-- ----------------------------------------------------------------------------


-- Upload (INSERT) — §13.3: User must be a member of the Space that owns
-- the memory.
-- WITH CHECK validates the object being uploaded.
DROP POLICY IF EXISTS media_upload ON storage.objects;

CREATE POLICY media_upload
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'media'
        AND name ~ '^spaces/[0-9a-fA-F-]+/memories/[0-9a-fA-F-]+/'
        AND is_space_member(split_part(name, '/', 2)::uuid)
    );


-- Read (SELECT) — §13.3: User must be a member of the Space that owns
-- the memory.
-- USING filters which objects can be read.
DROP POLICY IF EXISTS media_read ON storage.objects;

CREATE POLICY media_read
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'media'
        AND name ~ '^spaces/[0-9a-fA-F-]+/memories/[0-9a-fA-F-]+/'
        AND is_space_member(split_part(name, '/', 2)::uuid)
    );


-- Delete (DELETE) — §13.3: User must be the creator of the parent memory
-- OR a Space owner.
-- USING filters which objects can be deleted.
DROP POLICY IF EXISTS media_delete ON storage.objects;

CREATE POLICY media_delete
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'media'
        AND name ~ '^spaces/[0-9a-fA-F-]+/memories/[0-9a-fA-F-]+/'
        AND (
            is_memory_creator(split_part(name, '/', 4)::uuid)
            OR is_space_owner(split_part(name, '/', 2)::uuid)
        )
    );
