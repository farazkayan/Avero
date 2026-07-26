import type { Memory } from "../types/memory";

/**
 * Filters a Space's Memories by a free-text search query (feature-specs §7).
 *
 * Matching is case-insensitive substring across a Memory's title, its
 * description, and any of its tag names. A Memory is kept when the query
 * appears in ANY of those fields. An empty or whitespace-only query returns
 * the full list unchanged, so clearing the search instantly restores the
 * timeline (feature-specs §7).
 *
 * This is a pure function over already-loaded data — it performs no network
 * requests. The Space Detail page loads the whole timeline once on mount
 * (feature-specs §2), and for an MVP Space — a private memory album, not a
 * feed — that list is small enough to hold in memory and filter on every
 * keystroke with no debounce (Design System §1: "never feel noisy"). That
 * keeps search instant and calm, and avoids a per-keystroke DB round trip.
 * Description is included because it is a trivial extra substring check
 * (feature-specs §7 marks it optional for MVP; it is reasonably simple).
 *
 * Security note: this function never queries the database, so it cannot
 * bypass RLS. The list it filters was already RLS-gated by the Space Detail
 * fetch (`memories_select` enforces `is_space_member` + `deleted_at IS
 * NULL`, and the embedded `memory_tags` / `tags` joins are membership-gated
 * too). A non-member simply receives no rows to filter.
 *
 * @param memories       The full timeline (already ordered by memory_date).
 * @param tagsByMemoryId Tag names per Memory id (empty array if none).
 * @param query          The raw search string from the input.
 * @returns The subset of `memories` matching the query, in original order.
 */
export function filterMemories(
  memories: Memory[],
  tagsByMemoryId: Record<string, string[]>,
  query: string,
): Memory[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return memories;
  }

  return memories.filter((memory) => {
    if (memory.title.toLowerCase().includes(needle)) {
      return true;
    }
    if (
      memory.description &&
      memory.description.toLowerCase().includes(needle)
    ) {
      return true;
    }
    const tags = tagsByMemoryId[memory.id] ?? [];
    return tags.some((tag) => tag.toLowerCase().includes(needle));
  });
}
