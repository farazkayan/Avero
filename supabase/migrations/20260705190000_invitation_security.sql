-- ============================================================================
-- Migration: Invitation Security (Phase 2 — Spaces)
-- ----------------------------------------------------------------------------
-- Closes the RLS gaps identified in docs/spaces-design.md §2:
--   Gap 1 (CRITICAL): Self-join without invitation verification
--   Gap 2: Invitee cannot update invitation status
--   Gap 3: No duplicate pending invite prevention
--   Gap 4: "Already a member" check requires auth.users access
--   Gap 5: (Deferred — no decline flow for MVP, confirmed in review)
--   Gap 6: Expiry is application-level (documented, no fix needed)
--
-- Additionally enforces last-owner protection at the DB level (confirmed in
-- user review of spaces-design.md §10.3):
--   - leave_space() RPC rejects if caller is last owner or last member
--   - BEFORE DELETE trigger on space_members as defense-in-depth
--
-- This migration creates:
--   1. Partial unique index on pending invitations (Gap 3)
--   2. BEFORE INSERT trigger on space_invitations to block inviting existing
--      members (Gap 4)
--   3. accept_space_invitation() RPC — atomically validates + inserts
--      membership + updates invitation (Gaps 1 + 2)
--   4. leave_space() RPC with last-owner / last-member protection
--   5. BEFORE DELETE trigger on space_members for last-owner protection
--      (defense-in-depth — catches direct DELETEs that bypass the RPC)
--   6. Tightened space_members_insert policy — removes the open self-join
--      branch (Gap 1)
--
-- Confirmed decisions from design review:
--   - No decline flow for MVP (invitations expire after 7 days)
--   - No email sending — MVP uses copyable invite links only
--   - space_invitations.role is always 'member' for Phase 2
--   - Invite link format: /invite/:token (path parameter)
--   - Modifying space_members_insert policy is confirmed necessary
--   - Last-owner protection enforced at DB level (not just UI)
-- ============================================================================


-- ============================================================================
-- 1. Partial unique index on pending invitations (Gap 3)
-- ----------------------------------------------------------------------------
-- Prevents duplicate pending invitations for the same (space_id, email) pair.
-- Only applies to status = 'pending' so re-inviting after expiry or
-- cancellation is still allowed.
--
-- The client catches PostgreSQL error code 23505 (unique_violation) and maps
-- it to: "An invitation has already been sent to this email."
-- ============================================================================

CREATE UNIQUE INDEX uq_space_invitations_pending_email
    ON space_invitations (space_id, email)
    WHERE status = 'pending';


-- ============================================================================
-- 2. Trigger: check_invitation_not_existing_member (Gap 4)
-- ----------------------------------------------------------------------------
-- BEFORE INSERT trigger on space_invitations. Prevents inviting an email that
-- is already a member of the space.
--
-- Emails live in auth.users (not accessible via RLS to other users). This
-- trigger function is SECURITY DEFINER so it can join space_members with
-- auth.users to check membership by email.
--
-- Email comparison uses LOWER() for case-insensitive matching, so
-- "User@Test.com" and "user@test.com" are treated as the same address.
--
-- The client catches error code 23505 (unique_violation) and maps it to:
-- "This person is already a member of this space."
-- ============================================================================

CREATE OR REPLACE FUNCTION check_invitation_not_existing_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM space_members sm
        JOIN auth.users au ON au.id = sm.user_id
        WHERE sm.space_id = NEW.space_id
          AND LOWER(au.email) = LOWER(NEW.email)
    ) THEN
        RAISE EXCEPTION 'This person is already a member of this space.'
            USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER before_space_invitation_insert
    BEFORE INSERT ON space_invitations
    FOR EACH ROW
    EXECUTE FUNCTION check_invitation_not_existing_member();


