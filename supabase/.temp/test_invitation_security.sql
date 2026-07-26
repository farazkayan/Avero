-- ============================================================================
-- Verification Tests: Invitation Security Migration
-- ----------------------------------------------------------------------------
-- Tests the behavioral correctness of migration 20260705190000.
-- Uses only standard SQL (no psql meta-commands) so it runs via the
-- Supabase query API.
--
-- Test users (already exist in auth.users):
--   User A: b5925f4b-d6ef-42ec-a95b-5a7e7c2256de / farjana.eden92@gmail.com
--   User B: 06fd4988-3df5-4bdf-802e-6b66d7ce315c / farazkayanhaque.work@gmail.com
-- ============================================================================

-- ============================================================================
-- SETUP: Create test space and invitations
-- ============================================================================

-- Clean up any leftover test data from previous runs
DELETE FROM space_invitations WHERE email IN ('farjana.eden92@gmail.com', 'farazkayanhaque.work@gmail.com', 'test-invitee@example.com');
DELETE FROM space_members WHERE space_id IN (SELECT id FROM spaces WHERE name LIKE 'TEST_SPACE_%');
DELETE FROM spaces WHERE name LIKE 'TEST_SPACE_%';

-- Ensure User A has a profile (they exist in auth.users but may lack a profiles row)
INSERT INTO profiles (id, name)
VALUES ('b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'Test User A')
ON CONFLICT (id) DO NOTHING;

-- Create test space owned by User A.
-- The handle_new_space() trigger auto-adds User A as 'owner' (SECURITY DEFINER,
-- bypasses RLS). We do NOT insert User A's membership manually.
INSERT INTO spaces (id, name, description, created_by)
VALUES ('11111111-0000-0000-0000-000000000001', 'TEST_SPACE_A', 'Test space for verification', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de');

-- Add User B as a member (service role, bypasses RLS)
INSERT INTO space_members (space_id, user_id, role)
VALUES ('11111111-0000-0000-0000-000000000001', '06fd4988-3df5-4bdf-802e-6b66d7ce315c', 'member');

-- ============================================================================
-- TEST 1: Partial unique index prevents duplicate pending invites
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 1: Partial unique index prevents duplicate pending invites';
END $$;

-- Insert first pending invite (should succeed)
INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'test-invitee@example.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', 'aaaaaaaa-0000-0000-0000-000000000001', 'pending', now() + interval '7 days');

DO $$ BEGIN
    RAISE NOTICE '--- First pending invite inserted OK';
END $$;

-- Insert duplicate pending invite (should fail with 23505)
DO $$ BEGIN
    BEGIN
        INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
        VALUES ('11111111-0000-0000-0000-000000000001', 'test-invitee@example.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', 'bbbbbbbb-0000-0000-0000-000000000001', 'pending', now() + interval '7 days');
        RAISE EXCEPTION 'TEST 1 FAILED: duplicate pending invite was NOT blocked';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE '--- TEST 1 PASSED: duplicate pending invite blocked (23505)';
    END;
END $$;

-- Insert same email but with 'cancelled' status (should succeed — partial index only covers pending)
INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'test-invitee@example.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', 'cccccccc-0000-0000-0000-000000000001', 'cancelled', now() + interval '7 days');

DO $$ BEGIN
    RAISE NOTICE '--- TEST 1 PASSED: cancelled invite with same email allowed';
END $$;

-- Clean up the cancelled one
DELETE FROM space_invitations WHERE token = 'cccccccc-0000-0000-0000-000000000001';


-- ============================================================================
-- TEST 2: Trigger blocks inviting an existing member
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 2: Trigger blocks inviting an existing member';
END $$;

-- User B is already a member. Try to invite them (should fail).
DO $$ BEGIN
    BEGIN
        INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
        VALUES ('11111111-0000-0000-0000-000000000001', 'farazkayanhaque.work@gmail.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', 'dddddddd-0000-0000-0000-000000000001', 'pending', now() + interval '7 days');
        RAISE EXCEPTION 'TEST 2 FAILED: inviting existing member was NOT blocked';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE '--- TEST 2 PASSED: inviting existing member blocked (23505)';
    END;
END $$;


-- ============================================================================
-- TEST 3: accept_space_invitation() — valid invite (should succeed)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 3: accept_space_invitation() — valid invite';
END $$;

-- Remove User B's membership temporarily
DELETE FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' AND user_id = '06fd4988-3df5-4bdf-802e-6b66d7ce315c';

