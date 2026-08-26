import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import SearchInput from "../components/ui/SearchInput";
import SortControl, { type SortOption } from "../components/ui/SortControl";
import { SparkleIcon } from "../components/ui/icons";
import MemoryTimelineCard from "../components/memories/MemoryTimelineCard";
import EchoesCarousel from "../components/memories/EchoesCarousel";
import BackLink from "../components/ui/BackLink";
import SegmentedControl from "../components/ui/SegmentedControl";
import CreateMemoryButton from "../components/ui/CreateMemoryButton";
import EndOfTimelineIndicator from "../components/ui/EndOfTimelineIndicator";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { filterMemories } from "../lib/search";
import {
  addReaction,
  fetchMemoryReactionsBatch,
  removeReaction,
  type MemoryReactionSummary,
} from "../lib/reactions";
import { fetchTimelineThumbnailsBatch, fetchMemoryMosaicThumbnailsBatch } from "../lib/media";
import { fetchEchoesMemories, getTodayLocalDate, computeEchoesTargetDates } from "../lib/echoes";
import {
  AUTHENTICATED_HOME_PATH,
  memoryCreatePath,
} from "../constants/routes";
import type { Memory } from "../types/memory";
import type { Media } from "../types/media";
import type { ReactionType } from "../types/reaction";
import type { Space } from "../types/space";

type MemoryWithTags = Memory & {
  memory_tags: {
    tag_id: string;
    tags:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
  }[];
};

