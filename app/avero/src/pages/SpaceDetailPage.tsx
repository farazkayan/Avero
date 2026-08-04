import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import SearchInput from "../components/ui/SearchInput";
import SortControl, { type SortOption } from "../components/ui/SortControl";
import { SparkleIcon, GearIcon, SearchIcon, ChartIcon } from "../components/ui/icons";
import MemoryTimelineCard from "../components/memories/MemoryTimelineCard";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { filterMemories } from "../lib/search";
import {
  addReaction,
  fetchMemoryReactionsBatch,
  removeReaction,
  type MemoryReactionSummary,
} from "../lib/reactions";
import { fetchTimelineThumbnailsBatch } from "../lib/media";
import {
  AUTHENTICATED_HOME_PATH,
  memoryCreatePath,
  spaceSettingsPath,
  spaceStatsPath,
} from "../constants/routes";
import type { Memory } from "../types/memory";
import type { Media } from "../types/media";
import type { ReactionType } from "../types/reaction";
import type { Space } from "../types/space";

/**
 * Space Memories timeline (feature-specs §2).
 *
 * The Space detail route (`/spaces/:spaceId`) now hosts the Memories
 * timeline for that Space. The former detail content (members, invite,
 * danger zone) has been relocated to `/spaces/:spaceId/settings`
 * ({@link SpaceSettingsPage}).
 *
 * Fetches the Space (for the header) and all of its Memories on mount. RLS
 * auto-filters both queries: a non-member receives no rows for the Space,
 * which resolves to a calm "not found or no access" state rather than a raw
 * error (spaces-design §8 — "RLS will naturally return nothing for
 * unauthorized access"). The memories query is also RLS-filtered to
 * `deleted_at IS NULL` (migration 20260706090000), so soft-deleted memories
 * never appear here.
 *
 * Per feature-specs §2, Memories are ordered by `memory_date` DESCENDING
 * (most recent first) — NOT by upload time. This is the chronological order
 * the events actually happened, which is what a "timeline" means.
 *
 * The page shows:
 *  - The Space name + description as a header, with a settings gear link
 *    to the settings page (visible to all members).
 *  - A "Create Memory" button (visible to all members — feature-specs §2).
 *  - A loading state while fetching.
 *  - An inspiring empty state if the Space has zero memories
 *    (blueprint §6 — "Empty States Should Inspire").
 *  - A search box (feature-specs §7) that filters the timeline by title,
 *    tags, and description. Filtering is client-side over the loaded list
 *    (instant, no debounce), with a calm empty-results state and a clear
 *    button that restores the full timeline.
 *  - Each Memory as a card: title, a small type badge, the formatted
 *    memory_date, and the description (truncated if long). List items are
 *    NOT clickable yet — the Memory detail page is a future step.
 */
