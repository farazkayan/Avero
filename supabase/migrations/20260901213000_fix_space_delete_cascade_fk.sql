-- ============================================================================
-- Migration: allow Space delete despite stats_recompute_queue FK (Issue 3)
-- ----------------------------------------------------------------------------
-- A `DELETE FROM spaces WHERE id = X` (owner-only via `spaces_delete` RLS)
-- cascades to every child table. The child-table DELETE fires the
-- `enqueue_stats_recompute_*` AFTER DELETE triggers, which try to
-- `INSERT INTO stats_recompute_queue (space_id) VALUES (sid)`. But the
-- parent `spaces.id = X` row is already gone (the cascade has fired on
-- child rows whose trigger order interleaves with the parent delete), so
-- the INSERT violates the FK on `stats_recompute_queue.space_id` and the
-- whole transaction aborts with 409 Conflict.
--
-- This is exactly the user's reported bug — DELETE on /spaces?id=eq.<uuid>
-- returns 409 Conflict, which the page surfaces as "We couldn't delete this
-- Space. Please try again."
--
-- The simplest correct fix: in each `enqueue_stats_recompute_*` function,
-- guard the INSERT with an `EXISTS (SELECT 1 FROM spaces WHERE id = sid)`
-- check on the DELETE branch. The queue row would cascade out anyway
-- (stats_recompute_queue.space_id is ON DELETE CASCADE), so enqueuing for a
-- Space that's being deleted is wasted work. Skipping it preserves the
-- foreign key and lets the DELETE complete.
--
-- Behavior is unchanged for non-DELETE operations (INSERT/UPDATE on
-- memories, media, comments, reactions, space_members — all still enqueue).
-- Only the DELETE branch of each trigger function is affected, and only when
-- the parent Space has already been removed by the cascade.
--
-- This migration does NOT modify any historical migration files. It only
-- defines the fix going forward; existing deployments must apply it via
-- `supabase db push` to clear the bug.
-- ============================================================================


-- memories: skip DELETE-branch enqueue when the parent Space is already gone.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_memory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        sid := OLD.space_id;
        -- Guard: if the parent Space is already gone (mid-cascade DELETE),
        -- inserting into stats_recompute_queue would violate the FK and
        -- abort the entire transaction. The queue row would cascade out
        -- anyway, so skipping is both safe and necessary.
        IF NOT EXISTS (SELECT 1 FROM spaces WHERE id = sid) THEN
            RETURN NULL;
        END IF;
    ELSE
        sid := NEW.space_id;
    END IF;
    IF sid IS NOT NULL THEN
        INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
        ON CONFLICT (space_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;


-- media: skip DELETE-branch enqueue when the parent memory's space is gone.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    mid uuid;
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        mid := OLD.memory_id;
    ELSE
        mid := NEW.memory_id;
    END IF;
    IF mid IS NOT NULL THEN
        SELECT space_id INTO sid FROM memories WHERE id = mid;
        -- Guard: same rationale as above — skip enqueue if the parent chain
        -- (memory then space) has already been removed by the cascade.
        IF sid IS NULL OR NOT EXISTS (SELECT 1 FROM spaces WHERE id = sid) THEN
            RETURN NULL;
        END IF;
        INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
        ON CONFLICT (space_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;


-- comments: skip DELETE-branch enqueue when the parent chain is gone.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    mid uuid;
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        mid := OLD.memory_id;
    ELSE
        mid := NEW.memory_id;
    END IF;
    IF mid IS NOT NULL THEN
        SELECT space_id INTO sid FROM memories WHERE id = mid;
        IF sid IS NULL OR NOT EXISTS (SELECT 1 FROM spaces WHERE id = sid) THEN
            RETURN NULL;
        END IF;
        INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
        ON CONFLICT (space_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;


-- reactions: same fix.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    mid uuid;
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        mid := OLD.memory_id;
    ELSE
        mid := NEW.memory_id;
    END IF;
    IF mid IS NOT NULL THEN
        SELECT space_id INTO sid FROM memories WHERE id = mid;
        IF sid IS NULL OR NOT EXISTS (SELECT 1 FROM spaces WHERE id = sid) THEN
            RETURN NULL;
        END IF;
        INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
        ON CONFLICT (space_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;


-- space_members: skip DELETE-branch enqueue when the parent Space is gone.
CREATE OR REPLACE FUNCTION enqueue_stats_recompute_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sid uuid;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        sid := OLD.space_id;
        IF NOT EXISTS (SELECT 1 FROM spaces WHERE id = sid) THEN
            RETURN NULL;
        END IF;
    ELSE
        sid := NEW.space_id;
    END IF;
    IF sid IS NOT NULL THEN
        INSERT INTO stats_recompute_queue (space_id) VALUES (sid)
        ON CONFLICT (space_id) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;