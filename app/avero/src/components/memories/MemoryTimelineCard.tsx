import { Link, useNavigate } from "react-router";
import { useCallback, useEffect, useState } from "react";
import TimelineReactionControl from "../reactions/TimelineReactionControl";
import { getMediaDownloadUrl } from "../../lib/media";
import { memoryDetailPath } from "../../constants/routes";
import { PhotoIcon } from "../../components/ui/icons";
import { deleteMemory } from "../../lib/memories";
import MultiPhotoMosaic from "../ui/MultiPhotoMosaic";
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
  const navigate = useNavigate();
// Resolved URLs for thumbnails - we need to resolve the B2 object keys to presigned URLs
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);

  // Resolve thumbnail URLs to presigned URLs for display
  const resolveThumbnailUrls = useCallback(async () => {
    if (thumbnails.length === 0) {
      setThumbnailUrls([]);
      return;
    }
    
    // For mosaic layout (2+ photos), we need up to 3 thumbnails and use thumbnail_grid_path (smaller, optimized for grid)
    // For single image layout (1 photo), we need 1 thumbnail and use thumbnail_detail_path (larger, for hero display)
    const useMosaicLayout = thumbnails.length >= 2;
    const maxThumbnailsNeeded = useMosaicLayout ? 3 : 1;
    const thumbnailsToResolve = thumbnails.slice(0, maxThumbnailsNeeded);
    
    try {
      // Resolve URLs in parallel
      const urlPromises = thumbnailsToResolve.map(thumbnail =>
        getMediaDownloadUrl(
          // For mosaic layout, use thumbnail_grid_path (smaller thumbnails for grid display)
          // For single image layout, use thumbnail_detail_path (larger, for hero display)
          useMosaicLayout
            ? (thumbnail.thumbnail_grid_path ?? thumbnail.thumbnail_path ?? thumbnail.url)
            : (thumbnail.thumbnail_detail_path ?? thumbnail.thumbnail_grid_path ?? thumbnail.thumbnail_path ?? thumbnail.url)
        )
      );
      
      const results = await Promise.all(urlPromises);
      const resolvedUrls = results.map(result => result.ok ? result.url : "");
      setThumbnailUrls(resolvedUrls);
    } catch {
      // If URL resolution fails, set empty strings so images don't load
      setThumbnailUrls(thumbnailsToResolve.map(() => ""));
    }
  }, [thumbnails]);

  useEffect(() => {
    resolveThumbnailUrls();
  }, [resolveThumbnailUrls]);

  // State for more options menu
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const id = open ? "more-options-menu" : undefined;

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEditClick = () => {
    handleMenuClose();
    // Navigate to the edit memory page
    navigate(memoryDetailPath(spaceId, memory.id).replace("/memories/", "/memories/") + "/edit");
  };

  const handleDeleteClick = async () => {
    handleMenuClose();
    if (window.confirm("Are you sure you want to delete this memory? This action cannot be undone.")) {
      try {
        const result = await deleteMemory(memory.id);
        if (result.ok) {
          // In a real implementation, we would remove this memory from the list
          // For now, we'll just log the success
          console.log("Memory deleted successfully:", memory.id);
          // Note: In a full implementation, we would trigger a state update or refetch
          // to remove this card from the UI
        } else {
          alert(`Failed to delete memory: ${result.error}`);
        }
      } catch (error) {
        alert("An error occurred while deleting the memory. Please try again.");
      }
    }
  };

return (
    <article className={`bg-card-warm dark:bg-card-dark border border-outline-variant/30 dark:border-inverse-surface rounded-2xl p-4 sm:p-5 shadow-stone hover:-translate-y-[2px] transition-all duration-300 group${thumbnails.length === 0 ? ' border-t-2 border-accent-warm/20 dark:border-primary-fixed-dim/20' : ''}`}>
{/* Image Header Area */}
        {thumbnails.length > 0 ? (
          thumbnails.length >= 2 ? (
            // Multi-photo mosaic (2+ photos): use MultiPhotoMosaic component
            <MultiPhotoMosaic
              media={thumbnails.slice(0, 3)}
              aspectRatio="landscape"
              className="mb-5"
            />
          ) : (
            // Single-image card (1 photo): single full-width image header
            <div className="relative h-[220px] sm:h-[260px] overflow-hidden bg-surface-container-low dark:bg-inverse-surface rounded-xl mb-5 transition-colors duration-300">
              {thumbnailUrls[0] ? (
                <img
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                  src={thumbnailUrls[0]}
                />
              ) : (
                // Placeholder for loading thumbnail
                <div className="absolute inset-0 flex items-center justify-center text-[28px] text-on-surface-variant/50">
                  <PhotoIcon />
                </div>
              )}
            </div>
          )
        ) : null}

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

          {/* More options button with dropdown menu */}
          <div className="relative">
            <button
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={handleMenuOpen}
              className="text-on-surface-variant dark:text-secondary-fixed-dim hover:text-primary transition-colors p-1"
            >
              <span className="material-symbols-outlined text-[20px]" data-icon="more_horiz">more_horiz</span>
            </button>
            
            {/* Dropdown menu */}
            {open && (
              <div
                className="absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-canvas-warm dark:bg-canvas-dark shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-20"
                role="menu"
                aria-orientation="vertical"
                aria-labelledby={id}
              >
                <div className="py-1" role="none">
                  {/* Edit option */}
                  <button
                    onClick={handleEditClick}
                    onKeyDown={handleMenuClose}
                    className="block px-4 py-2 text-sm text-on-surface dark:text-surface-container-lowest w-full text-left"
                    role="menuitem"
                    tabIndex={-1}
                  >
                    Edit Memory
                  </button>
                  {/* Delete option */}
                  <button
                    onClick={handleDeleteClick}
                    onKeyDown={handleMenuClose}
                    className="block px-4 py-2 text-sm text-error dark:text-error w-full text-left"
                    role="menuitem"
                    tabIndex={-1}
                  >
                    Delete Memory
                  </button>
                </div>
              </div>
            )}
          </div>
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
