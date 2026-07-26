-- ============================================================================
-- Migration: Database default for space_invitations.expires_at
-- ----------------------------------------------------------------------------
-- Previously `expires_at` was set client-side in SpaceDetailPage.tsx
-- (`now() + 7 days` computed in the browser). That meant the 7-day expiry
-- policy was only enforced by our own UI's honesty — a direct API call could
-- set any `expires_at` value (including far-future or NULL-bypassing dates).
--
-- This migration moves the 7-day expiry policy into the database as a column
-- DEFAULT, so an insert that omits `expires_at` gets `now() + interval '7 days'`
-- from PostgreSQL itself. This mirrors the existing pattern already used for
-- `token` (`gen_random_uuid()`) and `status` / `role` / `created_at`.
--
-- The column keeps its `NOT NULL` constraint; only the default is added. No
-- data is touched — existing rows keep their current `expires_at` values.
--
-- After this change, SpaceDetailPage.tsx omits `expires_at` from the insert
-- payload entirely and relies on this database default.
--
-- Source of truth: docs/spaces-design.md §1.2 (7-day expiry on pending invites)
--   "expires_at = now() + interval '7 days'"
-- ============================================================================

ALTER TABLE space_invitations
    ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
