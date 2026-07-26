import { supabase } from "./supabase";
import { deleteMedia } from "./media";
import type { Media } from "../types/media";

/**
 * Memory helpers (feature-specs §2, database §6).
 *
 * This module is the home for Memory-level operations that span more than a
 * single table. The first such operation is {@link deleteMemory} — a
 * destructive, irreversible action that must clean up external B2 objects
 * (media) *before* the Memory row is removed, because the DB cascade on
 * `media.memory_id` deletes the rows but leaves the B2 objects orphaned.
 */

// ============================================================================
// Delete (feature-specs §2, database §6 + §13)
// ============================================================================
//
// Deleting a Memory is a destructive, irreversible action (feature-specs §4
// establishes the "no soft delete for MVP" precedent for comments; Memories
// follow the same hard-delete model — there is no undo). The operation must
// not leave orphaned data or a misleading success state.
//
// DEPENDENT ROWS (database §6 + tables migration 20260703170100):
//  - media          — ON DELETE CASCADE on memory_id (tables.sql:131)
//  - comments       — ON DELETE CASCADE on memory_id (tables.sql:181)
//  - reactions      — ON DELETE CASCADE on memory_id (tables.sql:199)
//  - memory_tags    — ON DELETE CASCADE on memory_id (tables.sql:166)
// All four cascade automatically when the Memory row is deleted, so they need
// NO explicit client-side cleanup. The DB handles them.
//
// EXTERNAL OBJECTS (the one thing the cascade CANNOT handle):
//  - Each `media` row points at one or two Backblaze B2 objects (the original
//    file in `storage_path`/`url`, and optionally a thumbnail in
//    `thumbnail_path`). A DB cascade deletes the *row* but leaves the B2
//    objects orphaned forever — the keys live only in the now-deleted row.
//  - Therefore media MUST be deleted via `deleteMedia()` BEFORE the Memory
//    row is removed. `deleteMedia()` deletes the DB row first (RLS-gated),
//    then the B2 objects (original + thumbnail). Reversing the order would
//    lose the B2 keys and orphan the objects permanently.
//
// ORDERING:
//  1. Fetch all `media` rows for the Memory (RLS-gated by media_select —
//     only a Space member sees them; a non-member gets an empty list and the
//     Memory delete below will be RLS-denied anyway).
//  2. For each media row, call `deleteMedia()`. This deletes the media DB row
//     (RLS-gated by media_delete = creator OR Space owner) and then the B2
//     objects. A B2 delete failure is non-fatal (the row is already gone) and
//     is reported as `b2Orphaned` — the orphan can be swept later, and the
//     Memory delete can still proceed.
//  3. Delete the Memory row (RLS-gated by memories_delete = creator OR Space
//     owner). The DB cascade removes comments, reactions, memory_tags, and any
//     media rows that weren't already deleted in step 2.
//
// FAILURE HANDLING:
//  - If a media DB-row delete fails (RLS denied or error), the function
//    returns `{ ok: false, error }` and does NOT delete the Memory. The
//    Memory and its remaining media are intact; the user sees a clear error
//    and can retry. No partial success is reported as success.
//  - If the Memory row delete fails (RLS denied or error), the function
//    returns `{ ok: false, error }`. Any media already deleted in step 2 is
//    gone (rows + B2 objects) — this is the unavoidable consequence of the
//    ordering requirement (media must go first so B2 keys aren't lost). The
//    error message is honest about this rather than claiming nothing happened.
//  - RLS silent-deny: a DELETE that matches no rows (because RLS hid them)
//    resolves to `{ error: null }` with `count: 0`, NOT an error. So a
//    non-creator/non-owner who somehow reaches this path sees a clear error
//    rather than a silent no-op that looks like success. The Memory row is
//    re-fetched after the delete to confirm it's actually gone.
//
// The function never throws — callers can use a plain `if`/`else` without a
// try/catch, matching the {@link deleteMedia} pattern.

/** Calm, honest fallback message for a failed delete (auth-design §7 voice). */
const GENERIC_MEMORY_DELETE_ERROR =
  "We couldn't delete this Memory. Please try again.";

/**
 * Result of {@link deleteMemory}. On success `ok` is `true`; if any B2 object
 * could not be deleted (but the Memory row was), `b2Orphaned` is `true` — the
 * Memory is gone and the user can navigate away, but some B2 objects may
 * remain (sweepable later). On failure `error` carries a user-facing message
 * and the Memory row is untouched (unless media was already deleted — see the
 * module comment on ordering).
 */