export default function SpaceDetailPage() {
  const { spaceId } = useParams();
  const { user } = useAuth();

  const [space, setSpace] = useState<Space | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tagsByMemoryId, setTagsByMemoryId] = useState<Record<string, string[]>>(
    {},
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Sort control state — persisted via localStorage so the user's preference
  // survives across visits (key: `avero:timeline:sort`). Default is "newest"
  // (memory_date DESC) per feature-specs §2.
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("avero:timeline:sort");
      if (stored === "newest" || stored === "oldest" || stored === "recently-added") {
        return stored;
      }
    }
    return "newest";
  });

  const handleSortChange = useCallback((value: SortOption) => {
    setSortOption(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("avero:timeline:sort", value);
    }
  }, []);

  // Reactions for the timeline cards, batch-fetched in a single query across
  // all loaded Memory ids (feature-specs §5) to avoid N+1 round trips. Keyed by
  // memoryId; the page is the single source of truth, and each card's
  // TimelineReactionControl receives its summary as a prop. Refresh-based,
  // not realtime (database §14): the acting user's own add/remove updates
  // this map immediately; other users' reactions appear on reload.
  const [reactionsByMemoryId, setReactionsByMemoryId] = useState<
    Record<string, MemoryReactionSummary>
  >({});
  // The reaction type currently in flight per Memory (one at a time per
  // card), for the subtle "working" state and to prevent a double-fire.
  const [pendingByMemoryId, setPendingByMemoryId] = useState<
    Record<string, ReactionType | null>
  >({});
  // Thumbnail media for the timeline cards, batch-fetched in a single RPC
  // round trip across all loaded Memory ids (feature-specs §3 — the deferred
  // photo-thumbnail feature). Keyed by memoryId; each bucket holds the first
  // 1–2 media rows (oldest first) for that Memory. Empty bucket → no
  // thumbnail. Separate from the reactions map so the two batch fetches have
  // independent failure modes (reactions depend on [memories, user];
  // thumbnails depend on [memories] only).
  const [thumbnailsByMemoryId, setThumbnailsByMemoryId] = useState<
    Record<string, Media[]>
  >({});

  useEffect(() => {
    if (!spaceId) {
      // React Router guarantees :spaceId is present when this page mounts
      // (the route only matches /spaces/:spaceId). This guard only satisfies
      // the type system. It must not call setState synchronously
      // (react-hooks/set-state-in-effect), and since the branch is
      // unreachable in practice, leaving the initial loading state is fine.
      return;
    }

    let cancelled = false;

    async function fetchSpaceTimeline(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);
      // Reset any stale search when switching Spaces so a filter from one
      // Space never bleeds into another's timeline.
      setSearchQuery("");

      try {
        // Determine the order clause based on the selected sort option
        const getOrderClause = (option: SortOption) => {
          switch (option) {
            case "oldest":
              return { column: "memory_date", ascending: true };
            case "recently-added":
              return { column: "created_at", ascending: false };
            case "newest":
            default:
              return { column: "memory_date", ascending: false };
          }
        };

        const orderClause = getOrderClause(sortOption);

        const [spaceResponse, memoriesResponse] = await Promise.all([
          supabase
            .from("spaces")
            .select("*")
            .eq("id", id)
            .maybeSingle(),
          // Memories for this Space, ordered by the selected sort option.
          // Default is memory_date DESC (feature-specs §2). RLS auto-filters
          // to members only and excludes soft-deleted rows (deleted_at IS NULL),
          // so no explicit filter is needed here. The memory_tags -> tags join
          // embeds each Memory's tag names so search (feature-specs §7) can
          // match on tags without a second round trip; the join is also
          // RLS-gated (memory_tags_select / tags_select enforce is_space_member),
          // so a non-member still receives no rows — search cannot bypass RLS.
          supabase
            .from("memories")
            .select("*, memory_tags(tag_id, tags(id, name))")
            .eq("space_id", id)
            .order(orderClause.column, { ascending: orderClause.ascending }),
        ]);

        if (cancelled) {
          return;
        }

        // Space fetch — a PostgREST error here is either a malformed id
        // (treated as "not found") or a real failure (treated as "try
        // again"). RLS returning no rows resolves to null data with no
        // error, which is the normal "not a member / doesn't exist" path.
        if (spaceResponse.error) {
          if (spaceResponse.error.code === "22P02") {
            // invalid_text_representation — not a valid UUID
            setNotFound(true);
          } else {
            setLoadError("We couldn't load this Space. Please try again.");
          }
          return;
        }

        if (!spaceResponse.data) {
          // RLS returned no rows — the Space doesn't exist or the user
          // isn't a member. Both resolve to the same calm state.
          setNotFound(true);
          return;
        }

        // Memories fetch — if the Space was found (RLS passed), the
        // memories query should also pass (same membership check). A failure
        // here is unexpected; surface it as a general load error.
        if (memoriesResponse.error) {
          setLoadError("We couldn't load this Space. Please try again.");
          return;
        }

        setSpace(spaceResponse.data as Space);

        const joinedMemories =
          (memoriesResponse.data ?? []) as MemoryWithTags[];
        setMemories(joinedMemories as Memory[]);
        setTagsByMemoryId(buildTagsByMemoryId(joinedMemories));
      } catch {
        if (cancelled) {
          return;
        }
        setLoadError("We couldn't load this Space. Please try again.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchSpaceTimeline(spaceId);

    return () => {
      cancelled = true;
    };
  }, [spaceId, sortOption]);

  // --- Batch-fetch reactions for all loaded Memories (feature-specs §5) -----
  // A single query across every Memory id avoids the N+1 problem (one round
  // trip per card). Re-runs when the Memory list or the current user changes.
  // A failure is calm: the cards still render, just without counts (every
  // summary defaults to all-zero), matching the "render the rest of the page"
  // pattern used elsewhere.
  useEffect(() => {
    let cancelled = false;
    const memoryIds = memories.map((m) => m.id);

    async function fetchBatch() {
      // No user or no memories → nothing to fetch. The reset lives inside the
      // async function (not the effect body) so it isn't a synchronous
      // setState in the effect — same structure as `fetchSpaceTimeline`
      // above.
      if (!user || memories.length === 0) {
        if (!cancelled) {
          setReactionsByMemoryId({});
        }
        return;
      }
      try {
        const result = await fetchMemoryReactionsBatch(memoryIds, user.id);
        if (!cancelled) {
          setReactionsByMemoryId(result);
        }
      } catch {
        // Calm: leave the existing (or empty) summaries in place. The cards
        // render with zero counts rather than blocking the timeline.
        if (!cancelled) {
          setReactionsByMemoryId({});
        }
      }
    }

    void fetchBatch();

    return () => {
      cancelled = true;
    };
  }, [memories, user]);

  // --- Batch-fetch thumbnail media for all loaded Memories (feature-specs §3) -
  // A single RPC round trip fetches the first 1–2 media rows per Memory
  // (ordered by created_at) via get_timeline_thumbnails, avoiding N+1 per-card
  // queries. Re-runs when the Memory list changes (no user dep — thumbnails
  // don't depend on who's viewing). A failure is calm: the cards still render,
  // just without thumbnails (every bucket defaults to empty), matching the
  // reactions batch pattern. SECURITY INVOKER on the RPC means media_select
  // RLS filters exactly as a plain select would — no RLS bypass.
  useEffect(() => {
    let cancelled = false;
    const memoryIds = memories.map((m) => m.id);

    async function fetchBatch() {
      // No memories → nothing to fetch. The reset lives inside the async
      // function (not the effect body) so it isn't a synchronous setState in
      // the effect — same structure as `fetchSpaceTimeline` above.
      if (memories.length === 0) {
        if (!cancelled) {
          setThumbnailsByMemoryId({});
        }
        return;
      }
      try {
        const result = await fetchTimelineThumbnailsBatch(memoryIds);
        if (!cancelled) {
          setThumbnailsByMemoryId(result);
        }
      } catch {
        // Calm: leave the existing (or empty) thumbnails in place. The cards
        // render without thumbnails rather than blocking the timeline.
        if (!cancelled) {
          setThumbnailsByMemoryId({});
        }
      }
    }

    void fetchBatch();

    return () => {
      cancelled = true;
    };
  }, [memories]);

  // --- Toggle a reaction on a Memory (optimistic + revert) -----------------
  // Mirrors ReactionBar.handleToggle but operates on the batch map. The
  // "switch" case (user has a different type and toggles heart, or picks a new
  // type from the popup) removes the old type and adds the new one. No confirm
  // dialog — reactions are low-stakes and instantly reversible.
  const handleToggleReaction = useCallback(
    (memoryId: string, type: ReactionType) => {
      if (!user) return;
      const currentUserId = user.id;
      // Ignore a second toggle while one is already in flight for this card.
      if (pendingByMemoryId[memoryId] !== null && pendingByMemoryId[memoryId] !== undefined) {
        return;
      }

      const prev = reactionsByMemoryId[memoryId];
      if (!prev) return;

      const hasType = prev.mine.has(type);
      // The user's *other* current reaction (if switching types). A user can
      // hold multiple types, but the pill's quick-toggle treats heart as the
      // single default; switching to heart removes any other type first.
      const otherTypes = [...prev.mine].filter((t) => t !== type);

      // Snapshot for revert.
      const prevCounts = { ...prev.counts };
      const prevMine = new Set(prev.mine);

      // Optimistic update.
      setReactionsByMemoryId((map) => {
        const current = map[memoryId];
        if (!current) return map;
        const nextCounts = { ...current.counts };
        const nextMine = new Set(current.mine);
        // Remove any other type the user held (switching to the new type).
        for (const t of otherTypes) {
          nextMine.delete(t);
          nextCounts[t] = Math.max(0, nextCounts[t] - 1);
        }
        if (hasType) {
          // Toggle off the chosen type.
          nextMine.delete(type);
          nextCounts[type] = Math.max(0, nextCounts[type] - 1);
        } else {
          nextMine.add(type);
          nextCounts[type] += 1;
        }
        return { ...map, [memoryId]: { counts: nextCounts, mine: nextMine } };
      });
      setPendingByMemoryId((map) => ({ ...map, [memoryId]: type }));

      // Fire the add/remove. For a switch (otherTypes non-empty), remove the
      // old type then add the new one; the UNIQUE constraint allows both.
      async function apply() {
        // Remove other types first (switch).
        for (const t of otherTypes) {
          await removeReaction({ memoryId, userId: currentUserId, type: t });
        }
        const result = hasType
          ? await removeReaction({ memoryId, userId: currentUserId, type })
          : await addReaction({ memoryId, userId: currentUserId, type });

        setPendingByMemoryId((map) => {
          const next = { ...map };
          delete next[memoryId];
          return next;
        });

        if (!result.ok) {
          // Revert to the pre-toggle snapshot.
          setReactionsByMemoryId((map) => ({
            ...map,
            [memoryId]: { counts: prevCounts, mine: prevMine },
          }));
        }
      }

      void apply();
    },
    [pendingByMemoryId, reactionsByMemoryId, user],
  );

  // Filter the timeline by the search query (feature-specs §7). Client-side
  // over the already-loaded list, so it's instant and calm — no debounce or
  // DB round trip per keystroke. Memoized so it only recomputes when the
  // source list, the tag index, or the query changes.
  const filteredMemories = useMemo(
    () => filterMemories(memories, tagsByMemoryId, searchQuery),
    [memories, tagsByMemoryId, searchQuery],
  );

  return (
    <>
      <div className="mb-6">
        <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-400"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : notFound ? (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            Space not found
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted sm:text-base">
            This Space may have been deleted, or you may not have access to it.
          </p>
          <div className="mt-8">
            <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      ) : space ? (
        <>
          {/* Header — Space name + description, with a settings gear link */}
          <section>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-bold leading-tight text-ink sm:text-3xl">
                  {space.name}
                </h1>
                {space.description && (
                  <p className="mt-2 text-sm text-ink-muted sm:text-base">
                    {space.description}
                  </p>
                )}
              </div>
              {spaceId && (
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    to={spaceStatsPath(spaceId)}
                    aria-label="Space stats"
                    className="inline-flex items-center justify-center rounded-md p-2 text-ink-muted transition-colors duration-200 hover:text-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                  >
                    <ChartIcon />
                  </Link>
                  <Link
                    to={spaceSettingsPath(spaceId)}
                    aria-label="Space settings"
                    className="inline-flex items-center justify-center rounded-md p-2 text-ink-muted transition-colors duration-200 hover:text-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                  >
                    <GearIcon />
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* Create Memory — visible to all members (feature-specs §2) */}
          <section className="mt-6">
            <Link
              to={memoryCreatePath(space.id)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Create Memory
            </Link>
          </section>

          {/* Memories timeline */}
          <section className="mt-10">
            {memories.length === 0 ? (
              <EmptyState
                icon={<SparkleIcon />}
                title="No memories yet"
                titleAs="h2"
                description="Every Space starts with a single memory. Capture the first one — a trip, a milestone, a quiet hangout — and watch this timeline come to life."
              >
                <Link
                  to={memoryCreatePath(space.id)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Create your first memory
                </Link>
              </EmptyState>
            ) : (
              <>
                {/* Sort control + Search — filters the timeline by title, tags,
                    and description (feature-specs §7). Client-side over the
                    already-loaded list, so it's instant and calm. */}
                <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6">
                  <SortControl
                    value={sortOption}
                    onChange={handleSortChange}
                    ariaLabel="Sort memories"
                    className="w-full sm:w-auto"
                  />
                  <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search memories…"
                    ariaLabel="Search memories"
                    className="w-full sm:w-[320px]"
                  />
                </div>

                {filteredMemories.length === 0 ? (
                  <EmptyState
                    icon={<SearchIcon />}
                    title="No matching memories"
                    titleAs="h2"
                    description="Nothing in this Space matches your search. Try a different word, or clear the search to see the full timeline."
                  >
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-ink/10 bg-canvas px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:border-ink/20 hover:bg-canvas-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      Clear search
                    </button>
                  </EmptyState>
                ) : (
                  <ul className="space-y-4">
                    {filteredMemories.map((memory) => (
                      <li key={memory.id}>
                        {/* The card markup + token-driven styling + thumbnail
                            slot + reaction control now live in
                            {@link MemoryTimelineCard}. The page owns the batch
                            state (reactions + thumbnails maps) and passes
                            per-card props. The card is a <div> (not a <Link>) so
                            the reaction pill <button> isn't nested inside an
                            anchor; the title is the navigation link. */}
                        <MemoryTimelineCard
                          memory={memory}
                          spaceId={space.id}
                          thumbnails={thumbnailsByMemoryId[memory.id] ?? []}
                          summary={reactionsByMemoryId[memory.id]}
                          currentUserId={user?.id ?? ""}
                          isPending={pendingByMemoryId[memory.id] ?? null}
                          onToggleReaction={(type) =>
                            handleToggleReaction(memory.id, type)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

/**
 * Shape of a memories row with its tags embedded via the memory_tags -> tags
 * join, as returned by the Space timeline fetch. The base columns match
 * {@link Memory}; `memory_tags` is the join payload used only to build the
 * search index and is not part of the rendered Memory.
 */
type MemoryWithTags = Memory & {
  memory_tags: {
    tag_id: string;
    tags:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
  }[];
};

/**
 * Builds a Memory id -> tag-names map from the joined timeline response, for
 * use by {@link filterMemories}. Each memory_tags row links to exactly one
 * tag; the nested `tags` may arrive as a single object or a one-element array
 * depending on the PostgREST join cardinality, so both shapes are handled.
 * Tags with no resolved name (e.g. a tag deleted mid-join — unlikely given
 * CASCADE) are skipped.
 */
function buildTagsByMemoryId(
  memories: MemoryWithTags[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const memory of memories) {
    const names: string[] = [];
    for (const link of memory.memory_tags ?? []) {
      const tag = link.tags;
      if (Array.isArray(tag)) {
        if (tag[0]) names.push(tag[0].name);
      } else if (tag) {
        names.push(tag.name);
      }
    }
    map[memory.id] = names;
  }
  return map;
}