-- ============================================================================
-- 3. RPC: accept_space_invitation (Gaps 1 + 2)
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER function that atomically:
--   1. Verifies the caller is authenticated (auth.uid() IS NOT NULL)
--   2. Looks up the invitation by token (FOR UPDATE — prevents race conditions)
--   3. Checks status = 'pending' (not already used/cancelled/expired)
--   4. Checks expires_at > now() (marks as 'expired' for cleanliness if not)
--   5. Checks the invitee's email (from auth.jwt()) matches the invitation
--   6. Checks the invitee is not already a member (defensive — clearer error)
--   7. Inserts a space_members row with the invitation's role
--   8. Updates the invitation: status = 'accepted', accepted_at = now()
--   9. Returns the space_id (for client-side navigation)
--
-- This function bypasses RLS (SECURITY DEFINER) to perform both the
-- membership insert and the invitation update atomically in a single
-- transaction. The tightened space_members_insert policy (section 6) ensures
-- the only self-join path is through this function.
--
-- Security walk-through (confirmed safe — no remaining path to join without
-- a valid invitation):
--   - auth.uid() must be non-NULL (authenticated)
--   - Token must match a real invitation row (FOR UPDATE locked)
--   - Status must be 'pending' (not already used/cancelled/expired)
--   - Expiry must be in the future
--   - JWT email must match invitation email (case-insensitive)
--   - Must not already be a member
--   - All checks + insert + update are in one transaction (atomic)
--
-- Error codes (for frontend mapping):
--   insufficient_privilege (42501) — not authenticated, or email mismatch
--   no_data_found (P0002) — invitation not found
--   object_not_in_prerequisite_state (55000) — already used/cancelled/expired
--   unique_violation (23505) — already a member
-- ============================================================================

