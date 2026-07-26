# Manual Testing Checklist

> **Purpose:** Step-by-step manual testing guide for the Avero database implementation.
> Run this after applying all migrations (Migrations 1–11, 13) and before deploying to production.
>
> **Source of truth:** [`docs/backend-implementation.md`](../docs/backend-implementation.md) §14 Step 8 (Verification).
>
> **Companion file:** [`supabase/migrations/20260703171100_verification_queries.sql`](migrations/20260703171100_verification_queries.sql) — run the relevant section after each test scenario below.
>
> **Prerequisites:**
> - A Supabase project with all migrations applied.
> - Access to the Supabase Dashboard (SQL Editor, Authentication, Storage).
> - At least two test email addresses (e.g., `tester.a@example.com`, `tester.b@example.com`).
> - The Supabase service role key (for service-role queries only — clearly marked).

---

## How to Use This Checklist

1. Work through each section in order — later tests depend on data created in earlier tests.
2. Each test has: **Prerequisites**, **Steps**, **Expected Result**, and **Verification Query** (referencing the verification SQL file).
3. Check the `[ ]` box after each test passes.
4. If a test fails, stop and debug before continuing — later tests may depend on it.

---

## Phase 0: Pre-Flight Structural Verification

### 0.1 Verify all schema objects exist

- [ ] **0.1** Run Section A (queries A.1–A.12) of the verification SQL file in the Supabase SQL Editor.

**Prerequisites:** All migrations applied. No test data required.

**Steps:**
1. Open the Supabase Dashboard → SQL Editor.
2. Open `supabase/migrations/20260703171100_verification_queries.sql`.
3. Run each query in Section A (A.1 through A.12).

**Expected Result:**
- A.1: 10 tables (comments, media, memories, memory_tags, profiles, reactions, space_invitations, space_members, spaces, tags).
- A.2: 5 CHECK constraints.
- A.3: 3 UNIQUE constraints.
- A.4: 1 composite PK (pk_memory_tags).
- A.5: 13 non-implicit indexes.
- A.6: 6 functions; `is_space_member`, `is_space_owner`, `is_memory_creator` have volatility = `s` (STABLE).
- A.7: 5 SECURITY DEFINER functions, each with `search_path=public` in proconfig.
- A.8: 6 triggers (on_auth_user_created, on_space_created, 4× set_updated_at_*).
- A.9: 10 tables, all with `rls_enabled = true`.
- A.10: Policy counts match (total 37).
- A.11: `media` bucket exists, `is_public = false`.
- A.12: 3 Storage policies (media_upload, media_read, media_delete).

---

## Phase 1: Sign-Up & Profile Creation

### 1.1 New user sign-up creates a profiles row

- [ ] **1.1** Verify `handle_new_user()` trigger fires on sign-up.

**Prerequisites:** No existing user with the test email.

**Steps:**
1. Open the Avero app (or Supabase Dashboard → Authentication → Users → Add user).
2. Sign up a new user: `tester.a@example.com`, password `TestPass123!`, name `Alice Tester`.
3. In the SQL Editor, run verification query B.1.

**Expected Result:**
- A row appears in `auth.users` with `raw_user_meta_data->>'name' = 'Alice Tester'`.
- A corresponding row exists in `profiles` with `name = 'Alice Tester'`.
- `profile_name` is NOT NULL in the query result.

**Verification Query:** B.1, B.2

---

### 1.2 Sign-up without a name fails

- [ ] **1.2** Verify `handle_new_user()` raises an exception when name is missing.

**Prerequisites:** Ability to create a user directly via the Supabase Dashboard (bypassing frontend validation).

**Steps:**
1. Supabase Dashboard → Authentication → Users → Add user.
2. Create a user WITHOUT setting `user_metadata.name` (leave it empty).
3. Check if the user was created.

