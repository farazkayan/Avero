-- ============================================================================
-- Migration: RLS Policies
-- ----------------------------------------------------------------------------
-- Implements the complete §11.4 policy matrix: SELECT/INSERT/UPDATE/DELETE
-- policies for all 10 application tables.
--
-- Source of truth: docs/backend-implementation.md §11 (Row Level Security
-- Strategy), especially §11.4 (Policy Matrix) and §11.5 (Nullable FK Impact).
--
-- Helper functions (defined in earlier migrations, all STABLE + SECURITY
-- DEFINER):
--   is_space_member(uuid)  — is auth.uid() a member of the given space?
--   is_space_owner(uuid)   — is auth.uid() an OWNER of the given space?
--   is_memory_creator(uuid) — is auth.uid() the creator of the given memory?
--
-- Design principles:
--   - Deny by default (RLS enabled in Migration 10, no policy = no access).
--   - Membership is the gate (all content access flows through is_space_member).
--   - Soft-deleted memories excluded (deleted_at IS NULL in SELECT policies).
--   - No public access (all policies TO authenticated — §16.9).
--   - Principle of least privilege (WITH CHECK enforces ownership of created
--     content).
--
-- Child-table membership checks (media, memory_tags, comments, reactions)
-- use subqueries against memories:
--   (SELECT space_id FROM memories WHERE id = <child>.memory_id)
-- These subqueries are subject to memories RLS, which automatically enforces
-- deleted_at IS NULL — so child rows of soft-deleted memories are hidden too.
-- ============================================================================


-- ============================================================================
-- 1. profiles
-- ============================================================================
-- SELECT: Own row, or share at least one Space with the profile user.
--   Members of the same Space need to see each other's names and avatars.
-- INSERT: No policy — profiles are created only by the handle_new_user
--   trigger (SECURITY DEFINER, bypasses RLS).
-- UPDATE: Own row only (user can edit their own name/avatar).
-- DELETE: Own row only (user can delete their own profile).
-- ============================================================================

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select
    ON profiles
    FOR SELECT
    TO authenticated
    USING (
        id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM space_members sm
            WHERE sm.user_id = profiles.id
              AND is_space_member(sm.space_id)
        )
    );

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update
    ON profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY profiles_delete
    ON profiles
    FOR DELETE
    TO authenticated
    USING (id = auth.uid());


-- ============================================================================
-- 2. spaces
-- ============================================================================
-- SELECT: Member of the space.
-- INSERT: Any authenticated user can create a Space. WITH CHECK enforces
--   created_by = auth.uid() so the creator is always the authenticated user
--   (the handle_new_space trigger then auto-adds them as owner).
-- UPDATE: Owner of the space only.
-- DELETE: Owner of the space only (cascades to all child data).
-- ============================================================================

DROP POLICY IF EXISTS spaces_select ON spaces;
CREATE POLICY spaces_select
    ON spaces
    FOR SELECT
    TO authenticated
    USING (is_space_member(id));

DROP POLICY IF EXISTS spaces_insert ON spaces;
CREATE POLICY spaces_insert
    ON spaces
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS spaces_update ON spaces;
CREATE POLICY spaces_update
    ON spaces
    FOR UPDATE
    TO authenticated
    USING (is_space_owner(id))
    WITH CHECK (is_space_owner(id));

DROP POLICY IF EXISTS spaces_delete ON spaces;
CREATE POLICY spaces_delete
    ON spaces
    FOR DELETE
    TO authenticated
    USING (is_space_owner(id));


-- ============================================================================
-- 3. space_members
-- ============================================================================
-- SELECT: Member of the space (members can see who else is in the Space).
-- INSERT: Owner can add any user (any role), OR a user can self-join as
--   'member' (via invite acceptance). WITH CHECK enforces role = 'member'
--   for self-joins to prevent self-promotion to owner.
-- UPDATE: Owner of the space only (role changes, e.g. promote/demote).
--   The WITH CHECK prevents an owner from demoting themselves (after the
--   update, is_space_owner returns false for them). This is a safety measure;
--   the application can use the service role if self-demotion is needed.
-- DELETE: Owner can remove anyone, OR self can leave (remove own row).
-- ============================================================================

DROP POLICY IF EXISTS space_members_select ON space_members;
CREATE POLICY space_members_select
    ON space_members
    FOR SELECT
    TO authenticated
    USING (is_space_member(space_id));

DROP POLICY IF EXISTS space_members_insert ON space_members;
CREATE POLICY space_members_insert
    ON space_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_owner(space_id)
        OR (user_id = auth.uid() AND role = 'member')
    );

DROP POLICY IF EXISTS space_members_update ON space_members;
CREATE POLICY space_members_update
    ON space_members
    FOR UPDATE
    TO authenticated
    USING (is_space_owner(space_id))
    WITH CHECK (is_space_owner(space_id));

