/**
 * Shared types for the Memories feature (feature-specs §2, database §6).
 *
 * Co-located in a single module so every Memories screen — create, detail,
 * timeline — agrees on the shape of a Memory. Only the fields used by the
 * current scope are declared; the file grows as later screens need more.
 */

/**
 * The type of a Memory (feature-specs §2, database §6).
 *
 * Stored as lowercase snake_case in the database; the UI maps each value to a
 * friendly display label. The union keeps the set exhaustive so a future
 * addition is a deliberate type change, not a silent string drift.
 */
export type MemoryType =
  | "trip"
  | "milestone"
  | "hangout"
  | "celebration"
  | "adventure"
  | "side_quest";

/**
 * A Memory — a single shared moment within a Space (database §6,
 * backend-implementation §5.5).
 *
 * `memory_date` is a calendar `date` (not a timestamp) because a memory's date
 * is a day, not a precise moment. `deleted_at` supports soft delete; rows with
 * a non-null `deleted_at` are filtered out by the `memories_select` RLS policy
 * and are never returned to the client.
 */
export type Memory = {
  id: string;
  space_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  memory_type: string | null;
  location: string | null;
  memory_date: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};