**Expected Result:**
- The user creation fails (or the user is created but immediately rolled back).
- The exception message contains `handle_new_user: auth.users ... has no name in raw_user_meta_data`.
- No orphaned `auth.users` row exists (the AFTER INSERT trigger rolls back the entire transaction).
- Run B.2 to confirm no orphaned profiles exist.

> **Note:** If using the Supabase Dashboard "Add user" form, it may not allow omitting metadata. In that case, use the SQL Editor with the service role:
> ```sql
> -- This should fail:
> INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
> VALUES (
>     gen_random_uuid(),
>     'no.name@example.com',
>     crypt('TestPass123!', gen_salt('bf')),
>     '{"provider":"email","providers":["email"]}'::jsonb,
>     '{}'::jsonb  -- no name
> );
> ```

**Verification Query:** B.2 (confirm no orphaned profiles)

---

## Phase 2: Space Creation & Ownership

### 2.1 Creating a Space auto-adds the creator as owner

- [ ] **2.1** Verify `handle_new_space()` trigger fires on Space creation.

**Prerequisites:** User Alice (`tester.a@example.com`) is signed in.

**Steps:**
1. As Alice, insert a new Space (via the app or SQL Editor with Alice's session):
   ```sql
   -- Run as authenticated user Alice
   INSERT INTO spaces (name, created_by)
   VALUES ('Test Space Alpha', auth.uid());
   ```
2. Run verification query C.1 and C.2.

**Expected Result:**
- A row appears in `spaces` with `name = 'Test Space Alpha'` and `created_by = Alice's UUID`.
- A row appears in `space_members` with `space_id = <new space>`, `user_id = Alice's UUID`, `role = 'owner'`.
- C.1 shows `owner_count >= 1` for the new Space.
- C.2 shows `created_by = owner_user_id`.

**Verification Query:** C.1, C.2

---

### 2.2 Space creation without created_by skips owner creation

- [ ] **2.2** Verify `handle_new_space()` handles NULL `created_by` gracefully.

**Prerequisites:** Service role key.

**Steps:**
1. Using the service role, insert a Space with `created_by = NULL`:
   ```sql
   -- Service role only — bypasses RLS
   INSERT INTO spaces (name, created_by)
   VALUES ('Orphan Space Test', NULL);
   ```
2. Check `space_members` for this Space.

**Expected Result:**
- The Space is created (the trigger does NOT raise an exception).
- No `space_members` row exists for this Space (the trigger skipped the insert because `created_by IS NULL`).
- This confirms the defensive behavior documented in Migration 5.

> **Cleanup:** Delete this test Space afterward:
> ```sql
> DELETE FROM spaces WHERE name = 'Orphan Space Test';
> ```

---

## Phase 3: Membership & Invitations

### 3.1 Owner can invite a user

- [ ] **3.1** Verify Space owner can create an invitation.

**Prerequisites:**
- Alice owns "Test Space Alpha".
- A second user Bob (`tester.b@example.com`) exists in `auth.users` / `profiles`.

**Steps:**
1. As Alice, create an invitation for Bob:
   ```sql
   -- Run as authenticated user Alice
   INSERT INTO space_invitations (space_id, email, role, invited_by, expires_at)
   VALUES (
       '<space-alpha-uuid>',
       'tester.b@example.com',
       'member',
       auth.uid(),
       now() + interval '7 days'
   );
   ```
2. Verify the invitation appears.

**Expected Result:**
- INSERT succeeds (Alice is the owner, so `is_space_owner` returns true).
- A row appears in `space_invitations` with `status = 'pending'`.

---

### 3.2 Non-owner cannot invite

- [ ] **3.2** Verify a non-owner cannot create invitations.

**Prerequisites:** Bob is NOT a member of "Test Space Alpha".

**Steps:**
1. As Bob, attempt to create an invitation:
   ```sql
   -- Run as authenticated user Bob
   INSERT INTO space_invitations (space_id, email, role, invited_by, expires_at)
   VALUES (
       '<space-alpha-uuid>',
       'someone@example.com',
       'member',
       auth.uid(),
       now() + interval '7 days'
   );
   ```

**Expected Result:**
- INSERT fails with an RLS policy violation (new row violates row-level security).
- Bob is not an owner, so `is_space_owner` returns false, and the `WITH CHECK` fails.

---

### 3.3 Invitee can see their own invitation

- [ ] **3.3** Verify invitee can view their pending invitation via JWT email.

**Prerequisites:** An invitation exists for `tester.b@example.com`.

**Steps:**
1. As Bob, query invitations:
   ```sql
   -- Run as authenticated user Bob
   SELECT * FROM space_invitations;
   ```

**Expected Result:**
- Bob sees the invitation addressed to `tester.b@example.com` (even though he's not yet a Space member).
- The `space_invitations_select` policy matches via `email = (auth.jwt() ->> 'email')`.

---

### 3.4 Member self-join via invitation acceptance

- [ ] **3.4** Verify a user can self-join as 'member' (simulating invite acceptance).

**Prerequisites:** Bob has a pending invitation to "Test Space Alpha".

**Steps:**
1. As Bob, insert a `space_members` row for himself:
   ```sql
   -- Run as authenticated user Bob
   INSERT INTO space_members (space_id, user_id, role)
   VALUES ('<space-alpha-uuid>', auth.uid(), 'member');
   ```

**Expected Result:**
- INSERT succeeds. The `WITH CHECK` allows `user_id = auth.uid() AND role = 'member'`.
- Bob is now a member of "Test Space Alpha" with role `member`.

---

### 3.5 Member cannot self-promote to owner

- [ ] **3.5** Verify a member cannot insert themselves as 'owner'.

**Prerequisites:** Bob is a member of "Test Space Alpha".

**Steps:**
1. As Bob, attempt to insert himself as owner:
   ```sql
   -- Run as authenticated user Bob
   INSERT INTO space_members (space_id, user_id, role)
   VALUES ('<space-alpha-uuid>', auth.uid(), 'owner');
   ```

**Expected Result:**
- INSERT fails with RLS violation.
- The `WITH CHECK` requires `is_space_owner(space_id) OR (user_id = auth.uid() AND role = 'member')`. Since `role = 'owner'` and Bob is not an owner, the check fails.

---

### 3.6 Owner can remove a member

- [ ] **3.6** Verify owner can delete a member row.

**Prerequisites:** Bob is a member of "Test Space Alpha". Alice is the owner.

**Steps:**
1. As Alice, delete Bob's membership:
   ```sql
   -- Run as authenticated user Alice
   DELETE FROM space_members
   WHERE space_id = '<space-alpha-uuid>' AND user_id = '<bob-uuid>';
   ```

**Expected Result:**
- DELETE succeeds (Alice is the owner, `is_space_owner` returns true).
- Bob's `space_members` row is removed.

---

### 3.7 Member can leave (self-delete)

- [ ] **3.7** Verify a member can remove their own membership.

**Prerequisites:** Bob is a member of "Test Space Alpha".

**Steps:**
1. As Bob, delete his own membership:
   ```sql
   -- Run as authenticated user Bob
   DELETE FROM space_members
   WHERE space_id = '<space-alpha-uuid>' AND user_id = auth.uid();
   ```

**Expected Result:**
- DELETE succeeds (`user_id = auth.uid()` matches in the `USING` clause).
- Bob is no longer a member.

---

## Phase 4: Memory CRUD & Soft Delete

### 4.1 Member can create a memory

- [ ] **4.1** Verify a Space member can create a memory.

**Prerequisites:** Alice is a member/owner of "Test Space Alpha".

**Steps:**
1. As Alice, create a memory:
   ```sql
   -- Run as authenticated user Alice
   INSERT INTO memories (space_id, title, description, created_by, memory_date)
   VALUES (
       '<space-alpha-uuid>',
       'First Test Memory',
       'A test memory for verification.',
       auth.uid(),
       '2026-07-01'
   );
   ```

**Expected Result:**
- INSERT succeeds. `is_space_member` returns true, and `created_by = auth.uid()` passes `WITH CHECK`.
- A row appears in `memories` with `deleted_at = NULL`.

---

### 4.2 Non-member cannot create a memory

- [ ] **4.2** Verify a non-member cannot create a memory.

**Prerequisites:** Bob is NOT a member of "Test Space Alpha".

**Steps:**
1. As Bob, attempt to create a memory:
   ```sql
   -- Run as authenticated user Bob
   INSERT INTO memories (space_id, title, description, created_by, memory_date)
   VALUES (
       '<space-alpha-uuid>',
       'Unauthorized Memory',
       'Should fail.',
       auth.uid(),
       '2026-07-01'
   );
   ```

**Expected Result:**
- INSERT fails with RLS violation. `is_space_member` returns false for Bob.

---

### 4.3 Creator can soft-delete a memory

- [ ] **4.3** Verify a memory creator can soft-delete (UPDATE deleted_at).

**Prerequisites:** Alice created a memory in "Test Space Alpha".

**Steps:**
1. As Alice, soft-delete the memory:
   ```sql
   -- Run as authenticated user Alice
   UPDATE memories
   SET deleted_at = now()
   WHERE id = '<memory-uuid>';
   ```
2. Run verification query E.1 and E.2.

**Expected Result:**
- UPDATE succeeds (Alice is the creator, `created_by = auth.uid()` passes).
- E.1 (as Alice): The soft-deleted memory does NOT appear (RLS filters `deleted_at IS NULL`).
- E.2 (service role): The memory row still exists with `deleted_at` set to a timestamp.

**Verification Query:** E.1, E.2

---

### 4.4 Soft-deleted memory's child rows are hidden

- [ ] **4.4** Verify child rows (comments, media) of a soft-deleted memory are hidden.

**Prerequisites:**
- A memory exists with comments and/or media.
- The memory has been soft-deleted (deleted_at is set).

**Steps:**
1. As a Space member, query comments for the soft-deleted memory:
   ```sql
   -- Run as authenticated user (Space member)
   SELECT * FROM comments WHERE memory_id = '<soft-deleted-memory-uuid>';
   ```
2. As a Space member, query media for the soft-deleted memory:
   ```sql
   SELECT * FROM media WHERE memory_id = '<soft-deleted-memory-uuid>';
   ```

**Expected Result:**
- Both queries return 0 rows. The subqueries in the child-table RLS policies hit the `memories` table, which is RLS-filtered (`deleted_at IS NULL`), so the soft-deleted memory's children are hidden.

**Verification Query:** E.3

---

### 4.5 Owner can hard-delete a memory (creator is gone)

- [ ] **4.5** Verify Space owner can delete a memory when `created_by IS NULL`.

**Prerequisites:**
- A memory exists with `created_by = NULL` (simulate by setting it to NULL with the service role).
- Alice is the owner of the Space.

**Steps:**
1. (Service role) Set `created_by` to NULL:
   ```sql
   UPDATE memories SET created_by = NULL WHERE id = '<memory-uuid>';
   ```
2. As Alice (owner), delete the memory:
   ```sql
   -- Run as authenticated user Alice
   DELETE FROM memories WHERE id = '<memory-uuid>';
   ```

**Expected Result:**
- DELETE succeeds. `is_space_owner(space_id)` returns true for Alice. `created_by = auth.uid()` evaluates to NULL (not true), but the OR means `is_space_owner` grants access.

---

## Phase 5: Media & Storage

### 5.1 Member can upload a file to Storage

- [ ] **5.1** Verify a Space member can upload a file to the `media` bucket.

**Prerequisites:** Alice is a member of "Test Space Alpha". A memory exists in the Space.

**Steps:**
1. As Alice, upload a file via the Supabase client:
   ```javascript
   // Frontend code (or Supabase Dashboard → Storage)
   const { data, error } = await supabase.storage
       .from('media')
       .upload(
           `spaces/${spaceId}/memories/${memoryId}/${mediaId}.jpg`,
           file
       );
   ```
   Or use the Supabase Dashboard → Storage → media → Upload file with the path:
   `spaces/<space-id>/memories/<memory-id>/<media-id>.jpg`

**Expected Result:**
- Upload succeeds. The `media_upload` Storage policy checks `is_space_member(space_id)` from the path.

---

### 5.2 Non-member cannot upload

- [ ] **5.2** Verify a non-member cannot upload to Storage.

**Prerequisites:** Bob is NOT a member of "Test Space Alpha".

**Steps:**
1. As Bob, attempt to upload a file to the same Space's path.

**Expected Result:**
- Upload fails with a Storage policy violation. `is_space_member` returns false for Bob.

---

### 5.3 Member can read Storage objects

- [ ] **5.3** Verify a Space member can read (download) files from Storage.

**Prerequisites:** A file exists in the `media` bucket under a Space Alice is a member of.

**Steps:**
1. As Alice, list or download files from the `media` bucket.

**Expected Result:**
- Alice can see and download files in Spaces she is a member of.
- Files in Spaces she is NOT a member of are hidden.

---

### 5.4 Path convention is enforced

- [ ] **5.4** Verify files with non-conforming paths are inaccessible.

**Prerequisites:** Service role key.

**Steps:**
1. (Service role) Upload a file with a non-conforming path:
   ```
   random/path/file.jpg
   ```
2. As a Space member, attempt to list/download this file.

**Expected Result:**
- The file is invisible to all authenticated users. The Storage policies require `name ~ '^spaces/[0-9a-fA-F-]+/memories/[0-9a-fA-F-]+/'`, so non-conforming paths are excluded.

> **Cleanup:** Delete the non-conforming file with the service role.

**Verification Query:** H.2

---

### 5.5 Media row and Storage object linkage

- [ ] **5.5** Verify media table rows correspond to Storage objects.

**Prerequisites:** At least one media row exists with a corresponding Storage object.

**Steps:**
1. (Service role) Run verification queries H.3 and H.4.

**Expected Result:**
- H.3: All Storage objects show `link_status = 'linked'` (no orphaned files).
- H.4: All media rows show `link_status = 'linked'` (no orphaned media rows).

**Verification Query:** H.3, H.4

---

## Phase 6: Tags

### 6.1 Member can create tags

- [ ] **6.1** Verify a Space member can create a tag.

**Prerequisites:** Alice is a member of "Test Space Alpha".

**Steps:**
1. As Alice, create a tag:
   ```sql
   INSERT INTO tags (space_id, name)
   VALUES ('<space-alpha-uuid>', 'Summer');
   ```

**Expected Result:**
- INSERT succeeds. `is_space_member` returns true.

---

### 6.2 Case-insensitive tag uniqueness

- [ ] **6.2** Verify duplicate tags (case-insensitive) are rejected.

**Prerequisites:** A tag named `Summer` exists in "Test Space Alpha".

**Steps:**
1. As Alice, attempt to create a tag with different casing:
   ```sql
   INSERT INTO tags (space_id, name)
   VALUES ('<space-alpha-uuid>', 'summer');
   ```

**Expected Result:**
- INSERT fails with a unique constraint violation on `uq_tags_space_name_lower`.
- The UNIQUE INDEX on `(space_id, lower(name))` prevents the duplicate.

---

### 6.3 Only owner can delete tags

- [ ] **6.3** Verify a non-owner member cannot delete a tag.

**Prerequisites:** Bob is a member (not owner) of "Test Space Alpha". A tag exists.

**Steps:**
1. As Bob, attempt to delete a tag:
   ```sql
   DELETE FROM tags WHERE id = '<tag-uuid>';
   ```

**Expected Result:**
- DELETE fails with RLS violation. `is_space_owner` returns false for Bob. Only owners can delete tags.

---

## Phase 7: Comments

### 7.1 Member can comment on a memory

- [ ] **7.1** Verify a Space member can create a comment.

**Prerequisites:** Alice is a member of "Test Space Alpha". A memory exists.

**Steps:**
1. As Alice, create a comment:
   ```sql
   INSERT INTO comments (memory_id, user_id, content)
   VALUES ('<memory-uuid>', auth.uid(), 'Great memory!');
   ```

**Expected Result:**
- INSERT succeeds. `is_space_member` (via memory subquery) returns true, and `user_id = auth.uid()` passes `WITH CHECK`.

---

### 7.2 Author can edit their own comment

- [ ] **7.2** Verify a comment author can update their comment.

**Prerequisites:** Alice created a comment.

**Steps:**
1. As Alice, update the comment:
   ```sql
   UPDATE comments SET content = 'Updated comment!' WHERE id = '<comment-uuid>';
   ```

**Expected Result:**
- UPDATE succeeds. `user_id = auth.uid()` passes both `USING` and `WITH CHECK`.

---

### 7.3 Non-author cannot edit a comment

- [ ] **7.3** Verify a non-author member cannot edit someone else's comment.

**Prerequisites:** Bob is a member of the same Space. Alice created the comment.

**Steps:**
1. As Bob, attempt to update Alice's comment:
   ```sql
   UPDATE comments SET content = 'Hijacked!' WHERE id = '<comment-uuid>';
   ```

**Expected Result:**
- UPDATE fails (0 rows affected). `user_id = auth.uid()` is false for Bob.

---

### 7.4 Author or owner can delete a comment

- [ ] **7.4** Verify comment author and Space owner can delete comments.

**Prerequisites:** Alice created a comment. Alice is also the Space owner.

**Steps:**
1. As Alice, delete the comment:
   ```sql
   DELETE FROM comments WHERE id = '<comment-uuid>';
   ```

**Expected Result:**
- DELETE succeeds. `user_id = auth.uid()` is true (author) OR `is_space_owner` is true (owner).

---

### 7.5 Non-author non-owner cannot delete

- [ ] **7.5** Verify a non-author member cannot delete someone else's comment.

**Prerequisites:** Bob is a member (not owner). Alice created the comment.

**Steps:**
1. As Bob, attempt to delete Alice's comment:
   ```sql
   DELETE FROM comments WHERE id = '<comment-uuid>';
   ```

**Expected Result:**
- DELETE fails (0 rows affected). Bob is neither the author nor the owner.

---

## Phase 8: Reactions

### 8.1 Member can react to a memory

- [ ] **8.1** Verify a Space member can create a reaction.

**Prerequisites:** Alice is a member of "Test Space Alpha". A memory exists.

**Steps:**
1. As Alice, create a reaction:
   ```sql
   INSERT INTO reactions (memory_id, user_id, type)
   VALUES ('<memory-uuid>', auth.uid(), 'heart');
   ```

**Expected Result:**
- INSERT succeeds. `is_space_member` returns true, and `user_id = auth.uid()` passes `WITH CHECK`.

---

### 8.2 Duplicate reaction type is rejected

- [ ] **8.2** Verify a user cannot create the same reaction type twice.

**Prerequisites:** Alice already has a `heart` reaction on the memory.

**Steps:**
1. As Alice, attempt to create another `heart` reaction:
   ```sql
   INSERT INTO reactions (memory_id, user_id, type)
   VALUES ('<memory-uuid>', auth.uid(), 'heart');
   ```

**Expected Result:**
- INSERT fails with a unique constraint violation on `uq_reactions_memory_user_type`.

---

### 8.3 User can change reaction type (delete + insert)

- [ ] **8.3** Verify a user can change their reaction by deleting and re-inserting.

**Prerequisites:** Alice has a `heart` reaction on the memory.

**Steps:**
1. As Alice, delete the `heart` reaction:
   ```sql
   DELETE FROM reactions
   WHERE memory_id = '<memory-uuid>' AND user_id = auth.uid() AND type = 'heart';
   ```
2. As Alice, insert a `fire` reaction:
   ```sql
   INSERT INTO reactions (memory_id, user_id, type)
   VALUES ('<memory-uuid>', auth.uid(), 'fire');
   ```

**Expected Result:**
- DELETE succeeds (`user_id = auth.uid()` passes).
- INSERT succeeds (the `heart` reaction is gone, so no unique constraint violation).

---

### 8.4 Non-author cannot delete someone else's reaction

- [ ] **8.4** Verify a user cannot delete another user's reaction.

**Prerequisites:** Alice has a reaction. Bob is a member of the same Space.

**Steps:**
1. As Bob, attempt to delete Alice's reaction:
   ```sql
   DELETE FROM reactions
   WHERE memory_id = '<memory-uuid>' AND user_id = '<alice-uuid>';
   ```

**Expected Result:**
- DELETE fails (0 rows affected). `user_id = auth.uid()` is false for Bob (he's trying to delete Alice's reaction, not his own).

---

## Phase 9: RLS Isolation (Cross-Space)

### 9.1 Member of Space A cannot see Space B's content

- [ ] **9.1** Verify cross-Space isolation.

**Prerequisites:**
- Alice is a member of "Test Space Alpha" only.
- A second Space "Test Space Beta" exists with memories, comments, etc.
- Alice is NOT a member of "Test Space Beta".

**Steps:**
1. As Alice, query all content:
   ```sql
   SELECT * FROM spaces;
   SELECT * FROM memories;
   SELECT * FROM comments;
   SELECT * FROM reactions;
   SELECT * FROM media;
   SELECT * FROM tags;
   ```

**Expected Result:**
- Alice sees only "Test Space Alpha" and its content.
- No data from "Test Space Beta" appears in any query.

**Verification Query:** D.1–D.6

---

## Phase 10: Cascade Behavior

### 10.1 Space deletion cascades to all child data

- [ ] **10.1** Verify CASCADE removes all child data when a Space is deleted.

**Prerequisites:**
- "Test Space Alpha" has memories, media, tags, memory_tags, comments, reactions, space_members, and space_invitations.
- Alice is the owner.

**Steps:**
1. Run verification query F.1 (record before-counts).
2. As Alice (owner), delete the Space:
   ```sql
   DELETE FROM spaces WHERE id = '<space-alpha-uuid>';
   ```
3. Run verification query F.2 (verify after-counts).

**Expected Result:**
- F.1: Non-zero counts for all child tables.
- F.2: All counts = 0. CASCADE removed:
  - `space_members` (CASCADE)
  - `space_invitations` (CASCADE)
  - `memories` (CASCADE)
  - `media` (CASCADE via memories)
  - `tags` (CASCADE)
  - `memory_tags` (CASCADE via memories and tags)
  - `comments` (CASCADE via memories)
  - `reactions` (CASCADE via memories)

**Verification Query:** F.1, F.2

> **Warning:** This test is destructive. Use a dedicated test Space, not production data.

---

## Phase 11: SET NULL Behavior (Account Deletion)

### 11.1 Account deletion sets created_by to NULL (Space/Memory survive)

- [ ] **11.1** Verify ON DELETE SET NULL behavior when a user's account is deleted.

**Prerequisites:**
- A test user (e.g., `tester.c@example.com`) has created a Space and memories.
- The test user is a member of at least one Space.

**Steps:**
1. Run verification query G.1 (record the user's created Spaces/memories).
2. (Service role) Delete the user's account:
   ```sql
   DELETE FROM auth.users WHERE id = '<tester-c-uuid>';
   ```
3. Run verification queries G.2, G.3, G.4.

**Expected Result:**
- G.1: Rows showing the user's created Spaces and memories with non-NULL `created_by`.
- G.2: The Spaces and memories still exist but `created_by` is NULL (ON DELETE SET NULL).
- G.3: The user's `space_members` rows are gone (CASCADE from `auth.users` → `profiles` → `space_members`).
- G.4: The user's `profiles` row is gone (CASCADE from `auth.users` → `profiles`).

**Verification Query:** G.1, G.2, G.3, G.4

> **Warning:** This test is destructive. Use a dedicated test user, not a real account.

---

## Phase 12: updated_at Triggers

### 12.1 updated_at is auto-maintained on UPDATE

- [ ] **12.1** Verify `set_updated_at()` triggers update `updated_at` on UPDATE.

**Prerequisites:** A profile, space, memory, and comment exist.

**Steps:**
1. Record the current `updated_at` values:
   ```sql
   SELECT id, name, updated_at FROM profiles WHERE id = auth.uid();
   SELECT id, name, updated_at FROM spaces LIMIT 1;
   SELECT id, title, updated_at FROM memories LIMIT 1;
   SELECT id, content, updated_at FROM comments LIMIT 1;
   ```
2. Wait 2 seconds (to ensure `now()` differs).
3. Update each row:
   ```sql
   UPDATE profiles SET name = name WHERE id = auth.uid();
   UPDATE spaces SET name = name WHERE id = (SELECT id FROM spaces LIMIT 1);
   UPDATE memories SET title = title WHERE id = (SELECT id FROM memories LIMIT 1);
   UPDATE comments SET content = content WHERE id = (SELECT id FROM comments LIMIT 1);
   ```
4. Re-query `updated_at`:
   ```sql
   SELECT id, updated_at FROM profiles WHERE id = auth.uid();
   SELECT id, updated_at FROM spaces LIMIT 1;
   SELECT id, updated_at FROM memories LIMIT 1;
   SELECT id, updated_at FROM comments LIMIT 1;
   ```

**Expected Result:**
- The `updated_at` values have changed (increased) after the UPDATE.
- The `set_updated_at()` trigger set `NEW.updated_at = now()` before the UPDATE was applied.

---

## Phase 13: Final Verification

### 13.1 Re-run structural verification

- [ ] **13.1** Re-run Section A of the verification SQL file.

**Prerequisites:** All manual tests above are complete.

**Steps:**
1. Run all queries in Section A (A.1–A.12) of the verification SQL file.

**Expected Result:**
- All results match the expected values from Phase 0.
- No schema objects were accidentally dropped or modified during testing.

---

## Cleanup

After all tests are complete, clean up test data:

- [ ] Delete test Spaces (if not already deleted during cascade testing).
- [ ] Delete test users (Supabase Dashboard → Authentication → Users).
- [ ] Delete orphaned Storage objects (Supabase Dashboard → Storage → media).
- [ ] Run Section A verification queries one final time to confirm the schema is intact.

---

## Summary

| Phase | Tests | Description |
|-------|-------|-------------|
| 0 | 1 | Structural integrity (no data required) |
| 1 | 2 | Sign-up & profile creation trigger |
| 2 | 2 | Space creation & ownership trigger |
| 3 | 7 | Membership & invitations |
| 4 | 5 | Memory CRUD & soft delete |
| 5 | 5 | Media & Storage |
| 6 | 3 | Tags |
| 7 | 5 | Comments |
| 8 | 4 | Reactions |
| 9 | 1 | RLS cross-Space isolation |
| 10 | 1 | Cascade behavior |
| 11 | 1 | SET NULL behavior |
| 12 | 1 | updated_at triggers |
| 13 | 1 | Final structural verification |
| **Total** | **39** | |
