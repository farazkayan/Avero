-- ============================================================================
-- Migration: Verification Queries
-- ----------------------------------------------------------------------------
-- Read-only queries to verify the database implementation after all migrations
-- are applied. These queries do NOT modify any data.
--
-- Source of truth: docs/backend-implementation.md §14 Step 8 (Verification).
--
-- Usage:
--   - Section A (Structural Integrity) can be run immediately after all
--     migrations are applied — no test data required.
--   - Sections B–H require test data (test users, spaces, memories, etc.).
--     Follow the Manual Testing Checklist (Migration 14) to set up test data,
--     then run the relevant section after each test scenario.
--
-- All queries are read-only (SELECT only). They are safe to run at any time.
-- ============================================================================


-- ============================================================================
-- Section A: Structural Integrity (no test data required)
-- ============================================================================
-- Verifies that all schema objects were created correctly: tables, constraints,
-- indexes, triggers, functions, RLS status, and policy counts.
-- Run this immediately after applying all migrations.
-- ============================================================================

-- A.1: Verify all 10 application tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
-- Expected: 10 rows — comments, media, memories, memory_tags, profiles,
-- reactions, space_invitations, space_members, spaces, tags


-- A.2: Verify all CHECK constraints exist
SELECT conname AS constraint_name,
       conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'c'
  AND connamespace = 'public'::regnamespace
ORDER BY conname;
-- Expected: 5 rows — chk_media_type, chk_reactions_type,
-- chk_space_invitations_role, chk_space_invitations_status,
-- chk_space_members_role


-- A.3: Verify all UNIQUE constraints exist
SELECT conname AS constraint_name,
       conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'u'
  AND connamespace = 'public'::regnamespace
ORDER BY conname;
-- Expected: 3 rows — uq_reactions_memory_user_type,
-- uq_space_invitations_token, uq_space_members_space_user


-- A.4: Verify composite primary key on memory_tags
SELECT conname AS constraint_name,
       conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'p'
  AND conrelid::regclass::text = 'memory_tags'
  AND connamespace = 'public'::regnamespace;
-- Expected: 1 row — pk_memory_tags


-- A.5: Verify all non-implicit indexes exist (excluding PK and UNIQUE indexes)
SELECT indexname AS index_name,
       tablename AS table_name
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname NOT IN (
      SELECT conname
      FROM pg_constraint
      WHERE contype IN ('p', 'u')
        AND connamespace = 'public'::regnamespace
  )
  AND tablename IN (
      'profiles', 'spaces', 'space_members', 'space_invitations',
      'memories', 'media', 'tags', 'memory_tags', 'comments', 'reactions'
  )
ORDER BY tablename, indexname;
-- Expected: 13 rows (see Migration 4 for the full list)


-- A.6: Verify all trigger functions exist
SELECT proname AS function_name,
       prokind AS kind,  -- 'f' = function, 'p' = procedure
       provolatile AS volatility  -- 's' = STABLE, 'v' = VOLATILE, 'i' = IMMUTABLE
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
      'set_updated_at',
      'handle_new_user',
      'handle_new_space',
      'is_space_member',
      'is_space_owner',
      'is_memory_creator'
  )
ORDER BY proname;
-- Expected: 6 rows. is_space_member, is_space_owner, is_memory_creator
-- should have volatility = 's' (STABLE).


-- A.7: Verify SECURITY DEFINER functions have search_path = public
SELECT proname AS function_name,
       proconfig AS settings
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
      'handle_new_user',
      'handle_new_space',
      'is_space_member',
      'is_space_owner',
      'is_memory_creator'
  )
