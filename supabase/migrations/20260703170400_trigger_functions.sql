-- ============================================================================
-- Migration: Trigger Functions
-- ----------------------------------------------------------------------------
-- Defines the four SQL functions required by the architecture.
--
-- Source of truth: docs/backend-implementation.md §12 (Triggers & Functions).
--
-- NO TRIGGERS ARE ATTACHED IN THIS MIGRATION. Trigger attachment happens in:
--   - Migration 6: handle_new_user on auth.users INSERT
--   - Migration 7: handle_new_space on spaces INSERT
--   - Migration 8: set_updated_at on profiles/spaces/memories/comments UPDATE
--
-- is_space_member(uuid) is defined here (not in a later "helper functions"
-- migration) so that it exists BEFORE the Storage (Migration 9) and RLS
-- (Migration 11) migrations reference it. PostgreSQL resolves function
-- references at CREATE POLICY time, so the function must pre-exist.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- set_updated_at()
-- ----------------------------------------------------------------------------
-- Generic BEFORE UPDATE trigger function that auto-maintains the updated_at
-- column. Reusable across all tables that have an updated_at column
-- (profiles, spaces, memories, comments) because it does not reference any
-- specific table — it operates on the NEW record passed by the trigger.
--
-- Source: §12. The per-table triggers are attached in Migration 8.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- handle_new_user()
-- ----------------------------------------------------------------------------
-- AFTER INSERT trigger function on auth.users. Creates the matching profiles
-- row from Supabase Auth's user metadata, establishing the 1:1 relationship
-- between auth.users and profiles.
--
-- The user's name is sourced from new.raw_user_meta_data->>'name', which is
-- exactly what the frontend stores via supabase.auth.signUp({ options: {
-- data: { name } } }) in SignUpPage.tsx.
--
-- If name is absent from metadata, the function raises an exception rather
-- than creating a profile with an empty or placeholder name. The frontend
-- always sends a validated, non-empty name (SignUpPage.tsx rejects empty
-- names), so a missing name indicates API misuse or a misconfigured auth
-- provider. Because this is an AFTER INSERT trigger, the exception rolls back
-- the entire transaction — including the auth.users insert — so no orphaned
-- auth user is created. This prioritizes data integrity over silent failure
-- (blueprint §7: "Losing a Memory is far worse than delaying a feature").
--
-- Source: §12, Gap 1.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.raw_user_meta_data->>'name' IS NULL
       OR btrim(NEW.raw_user_meta_data->>'name') = '' THEN
        RAISE EXCEPTION
            'handle_new_user: auth.users % has no name in raw_user_meta_data',
            NEW.id
            USING ERRCODE = 'not_null_violation';
    END IF;

    INSERT INTO public.profiles (id, name)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'name'
    );
    RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- handle_new_space()
-- ----------------------------------------------------------------------------
-- AFTER INSERT trigger function on spaces. Auto-adds the creating user as an
-- 'owner' in space_members, ensuring every Space always has at least one
-- owner (feature-specs §1: "Every Space must have at least 1 owner").
--
-- This runs in the same transaction as the Space insert, so if the
-- space_members insert fails, the Space insert is rolled back too — a Space
-- can never exist without an owner.
--
-- The user_id is taken from NEW.created_by. If created_by is NULL (which
-- should not happen at creation time, since the creator must be specified),
-- the trigger skips the insert to avoid a FK violation. This is defensive;
-- the application must always set created_by when creating a Space.
--
-- Source: §12.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_space()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.created_by IS NOT NULL THEN
        INSERT INTO public.space_members (space_id, user_id, role)
        VALUES (NEW.id, NEW.created_by, 'owner');
    END IF;
    RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- is_space_member(p_space_id uuid)
-- ----------------------------------------------------------------------------
-- RLS helper function. Returns true if the current authenticated user
-- (auth.uid()) is a member of the given space.
--
-- SECURITY CONSIDERATIONS:
--   - SECURITY DEFINER: the function executes with the privileges of its
--     owner (the migration/postgres role), bypassing RLS on space_members.
--     This is essential: RLS policies on space_members would otherwise
--     prevent the function from reading the membership table to answer the
--     very question "is this user a member?". Without SECURITY DEFINER, the
--     function would be circular and always return false for non-members.
--   - SET search_path = public: locks the search path to prevent
--     search-path-based privilege escalation (a recommended hardening for
--     SECURITY DEFINER functions).
--   - Returns false when auth.uid() is NULL (unauthenticated request). This
--     ensures deny-by-default behavior: no user means no membership.
--   - Uses EXISTS for efficiency: returns a boolean without fetching rows
--     and short-circuits on the first match.
--   - STABLE: declared STABLE so the query planner can optimize repeated
--     calls within the same statement (e.g. once per row in an RLS-filtered
--     query). IMMUTABLE would be wrong (it reads from a table); VOLATILE
--     (the default) would prevent planner caching. STABLE is correct: the
--     result does not change within a transaction unless the data changes.
--
-- This function is the single gatekeeper for all content access. Every RLS
-- policy on Space-scoped content (memories, media, tags, comments, reactions)
-- flows through it, enforcing the core rule (feature-specs §9):
--   "If you are not in the Space, you cannot see anything inside it."
--
-- Source: §11.3, §12.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_space_member(p_space_id uuid)
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
    );
END;
$$;
