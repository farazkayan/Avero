import { Link } from "react-router";
import MemoryThumbnail from "./MemoryThumbnail";
import MultiPhotoMosaic from "../ui/MultiPhotoMosaic";
import TimelineReactionControl from "../reactions/TimelineReactionControl";
import { memoryDetailPath } from "../../constants/routes";
import type { Memory, MemoryType } from "../../types/memory";
import type { Media } from "../../types/media";
import type { MemoryReactionSummary } from "../../lib/reactions";
import type { ReactionType } from "../../types/reaction";

/**
 * Friendly display labels for each {@link MemoryType}, keyed by the stored
 * snake_case value. Mirrors the labels used on the create screen so the
 * timeline and the create form always agree on how a type is shown.
 */
const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  trip: "Trip",
  milestone: "Milestone",
  hangout: "Hangout",
  celebration: "Celebration",
  adventure: "Adventure",
  side_quest: "Side Quest",
};

type MemoryTimelineCardProps = {
  /** The Memory this card represents. */
  memory: Memory;
  /** The Space the Memory belongs to — used to build the detail route. */
  spaceId: string;
  /** The first 1–2 media rows for this Memory (oldest first), from the page's
   *  batch thumbnail fetch. Empty array → no thumbnail. */
  thumbnails: Media[];
  /** The batch-fetched reaction summary for this Memory, or `undefined` while
   *  the batch fetch is in flight (the control is rendered once seeded). */
  summary: MemoryReactionSummary | undefined;
  /** The current user's id — passed through to the reaction control. */
  currentUserId: string;
  /** The reaction type currently in flight for this Memory (subtle "working"
   *  state), or `null` when idle. Page-owned. */
  isPending: ReactionType | null;
  /** Apply a reaction: delegates to the page which owns the optimistic update
   *  + add/remove calls + revert-on-error. */
  onToggleReaction: (type: ReactionType) => void;
};

/**
 * A single Memory card on the Space timeline (feature-specs §2), redesigned to
 * the v2.0 design system and carrying the deferred photo-thumbnail feature.
 *
 * Extracted from `SpaceDetailPage`'s inline card markup so the page stays
 * readable now that the card carries a thumbnail + reaction control + the new
 * token-driven styling. The page owns the batch state (reactions + thumbnails
 * maps) and passes per-card props, mirroring how `TimelineReactionControl`
 * receives its `summary` as a prop.
 *
 * Visual language (all from v2.0 tokens — no one-off values):
 *  - **Card surface:** `elevation-raised` → `bg-canvas-soft` + hairline
 *    `border border-ink/5`, `rounded-xl`.
 *  - **Hover:** the canonical `.hover-lift` utility (translateY, accent border,
 *    one hairline glow). This replaces the card's former ad-hoc
 *    `transition-colors duration-200 hover:border-ink/10 hover:bg-canvas-raised`
 *    — the deliberate `.hover-lift` application the design system calls for.
 *  - **Title:** `text-base font-semibold text-ink` (primary sans-serif, per
 *    Design System §3 — titles stay sans).
 *  - **Type badge:** `bg-accent-soft text-accent-400` — the new accent/ink
 *    token scale, no hardcoded values.
 *  - **Metadata row (date + location):** `font-mono text-xs text-ink-muted` —
 *    the signature typographic accent per Design System §3, reserved for
 *    dates/counts/metadata. Titles/descriptions stay on the primary
 *    sans-serif. Date format: `23 Jul 2026` (DD Mon YYYY) — compact,
 *    unambiguous, journal-stamp-like in mono.
 *  - **Thumbnail:** top-right, ~64px square, `rounded-lg`, hairline border,
 *    via {@link MemoryThumbnail}.
 *  - **Reaction control:** `TimelineReactionControl` as today — visual tokens
 *    only, no change to its interaction logic (long-press, popup, hint).
 *
 * Navigation: the card is a `<div>` (not a `<Link>`) so the reaction pill
 * `<button>` isn't nested inside an anchor (invalid HTML, would steal clicks).
 * The **title** is the `<Link>` to Memory Detail, exactly as before the
 * redesign. The thumbnail is **not** clickable to a lightbox — clicking the
 * card/title still navigates to Memory Detail (spec: "No lightbox/click-to-
 * enlarge from the card").
 */
