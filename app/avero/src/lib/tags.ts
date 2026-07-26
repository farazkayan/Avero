import { supabase } from "./supabase";
import type { Tag } from "../types/tag";

/**
 * Maximum length for a single tag name.
 *
 * The `tags.name` column is `text` with no CHECK constraint (database §10),
 * but 50 characters is ample for a label and keeps the chip UI tidy
 * (Design System §1: "simplicity is premium").
 */
export const MAX_TAG_LENGTH = 50;

/**
 * Maximum number of tags a single Memory can have.
 *
 * Prevents abuse and keeps the detail page calm — a wall of chips would feel
 * noisy (Design System §1: "never feel noisy, overwhelming, or addictive").
 * 10 is generous for any reasonable memory.
 */
export const MAX_TAGS_PER_MEMORY = 10;

/**
 * Fetches the tags linked to a Memory, for display on the Memory Detail page.
 *
 * Queries the `memory_tags` junction and joins through to `tags`. RLS on both
 * tables ensures only members of the Memory's Space receive rows — a
 * non-member gets an empty result, which renders as no tags (consistent with
 * the calm "not found or no access" pattern on MemoryDetailPage).
 *
 * Returns the Tag objects sorted alphabetically by name (case-insensitive) for
 * a calm, deterministic display order.
 *
 * @throws the underlying Supabase error if the query fails. Callers are
 *   expected to handle this gracefully (the detail page treats a tag fetch
 *   failure as non-fatal and renders without tags).
 */
export async function fetchMemoryTags(memoryId: string): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("memory_tags")
    // Join through to the tag row. PostgREST returns each junction row with a
    // nested `tags` object containing the joined columns.
    .select("tag_id, tags(id, space_id, name, created_at)")
    .eq("memory_id", memoryId);

  if (error) {
    throw error;
  }

  // Flatten the nested join shape into a plain Tag[]. Each memory_tags row
  // links to exactly one tag, so `row.tags` is a single object (or null if
  // the tag was deleted between the join — unlikely given CASCADE, but the
  // filter keeps this defensive).
  const tags: Tag[] = (data ?? [])
    .map((row) => {
      const tag = row.tags as unknown as Tag | Tag[] | null;
      if (Array.isArray(tag)) {
        return tag[0] ?? null;
      }
      return tag;
    })
    .filter((t): t is Tag => t !== null);

  return tags.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/**
 * Syncs a Memory's tag set atomically via the `sync_memory_tags` RPC.
 *
 * Given the desired set of tag names, the RPC upserts tags (reusing existing
 * Space tags case-insensitively — feature-specs §6: "Tags are shared within a
 * Space") and replaces the Memory's `memory_tags` links in a single
 * transaction. Pass an empty array to remove all tags from the Memory.
 *
 * The RPC handles trimming, blank-dropping, and case-insensitive dedup
 * server-side, so callers can pass the raw tag names as the user entered them.
 *
 * @param memoryId  The Memory to tag.
 * @param spaceId   The Space the Memory belongs to (tags are Space-scoped).
 * @param tagNames  The desired tag names (raw — normalized server-side).
 * @throws the underlying Supabase error if the RPC fails.
 */
export async function syncMemoryTags(
  memoryId: string,
  spaceId: string,
  tagNames: string[],
): Promise<void> {
  const { error } = await supabase.rpc("sync_memory_tags", {
    p_memory_id: memoryId,
    p_space_id: spaceId,
    p_tag_names: tagNames,
  });

  if (error) {
    throw error;
  }
}