DROP POLICY IF EXISTS space_members_delete ON space_members;
CREATE POLICY space_members_delete
    ON space_members
    FOR DELETE
    TO authenticated
    USING (
        is_space_owner(space_id)
        OR user_id = auth.uid()
    );


-- ============================================================================
-- 4. space_invitations
-- ============================================================================
-- SELECT: Owner of the space, OR invitee matching by email (via JWT).
--   Uses auth.jwt() ->> 'email' to match the invitee's email.
-- INSERT: Owner of the space only (owners create invitations).
-- UPDATE: Owner of the space only (owners manage invitation status).
-- DELETE: Owner of the space only (owners cancel/delete invitations).
-- ============================================================================

DROP POLICY IF EXISTS space_invitations_select ON space_invitations;
CREATE POLICY space_invitations_select
    ON space_invitations
    FOR SELECT
    TO authenticated
    USING (
        is_space_owner(space_id)
        OR email = (auth.jwt() ->> 'email')
    );

DROP POLICY IF EXISTS space_invitations_insert ON space_invitations;
CREATE POLICY space_invitations_insert
    ON space_invitations
    FOR INSERT
    TO authenticated
    WITH CHECK (is_space_owner(space_id));

DROP POLICY IF EXISTS space_invitations_update ON space_invitations;
CREATE POLICY space_invitations_update
    ON space_invitations
    FOR UPDATE
    TO authenticated
    USING (is_space_owner(space_id))
    WITH CHECK (is_space_owner(space_id));

DROP POLICY IF EXISTS space_invitations_delete ON space_invitations;
CREATE POLICY space_invitations_delete
    ON space_invitations
    FOR DELETE
    TO authenticated
    USING (is_space_owner(space_id));


-- ============================================================================
-- 5. memories
-- ============================================================================
-- SELECT: Member of the space AND deleted_at IS NULL (soft-deleted memories
--   are excluded from normal access — §16.7).
-- INSERT: Member of the space. WITH CHECK enforces created_by = auth.uid()
--   (creation-time invariant — §16.2: "A Memory cannot exist without a
--   creator").
-- UPDATE: Space owner OR creator. If created_by IS NULL (creator's account
--   deleted), created_by = auth.uid() evaluates to NULL (not true), so only
--   is_space_owner grants access — matching §11.5 exactly.
-- DELETE: Same as UPDATE (creator or owner can hard-delete; soft-delete is
--   an UPDATE that sets deleted_at).
-- ============================================================================

DROP POLICY IF EXISTS memories_select ON memories;
CREATE POLICY memories_select
    ON memories
    FOR SELECT
    TO authenticated
    USING (
        is_space_member(space_id)
        AND deleted_at IS NULL
    );

DROP POLICY IF EXISTS memories_insert ON memories;
CREATE POLICY memories_insert
    ON memories
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_member(space_id)
        AND created_by = auth.uid()
    );

DROP POLICY IF EXISTS memories_update ON memories;
CREATE POLICY memories_update
    ON memories
    FOR UPDATE
    TO authenticated
    USING (
        is_space_owner(space_id)
        OR created_by = auth.uid()
    )
    WITH CHECK (
        is_space_owner(space_id)
        OR created_by = auth.uid()
    );

DROP POLICY IF EXISTS memories_delete ON memories;
CREATE POLICY memories_delete
    ON memories
    FOR DELETE
    TO authenticated
    USING (
        is_space_owner(space_id)
        OR created_by = auth.uid()
    );


-- ============================================================================
-- 6. media
-- ============================================================================
-- SELECT: Member of the space (via the parent memory's space). The subquery
--   is subject to memories RLS, which enforces deleted_at IS NULL — so media
--   for soft-deleted memories is also hidden.
-- INSERT: Member of the space (via the parent memory's space).
-- UPDATE: Creator of the parent memory only (§11.4).
-- DELETE: Creator of the parent memory only (§11.4).
--   Note: the Storage delete policy (Migration 9) is more permissive (creator
--   OR space owner). This is by design — database RLS is more restrictive
--   for row deletion, while Storage allows owner cleanup of orphaned files.
-- ============================================================================

DROP POLICY IF EXISTS media_select ON media;
CREATE POLICY media_select
    ON media
    FOR SELECT
    TO authenticated
    USING (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = media.memory_id)
        )
    );

DROP POLICY IF EXISTS media_insert ON media;
CREATE POLICY media_insert
    ON media
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = media.memory_id)
        )
    );

DROP POLICY IF EXISTS media_update ON media;
CREATE POLICY media_update
    ON media
    FOR UPDATE
    TO authenticated
    USING (is_memory_creator(memory_id))
    WITH CHECK (is_memory_creator(memory_id));

DROP POLICY IF EXISTS media_delete ON media;
CREATE POLICY media_delete
    ON media
    FOR DELETE
    TO authenticated
    USING (is_memory_creator(memory_id));


