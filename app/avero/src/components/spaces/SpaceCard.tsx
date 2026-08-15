import { Link } from "react-router";
import MultiPhotoMosaic from "../ui/MultiPhotoMosaic";
import { spaceDetailPath } from "../../constants/routes";
import type { Space, SpaceRole } from "../../types/space";
import type { Media } from "../../types/media";

type SpaceCardProps = {
  space: Space;
  role: SpaceRole;
  /**
   * Up to 3 most recent media rows across ALL Memories in this Space (newest first),
   * from the dashboard's batch mosaic thumbnail fetch. Empty array → placeholder.
   */
  thumbnails: Media[];
};

/**
 * A single Space in the dashboard list (spaces-design §6.1, design-system §6),
 * redesigned to the v2.0 design system and carrying a multi-photo mosaic
 * preview so Spaces feel alive on the "Your Spaces" list.
 *
 * The whole card is a React Router `<Link>` to the Space detail page
 * (`/spaces/:id`), so the entire surface is clickable. The role badge is
 * rendered inside the link but is non-interactive (purely informational), so
 * no nested interactive elements are introduced. The mosaic's media is
 * `pointer-events-none` (handled by {@link MultiPhotoMosaic}), so a click on
 * the mosaic passes through to the link rather than stealing it.
 *
 * Visual language (all from v2.0 tokens — no one-off values):
 *  - **Card surface:** `elevation-raised` → `bg-canvas-soft` + hairline
 *    `border border-ink/5`, `rounded-xl`.
 *  - **Hover:** the canonical `.hover-lift` utility (translateY, accent border,
 *    one hairline glow).
 *  - **Title:** `text-base font-semibold text-ink` (primary sans-serif, per
 *    Design System §3 — titles stay sans).
 *  - **Role badge:** `bg-accent-soft text-accent-400` (Owner) /
 *    `bg-ink/5 text-ink-muted` (Member), with `font-mono` text — the role
 *    label is metadata, so it uses the signature mono face per Design System
 *    §3 (mono reserved for dates/counts/metadata labels).
 *  - **Description:** `text-sm text-ink-muted line-clamp-2` (sans-serif).
 *  - **Mosaic:** top-right, ~64px square, via {@link MultiPhotoMosaic} —
 *    shows up to 3 recent photos across all Memories in the Space. Layout
 *    states: 0=placeholder, 1=single, 2=split, 3+=mosaic. The new
 *    get_space_mosaic_thumbnails RPC returns up to 3 rows per Space (newest
 *    first) that MultiPhotoMosaic consumes directly.
 */
export default function SpaceCard({ space, role, thumbnails }: SpaceCardProps) {
  return (
    <Link
      to={spaceDetailPath(space.id)}
      className="hover-lift block rounded-xl border border-ink/5 bg-canvas-soft p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
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

        {/* Photo preview — top-right, ~64px square. Uses MultiPhotoMosaic to
            show up to 3 recent photos across all Memories in the Space.
            Renders a calm placeholder when the Space has no media. */}
        <MultiPhotoMosaic media={thumbnails} className="w-16 h-16 shrink-0" />
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
    <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-0.5 font-mono text-xs font-medium text-ink-muted">
      Member
    </span>
  );
}
