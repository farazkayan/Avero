/**
 * Shared types for the Tags feature (feature-specs §6, database §10/§11).
 *
 * Co-located in a single module so every screen that touches tags — create,
 * edit, detail — agrees on the shape of a Tag. Only the fields used by the
 * current scope are declared; the file grows as later screens (e.g. tag-based
 * search) need more.
 */

/**
 * A Tag — a simple label shared within a Space (feature-specs §6, database §10).
 *
 * Tags are case-insensitive and unique per Space, enforced by the
 * `uq_tags_space_name_lower` unique index on `(space_id, lower(name))`. The
 * `name` field preserves the original casing as entered by the first user to
 * create it; comparisons and dedup happen on the lower-cased form.
 */
export type Tag = {
  id: string;
  space_id: string;
  name: string;
  created_at: string;
};

/**
 * A `memory_tags` junction row (database §11) — the many-to-many link between
 * a Memory and its Tags. Exposed when fetching a Memory's tags via the
 * `memory_tags` → `tags` join.
 */
export type MemoryTag = {
  memory_id: string;
  tag_id: string;
};