-- ============================================================================
-- 7. tags
-- ============================================================================
-- SELECT: Member of the space (tags are shared within a Space — §6).
-- INSERT: Member of the space (any member can create tags).
-- UPDATE: Member of the space (any member can rename tags).
-- DELETE: Space owner only (deleting a tag is a higher-privilege action).
-- ============================================================================

DROP POLICY IF EXISTS tags_select ON tags;
CREATE POLICY tags_select
    ON tags
    FOR SELECT
    TO authenticated
    USING (is_space_member(space_id));

DROP POLICY IF EXISTS tags_insert ON tags;
CREATE POLICY tags_insert
    ON tags
    FOR INSERT
    TO authenticated
    WITH CHECK (is_space_member(space_id));

DROP POLICY IF EXISTS tags_update ON tags;
CREATE POLICY tags_update
    ON tags
    FOR UPDATE
    TO authenticated
    USING (is_space_member(space_id))
    WITH CHECK (is_space_member(space_id));

DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_delete
    ON tags
    FOR DELETE
    TO authenticated
    USING (is_space_owner(space_id));


-- ============================================================================
-- 8. memory_tags
-- ============================================================================
-- SELECT: Member of the space (via the parent memory's space). The subquery
--   is subject to memories RLS, which enforces deleted_at IS NULL.
-- INSERT: Member of the space (any member can tag a memory).
-- UPDATE: No policy (§11.4: "—"). memory_tags is a junction; changes are
--   made via INSERT/DELETE, not UPDATE.
-- DELETE: Member of the space (any member can untag a memory).
-- ============================================================================

DROP POLICY IF EXISTS memory_tags_select ON memory_tags;
CREATE POLICY memory_tags_select
    ON memory_tags
    FOR SELECT
    TO authenticated
    USING (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = memory_tags.memory_id)
        )
    );

DROP POLICY IF EXISTS memory_tags_insert ON memory_tags;
CREATE POLICY memory_tags_insert
    ON memory_tags
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = memory_tags.memory_id)
        )
    );

DROP POLICY IF EXISTS memory_tags_delete ON memory_tags;
CREATE POLICY memory_tags_delete
    ON memory_tags
    FOR DELETE
    TO authenticated
    USING (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = memory_tags.memory_id)
        )
    );


-- ============================================================================
-- 9. comments
-- ============================================================================
-- SELECT: Member of the space (via the parent memory's space). The subquery
--   is subject to memories RLS, which enforces deleted_at IS NULL.
-- INSERT: Member of the space. WITH CHECK enforces user_id = auth.uid()
--   (no anonymous comments — feature-specs §4).
-- UPDATE: Author only (user_id = auth.uid()).
-- DELETE: Author only, OR space owner (§11.4: "Author only (or space
--   owner)"). Hard delete only — feature-specs §4: "Deleted comments are
--   removed permanently (no soft delete for MVP)."
-- ============================================================================

DROP POLICY IF EXISTS comments_select ON comments;
CREATE POLICY comments_select
    ON comments
    FOR SELECT
    TO authenticated
    USING (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = comments.memory_id)
        )
    );

DROP POLICY IF EXISTS comments_insert ON comments;
CREATE POLICY comments_insert
    ON comments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = comments.memory_id)
        )
        AND user_id = auth.uid()
    );

DROP POLICY IF EXISTS comments_update ON comments;
CREATE POLICY comments_update
    ON comments
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS comments_delete ON comments;
CREATE POLICY comments_delete
    ON comments
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR is_space_owner(
            (SELECT space_id FROM memories WHERE id = comments.memory_id)
        )
    );


-- ============================================================================
-- 10. reactions
-- ============================================================================
-- SELECT: Member of the space (via the parent memory's space). The subquery
--   is subject to memories RLS, which enforces deleted_at IS NULL.
-- INSERT: Member of the space. WITH CHECK enforces user_id = auth.uid()
--   (reactions are personal — feature-specs §5).
-- UPDATE: No policy (§11.4: "— (delete + re-insert)"). Reactions are toggles;
--   changing a reaction is done by DELETE + INSERT, not UPDATE.
-- DELETE: Author only (user_id = auth.uid()). Reactions are personal; only
--   the reactor can remove their own reaction.
-- ============================================================================

DROP POLICY IF EXISTS reactions_select ON reactions;
CREATE POLICY reactions_select
    ON reactions
    FOR SELECT
    TO authenticated
    USING (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = reactions.memory_id)
        )
    );

DROP POLICY IF EXISTS reactions_insert ON reactions;
CREATE POLICY reactions_insert
    ON reactions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_space_member(
            (SELECT space_id FROM memories WHERE id = reactions.memory_id)
        )
        AND user_id = auth.uid()
    );

DROP POLICY IF EXISTS reactions_delete ON reactions;
CREATE POLICY reactions_delete
    ON reactions
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());
