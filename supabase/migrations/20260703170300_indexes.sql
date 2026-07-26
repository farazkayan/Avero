-- ============================================================================
-- Migration: Indexes
-- ----------------------------------------------------------------------------
-- Creates the performance and lookup indexes defined in
-- docs/backend-implementation.md §10 (Indexes).
--
-- Indexes that are already provided IMPLICITLY by primary keys or UNIQUE
-- constraints (created in Migrations 2 and 3) are NOT recreated here:
--   - profiles PK (id)
--   - spaces PK (id)
--   - space_members PK (id), UNIQUE (space_id, user_id)
--   - space_invitations PK (id), UNIQUE (token)
--   - memories PK (id)
--   - media PK (id)
--   - tags PK (id)
--   - memory_tags PK (memory_id, tag_id)
--   - comments PK (id)
--   - reactions PK (id), UNIQUE (memory_id, user_id, type)
--
-- This migration deliberately EXCLUDES triggers, functions, storage, and RLS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- spaces
-- ----------------------------------------------------------------------------

-- Lookup of spaces created by a user (audit / "spaces I created" view).
-- created_by is nullable (ON DELETE SET NULL), so NULLs are excluded from
-- consideration by the planner for equality lookups.
CREATE INDEX idx_spaces_created_by ON spaces (created_by);


-- ----------------------------------------------------------------------------
-- space_members
-- ----------------------------------------------------------------------------

-- "My spaces" query: list all spaces a user belongs to.
-- The UNIQUE (space_id, user_id) index has space_id as its leading column,
-- so it cannot efficiently serve user_id-only lookups; this index does.
CREATE INDEX idx_space_members_user_id ON space_members (user_id);


-- ----------------------------------------------------------------------------
-- space_invitations
-- ----------------------------------------------------------------------------

-- Invitee lookup: find pending invitations for a given email address.
CREATE INDEX idx_space_invitations_email ON space_invitations (email);

-- Space invites: list all invitations for a given space.
CREATE INDEX idx_space_invitations_space_id ON space_invitations (space_id);


-- ----------------------------------------------------------------------------
-- memories
-- ----------------------------------------------------------------------------

-- Full timeline index: memories for a space ordered by memory_date DESC.
-- Covers queries that may include soft-deleted rows (e.g. future admin restore).
CREATE INDEX idx_memories_space_date ON memories (space_id, memory_date DESC);

-- Partial timeline index: active (non-deleted) memories for a space, ordered
-- by memory_date DESC. This is the most common query in the app (the Space
-- timeline) and the partial index keeps it small by excluding soft-deleted
-- rows. Source: §10 partial index note.
CREATE INDEX idx_memories_space_date_active
    ON memories (space_id, memory_date DESC)
    WHERE deleted_at IS NULL;

-- Creator lookup: memories created by a specific user (audit / "my memories").
-- created_by is nullable (ON DELETE SET NULL).
CREATE INDEX idx_memories_created_by ON memories (created_by);


-- ----------------------------------------------------------------------------
-- media
-- ----------------------------------------------------------------------------

-- Fetch all media for a memory (gallery view).
CREATE INDEX idx_media_memory_id ON media (memory_id);


-- ----------------------------------------------------------------------------
-- tags
-- ----------------------------------------------------------------------------

-- Case-insensitive uniqueness per Space (§5.7, Gap 4).
-- Implemented as a UNIQUE INDEX because it contains the expression lower(name),
-- which cannot be expressed as a plain UNIQUE constraint. The name column
-- itself stores the original casing as entered by the user.
CREATE UNIQUE INDEX uq_tags_space_name_lower
    ON tags (space_id, lower(name));

-- Space tags listing: fetch all tags for a space.
-- §10 lists this separately from the unique expression index; a plain
-- (space_id) index is smaller for this access pattern.
CREATE INDEX idx_tags_space_id ON tags (space_id);


-- ----------------------------------------------------------------------------
-- memory_tags
-- ----------------------------------------------------------------------------

-- Reverse lookup: find all memories tagged with a given tag.
-- The composite PK (memory_id, tag_id) has memory_id as its leading column,
-- so it cannot efficiently serve tag_id-only lookups; this index does.
CREATE INDEX idx_memory_tags_tag_id ON memory_tags (tag_id);


-- ----------------------------------------------------------------------------
-- comments
-- ----------------------------------------------------------------------------

-- Chronological comments for a memory (feature-specs §4: comments appear in
-- chronological order). created_at ascending matches the natural read order.
CREATE INDEX idx_comments_memory_created ON comments (memory_id, created_at);


-- ----------------------------------------------------------------------------
-- reactions
-- ----------------------------------------------------------------------------

-- Reaction counts and listing for a memory.
-- The UNIQUE (memory_id, user_id, type) index can serve memory_id-only
-- lookups via its leading column, but §10 lists a separate (memory_id) index;
-- it is smaller for count/list queries that do not filter by user or type.
CREATE INDEX idx_reactions_memory_id ON reactions (memory_id);