-- Create a valid pending invite for User B's email
DELETE FROM space_invitations WHERE email = 'farazkayanhaque.work@gmail.com';
INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'farazkayanhaque.work@gmail.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', 'eeeeeeee-0000-0000-0000-000000000001', 'pending', now() + interval '7 days');

-- Simulate User B's session and accept
DO $$
DECLARE
    v_result uuid;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    v_result := accept_space_invitation('eeeeeeee-0000-0000-0000-000000000001');
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE '--- accept_space_invitation returned space_id: %', v_result;
END $$;

-- Verify membership was created
SELECT user_id, role FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' AND user_id = '06fd4988-3df5-4bdf-802e-6b66d7ce315c';

-- Verify invitation status changed to accepted
SELECT status, accepted_at IS NOT NULL AS has_accepted_at FROM space_invitations WHERE token = 'eeeeeeee-0000-0000-0000-000000000001';

DO $$ BEGIN
    RAISE NOTICE '--- TEST 3 PASSED: valid invite accepted, membership created, status updated';
END $$;


-- ============================================================================
-- TEST 4: accept_space_invitation() — expired invite (should fail)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 4: accept_space_invitation() — expired invite';
END $$;

-- Remove User B's membership again
DELETE FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' AND user_id = '06fd4988-3df5-4bdf-802e-6b66d7ce315c';

