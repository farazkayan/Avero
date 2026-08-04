import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import type { SpaceMember, SpaceRole } from "../../types/space";
import { getAvatarDownloadUrl } from "../../lib/avatar";
import { AvatarFallback } from "../ui/AvatarFallback";

type MemberRowProps = {
  member: SpaceMember;
  /** Whether the row represents the currently signed-in user. */
  isCurrentUser?: boolean;
};

/**
 * A single member in the Space detail member list (spaces-design §6.3,
 * design-system §6).
 *
 * Displays the member's display name (falling back to a truncated user id when
 * the joined profile is missing), their role as a badge, and a "You" marker
 * when the row is the current user. The role badge reuses the same visual
 * language as `SpaceCard`'s `RoleBadge` so owner/member reads consistently
 * across the dashboard and the detail page.
 *
 * This is a presentational component — it takes a `SpaceMember` and renders
 * it. Any owner-only actions (remove member) are not part of this step and
 * will be added alongside the invitations UI.
 */
export default function MemberRow({
  member,
  isCurrentUser = false,
}: MemberRowProps) {
  const displayName = member.profiles?.name ?? "Unknown member";
  const { avatarVersion } = useAuth();

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={displayName} avatarUrl={member.profiles?.avatar_url} avatarVersion={avatarVersion} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {displayName}
            {isCurrentUser && (
              <span className="ml-2 text-xs font-normal text-ink-muted">
                (you)
              </span>
            )}
          </p>
        </div>
      </div>
      <RoleBadge role={member.role} />
    </li>
  );
}

/**
 * A member's avatar. When a profile has no `avatar_url`, render the first
 * initial of their name on a soft accent surface — a calm, deterministic
 * placeholder that avoids a broken-image glyph.
 *
 * IMPORTANT: `avatarUrl` is the durable B2 object *key*
 * (e.g. `avatars/{user_id}/avatar.webp`), NOT a URL the browser can fetch
 * directly. It must be resolved into a short-lived presigned download URL via
 * `getAvatarDownloadUrl` — the same path used by the shared `Avatar` and
 * `AvatarUpload` components. Rendering the raw key as an `<img src>` produces
 * a relative request that 404s, leaving the avatar blank (the original bug on
 * the Space Settings member list). This component mirrors the resolution
 * pattern in `Avatar.tsx`: render-time reset of the cached download URL when
 * the source key changes, an effect to fetch the presigned URL, a loading
 * pulse while pending, and the `AvatarFallback` otherwise.
 */
const MEMBER_AVATAR_SIZE = 36; // h-9 w-9

function Avatar({
  name,
  avatarUrl,
  avatarVersion,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  avatarVersion: number;
}) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [prevAvatarUrl, setPrevAvatarUrl] = useState(avatarUrl);

  // Reset the cached download URL when the source `avatarUrl` changes —
  // during render, not in an effect (react-hooks/set-state-in-effect). The
  // loading flag is derived below from `avatarUrl` + `downloadUrl`, so it
  // automatically reflects "fetching" without a separate setState.
  if (avatarUrl !== prevAvatarUrl) {
    setPrevAvatarUrl(avatarUrl);
    setDownloadUrl(null);
  }

  // Loading is true while we have an avatar key but haven't resolved its
  // download URL yet. Derived during render instead of tracked via setState
  // in the effect (react-hooks/set-state-in-effect).
  const isLoading = !!avatarUrl && !downloadUrl;

  useEffect(() => {
    if (!avatarUrl) {
      return;
    }

    let cancelled = false;

    getAvatarDownloadUrl(avatarUrl).then((result) => {
      if (!cancelled) {
        setDownloadUrl(result.ok ? result.url : null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [avatarUrl, avatarVersion]);

  if (isLoading) {
    return (
      <div
        className="shrink-0 rounded-full bg-canvas-raised animate-pulse"
        style={{ width: MEMBER_AVATAR_SIZE, height: MEMBER_AVATAR_SIZE }}
        aria-hidden="true"
      />
    );
  }

  if (downloadUrl) {
    return (
      <img
        src={downloadUrl}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: MEMBER_AVATAR_SIZE, height: MEMBER_AVATAR_SIZE }}
        loading="lazy"
      />
    );
  }

  return <AvatarFallback name={name} size={MEMBER_AVATAR_SIZE} />;
}

function RoleBadge({ role }: { role: SpaceRole }) {
  if (role === "owner") {
    return (
      <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-400">
        Owner
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-medium text-ink-muted">
      Member
    </span>
  );
}
