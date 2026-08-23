import { Link } from "react-router";
import TimelineReactionControl from "../reactions/TimelineReactionControl";
import { memoryDetailPath } from "../../constants/routes";
import type { Memory, MemoryType } from "../../types/memory";
import type { Media } from "../../types/media";
import type { MemoryReactionSummary } from "../../lib/reactions";
import type { ReactionType } from "../../types/reaction";

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  trip: "Trip",
  milestone: "Milestone",
  hangout: "Hangout",
  celebration: "Celebration",
  adventure: "Adventure",
  side_quest: "Side Quest",
};

type MemoryTimelineCardProps = {
  memory: Memory;
  spaceId: string;
  thumbnails: Media[];
  summary: MemoryReactionSummary | undefined;
  currentUserId: string;
  isPending: ReactionType | null;
  onToggleReaction: (type: ReactionType) => void;
};

export default function MemoryTimelineCard({
  memory,
  spaceId,
  thumbnails,
  summary,
  currentUserId,
  isPending,
  onToggleReaction,
}: MemoryTimelineCardProps) {
  const useMosaicLayout = thumbnails.length >= 3;

  return (
    <article className="bg-card-warm dark:bg-card-dark border border-outline-variant/30 dark:border-inverse-surface rounded-2xl p-4 sm:p-5 shadow-stone hover:-translate-y-[2px] transition-all duration-300 group">
      {/* Image Header Area */}
      {useMosaicLayout ? (
        // Mosaic-header card (3+ photos): 2x2 grid photo collage
        <div className="grid grid-cols-2 grid-rows-2 gap-2 h-[260px] sm:h-[300px] mb-5">
          <div className="col-span-1 row-span-2 relative overflow-hidden rounded-xl">
            <img
              alt=""
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              src={thumbnails[0]?.thumbnail_grid_path ?? thumbnails[0]?.thumbnail_path ?? thumbnails[0]?.url ?? ""}
            />
          </div>
          <div className="relative overflow-hidden rounded-xl">
            <img
              alt=""
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out delay-75"
              src={thumbnails[1]?.thumbnail_grid_path ?? thumbnails[1]?.thumbnail_path ?? thumbnails[1]?.url ?? ""}
            />
          </div>
          <div className="relative overflow-hidden rounded-xl">
            <img
              alt=""
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out delay-150"
              src={thumbnails[2]?.thumbnail_grid_path ?? thumbnails[2]?.thumbnail_path ?? thumbnails[2]?.url ?? ""}
            />
          </div>
        </div>
      ) : (
        // Single-image card (≤2 photos): single full-width image header
        <div className="relative h-[220px] sm:h-[260px] overflow-hidden bg-surface-container-low dark:bg-inverse-surface rounded-xl mb-5 transition-colors duration-300">
          {thumbnails[0] && (
            <img
              alt=""
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              src={thumbnails[0]?.thumbnail_grid_path ?? thumbnails[0]?.thumbnail_path ?? thumbnails[0]?.url ?? ""}
            />
          )}
        </div>
      )}

      {/* Content Area */}
      <div>
        {/* Title & Category Pill */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <h3 className="font-headline-md text-headline-md text-on-surface dark:text-surface-container-lowest leading-tight transition-colors duration-300">
            <Link
              to={memoryDetailPath(spaceId, memory.id)}
              className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
            >
              {memory.title}
            </Link>
          </h3>
          {memory.memory_type && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-accent-warm/10 dark:bg-primary-fixed-dim/10 text-accent-warm dark:text-primary-fixed-dim font-mono-label text-mono-label uppercase tracking-widest whitespace-nowrap mt-1 transition-colors duration-300">
              {formatMemoryType(memory.memory_type)}
            </span>
          )}
        </div>

        {/* Metadata Row */}
        <div className="flex items-center gap-3 font-mono-data text-mono-data text-on-surface-variant dark:text-secondary-fixed-dim mb-4 opacity-80 transition-colors duration-300">
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" data-icon="calendar_today">calendar_today</span>
            {formatMemoryDate(memory.memory_date)}
          </span>
          {memory.location && (
            <>
              <span className="w-1 h-1 rounded-full bg-outline-variant/50" aria-hidden="true" />
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]" data-icon="location_on">location_on</span>
                {memory.location}
              </span>
            </>
          )}
        </div>

        {/* Body Text - multiple paragraphs supported */}
        {memory.description && (
          <div className="font-body-md text-body-md text-on-surface-variant dark:text-surface-container-highest leading-relaxed space-y-4 transition-colors duration-300">
            {memory.description.split("\n\n").map((paragraph, index) => (
              <p key={index} className="">{paragraph}</p>
            ))}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-outline-variant/20 dark:border-inverse-surface transition-colors duration-300">
          {/* Like button (heart icon + count) - using existing TimelineReactionControl */}
          {summary && (
            <div className="flex items-center">
              <TimelineReactionControl
                memoryId={memory.id}
                currentUserId={currentUserId}
                summary={summary}
                isPending={isPending}
                onToggle={onToggleReaction}
              />
            </div>
          )}

          {/* More options button */}
          <button
            aria-label="More options"
            className="text-on-surface-variant dark:text-secondary-fixed-dim hover:text-primary transition-colors p-1"
          >
            <span className="material-symbols-outlined text-[20px]" data-icon="more_horiz">more_horiz</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function formatMemoryType(rawType: string): string {
  if (rawType in MEMORY_TYPE_LABELS) {
    return MEMORY_TYPE_LABELS[rawType as MemoryType];
  }
  return rawType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatMemoryDate(memoryDate: string): string {
  const date = new Date(`${memoryDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Date unknown";
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}