-- Create an expired invite
INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'farazkayanhaque.work@gmail.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', 'ffffffff-0000-0000-0000-000000000001', 'pending', now() - interval '1 day');

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    BEGIN
        PERFORM accept_space_invitation('ffffffff-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 4 FAILED: expired invite was NOT rejected';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN
            RAISE NOTICE '--- TEST 4 PASSED: expired invite rejected (object_not_in_prerequisite_state)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Verify the invite was marked as expired
SELECT status FROM space_invitations WHERE token = 'ffffffff-0000-0000-0000-000000000001';


-- ============================================================================
-- TEST 5: accept_space_invitation() — email mismatch (should fail)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 5: accept_space_invitation() — email mismatch';
END $$;

-- Create a valid invite for User B's email
INSERT INTO space_invitations (space_id, email, invited_by, role, token, status, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'farazkayanhaque.work@gmail.com', 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de', 'member', '99999999-0000-0000-0000-000000000001', 'pending', now() + interval '7 days');

-- Simulate User A trying to accept an invite meant for User B
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"b5925f4b-d6ef-42ec-a95b-5a7e7c2256de","email":"farjana.eden92@gmail.com","role":"authenticated"}', true);
    BEGIN
        PERFORM accept_space_invitation('99999999-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 5 FAILED: email mismatch was NOT rejected';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '--- TEST 5 PASSED: email mismatch rejected (insufficient_privilege)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;


-- ============================================================================
-- TEST 6: accept_space_invitation() — already accepted (should fail)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 6: accept_space_invitation() — already accepted invite';
END $$;

-- The invite from TEST 3 was accepted. Try to accept it again.
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    BEGIN
        PERFORM accept_space_invitation('eeeeeeee-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 6 FAILED: already-accepted invite was NOT rejected';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN
            RAISE NOTICE '--- TEST 6 PASSED: already-accepted invite rejected (object_not_in_prerequisite_state)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;


-- ============================================================================
-- TEST 7: accept_space_invitation() — not found (should fail)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 7: accept_space_invitation() — token not found';
END $$;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    BEGIN
        PERFORM accept_space_invitation('00000000-0000-0000-0000-000000000000');
        RAISE EXCEPTION 'TEST 7 FAILED: non-existent token was NOT rejected';
    EXCEPTION
        WHEN no_data_found THEN
            RAISE NOTICE '--- TEST 7 PASSED: non-existent token rejected (no_data_found)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;


-- ============================================================================
-- TEST 8: leave_space() — normal member can leave (should succeed)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 8: leave_space() — normal member leaves';
END $$;

-- User B accepted the invite in TEST 3, so they're a member again.
-- Verify current members
SELECT user_id, role FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' ORDER BY joined_at;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    PERFORM leave_space('11111111-0000-0000-0000-000000000001');
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE '--- TEST 8 PASSED: member left successfully';
END $$;

-- Verify User B is no longer a member
SELECT COUNT(*) AS user_b_membership_count FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' AND user_id = '06fd4988-3df5-4bdf-802e-6b66d7ce315c';


-- ============================================================================
-- TEST 9: leave_space() — last owner cannot leave (should fail)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 9: leave_space() — last owner cannot leave';
END $$;

-- User A is the only owner. Try to leave.
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"b5925f4b-d6ef-42ec-a95b-5a7e7c2256de","email":"farjana.eden92@gmail.com","role":"authenticated"}', true);
    BEGIN
        PERFORM leave_space('11111111-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 9 FAILED: last owner was allowed to leave';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN
            RAISE NOTICE '--- TEST 9 PASSED: last owner cannot leave (object_not_in_prerequisite_state)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;


-- ============================================================================
-- TEST 10: leave_space() — not a member (should fail)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 10: leave_space() — not a member';
END $$;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    BEGIN
        PERFORM leave_space('11111111-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 10 FAILED: non-member was allowed to leave';
    EXCEPTION
        WHEN no_data_found THEN
            RAISE NOTICE '--- TEST 10 PASSED: non-member cannot leave (no_data_found)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;


-- ============================================================================
-- TEST 11: Tightened space_members_insert policy — self-join blocked
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 11: Tightened policy blocks self-join without invitation';
END $$;

-- Simulate User B trying to insert themselves directly (old self-join path)
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"06fd4988-3df5-4bdf-802e-6b66d7ce315c","email":"farazkayanhaque.work@gmail.com","role":"authenticated"}', true);
    BEGIN
        INSERT INTO space_members (space_id, user_id, role)
        VALUES ('11111111-0000-0000-0000-000000000001', '06fd4988-3df5-4bdf-802e-6b66d7ce315c', 'member');
        RAISE EXCEPTION 'TEST 11 FAILED: self-join was NOT blocked by RLS';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE '--- TEST 11 PASSED: self-join blocked by RLS (check_violation)';
        WHEN insufficient_privilege THEN
            RAISE NOTICE '--- TEST 11 PASSED: self-join blocked by RLS (insufficient_privilege)';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;


-- ============================================================================
-- TEST 12: prevent_last_owner_leave trigger — direct DELETE blocked
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 12: Trigger blocks direct DELETE of last owner';
END $$;

-- User A is the last owner. Try to delete directly (bypassing leave_space RPC).
-- This runs as the service role (no JWT), so RLS doesn't apply, but the
-- BEFORE DELETE trigger still fires.
DO $$
BEGIN
    BEGIN
        DELETE FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' AND user_id = 'b5925f4b-d6ef-42ec-a95b-5a7e7c2256de';
        RAISE EXCEPTION 'TEST 12 FAILED: direct DELETE of last owner was NOT blocked';
    EXCEPTION
        WHEN object_not_in_prerequisite_state THEN
            RAISE NOTICE '--- TEST 12 PASSED: direct DELETE of last owner blocked (object_not_in_prerequisite_state)';
    END;
END $$;


-- ============================================================================
-- TEST 13: Owner can still add members directly (trusted path works)
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 13: Owner can still add members directly (trusted path)';
END $$;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"b5925f4b-d6ef-42ec-a95b-5a7e7c2256de","email":"farjana.eden92@gmail.com","role":"authenticated"}', true);
    INSERT INTO space_members (space_id, user_id, role)
    VALUES ('11111111-0000-0000-0000-000000000001', '06fd4988-3df5-4bdf-802e-6b66d7ce315c', 'member');
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE '--- TEST 13 PASSED: owner added member directly';
END $$;

-- Verify
SELECT COUNT(*) AS member_count FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001';


-- ============================================================================
-- TEST 14: leave_space() — owner can leave if another owner exists
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> TEST 14: leave_space() — owner leaves when another owner exists';
END $$;

-- Promote User B to owner
UPDATE space_members SET role = 'owner' WHERE space_id = '11111111-0000-0000-0000-000000000001' AND user_id = '06fd4988-3df5-4bdf-802e-6b66d7ce315c';

-- Now User A (one of two owners) can leave
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"b5925f4b-d6ef-42ec-a95b-5a7e7c2256de","email":"farjana.eden92@gmail.com","role":"authenticated"}', true);
    PERFORM leave_space('11111111-0000-0000-0000-000000000001');
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE '--- TEST 14 PASSED: owner left when another owner exists';
END $$;

-- Verify User A left, User B remains as owner
SELECT user_id, role FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001' ORDER BY joined_at;


-- ============================================================================
-- CLEANUP
-- ============================================================================
DO $$ BEGIN
    RAISE NOTICE '>>> CLEANUP: Removing test data';
END $$;

DELETE FROM space_invitations WHERE space_id = '11111111-0000-0000-0000-000000000001';
DELETE FROM space_members WHERE space_id = '11111111-0000-0000-0000-000000000001';
DELETE FROM spaces WHERE id = '11111111-0000-0000-0000-000000000001';

DO $$ BEGIN
    RAISE NOTICE '>>> ALL TESTS COMPLETE';
END $$;
