import { Link } from "react-router";
import MemoryThumbnail from "./MemoryThumbnail";
import { memoryDetailPath } from "../../constants/routes";
import type { Memory } from "../../types/memory";
import type { Media } from "../../types/media";

type EchoesCardProps = {
  /** The Memory this card represents. */
  memory: Memory;
  /** The Space the Memory belongs to — used to build the detail route. */
  spaceId: string;
  /** The first 1–2 media rows for this Memory (oldest first), from the page's
   *  batch thumbnail fetch. Empty array → no thumbnail. */
  thumbnails: Media[];
  /** The interval label (e.g., "1 week ago", "3 years ago"). */
  intervalLabel: string;
};

/**
 * A single Echoes card in the "On This Day" carousel.
 *
 * Visual language (all from v2.0 tokens — no one-off values):
 *  - **Card surface:** `elevation-raised` → `bg-canvas-soft` + hairline
 *    `border border-ink/5`, `rounded-xl`.
 *  - **Hover:** the canonical `.hover-lift` utility (translateY, accent border,
 *    one hairline glow). Consistent with MemoryTimelineCard and AchievementCard.
 *  - **Interval label:** `font-mono text-xs text-ink-muted` — the signature
 *    typographic accent per Design System §3, reserved for dates/counts/metadata.
 *  - **Title:** `text-sm font-semibold text-ink` (primary sans-serif).
 *  - **Thumbnail:** top-right, ~64px square, `rounded-lg`, hairline border,
 *    via {@link MemoryThumbnail} (uses `thumbnail_grid_path` — the B.1 pipeline).
 *
 * Navigation: the card is a `<div>` (not a `<Link>`) so the thumbnail isn't
 * nested inside an anchor. The **title** is the `<Link>` to Memory Detail,
 * exactly as in MemoryTimelineCard. The thumbnail is not clickable.
 *
 * Motion: respects `prefers-reduced-motion` via the `.hover-lift` utility
 * (Design System §7 — "restrained... no bounce, no overshoot").
 */
export default function EchoesCard({
  memory,
  spaceId,
  thumbnails,
  intervalLabel,
}: EchoesCardProps) {
  return (
    <div className="hover-lift flex-shrink-0 w-64 rounded-xl border border-ink/5 bg-canvas-soft p-4">
      <div className="flex items-start gap-3">
        {/* Text content — flexes to fill, stays left of the thumbnail. */}
        <div className="min-w-0 flex-1">
          {/* Interval label — mono font, muted ink (Design System §3) */}
          <p className="font-mono text-xs text-ink-muted">{intervalLabel}</p>

          {/* Title — links to Memory Detail */}
          <h3 className="mt-1 text-sm font-semibold text-ink truncate">
            <Link
              to={memoryDetailPath(spaceId, memory.id)}
              className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
            >
              {memory.title}
            </Link>
          </h3>
        </div>

        {/* Photo thumbnail — top-right, ~64px square. Renders nothing when
            the Memory has no media (no placeholder, no broken-image icon). */}
        <MemoryThumbnail media={thumbnails} />
      </div>
    </div>
  );
}