CREATE OR REPLACE FUNCTION accept_space_invitation(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invitation space_invitations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to accept an invitation.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Lock the invitation row to prevent race conditions (double-accept)
    SELECT * INTO v_invitation
    FROM space_invitations
    WHERE token = p_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This invitation could not be found.'
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_invitation.status != 'pending' THEN
        RAISE EXCEPTION 'This invitation has already been used or cancelled.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF v_invitation.expires_at <= now() THEN
        -- Mark as expired for data cleanliness
        UPDATE space_invitations
        SET status = 'expired'
        WHERE id = v_invitation.id;

        RAISE EXCEPTION 'This invitation has expired.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF LOWER(v_invitation.email) != LOWER(auth.jwt() ->> 'email') THEN
        RAISE EXCEPTION 'This invitation was sent to a different email address.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Check if already a member (defensive — gives a clearer error than
    -- the UNIQUE constraint violation on space_members)
    IF EXISTS (
        SELECT 1 FROM space_members
        WHERE space_id = v_invitation.space_id
          AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'You are already a member of this space.'
            USING ERRCODE = 'unique_violation';
    END IF;

    -- Insert membership (bypasses RLS — SECURITY DEFINER)
    INSERT INTO space_members (space_id, user_id, role)
    VALUES (v_invitation.space_id, auth.uid(), v_invitation.role);

    -- Mark invitation as accepted (bypasses RLS — SECURITY DEFINER)
    UPDATE space_invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_invitation.id;

    RETURN v_invitation.space_id;
END;
$$;

REVOKE ALL ON FUNCTION accept_space_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_space_invitation(uuid) TO authenticated;


-- ============================================================================
-- 4. RPC: leave_space (last-owner protection)
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER function that allows a user to leave a space, with
-- DB-level enforcement of last-owner and last-member protection.
--
-- Checks (in order):
--   1. Caller is authenticated
--   2. Caller is a member of the space
--   3. Caller is not the last member (space would be orphaned)
--   4. If caller is an owner, they are not the last owner
--
-- Uses pg_advisory_xact_lock to serialize concurrent leave/remove operations
-- on the same space, preventing race conditions where two owners leave
-- simultaneously and both pass the count check before either commits.
--
-- The BEFORE DELETE trigger (section 5) provides defense-in-depth for direct
-- DELETEs that bypass this RPC. Both use the same advisory lock key.
--
-- Error codes (for frontend mapping):
--   insufficient_privilege (42501) — not authenticated
--   no_data_found (P0002) — not a member of this space
--   object_not_in_prerequisite_state (55000) — last owner or last member
-- ============================================================================

CREATE OR REPLACE FUNCTION leave_space(p_space_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_membership space_members%ROWTYPE;
    v_member_count int;
    v_owner_count int;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to leave a space.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Advisory lock to serialize concurrent leave/remove operations on this
    -- space. Key matches the prevent_last_owner_leave trigger (section 5).
    PERFORM pg_advisory_xact_lock(hashtext('space:' || p_space_id::text));

    -- Find the caller's membership
    SELECT * INTO v_membership
    FROM space_members
    WHERE space_id = p_space_id
      AND user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'You are not a member of this space.'
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Count total members and owners
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE role = 'owner')
    INTO v_member_count, v_owner_count
    FROM space_members
    WHERE space_id = p_space_id;

    -- If the caller is the last member, they can't leave
    IF v_member_count <= 1 THEN
        RAISE EXCEPTION 'You are the only member of this space. Consider deleting the space instead.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- If the caller is an owner and the last owner, they can't leave
    IF v_membership.role = 'owner' AND v_owner_count <= 1 THEN
        RAISE EXCEPTION 'You are the last owner of this space. Transfer ownership or delete the space before leaving.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Safe to leave — delete the membership.
    -- The prevent_last_owner_leave trigger (section 5) fires here but the
    -- advisory lock is already held (same transaction, re-entrant) and the
    -- counts have been verified, so it passes.
    DELETE FROM space_members
    WHERE id = v_membership.id;
END;
$$;

REVOKE ALL ON FUNCTION leave_space(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_space(uuid) TO authenticated;


-- ============================================================================
-- 5. Trigger: prevent_last_owner_leave (defense-in-depth)
-- ----------------------------------------------------------------------------
-- BEFORE DELETE trigger on space_members. Catches direct DELETE operations
-- that bypass the leave_space() RPC (e.g., an owner removing the last other
-- owner via supabase.from('space_members').delete()).
--
-- Uses the same advisory lock key as leave_space() to prevent race conditions
-- across both code paths.
--
-- Allows cascade deletes (space deletion, account deletion) by checking if
-- the space or profile still exists — if either is gone, the delete is part
-- of a cascade and should be allowed:
--   - Space deleted → space_members cascade-deleted → space row gone
--   - Account deleted → profiles cascade-deleted → profile row gone
--
-- Error codes (for frontend mapping):
--   object_not_in_prerequisite_state (55000) — last owner or last member
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_last_owner_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_count int;
    v_owner_count int;
BEGIN
    -- Allow cascade deletes when the space is being deleted (space row gone)
    IF NOT EXISTS (SELECT 1 FROM spaces WHERE id = OLD.space_id) THEN
        RETURN OLD;
    END IF;

    -- Allow cascade deletes when the user's account is being deleted
    -- (profile row gone)
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN
        RETURN OLD;
    END IF;

    -- Advisory lock to serialize concurrent operations on this space.
    -- Re-entrant if leave_space() already holds it (same transaction).
    PERFORM pg_advisory_xact_lock(hashtext('space:' || OLD.space_id::text));

    -- Count members and owners that would remain AFTER this deletion.
    -- In a BEFORE DELETE trigger, OLD still exists in the table, so we
    -- subtract 1 from the total and from owners (if OLD is an owner).
    SELECT
        COUNT(*) - 1,
        COUNT(*) FILTER (WHERE role = 'owner')
            - (CASE WHEN OLD.role = 'owner' THEN 1 ELSE 0 END)
    INTO v_member_count, v_owner_count
    FROM space_members
    WHERE space_id = OLD.space_id;

    -- If this is the last member, block
    IF v_member_count <= 0 THEN
        RAISE EXCEPTION 'Cannot remove the last member of a space. Delete the space instead.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- If this is the last owner, block
    IF OLD.role = 'owner' AND v_owner_count <= 0 THEN
        RAISE EXCEPTION 'Cannot remove the last owner of a space. Transfer ownership or delete the space first.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER before_space_member_delete
    BEFORE DELETE ON space_members
    FOR EACH ROW
    EXECUTE FUNCTION prevent_last_owner_leave();


-- ============================================================================
-- 6. Tighten space_members_insert policy (Gap 1 — CRITICAL)
-- ----------------------------------------------------------------------------
-- Removes the open self-join branch:
--   OR (user_id = auth.uid() AND role = 'member')
--
-- This branch allowed ANY authenticated user to join ANY space by simply
-- knowing the space_id — no invitation verification. The only self-join path
-- is now through accept_space_invitation() (SECURITY DEFINER, bypasses RLS).
--
-- Owners can still insert members directly (is_space_owner check), which is
-- the trusted path used by handle_new_space() (trigger on spaces INSERT) and
-- potential future admin operations.
--
-- This is the ONLY existing policy modified. All other 36 policies remain
-- untouched. Uses DROP POLICY IF EXISTS + CREATE POLICY (same idempotent
-- pattern as the original migration).
-- ============================================================================

DROP POLICY IF EXISTS space_members_insert ON space_members;
CREATE POLICY space_members_insert
    ON space_members
    FOR INSERT
    TO authenticated
    WITH CHECK (is_space_owner(space_id));
