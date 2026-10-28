import { useEffect, useState } from "react";
import { Link } from "react-router";
import MultiPhotoMosaic from "../ui/MultiPhotoMosaic";
import { spaceDetailPath } from "../../constants/routes";
import { getAvatarDownloadUrl } from "../../lib/avatar";
import type { Space, SpaceRole, SpaceMembershipWithSpace, SpaceMemberProfile } from "../../types/space";
import type { Media } from "../../types/media";

type SpaceCardProps = {
  space: Space;
  role: SpaceRole;
  /**
   * Up to 3 most recent media rows across ALL Memories in this Space (newest first),
   * from the dashboard's batch mosaic thumbnail fetch. Empty array → placeholder.
   */
  thumbnails: Media[];
  /**
   * Members of this Space (including profile avatars) for the avatar stack.
   */
  members: (SpaceMembershipWithSpace & { profiles: SpaceMemberProfile })[];
  /**
   * Number of memories in this Space.
   */
  memoryCount: number;
};

/**
 * A single Space in the dashboard list (spaces-design §6.1, design-system §6),
 * redesigned to match the Stitch source exactly.
 *
 * The whole card is a React Router `<Link>` to the Space detail page
 * (`/spaces/:id`), so the entire surface is clickable. The role badge is
 * rendered inside the link but is non-interactive (purely informational), so
 * no nested interactive elements are introduced. The mosaic's media is
 * `pointer-events-none` (handled by {@link MultiPhotoMosaic}), so a click on
 * the mosaic passes through to the link rather than stealing it.
 */
