import EchoesCard from "./EchoesCard";
import { getIntervalLabel } from "../../lib/echoes";
import type { Memory } from "../../types/memory";
import type { Media } from "../../types/media";

type EchoesCarouselProps = {
  memories: Memory[];
  thumbnails: Record<string, Media[]>;
  spaceId: string;
  today: string;
};

export default function EchoesCarousel({
  memories,
  thumbnails,
  spaceId,
  today,
}: EchoesCarouselProps) {
  if (memories.length === 0) {
    return null;
  }

  return (
    <section className="mb-16" aria-label="On this day">
      <h2 className="font-mono-label text-mono-label text-on-surface-variant dark:text-secondary-fixed-dim mb-6 tracking-[0.1em] uppercase transition-colors duration-300">
        On This Day
      </h2>
      <div className="flex overflow-x-auto gap-4 md:gap-gutter pb-6 no-scrollbar snap-x snap-mandatory -mx-margin-mobile px-margin-mobile md:mx-0 md:px-0">
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