export default function SpaceDetailPage() {
  const { spaceId } = useParams();
  const { user } = useAuth();

  const [space, setSpace] = useState<Space | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tagsByMemoryId, setTagsByMemoryId] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  const [sortOption, setSortOption] = useState<SortOption>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("avero:timeline:sort");
      if (stored === "newest" || stored === "oldest" || stored === "location") {
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

  const [reactionsByMemoryId, setReactionsByMemoryId] = useState<
    Record<string, MemoryReactionSummary>
  >({});
  const [pendingByMemoryId, setPendingByMemoryId] = useState<
    Record<string, ReactionType | null>
  >({});
  const [thumbnailsByMemoryId, setThumbnailsByMemoryId] = useState<
    Record<string, Media[]>
  >({});
  const [mosaicByMemoryId, setMosaicByMemoryId] = useState<
    Record<string, Media[]>
  >({});

  const [echoesMemories, setEchoesMemories] = useState<Memory[]>([]);
  const [echoesThumbnails, setEchoesThumbnails] = useState<Record<string, Media[]>>({});
  const [echoesToday, setEchoesToday] = useState<string>("");

  useEffect(() => {
    if (!spaceId) {
      return;
    }

    let cancelled = false;

    async function fetchSpaceTimeline(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);
      setSearchQuery("");

      try {
        const getOrderClause = (option: SortOption) => {
          switch (option) {
            case "oldest":
              return { column: "memory_date", ascending: true };
            case "location":
              return { column: "location", ascending: true };
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
          supabase
            .from("memories")
            .select("*, memory_tags(tag_id, tags(id, name))")
            .eq("space_id", id)
            .order(orderClause.column, { ascending: orderClause.ascending }),
        ]);

        if (cancelled) {
          return;
        }

        if (spaceResponse.error) {
          if (spaceResponse.error.code === "22P02") {
            setNotFound(true);
          } else {
            setLoadError("We couldn't load this Space. Please try again.");
          }
          return;
        }

        if (!spaceResponse.data) {
          setNotFound(true);
          return;
        }

        if (memoriesResponse.error) {
          setLoadError("We couldn't load this Space. Please try again.");
          return;
        }

        setSpace(spaceResponse.data as Space);

        const joinedMemories = (memoriesResponse.data ?? []) as MemoryWithTags[];
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

  useEffect(() => {
    let cancelled = false;
    const memoryIds = memories.map((m) => m.id);

    async function fetchBatch() {
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

  useEffect(() => {
    let cancelled = false;
    const memoryIds = memories.map((m) => m.id);

    async function fetchBatch() {
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

  useEffect(() => {
    let cancelled = false;
    const memoryIds = memories.map((m) => m.id);

    async function fetchBatch() {
      if (memories.length === 0) {
        if (!cancelled) {
          setMosaicByMemoryId({});
        }
        return;
      }
      try {
        const result = await fetchMemoryMosaicThumbnailsBatch(memoryIds);
        console.log('[SpaceDetailPage] Mosaic result:', result);
        if (!cancelled) {
          setMosaicByMemoryId(result);
        }
      } catch {
        if (!cancelled) {
          setMosaicByMemoryId({});
        }
      }
    }

    void fetchBatch();

    return () => {
      cancelled = true;
    };
  }, [memories]);

  useEffect(() => {
    if (!spaceId) return;
    const currentSpaceId = spaceId;
    let cancelled = false;

    async function fetchEchoes() {
      const today = getTodayLocalDate();
      const targetDates = computeEchoesTargetDates(today);

      if (!cancelled) {
        setEchoesToday(today);
      }

      try {
        const echoes = await fetchEchoesMemories(currentSpaceId, targetDates);
        if (cancelled) return;

        setEchoesMemories(echoes);

        if (echoes.length > 0) {
          const echoesMemoryIds = echoes.map((m) => m.id);
          const thumbs = await fetchTimelineThumbnailsBatch(echoesMemoryIds);
          if (!cancelled) {
            setEchoesThumbnails(thumbs);
          }
        }
      } catch {
        if (!cancelled) {
          setEchoesMemories([]);
          setEchoesThumbnails({});
        }
      }
    }

    void fetchEchoes();

    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const handleToggleReaction = useCallback(
    (memoryId: string, type: ReactionType) => {
      if (!user) return;
      const currentUserId = user.id;
      if (pendingByMemoryId[memoryId] !== null && pendingByMemoryId[memoryId] !== undefined) {
        return;
      }

      const prev = reactionsByMemoryId[memoryId];
      if (!prev) return;

      const hasType = prev.mine.has(type);
      const otherTypes = [...prev.mine].filter((t) => t !== type);

      const prevCounts = { ...prev.counts };
      const prevMine = new Set(prev.mine);

      setReactionsByMemoryId((map) => {
        const current = map[memoryId];
        if (!current) return map;
        const nextCounts = { ...current.counts };
        const nextMine = new Set(current.mine);
        for (const t of otherTypes) {
          nextMine.delete(t);
          nextCounts[t] = Math.max(0, nextCounts[t] - 1);
        }
        if (hasType) {
          nextMine.delete(type);
          nextCounts[type] = Math.max(0, nextCounts[type] - 1);
        } else {
          nextMine.add(type);
          nextCounts[type] += 1;
        }
        return { ...map, [memoryId]: { counts: nextCounts, mine: nextMine } };
      });
      setPendingByMemoryId((map) => ({ ...map, [memoryId]: type }));

      async function apply() {
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

  const filteredMemories = useMemo(
    () => filterMemories(memories, tagsByMemoryId, searchQuery),
    [memories, tagsByMemoryId, searchQuery],
  );

  return (
    <>
      <div className="mb-12">
        <BackLink to={AUTHENTICATED_HOME_PATH} className="mb-8" />

        {space && (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface dark:text-surface-container-lowest tracking-tight">
                {space.name}
              </h1>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
              <SegmentedControl spaceId={space.id} />
              <CreateMemoryButton spaceId={space.id} />
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-warm dark:text-primary-fixed-dim"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : notFound ? (
        <div className="py-16 text-center">
          <h1 className="font-headline-lg text-headline-lg text-on-surface dark:text-surface-container-lowest">
            Space not found
          </h1>
          <p className="mx-auto mt-3 max-w-sm font-body-md text-body-md text-on-surface-variant dark:text-secondary-fixed-dim">
            This Space may have been deleted, or you may not have access to it.
          </p>
          <div className="mt-8">
            <BackLink to={AUTHENTICATED_HOME_PATH} />
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-outline-variant/20 dark:border-inverse-surface bg-surface-container-low dark:bg-card-dark p-6 text-center">
          <p className="text-error">{loadError}</p>
        </div>
      ) : space ? (
        <>
          {echoesMemories.length > 0 && (
            <EchoesCarousel
              memories={echoesMemories}
              thumbnails={echoesThumbnails}
              spaceId={space.id}
              today={echoesToday}
            />
          )}

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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-warm dark:bg-primary-fixed text-canvas-warm dark:text-on-primary-fixed font-body-sm text-body-sm font-medium px-6 py-3 transition-colors hover:bg-opacity-90 hover:-translate-y-0.5 shadow-sm active:scale-95"
                >
                  Create your first memory
                </Link>
              </EmptyState>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-8 border-b border-outline-variant/20 dark:border-inverse-surface pb-4 transition-colors duration-300">
                  <SortControl
                    value={sortOption}
                    onChange={handleSortChange}
                    ariaLabel="Sort memories"
                    className="w-full sm:w-auto"
                  />
                  <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search memories..."
                    ariaLabel="Search memories"
                    variant="underline"
                    className="w-full sm:w-72"
                  />
                </div>

                {filteredMemories.length === 0 ? (
                  <EmptyState
                    icon={<SparkleIcon />}
                    title="No matching memories"
                    titleAs="h2"
                    description="Nothing in this Space matches your search. Try a different word, or clear the search to see the full timeline."
                  >
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant/30 dark:border-inverse-surface bg-surface-container-low dark:bg-inverse-surface px-4 py-2.5 font-body-sm text-body-sm font-semibold text-on-surface dark:text-surface-container-lowest transition-colors duration-200 hover:bg-surface-container dark:hover:bg-inverse-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                    >
                      Clear search
                    </button>
                  </EmptyState>
                ) : (
                  <div className="flex flex-col gap-8 sm:gap-12 max-w-3xl mx-auto">
                    {filteredMemories.map((memory) => (
                      <MemoryTimelineCard
                        key={memory.id}
                        memory={memory}
                        spaceId={space.id}
                        thumbnails={
                          (mosaicByMemoryId[memory.id]?.length ?? 0) >= 2
                            ? mosaicByMemoryId[memory.id]
                            : thumbnailsByMemoryId[memory.id] ?? []
                        }
                        summary={reactionsByMemoryId[memory.id]}
                        currentUserId={user?.id ?? ""}
                        isPending={pendingByMemoryId[memory.id] ?? null}
                        onToggleReaction={(type) =>
                          handleToggleReaction(memory.id, type)
                        }
                      />
                    ))}
                    <EndOfTimelineIndicator />
                  </div>
                )}
              </>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

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