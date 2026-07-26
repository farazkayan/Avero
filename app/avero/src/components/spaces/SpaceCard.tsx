import { Link } from "react-router";
import MemoryThumbnail from "../memories/MemoryThumbnail";
import { spaceDetailPath } from "../../constants/routes";
import type { Space, SpaceRole } from "../../types/space";
import type { Media } from "../../types/media";

type SpaceCardProps = {
  space: Space;
  role: SpaceRole;
  /**
   * The first 1–2 media rows of this Space's most recent Memory (oldest first),
   * from the dashboard's batch thumbnail fetch. Empty array → no thumbnail.
   */
  thumbnails: Media[];
};

/**
 * A single Space in the dashboard list (spaces-design §6.1, design-system §6),
 * redesigned to the v2.0 design system and carrying a small photo preview so
 * Spaces feel alive on the "Your Spaces" list — mirroring the now-redesigned
 * {@link MemoryTimelineCard} / {@link MemoryThumbnail}.
 *
 * The whole card is a React Router `<Link>` to the Space detail page
 * (`/spaces/:id`), so the entire surface is clickable. The role badge is
 * rendered inside the link but is non-interactive (purely informational), so
 * no nested interactive elements are introduced. The thumbnail's media is
 * `pointer-events-none` (handled by `MemoryThumbnail`), so a click on the
 * thumbnail passes through to the link rather than stealing it.
 *
 * Visual language (all from v2.0 tokens — no one-off values), mirroring
 * {@link MemoryTimelineCard}:
 *  - **Card surface:** `elevation-raised` → `bg-canvas-soft` + hairline
 *    `border border-white/5`, `rounded-xl`.
 *  - **Hover:** the canonical `.hover-lift` utility (translateY, accent border,
 *    one hairline glow). This replaces the card's former ad-hoc
 *    `transition-colors duration-200 hover:border-white/10 hover:bg-canvas-raised`
 *    — the deliberate `.hover-lift` application the design system calls for.
 *  - **Title:** `text-base font-semibold text-ink` (primary sans-serif, per
 *    Design System §3 — titles stay sans).
 *  - **Role badge:** `bg-accent-soft text-accent-400` (Owner) /
 *    `bg-white/5 text-ink-muted` (Member), with `font-mono` text — the role
 *    label is metadata, so it uses the signature mono face per Design System
 *    §3 (mono reserved for dates/counts/metadata labels). The pill affordance
 *    is kept (a recognizable role indicator); only the text face changes.
 *  - **Description:** `text-sm text-ink-muted line-clamp-2` (sans-serif).
 *  - **Thumbnail:** top-right, ~64px square, `rounded-lg`, hairline border,
 *    via {@link MemoryThumbnail} — reused as-is (not reinvented). The new
 *    Space-list thumbnails RPC returns exactly the `Media[]` shape (1–2 rows,
 *    oldest-first) that `MemoryThumbnail` already consumes, so the same
 *    stacked/fanned + poster-frame-for-video + "no media = no thumbnail"
 *    behavior applies here with zero new thumbnail logic.
 *
 * No member-count / memory-count displays are added — none exist on the card
 * today, and the spec forbids inventing new data displays. The card gains only
 * the thumbnail + token restyle + `.hover-lift` + mono role badge.
 */
export default function SpaceCard({ space, role, thumbnails }: SpaceCardProps) {
  return (
    <Link
      to={spaceDetailPath(space.id)}
      className="hover-lift block rounded-xl border border-white/5 bg-canvas-soft p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
    >
      <div className="flex items-start gap-4">
        {/* Text content — flexes to fill, stays left of the thumbnail. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-base font-semibold text-ink">{space.name}</h3>
            <RoleBadge role={role} />
          </div>
          {space.description && (
            <p className="mt-2 line-clamp-2 text-sm text-ink-muted">
              {space.description}
            </p>
          )}
        </div>

        {/* Photo preview — top-right, ~64px square. Renders nothing when the
            Space's most recent Memory has no media (no placeholder, no
            broken-image icon). Reuses MemoryThumbnail exactly as the Memory
            card does. */}
        <MemoryThumbnail media={thumbnails} />
      </div>
    </Link>
  );
}

/**
 * The viewer's role within this Space, shown as a small pill. The pill
 * affordance is kept (a recognizable role indicator); only the text face
 * changes to `font-mono` because the role label is metadata (Design System
 * §3 — mono reserved for metadata labels).
 */
function RoleBadge({ role }: { role: SpaceRole }) {
  if (role === "owner") {
    return (
      <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-xs font-medium text-accent-400">
        Owner
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-xs font-medium text-ink-muted">
      Member
    </span>
  );
}