export type DeleteMemoryResult =
  | { ok: true; b2Orphaned?: true }
  | { ok: false; error: string };

/**
 * Deletes a Memory and all of its attached media (DB rows + B2 objects).
 *
 * Deletes media first (via {@link deleteMedia}, which removes each media row
 * and its B2 original + thumbnail), then deletes the Memory row itself. The
 * DB cascade handles comments, reactions, and memory_tags automatically
 * (all `ON DELETE CASCADE` on `memory_id`).
 *
 * **Authorization:** the `memories_delete` RLS policy allows the Memory's
 * creator OR a Space owner. A non-authorized user's delete resolves to a
 * silent no-op at the DB (RLS hides the row), which this function detects and
 * surfaces as a clear error rather than a misleading success.
 *
 * @param memoryId the id of the Memory to delete.
 * @returns `{ ok: true }` (optionally with `b2Orphaned`) or `{ ok: false, error }`.
 */
export async function deleteMemory(
  memoryId: string,
): Promise<DeleteMemoryResult> {
  // Step 1 — fetch all media rows for this Memory. RLS (media_select = Space
  // member via the parent memory's space) gates this; a non-member receives
  // an empty list. We need the rows (not just ids) because deleteMedia reads
  // storage_path / url / thumbnail_path to delete the B2 objects.
  const { data: mediaRows, error: fetchError } = await supabase
    .from("media")
    .select("*")
    .eq("memory_id", memoryId);

  if (fetchError) {
    return { ok: false, error: GENERIC_MEMORY_DELETE_ERROR };
  }

  const media = (mediaRows ?? []) as Media[];

  // Step 2 — delete each media item (DB row + B2 objects). This MUST happen
  // before the Memory row is deleted: once the Memory row is gone, the DB
  // cascade removes the media rows and the B2 object keys are lost forever.
  //
  // A B2 delete failure is non-fatal (deleteMedia returns ok:true with
  // b2Orphaned:true) — the media row is already gone, so the Memory delete
  // can still proceed; the orphaned B2 object can be swept by a future
  // cleanup pass. A media DB-row delete failure (ok:false) is fatal — we stop
  // and surface the error so the user doesn't think the Memory was deleted.
  let b2Orphaned = false;

  for (const item of media) {
    const result = await deleteMedia(item);
    if (!result.ok) {
      // The media DB-row delete failed (RLS denied or error). The Memory and
      // its remaining media are intact. Surface a clear error — do not
      // proceed to delete the Memory, which would orphan the remaining media
      // B2 objects.
      return { ok: false, error: GENERIC_MEMORY_DELETE_ERROR };
    }
    if (result.b2Orphaned) {
      b2Orphaned = true;
    }
  }

  // Step 3 — delete the Memory row. RLS (memories_delete = creator OR Space
  // owner) is the real gate. The DB cascade removes comments, reactions,
  // memory_tags, and any media rows not already deleted in step 2.
  const { error: memoryDeleteError } = await supabase
    .from("memories")
    .delete()
    .eq("id", memoryId);

  if (memoryDeleteError) {
    // A real DB error (not an RLS deny — RLS denies resolve to no error with
    // zero affected rows, handled below). Any media already deleted in step 2
    // is gone; the error message is honest about this rather than claiming
    // nothing happened.
    return { ok: false, error: GENERIC_MEMORY_DELETE_ERROR };
  }

  // RLS silent-deny detection: a DELETE that matched no rows (because RLS hid
  // the Memory from a non-creator/non-owner caller) resolves to no error but
  // also no deletion. Re-fetch to confirm the row is actually gone; if it's
  // still there, the caller was not authorized. Surface a clear error rather
  // than a misleading success (the user must not think the Memory was deleted
  // when it wasn't).
  const { data: stillExists, error: refetchError } = await supabase
    .from("memories")
    .select("id")
    .eq("id", memoryId)
    .maybeSingle();

  if (refetchError) {
    // Can't confirm — treat as failure so we never report a false success.
    return { ok: false, error: GENERIC_MEMORY_DELETE_ERROR };
  }

  if (stillExists) {
    // The row is still there: RLS denied the delete (the caller is neither
    // the creator nor a Space owner). Any media deleted in step 2 is gone,
    // but the Memory itself was not — surface an honest error.
    return {
      ok: false,
      error:
        "You can't delete this Memory. Only its creator or a Space owner can.",
    };
  }

  // Success — the Memory and all its dependent rows are gone. B2 orphans (if
  // any media's B2 delete failed in step 2) are non-fatal and sweepable.
  return b2Orphaned ? { ok: true, b2Orphaned: true } : { ok: true };
}