export default function MemoryTimelineCard({
  memory,
  spaceId,
  thumbnails,
  summary,
  currentUserId,
  isPending,
  onToggleReaction,
}: MemoryTimelineCardProps) {
  // Deterministic layout rule (plan §3.2): 3+ photos → hero mosaic layout
  // (MultiPhotoMosaic, full-width below text), ≤2 photos → compact thumbnail
  // (MemoryThumbnail, top-right ~64px). This gives Memories with many photos
  // a richer visual presence while keeping low-photo Memories compact.
  const useHeroMosaic = thumbnails.length >= 3;

  return (
    <div className="hover-lift rounded-xl border border-ink/5 bg-canvas-soft p-5">
      <div className="flex items-start gap-4">
        {/* Text content — flexes to fill, stays left of the thumbnail. */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-ink">
              <Link
                to={memoryDetailPath(spaceId, memory.id)}
                className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
              >
                {memory.title}
              </Link>
            </h3>
            {memory.memory_type && (
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-400">
                {formatMemoryType(memory.memory_type)}
              </span>
            )}
          </div>

          {/* Metadata row — font-mono is the signature typographic accent
              (Design System §3), reserved for dates/counts/metadata. The date
              uses the DD Mon YYYY format (e.g. "23 Jul 2026") — compact,
              unambiguous, journal-stamp-like in mono. Location, if present,
              joins the same mono row separated by a middot. */}
          <p className="mt-1.5 font-mono text-xs text-ink-muted">
            {formatMemoryDate(memory.memory_date)}
            {memory.location && (
              <>
                <span className="mx-1.5 text-ink-disabled" aria-hidden="true">
                  ·
                </span>
                {memory.location}
              </>
            )}
          </p>

          {memory.description && (
            <p className="mt-3 line-clamp-3 text-sm text-ink-muted">
              {memory.description}
            </p>
          )}

          {/* Inline reaction control (feature-specs §5). Only rendered once
              the batch fetch has seeded this card's summary, so the required
              `summary` prop is always well-formed. Visual tokens only — no
              change to its interaction logic. */}
          {summary && (
            <div className="mt-4 flex items-center">
              <TimelineReactionControl
                memoryId={memory.id}
                currentUserId={currentUserId}
                summary={summary}
                isPending={isPending}
                onToggle={onToggleReaction}
              />
            </div>
          )}
        </div>

        {/* Photo thumbnail — compact mode (≤2 photos): top-right, ~64px
            square. Renders nothing when the Memory has no media. */}
        {!useHeroMosaic && <MemoryThumbnail media={thumbnails} />}
      </div>

      {/* Hero mosaic (3+ photos): full-width below the text content, giving
          Memories with many photos a richer visual presence. Uses
          MultiPhotoMosaic with landscape aspect ratio for a wider, more
          cinematic feel. */}
      {useHeroMosaic && (
        <div className="mt-4">
          <MultiPhotoMosaic
            media={thumbnails}
            aspectRatio="landscape"
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Formats a stored `memory_type` value (snake_case) into a friendly display
 * label. Falls back to a title-cased version of the raw value if the type
 * isn't in the known set — defensive against future types added to the
 * database before the UI is updated.
 */
function formatMemoryType(rawType: string): string {
  if (rawType in MEMORY_TYPE_LABELS) {
    return MEMORY_TYPE_LABELS[rawType as MemoryType];
  }
  // Title-case fallback for unknown types.
  return rawType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Formats a `memory_date` (stored as `YYYY-MM-DD`) into the compact
 * `DD Mon YYYY` form (e.g. "23 Jul 2026") for the timeline card's mono
 * metadata row.
 *
 * This format was chosen over the prior long-form ("July 23, 2026") and the
 * dotted concept-mockup style ("23.07.2026"): it's compact, unambiguous (no
 * MM/DD vs DD/MM confusion), and reads as a quiet journal stamp in the mono
 * face that pairs with the brass/album aesthetic. Confirmed in the plan
 * (plans/memory-timeline-card-redesign.md §1.3).
 *
 * Returns a calm fallback if the value can't be parsed rather than rendering
 * "Invalid Date". The fallback stays short so the mono row doesn't look
 * broken.
 */
function formatMemoryDate(memoryDate: string): string {
  // Parse as a local date by appending T00:00:00 so timezone offsets don't
  // shift the day backwards for users east of UTC.
  const date = new Date(`${memoryDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Date unknown";
  }
  // Pin to "en-GB" so the day always precedes the month — "23 Jul 2026" (DD
  // Mon YYYY), the format confirmed in the plan. Using `undefined` (the
  // browser default) would render month-first ("Jul 23, 2026") on en-US
  // locales, which breaks the confirmed journal-stamp ordering. The mono
  // face + this fixed ordering is the signature typographic accent.
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