ORDER BY proname;
-- Expected: 5 rows. Each should have proconfig containing
-- 'search_path=public'. set_updated_at is NOT SECURITY DEFINER (no
-- search_path setting needed — it doesn't query tables).


-- A.8: Verify all triggers exist
SELECT event_object_table AS table_name,
       trigger_name,
       event_manipulation AS event,
       action_timing AS timing,
       action_statement AS action
FROM information_schema.triggers
WHERE trigger_schema = 'public'
   OR (event_object_schema = 'auth' AND event_object_table = 'users')  -- handle_new_user is on auth.users
ORDER BY event_object_table, trigger_name;
-- Expected: 6 triggers:
--   auth.users: on_auth_user_created (AFTER INSERT)
--   spaces: on_space_created (AFTER INSERT)
--   profiles: set_updated_at_profiles (BEFORE UPDATE)
--   spaces: set_updated_at_spaces (BEFORE UPDATE)
--   memories: set_updated_at_memories (BEFORE UPDATE)
--   comments: set_updated_at_comments (BEFORE UPDATE)


-- A.9: Verify RLS is enabled on all 10 application tables
SELECT relname AS table_name,
       relrowsecurity AS rls_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN (
      'profiles', 'spaces', 'space_members', 'space_invitations',
      'memories', 'media', 'tags', 'memory_tags', 'comments', 'reactions'
  )
ORDER BY relname;
-- Expected: 10 rows, all with rls_enabled = true


-- A.10: Verify RLS policy count per table
SELECT relname AS table_name,
       COUNT(*) AS policy_count
FROM pg_class c
JOIN pg_policy p ON p.polrelid = c.oid
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN (
      'profiles', 'spaces', 'space_members', 'space_invitations',
      'memories', 'media', 'tags', 'memory_tags', 'comments', 'reactions'
  )
GROUP BY relname
ORDER BY relname;
-- Expected:
--   comments:        4
--   media:           4
--   memories:        4
--   memory_tags:     3
--   profiles:        3
--   reactions:       3
--   space_invitations: 4
--   space_members:   4
--   spaces:          4
--   tags:            4
-- Total: 37


-- A.11: Verify Storage bucket exists and is private
SELECT id,
       name,
       public AS is_public
FROM storage.buckets
WHERE id = 'media';
-- Expected: 1 row — id='media', name='media', is_public=false


-- A.12: Verify Storage policies exist
SELECT policyname AS policy_name,
       cmd AS operation,
       qual AS using_expr,
       with_check AS with_check_expr
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN ('media_upload', 'media_read', 'media_delete')
ORDER BY policyname;
-- Expected: 3 rows — media_upload (INSERT), media_read (SELECT),
-- media_delete (DELETE)


-- ============================================================================
-- Section B: Verify handle_new_user() creates a profiles row on sign-up
-- ============================================================================
-- Prerequisite: A new user has signed up via Supabase Auth (the frontend
-- SignUpPage or the Supabase dashboard). The trigger should have
-- automatically created a matching profiles row.
-- ============================================================================

-- B.1: Check that every auth.users row has a corresponding profiles row
SELECT u.id AS user_id,
       u.email,
       u.raw_user_meta_data->>'name' AS metadata_name,
       p.name AS profile_name,
       p.created_at
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
ORDER BY u.created_at DESC;
-- Expected: Every row should have a non-NULL profile_name matching
-- metadata_name. If profile_name is NULL, the trigger failed.


-- B.2: Check for orphaned profiles (profile exists but auth user doesn't)
SELECT p.id AS profile_id,
       p.name
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;
-- Expected: 0 rows (no orphaned profiles)


-- ============================================================================
-- Section C: Verify handle_new_space() auto-adds creator as owner
-- ============================================================================
-- Prerequisite: A user has created a Space (INSERT into spaces with
-- created_by = auth.uid()). The trigger should have automatically inserted
-- a space_members row with role = 'owner'.
-- ============================================================================

-- C.1: Check that every Space has at least one owner
SELECT s.id AS space_id,
       s.name AS space_name,
       s.created_by,
       COUNT(sm.user_id) AS owner_count
FROM spaces s
LEFT JOIN space_members sm
    ON sm.space_id = s.id AND sm.role = 'owner'
GROUP BY s.id, s.name, s.created_by
ORDER BY s.created_at DESC;
-- Expected: Every Space should have owner_count >= 1.
-- If owner_count = 0, the handle_new_space trigger failed.


-- C.2: Verify the creator was auto-added as owner
SELECT s.id AS space_id,
       s.name AS space_name,
       s.created_by,
       sm.user_id AS owner_user_id,
       sm.role
FROM spaces s
JOIN space_members sm ON sm.space_id = s.id AND sm.role = 'owner'
WHERE sm.user_id = s.created_by
ORDER BY s.created_at DESC;
-- Expected: Every Space should have a row where created_by = owner_user_id.


-- ============================================================================
-- Section D: Verify RLS blocks non-members from accessing Space content
-- ============================================================================
-- Prerequisite: At least two test users exist. User A is a member of Space X.
-- User B is NOT a member of Space X. Run these queries while authenticated
-- as User B (via the Supabase SQL Editor with User B's session, or by
-- setting request.jwt.claims).
--
-- Note: To test RLS from a specific user's perspective in the SQL Editor,
-- you can use:
--   SET request.jwt.claims TO '{"sub": "<user-b-uuid>", "role": "authenticated"}';
--   SET request.role TO 'authenticated';
-- Then run the SELECT queries below. Reset afterward:
--   RESET request.jwt.claims;
--   RESET request.role;
-- ============================================================================

-- D.1: As a non-member, verify spaces are hidden
SELECT id, name
FROM spaces;
-- Expected (as non-member): 0 rows (or only rows for Spaces the user is a
-- member of). If non-member Spaces appear, the spaces_select policy is broken.


-- D.2: As a non-member, verify memories are hidden
SELECT id, title, space_id
FROM memories;
-- Expected (as non-member): 0 rows from Spaces the user is not a member of.


-- D.3: As a non-member, verify comments are hidden
SELECT id, content, memory_id
FROM comments;
-- Expected (as non-member): 0 rows from Spaces the user is not a member of.


-- D.4: As a non-member, verify reactions are hidden
SELECT id, type, memory_id, user_id
FROM reactions;
-- Expected (as non-member): 0 rows from Spaces the user is not a member of.


-- D.5: As a non-member, verify media metadata is hidden
SELECT id, memory_id, type
FROM media;
-- Expected (as non-member): 0 rows from Spaces the user is not a member of.


-- D.6: As a member, verify content IS visible
-- (Run the same queries above while authenticated as User A, a member of
-- Space X. You should see the Space's memories, comments, reactions, media.)
SELECT id, name
FROM spaces;
-- Expected (as member): At least 1 row (Space X).


-- ============================================================================
-- Section E: Verify soft-deleted memories are excluded from SELECT queries
-- ============================================================================
-- Prerequisite: A memory has been soft-deleted (deleted_at set to a
-- non-NULL timestamp via UPDATE). Run these queries as a member of the
-- Space that owns the memory.
-- ============================================================================

-- E.1: Verify the soft-deleted memory is hidden from normal SELECT
SELECT id, title, deleted_at
FROM memories
WHERE deleted_at IS NULL;
-- Expected: The soft-deleted memory should NOT appear. Only active memories
-- should be returned.


-- E.2: Verify the soft-deleted memory exists in the table (service role only)
-- Run this with the service role key (bypasses RLS) to confirm the row
-- still exists:
SELECT id, title, deleted_at, space_id
FROM memories
WHERE deleted_at IS NOT NULL;
-- Expected (service role): The soft-deleted memory appears with a non-NULL
-- deleted_at timestamp.


-- E.3: Verify child rows of soft-deleted memories are also hidden
-- As a member of the Space, check that comments/media/reactions belonging
-- to the soft-deleted memory are hidden:
SELECT c.id, c.content, c.memory_id
FROM comments c
WHERE c.memory_id = '<soft-deleted-memory-uuid>';
-- Expected (as member): 0 rows. The subquery in the comments_select policy
-- hits the memories table, which is RLS-filtered (deleted_at IS NULL),
-- so the soft-deleted memory's comments are hidden.

SELECT m.id, m.memory_id, m.type
FROM media m
WHERE m.memory_id = '<soft-deleted-memory-uuid>';
-- Expected (as member): 0 rows (same reason as above).


-- ============================================================================
-- Section F: Verify CASCADE behavior on Space deletion
-- ============================================================================
-- Prerequisite: A Space with memories, media, tags, memory_tags, comments,
-- and reactions has been deleted (DELETE FROM spaces WHERE id = ...).
-- This should CASCADE to all child data.
--
-- WARNING: This test DELETES data. Run it only on test data.
-- Run with the service role or as the Space owner.
-- ============================================================================

-- F.1: Before deletion — record the Space's child data count
SELECT
    (SELECT COUNT(*) FROM memories WHERE space_id = '<test-space-uuid>') AS memories_count,
    (SELECT COUNT(*) FROM media m
       JOIN memories mem ON mem.id = m.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS media_count,
    (SELECT COUNT(*) FROM tags WHERE space_id = '<test-space-uuid>') AS tags_count,
    (SELECT COUNT(*) FROM memory_tags mt
       JOIN memories mem ON mem.id = mt.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS memory_tags_count,
    (SELECT COUNT(*) FROM comments c
       JOIN memories mem ON mem.id = c.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS comments_count,
    (SELECT COUNT(*) FROM reactions r
       JOIN memories mem ON mem.id = r.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS reactions_count,
    (SELECT COUNT(*) FROM space_members WHERE space_id = '<test-space-uuid>') AS members_count,
    (SELECT COUNT(*) FROM space_invitations WHERE space_id = '<test-space-uuid>') AS invitations_count;
-- Expected: Non-zero counts for all child tables.


-- F.2: After deletion — verify all child data is gone
-- (Run after: DELETE FROM spaces WHERE id = '<test-space-uuid>';)
SELECT
    (SELECT COUNT(*) FROM memories WHERE space_id = '<test-space-uuid>') AS memories_count,
    (SELECT COUNT(*) FROM media m
       JOIN memories mem ON mem.id = m.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS media_count,
    (SELECT COUNT(*) FROM tags WHERE space_id = '<test-space-uuid>') AS tags_count,
    (SELECT COUNT(*) FROM memory_tags mt
       JOIN memories mem ON mem.id = mt.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS memory_tags_count,
    (SELECT COUNT(*) FROM comments c
       JOIN memories mem ON mem.id = c.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS comments_count,
    (SELECT COUNT(*) FROM reactions r
       JOIN memories mem ON mem.id = r.memory_id
       WHERE mem.space_id = '<test-space-uuid>') AS reactions_count,
    (SELECT COUNT(*) FROM space_members WHERE space_id = '<test-space-uuid>') AS members_count,
    (SELECT COUNT(*) FROM space_invitations WHERE space_id = '<test-space-uuid>') AS invitations_count;
-- Expected: All counts = 0. CASCADE should have removed everything.


-- ============================================================================
-- Section G: Verify SET NULL behavior on account deletion
-- ============================================================================
-- Prerequisite: A user who created a Space and/or memories has had their
-- account deleted (DELETE FROM auth.users WHERE id = ...). The CASCADE
-- should delete their space_members rows, and SET NULL should nullify
-- spaces.created_by and memories.created_by.
--
-- WARNING: This test DELETES a user account. Run it only on test data.
-- Run with the service role key.
-- ============================================================================

-- G.1: Before account deletion — record the user's created Spaces/memories
SELECT 'spaces' AS table_name,
       id AS row_id,
       name,
       created_by
FROM spaces
WHERE created_by = '<test-user-uuid>'
UNION ALL
SELECT 'memories',
       id,
       title,
       created_by
FROM memories
WHERE created_by = '<test-user-uuid>';
-- Expected: Rows showing the user's created Spaces and memories with
-- non-NULL created_by.


-- G.2: After account deletion — verify created_by is NULL but rows survive
-- (Run after: DELETE FROM auth.users WHERE id = '<test-user-uuid>';)
SELECT 'spaces' AS table_name,
       id AS row_id,
       name,
       created_by
FROM spaces
WHERE id IN (
    SELECT id FROM spaces WHERE created_by IS NULL
)
UNION ALL
SELECT 'memories',
       id,
       title,
       created_by
FROM memories
WHERE created_by IS NULL
  AND space_id IN (
      -- Filter to Spaces that the deleted user created (by checking
      -- that the Space's created_by is also NULL — both were SET NULL)
      SELECT id FROM spaces WHERE created_by IS NULL
  );
-- Expected: The Spaces and memories still exist but created_by is NULL.
-- The Space survives (created_by IS NULL), and the memories survive
-- (created_by IS NULL). The user's space_members rows are gone (CASCADE).


-- G.3: Verify the deleted user's space_members rows are gone
SELECT COUNT(*) AS remaining_memberships
FROM space_members
WHERE user_id = '<test-user-uuid>';
-- Expected: 0 (CASCADE from auth.users → profiles → space_members)


-- G.4: Verify the deleted user's profile is gone
SELECT COUNT(*) AS remaining_profiles
FROM profiles
WHERE id = '<test-user-uuid>';
-- Expected: 0 (CASCADE from auth.users → profiles)


-- ============================================================================
-- Section H: Verify Storage policies match database RLS
-- ============================================================================
-- Prerequisite: Test users, a Space, and a memory with uploaded media.
-- Verify that:
--   1. A member can upload/read/delete media files in their Space.
--   2. A non-member cannot upload/read/delete media files.
--   3. The Storage path convention is enforced.
-- ============================================================================

-- H.1: List all Storage objects in the media bucket with their paths
SELECT id,
       name AS storage_path,
       owner,
       created_at
FROM storage.objects
WHERE bucket_id = 'media'
ORDER BY created_at DESC;
-- Expected: Paths matching the convention:
--   spaces/{space_id}/memories/{memory_id}/{media_id}.{ext}


-- H.2: Verify path convention compliance
SELECT name AS storage_path,
       CASE
           WHEN name ~ '^spaces/[0-9a-fA-F-]+/memories/[0-9a-fA-F-]+/.+'
           THEN 'valid'
           ELSE 'INVALID'
       END AS path_status
FROM storage.objects
WHERE bucket_id = 'media';
-- Expected: All rows should show 'valid'. Any 'INVALID' rows violate the
-- path convention and would be inaccessible via the Storage policies.


-- H.3: Cross-reference Storage objects with media table rows
-- (Run with service role to see all data)
SELECT so.name AS storage_path,
       so.id AS storage_object_id,
       m.id AS media_row_id,
       CASE
           WHEN m.id IS NULL THEN 'ORPHANED (no media row)'
           ELSE 'linked'
       END AS link_status
FROM storage.objects so
LEFT JOIN media m ON so.name LIKE 'spaces/%/memories/%/' || m.id::text || '.%'
WHERE so.bucket_id = 'media';
-- Expected: All rows should show 'linked'. Any 'ORPHANED' rows indicate
-- a Storage object without a corresponding media row (cleanup needed).
-- Note: This query uses a LIKE pattern that may not match all extensions
-- perfectly. Adjust the pattern if needed.


-- H.4: Verify media table rows have corresponding Storage objects
-- (Run with service role)
SELECT m.id AS media_row_id,
       m.memory_id,
       m.type,
       so.name AS storage_path,
       CASE
           WHEN so.id IS NULL THEN 'MISSING (no storage object)'
           ELSE 'linked'
       END AS link_status
FROM media m
LEFT JOIN storage.objects so
    ON so.bucket_id = 'media'
   AND so.name LIKE 'spaces/%/memories/' || m.memory_id::text || '/' || m.id::text || '.%'
ORDER BY m.created_at DESC;
-- Expected: All rows should show 'linked'. Any 'MISSING' rows indicate
-- a media row referencing a non-existent Storage object (orphaned media row).
