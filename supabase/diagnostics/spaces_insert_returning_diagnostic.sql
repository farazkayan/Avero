-- ============================================================================
-- Diagnostic: spaces INSERT ... RETURNING failure (root-cause investigation)
-- ----------------------------------------------------------------------------
-- PURPOSE:
--   Determine the ACTUAL root cause of the spaces INSERT...RETURNING failure
--   reported by CreateSpacePage.tsx, by reproducing the failing scenario
--   directly at the database level (not through the app / PostgREST).
--
--   This script does NOT propose or apply a fix. It only inspects and
--   reproduces. Run it in the Supabase Dashboard SQL Editor.
--
-- HOW TO USE:
--   1. Open Supabase Dashboard -> SQL Editor.
--   2. Set the TEST_USER_ID variable below to a REAL authenticated user's id
--      (the same user you reproduce the bug with in the app). See the lookup
--      query in Section 0 if you don't know the id.
--   3. Run Section 1 (inspection) first — it needs no special role.
--   4. Run Section 2 (simulation) — it switches to the `authenticated` role
--      with JWT claims so RLS applies exactly as PostgREST would apply it.
--   5. Run Section 3 (post-mortem) — as superuser, check what actually landed.
--   6. Report back the outputs of ALL sections (especially any error codes
--      and messages from Section 2).
--
-- IMPORTANT:
--   - Section 2 uses a transaction that ROLLS BACK at the end, so it does NOT
--     leave test data behind. You can re-run it safely.
--   - Each section is self-contained. Run them one at a time.
-- ============================================================================


