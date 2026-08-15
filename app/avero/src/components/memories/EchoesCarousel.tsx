import EchoesCard from "./EchoesCard";
import { getIntervalLabel } from "../../lib/echoes";
import type { Memory } from "../../types/memory";
import type { Media } from "../../types/media";

type EchoesCarouselProps = {
  /** The Memories that match today's Echoes intervals. */
  memories: Memory[];
  /** Per-Memory thumbnail media from the batch fetch. */
  thumbnails: Record<string, Media[]>;
  /** The Space ID for navigation. */
  spaceId: string;
  /** Today's date as "YYYY-MM-DD" for computing interval labels. */
  today: string;
};

/**
 * The horizontal "On This Day" carousel at the top of the Space timeline.
 *
 * Renders a horizontally scrollable row of EchoesCard components.
 * Only renders if there are memories to show — zero echoes = no render at all
 * (no empty state, no placeholder, no visual gap), per Spec §1 and §4.
 *
 * Scroll behavior: native touch/trackpad scroll via `overflow-x-auto`.
 * No scroll arrows, no fade edges — matches the TimelineDensity pattern in
 * SpaceStatsPage (Design System §7: restrained, no excess chrome).
 */
export default function EchoesCarousel({
  memories,
  thumbnails,
  spaceId,
  today,
}: EchoesCarouselProps) {
  // Zero echoes → render nothing (Spec §4: "as if the feature doesn't exist")
  if (memories.length === 0) {
    return null;
  }

  return (
    <section className="mt-10" aria-label="On this day">
      <div className="flex gap-4 overflow-x-auto pb-4 -mb-4 px-4 -mx-4">
        {memories.map((memory) => {
          const intervalLabel = getIntervalLabel(memory.memory_date, today);
          return (
            <EchoesCard
              key={memory.id}
              memory={memory}
              spaceId={spaceId}
              thumbnails={thumbnails[memory.id] ?? []}
              intervalLabel={intervalLabel}
            />
          );
        })}
      </div>
    </section>
  );
}