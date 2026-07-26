-- ============================================================================
-- Migration: Tables
-- ----------------------------------------------------------------------------
-- Creates all 10 application tables in strict dependency order so that every
-- foreign key references a table that already exists.
--
-- Source of truth: docs/backend-implementation.md §5 (Table Specifications)
-- and §14 Step 2 (Implementation Order).
--
-- This migration contains ONLY table structure:
--   - columns and data types
--   - single-column primary keys
--   - foreign keys with the approved ON DELETE behavior
--   - NOT NULL constraints
--   - default values
--
-- It deliberately EXCLUDES (deferred to later migrations):
--   - CHECK constraints            -> Migration 3 (Constraints)
--   - UNIQUE constraints            -> Migration 3 (Constraints)
--   - memory_tags composite PK      -> Migration 3 (Constraints)
--   - indexes                       -> Migration 4 (Indexes)
--   - triggers / RLS / functions    -> later migrations
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. profiles
--    Extends Supabase Auth's auth.users with app-level user data.
--    Populated by the handle_new_user() trigger (added in a later migration).
--    Source: §5.1
-- ----------------------------------------------------------------------------
CREATE TABLE profiles (
    id          uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    name        text NOT NULL,
    avatar_url  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 2. spaces
--    A private, shared memory environment.
--    created_by is nullable + ON DELETE SET NULL: the Space survives if the
--    creator deletes their account. Ownership is tracked via space_members
--    (creator auto-added as 'owner' by the handle_new_space trigger).
--    Source: §5.2, §7.3
-- ----------------------------------------------------------------------------
CREATE TABLE spaces (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text,
    created_by  uuid REFERENCES profiles (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 3. space_members
--    Membership junction between users and spaces.
--    Both FKs use CASCADE: memberships are removed with the space or account.
--    The UNIQUE (space_id, user_id) constraint is added in Migration 3.
--    Source: §5.3
-- ----------------------------------------------------------------------------
CREATE TABLE space_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id   uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    role       text NOT NULL,
    joined_at  timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 4. space_invitations
--    Token-based invitations to join a Space.
--    invited_by is nullable + ON DELETE SET NULL: the invitation survives if
--    the inviter deletes their account (it belongs to the Space, not the
--    inviter). expires_at is set at creation to now() + interval '7 days'
--    by the application.
--    Source: §5.4, §7.3
-- ----------------------------------------------------------------------------
CREATE TABLE space_invitations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id     uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    email        text NOT NULL,
    invited_by   uuid REFERENCES profiles (id) ON DELETE SET NULL,
    role         text NOT NULL DEFAULT 'member',
    token        uuid NOT NULL DEFAULT gen_random_uuid(),
    status       text NOT NULL DEFAULT 'pending',
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    accepted_at  timestamptz
);


-- ----------------------------------------------------------------------------
-- 5. memories
--    The core object of Avero.
--    created_by is nullable + ON DELETE SET NULL: the Memory survives if the
--    creator deletes their account (content is what matters). deleted_at
--    enables soft delete; queries/RLS filter WHERE deleted_at IS NULL.
--    memory_date is `date` (a calendar day, not a precise moment).
--    Source: §5.5, §7.3, §9
-- ----------------------------------------------------------------------------
CREATE TABLE memories (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id      uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    created_by    uuid REFERENCES profiles (id) ON DELETE SET NULL,
    title         text NOT NULL,
    description   text,
    memory_type   text,
    location      text,
    memory_date   date NOT NULL,
    deleted_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 6. media
--    Photos and videos attached to memories.
--    CASCADE on memory_id: media cannot exist without a memory.
--    storage_path is required for reliable Storage object deletion.
--    Source: §5.6
-- ----------------------------------------------------------------------------
CREATE TABLE media (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id     uuid NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
    url           text NOT NULL,
    storage_path  text NOT NULL,
    type          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 7. tags
--    Per-Space labels for organizing memories.
--    space_id is NOT NULL: tags are per-Space, not global.
--    Case-insensitive uniqueness (UNIQUE on lower(name)) is added as an index
--    in Migration 4 (it requires an expression, so it is an index, not a plain
--    UNIQUE constraint).
--    Source: §5.7, Gap 4
-- ----------------------------------------------------------------------------
CREATE TABLE tags (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id    uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 8. memory_tags
--    Many-to-many junction between memories and tags.
--    Both FKs use CASCADE: junction rows are cleaned up automatically when
--    either side is deleted.
--    No primary key is declared here; the composite PK (memory_id, tag_id)
--    is added in Migration 3 per §14 Step 3.
--    Source: §5.8
-- ----------------------------------------------------------------------------
CREATE TABLE memory_tags (
    memory_id  uuid NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
    tag_id     uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE
);


-- ----------------------------------------------------------------------------
-- 9. comments
--    User-generated context on memories.
--    Both FKs use CASCADE: comments cannot exist without a memory or author.
--    Hard delete only (no soft delete) per feature-specs §4.
--    updated_at supports potential comment editing in MVP.
--    Source: §5.9
-- ----------------------------------------------------------------------------
CREATE TABLE comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id   uuid NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    content     text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 10. reactions
--     Emotional validation of memories.
--     Both FKs use CASCADE: reactions are personal and tied to memories.
--     Hard delete: reactions are toggles, removed by deleting the row.
--     The UNIQUE (memory_id, user_id, type) constraint is added in Migration 3.
--     Source: §5.10
-- ----------------------------------------------------------------------------
CREATE TABLE reactions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id   uuid NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    type        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