-- ============================================================================
-- Section 0: Find your test user id (run only if you don't know it)
-- ============================================================================
-- Replace the email with the account you reproduce the bug with in the app.
-- Copy the `id` column from the result into TEST_USER_ID below.

-- SELECT id, email, created_at, raw_user_meta_data
-- FROM auth.users
-- WHERE email = 'farazkayanhaque.work@gmail.com';

-- >>> SET THIS TO YOUR REAL TEST USER UUID <<<
-- (Uncomment and edit the line below, or set it inline in Section 2.)


-- ============================================================================
-- Section 1: INSPECTION — current definitions (run as superuser, no role switch)
-- ============================================================================
-- Shows the exact current state of every object involved in the failure.
-- Compare the outputs against the expected values in the comments.

-- 1.1  handle_new_space() — full definition, volatility, owner, security flag
SELECT
    p.proname                                       AS function_name,
    pg_get_functiondef(p.oid)                       AS function_definition,
    CASE p.provolatile WHEN 's' THEN 'STABLE'
                        WHEN 'v' THEN 'VOLATILE'
                        WHEN 'i' THEN 'IMMUTABLE' END AS volatility,
    p.prosecdef                                     AS is_security_definer,
    pg_get_userbyid(p.proowner)                     AS owner,
    p.proconfig                                     AS proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'handle_new_space';
-- EXPECTED: volatility = STABLE (after revert migration) or VOLATILE (current),
--           is_security_defider = true, owner = postgres,
--           proconfig = {search_path=public}


-- 1.2  is_space_member / is_space_owner / is_memory_creator — volatility + owner
SELECT
    p.proname                                       AS function_name,
    CASE p.provolatile WHEN 's' THEN 'STABLE'
                        WHEN 'v' THEN 'VOLATILE'
                        WHEN 'i' THEN 'IMMUTABLE' END AS volatility,
    p.prosecdef                                     AS is_security_definer,
    pg_get_userbyid(p.proowner)                     AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_space_member', 'is_space_owner', 'is_memory_creator')
ORDER BY p.proname;
-- EXPECTED: all three is_security_defider = true, owner = postgres.
--           Volatility = STABLE after revert (VOLATILE right now if revert
--           migration not yet applied).
--   >>> If owner is NOT postgres (e.g. authenticator / anon), RLS will apply
--       to the trigger's INSERT INTO space_members and likely fail. <<<


-- 1.3  spaces_select policy — exact definition
SELECT
    pol.polname                                     AS policy_name,
    pol.polcmd                                      AS command,  -- r=SELECT, a=ALL, w=UPDATE, d=DELETE, 2=INSERT
    pg_get_expr(pol.polqual, pol.polrelid)          AS using_expr,
    pg_get_expr(pol.polwithcheck, pol.polrelid)     AS with_check_expr,
    pol.polroles                                    AS roles
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'spaces'
ORDER BY pol.polname;
-- EXPECTED: spaces_select  cmd=r  using=is_space_member(id)  with_check=NULL
--           spaces_insert  cmd=2  using=NULL  with_check=(created_by = auth.uid())


-- 1.4  spaces_insert policy — confirm WITH CHECK
SELECT
    pol.polname,
    pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'spaces' AND pol.polname = 'spaces_insert';
-- EXPECTED: (created_by = auth.uid())


-- 1.5  Trigger on_space_created — confirm it exists and is AFTER INSERT
SELECT
    t.tgname                                        AS trigger_name,
    pg_get_triggerdef(t.oid)                        AS trigger_definition,
    (t.tgtype & 4)  <> 0                            AS is_after,    -- bit 2 = AFTER
    (t.tgtype & 1)  <> 0                            AS is_row_level, -- bit 0 = ROW
    (t.tgtype & 8)  <> 0                            AS is_insert
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'spaces'
  AND NOT t.tgisinternal
ORDER BY t.tgname;
-- EXPECTED: on_space_created, AFTER INSERT, FOR EACH ROW, is_after=true,
--           is_row_level=true, is_insert=true.
--   >>> If on_space_created is MISSING, the trigger never fires and
--       space_members is never populated -> RETURNING SELECT policy filters
--       the row out -> 0 rows returned. <<<


-- 1.6  RLS enabled on spaces and space_members?
SELECT
    c.relname,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
WHERE c.relname IN ('spaces', 'space_members')
ORDER BY c.relname;
-- EXPECTED: rls_enabled = true for both. rls_forced = false (table owner
--           bypasses RLS, which is correct for the postgres-owned trigger).


-- 1.7  Grants on spaces / space_members to authenticated
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('spaces', 'space_members')
  AND grantee = 'authenticated'
ORDER BY table_name, privilege_type;
-- EXPECTED: INSERT, SELECT, UPDATE, DELETE on both tables for authenticated.


-- ============================================================================
-- Section 2: SIMULATION — reproduce the failing INSERT ... RETURNING
--            under the authenticated role with JWT claims (exactly like PostgREST)
-- ============================================================================
-- PostgREST, for `supabase.from('spaces').insert({...}).select().single()`,
-- connects as `authenticator`, then for the request runs:
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claim.role = 'authenticated';
--     SET LOCAL request.jwt.claim.sub  = '<user-uuid>';   -- auth.uid() reads this
--     INSERT INTO spaces (...) VALUES (...) RETURNING ...;
-- We replicate that here. The transaction ROLLS BACK so no data persists.
--
-- >>> REPLACE THE UUID BELOW WITH YOUR REAL TEST USER ID <<<
--     (from Section 0). Keep the quotes.

BEGIN;

-- Switch to the authenticated role so RLS applies (authenticator can SET ROLE
-- to authenticated; the SQL Editor runs as postgres which can also do this).
SET LOCAL ROLE authenticated;

-- JWT claims that auth.uid() / auth.jwt() read. sub = the test user's id.
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub  = '00000000-0000-0000-0000-000000000000'; -- <<< EDIT
-- Optional but harmless: a minimal JWT payload for auth.jwt() consumers.
SET LOCAL request.jwt.claims     = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000","email":"farazkayanhaque.work@gmail.com"}';

-- Sanity check: confirm auth.uid() resolves to the test user under this role.
SELECT 'auth.uid() resolves to:' AS label, auth.uid() AS uid;

-- 2A. The EXACT statement PostgREST runs (Prefer: return=representation).
--     If this returns a row -> the bug does NOT reproduce at the SQL layer
--     and the cause is PostgREST/app-specific (see report).
--     If this errors -> capture the SQLSTATE + message (shown in the editor).
INSERT INTO spaces (name, description, created_by)
VALUES ('Diagnostic Test Space', 'created by diagnostic script',
        '00000000-0000-0000-0000-000000000000')  -- <<< EDIT (same UUID as above)
RETURNING id, name, created_by, created_at;

-- 2B. (Optional) If 2A returned a row, also confirm the membership is visible
--     to the SELECT policy at this point in the same transaction:
SELECT 'space_members visible to me now:' AS label,
       sm.space_id, sm.user_id, sm.role
FROM space_members sm
WHERE sm.user_id = auth.uid();

ROLLBACK;  -- discard the test rows so the script is re-runnable


-- ============================================================================
-- Section 3: POST-MORTEM — what actually landed (run as superuser)
-- ============================================================================
-- Run this AFTER Section 2 (which rolled back). Because Section 2 rolled back,
-- these queries should return NOTHING for the test space. They are here so
-- that, if you instead run Section 2 WITHOUT the ROLLBACK (comment it out) to
-- reproduce a real failure, you can inspect the aftermath.

-- 3A. Did the space row get created?
SELECT id, name, created_by, created_at
FROM spaces
WHERE name = 'Diagnostic Test Space'
ORDER BY created_at DESC;

-- 3B. Did the space_members (owner) row get created by the trigger?
SELECT sm.id, sm.space_id, sm.user_id, sm.role, sm.joined_at
FROM space_members sm
JOIN spaces s ON s.id = sm.space_id
WHERE s.name = 'Diagnostic Test Space'
ORDER BY sm.joined_at DESC;

-- 3C. Cross-check: for the most recent space created by the test user, is the
--     owner membership present? (Useful if you reproduce via the app instead.)
SELECT s.id            AS space_id,
       s.name,
       s.created_by,
       sm.id           AS membership_id,
       sm.role,
       sm.user_id
FROM spaces s
LEFT JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = s.created_by
WHERE s.created_by = '00000000-0000-0000-0000-000000000000'  -- <<< EDIT
ORDER BY s.created_at DESC
LIMIT 5;
-- INTERPRETATION:
--   - membership_id IS NULL  -> trigger did NOT create the owner row.
--                               (trigger missing, or handle_new_space skipped
--                                because created_by was NULL, or the trigger's
--                                INSERT failed and rolled back the space too.)
--   - membership_id NOT NULL -> trigger worked; the failure is in the
--                               RETURNING SELECT-policy evaluation, not the
--                               trigger.


-- ============================================================================
-- Section 4: DECISION TREE — map each outcome to a root cause
-- ============================================================================
-- (Read-only commentary. No query to run here.)
--
-- OUTCOME A — Section 2A returns the row (no error):
--   The bug does NOT reproduce at the raw SQL layer. The cause is app/PostgREST
--   specific. Likely candidates:
--     * The frontend is sending a created_by that != auth.uid() (e.g. a stale
--       user.id, or the session resolved to a different user), so the INSERT
--       WITH CHECK fails with 42501. Check the actual request payload + the
--       exact Supabase error code returned to the browser.
--     * PostgREST .single() semantics: if RETURNING returns 0 rows it raises
--       PGRST116 (406 "JSON object requested, multiple (or no) rows returned"),
--       NOT 42501. Confirm the EXACT error code the app receives.
--
-- OUTCOME B — Section 2A errors with SQLSTATE 42501 (insufficient_privilege):
--   The INSERT's WITH CHECK (created_by = auth.uid()) failed. This means
--   created_by != auth.uid() at execution time. Check:
--     * The UUID in SET LOCAL request.jwt.claim.sub matches the created_by
--       literal in the INSERT. (If you edited only one, they mismatch.)
--     * In the app: whether user.id in CreateSpacePage matches the session's
--       auth.uid(). A stale session or a mismatched id would cause this.
--
-- OUTCOME C — Section 2A errors with a different code (e.g. 23503 FK, 23505
--   unique, or a trigger-raised exception):
--   The trigger or a constraint failed. Read the message. Common:
--     * 23503 on space_members.space_id -> the spaces row wasn't visible to
--       the trigger's FK check (shouldn't happen; same transaction).
--     * A RAISE from handle_new_space if created_by is NULL.
--     * If the function owner is NOT postgres, RLS applies to the trigger's
--       INSERT into space_members and the space_members_insert WITH CHECK
--       (is_space_owner OR (user_id=auth.uid() AND role='member')) fails
--       because role='owner' and the creator isn't an owner yet -> 42501
--       raised from WITHIN the trigger, rolling back the whole insert.
--       Section 1.2 (owner column) reveals this.
--
-- OUTCOME D — Section 2A returns 0 rows (no error, empty result):
--   The INSERT succeeded (WITH CHECK passed) but the SELECT policy
--   (is_space_member(id)) filtered the row out of RETURNING. This is the
--   "RETURNING visibility" scenario. Section 3B/3C tells you whether the
--   trigger actually created the membership:
--     * If membership exists but RETURNING was empty -> the SELECT policy
--      couldn't see it at RETURNING time. (This is the only scenario where a
--      visibility/snapshot angle would even apply — and per PostgreSQL CID
--      rules it should NOT happen, so it would point to something unusual
--      like a deferrable constraint or a CTE materialization boundary.)
--     * If membership is MISSING -> the trigger didn't fire / failed silently.
--
-- Report back: the outputs of Sections 1.1-1.7, the exact result of Section 2A
-- (row returned / error code + message / 0 rows), and Sections 3A-3C.
