-- ============================================================================
-- Migration: Add latitude/longitude to memories for map support
-- ----------------------------------------------------------------------------
-- Adds machine-readable coordinates alongside the existing free-text location
-- field. Both columns are nullable - a Memory can have text location without
-- coordinates (old data, or user typed free text without selecting autocomplete).
-- Partial index for efficient Map view queries.
-- ============================================================================

-- Add coordinate columns
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Partial index for Map view: geocoded memories in a space ordered by date
-- Mirrors the pattern of idx_memories_space_date_active
CREATE INDEX IF NOT EXISTS idx_memories_space_geocoded
    ON memories (space_id, memory_date DESC)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;