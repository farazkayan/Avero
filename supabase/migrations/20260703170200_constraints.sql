-- ============================================================================
-- Migration: Constraints
-- ----------------------------------------------------------------------------
-- Adds CHECK constraints, UNIQUE constraints, and the memory_tags composite
-- primary key via ALTER TABLE.
--
-- Source of truth: docs/backend-implementation.md §5 (Table Specifications)
-- and §14 Step 3 (Constraints).
--
-- This migration contains ONLY constraints. It deliberately EXCLUDES:
--   - the tags case-insensitive uniqueness (UNIQUE INDEX on lower(name))
--       -> Migration 4 (Indexes), because it requires an expression
--   - all other indexes                       -> Migration 4 (Indexes)
--   - triggers / RLS / functions / storage     -> later migrations
--
-- All constraints are given explicit, descriptive names so that future
-- migrations, error messages, and debugging remain predictable.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- CHECK constraints
-- ----------------------------------------------------------------------------

-- space_members.role: owner or member (§5.3)
ALTER TABLE space_members
    ADD CONSTRAINT chk_space_members_role
    CHECK (role IN ('owner', 'member'));

-- space_invitations.role: owner or member (§5.4)
ALTER TABLE space_invitations
    ADD CONSTRAINT chk_space_invitations_role
    CHECK (role IN ('owner', 'member'));

-- space_invitations.status: pending -> accepted | expired | cancelled (§5.4)
ALTER TABLE space_invitations
    ADD CONSTRAINT chk_space_invitations_status
    CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled'));

-- media.type: image or video (§5.6)
ALTER TABLE media
    ADD CONSTRAINT chk_media_type
    CHECK (type IN ('image', 'video'));

-- reactions.type: stable text enum strings, not emoji (§5.10, Gap 7)
ALTER TABLE reactions
    ADD CONSTRAINT chk_reactions_type
    CHECK (type IN ('heart', 'laugh', 'fire', 'tearful', 'clap', 'surprised'));


-- ----------------------------------------------------------------------------
-- UNIQUE constraints
-- ----------------------------------------------------------------------------

-- space_members: one membership per (space, user) — prevents duplicates (§5.3)
ALTER TABLE space_members
    ADD CONSTRAINT uq_space_members_space_user
    UNIQUE (space_id, user_id);

-- space_invitations: token uniqueness for lookup (§5.4)
ALTER TABLE space_invitations
    ADD CONSTRAINT uq_space_invitations_token
    UNIQUE (token);

-- reactions: one reaction per type per user per memory (§5.10, feature-specs §5)
ALTER TABLE reactions
    ADD CONSTRAINT uq_reactions_memory_user_type
    UNIQUE (memory_id, user_id, type);


-- ----------------------------------------------------------------------------
-- Composite primary key
-- ----------------------------------------------------------------------------

-- memory_tags: composite PK (memory_id, tag_id) (§5.8, §14 Step 3)
-- This implicitly creates a unique B-tree index on (memory_id, tag_id), which
-- is the junction's primary access path. The reverse-lookup index on tag_id
-- is added separately in Migration 4 (Indexes).
ALTER TABLE memory_tags
    ADD CONSTRAINT pk_memory_tags
    PRIMARY KEY (memory_id, tag_id);
