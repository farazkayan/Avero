-- ============================================================================
-- Migration: Add thumbnail_path column to media table
-- ----------------------------------------------------------------------------
-- Server-side thumbnail generation ("media web optimizer" — see
-- plans/media-web-optimizer.md). When a photo or video is uploaded, a small
-- WebP thumbnail variant is generated and stored as a separate B2 object.
-- This column holds the durable B2 object key for that thumbnail variant.
--
-- NULL semantics (critical for the no-backfill / graceful-fallback design):
--   - NULL means "no thumbnail variant exists" — either the media predates
--     this feature (no backfill — existing uploads stay as-is) or thumbnail
--     generation failed. In both cases, thumbnail consumers fall back to the
--     full-resolution original (media.url / storage_path), so there is no
--     regression for old media.
--   - Non-NULL means a thumbnail variant exists and should be preferred for
--     small displays (timeline cards, dashboard cards). The Memory Detail
--     gallery/lightbox continues using the full-resolution original regardless.
--
-- The thumbnail key follows the convention:
--   {space_id}/{memory_id}/{uuid}_thumb.webp
-- (same first-segment-is-space_id pattern as the original, so the
-- media-storage Edge Function can re-derive and re-authorize the space from
-- the thumbnail key alone — same as it does for the original).
--
-- This is a nullable text column with no default and no NOT NULL constraint,
-- so existing rows are unaffected (they get NULL automatically).
--
-- Source of truth: plans/media-web-optimizer.md §Phase 1.
-- ============================================================================

ALTER TABLE media ADD COLUMN IF NOT EXISTS thumbnail_path text;

COMMENT ON COLUMN media.thumbnail_path IS
    'Durable B2 object key for the small WebP thumbnail variant (NULL = no thumbnail; fall back to url/storage_path). See plans/media-web-optimizer.md.';
