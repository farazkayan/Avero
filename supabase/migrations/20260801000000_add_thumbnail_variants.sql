-- SPEC B.1: Add thumbnail_grid_path and thumbnail_detail_path columns
-- Grid: 300px max edge, WebP q75 | Detail: 1000px max edge, WebP q80

ALTER TABLE media
  ADD COLUMN IF NOT EXISTS thumbnail_grid_path text,
  ADD COLUMN IF NOT EXISTS thumbnail_detail_path text;

-- Indexes for thumbnail lookups
CREATE INDEX IF NOT EXISTS idx_media_thumbnail_grid_path ON media (thumbnail_grid_path) WHERE thumbnail_grid_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_thumbnail_detail_path ON media (thumbnail_detail_path) WHERE thumbnail_detail_path IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN media.thumbnail_grid_path IS 'B2 object key for 300px WebP q75 grid thumbnail (timeline cards, dashboard)';
COMMENT ON COLUMN media.thumbnail_detail_path IS 'B2 object key for 1000px WebP q80 detail thumbnail (lightbox placeholder, gallery)';