export default function SpaceCard({ space, role, thumbnails, members, memoryCount }: SpaceCardProps) {
  // Helper to format time ago from an ISO string
  const formatTimeAgo = (isoString: string): string => {
    const now = new Date();
    const past = new Date(isoString);
    const seconds = Math.floor((now.getTime() - past.getTime()) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(months / 12);

    if (years > 0) {
      return `${years}y ago`;
    } else if (months > 0) {
      return `${months}mo ago`;
    } else if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else if (minutes > 0) {
      return `${minutes}m ago`;
    } else {
      return "just now";
    }
  };

  return (
    <Link
      to={spaceDetailPath(space.id)}
      className="hover-lift flex flex-col bg-surface-container-low dark:bg-card-dark rounded-[16px] overflow-hidden border border-outline-variant dark:border-outline shadow-sm cursor-pointer group"
    >
      {/* Photo mosaic - h-48 with Stitch source layout based on photo count */}
      {thumbnails.length === 0 ? (
        // 0 photos: placeholder (using MultiPhotoMosaic's placeholder)
        <div className="h-48 p-1 bg-surface-container dark:bg-inverse-surface">
          <MultiPhotoMosaic media={[]} className="w-full h-full" />
        </div>
      ) : thumbnails.length === 1 ? (
        // 1 photo: single image filling the area
        <div className="h-48 p-1 bg-surface-container dark:bg-inverse-surface">
          <MultiPhotoMosaic media={thumbnails} className="w-full h-full rounded-[12px]" />
        </div>
      ) : thumbnails.length === 2 ? (
        // 2 photos: 3-column grid (left 2/3 width, right 1/3 width split vertically)
        <div className="h-48 p-1 grid grid-cols-3 gap-1 bg-surface-container dark:bg-inverse-surface">
          {/* Left column: spans 2 columns, 1 row (so full height) */}
          <div className="col-span-2">
            <MultiPhotoMosaic 
              media={[thumbnails[0]]} 
              className="w-full h-full bg-cover bg-center rounded-tl-[12px] rounded-bl-[4px]"
            />
          </div>
          {/* Right column: 1 column wide, split into 2 rows */}
          <div className="col-span-1 grid grid-rows-2 gap-1">
            <MultiPhotoMosaic 
              media={[thumbnails[1]]} 
              className="w-full h-full bg-cover bg-center rounded-tr-[12px]"
            />
            <MultiPhotoMosaic 
              media={[]} 
              className="w-full h-full bg-cover bg-center rounded-br-[4px]"
            />
          </div>
        </div>
      ) : (
        // 3+ photos: 2x2 grid (left column spans both rows, right column split into two rows)
        <div className="h-48 p-1 grid grid-cols-2 grid-rows-2 gap-1 bg-surface-container dark:bg-inverse-surface">
          {/* Left column: spans both rows (full height, 1/2 width) */}
          <div className="col-span-1 row-span-2">
            <MultiPhotoMosaic 
              media={[thumbnails[0]]} 
              className="w-full h-full bg-cover bg-center rounded-tl-[12px] rounded-bl-[4px]"
            />
          </div>
          {/* Top right */}
          <div className="col-span-1 row-span-1">
            <MultiPhotoMosaic 
              media={[thumbnails[1]]} 
              className="w-full h-full bg-cover bg-center rounded-tr-[12px]"
            />
          </div>
          {/* Bottom right */}
          <div className="col-span-1 row-span-1">
            <MultiPhotoMosaic 
              media={[thumbnails[2]]} 
              className="w-full h-full bg-cover bg-center rounded-br-[4px]"
            />
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 flex flex-col gap-3 sm:gap-4">
        <div className="flex justify-between items-start gap-3">
          <h3 
            className="text-headline-sm sm:text-headline-md font-headline-md text-on-surface dark:text-surface-container-lowest group-hover:text-accent-warm dark:group-hover:text-primary-fixed-dim transition-colors text-balance break-words"
          >
            {space.name}
          </h3>
          <span 
            className={role === "owner" 
              ? "px-2.5 py-0.5 rounded-full bg-accent-warm/20 text-accent-warm dark:text-primary-fixed-dim font-mono-label text-mono-label uppercase tracking-wider shrink-0"
              : "px-2.5 py-0.5 rounded-full bg-surface-container-high dark:bg-inverse-surface text-on-surface-variant dark:text-secondary-fixed-dim font-mono-label text-mono-label uppercase tracking-wider shrink-0"
            }
          >
            {role === "owner" ? "Owner" : "Member"}
          </span>
        </div>
        
        <div className="flex items-center justify-between mt-auto">
          {/* Member avatar stack */}
          <div className="flex -space-x-2">
            {members.slice(0, 3).map((member) => (
              <MemberAvatar
                key={member.id}
                avatarKey={member.profiles.avatar_url ?? null}
              />
            ))}
            {members.length > 3 && (
              <div
                className="size-8 rounded-full border-2 border-surface-container-low dark:border-card-dark bg-surface-container dark:bg-inverse-surface flex items-center justify-center font-mono-label text-mono-label text-on-surface-variant dark:text-surface-container-lowest"
              >
                +{members.length - 3}
              </div>
            )}
          </div>
          
          {/* Memory count + updated timestamp */}
          <span 
            className="font-mono-data text-mono-data tabular-nums text-on-surface-variant dark:text-secondary-fixed-dim text-right"
          >
            {memoryCount} memories<br />
            {formatTimeAgo(space.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Renders a single member avatar in the SpaceCard avatar stack.
 *
 * `avatarKey` is the durable B2 object key stored in `profiles.avatar_url`
 * (e.g. `avatars/{user_id}/avatar.webp`) — it is NOT a fetchable URL. We
 * resolve it to a short-lived presigned URL via `getAvatarDownloadUrl`, which
 * is the same path used by {@link MemberRow}, the app shell, and Settings.
 * Without this resolution the avatar renders as a broken image (the browser
 * treats the B2 key as a relative URL and 404s).
 *
 * The hook is cancelled on unmount so a slow avatar resolution cannot
 * `setState` after the card has been removed from the DOM (H-5 fix; audit
 * item M-18 pattern).
 */
function MemberAvatar({ avatarKey }: { avatarKey: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [prevAvatarKey, setPrevAvatarKey] = useState(avatarKey);

  // Reset the cached download URL when the source avatar key changes —
  // during render, not in an effect (matches the Avatar.tsx pattern and
  // avoids the react-hooks/set-state-in-effect lint rule).
  if (avatarKey !== prevAvatarKey) {
    setPrevAvatarKey(avatarKey);
    setUrl(null);
  }

  useEffect(() => {
    if (!avatarKey) {
      return;
    }
    let cancelled = false;
    getAvatarDownloadUrl(avatarKey).then((result) => {
      if (!cancelled) {
        setUrl(result.ok ? result.url : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [avatarKey]);

  return (
    <div
      className="size-8 rounded-full border-2 border-surface-container-low dark:border-card-dark bg-cover bg-center"
      style={url ? { backgroundImage: `url(${url})` } : undefined}
    />
  );
}
