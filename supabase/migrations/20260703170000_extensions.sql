-- ============================================================================
-- Migration: Extensions
-- ----------------------------------------------------------------------------
-- Enables the PostgreSQL extensions required by the Avero schema.
--
-- Source of truth: docs/backend-implementation.md §14 Step 1.
--
-- pgcrypto provides gen_random_uuid(), used as the default for UUID primary
-- keys on every application table. On Supabase this extension is typically
-- pre-enabled; the IF NOT EXISTS guard makes this migration idempotent and
-- safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
