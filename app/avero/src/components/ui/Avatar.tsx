import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { getAvatarDownloadUrl } from "../../lib/avatar";
import { AvatarFallback } from "./AvatarFallback";

/**
 * Avatar display component.
 * Shows the user's uploaded avatar if available, otherwise falls back to initials.
 */
export default function Avatar({ size = 32 }: { size?: number }) {
  const { user, avatarUrl, avatarVersion } = useAuth();
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

  // Loading is true while we have an avatar path but haven't resolved its
  // download URL yet. Derived during render instead of tracked via setState
  // in the effect (react-hooks/set-state-in-effect).
  const isLoading = !!avatarUrl && !downloadUrl;

  useEffect(() => {
    if (!avatarUrl) {
      return;
    }

    let cancelled = false;

    // getAvatarDownloadUrl now returns a discriminated-union result (mirroring
    // getMediaDownloadUrl) and consults a session-scoped cache, so a repeat
    // mount/render reuses the cached presigned URL instead of re-invoking the
    // Edge Function — the fix for the avatar loading slower than Memory
    // thumbnails.
    getAvatarDownloadUrl(avatarUrl).then((result) => {
      if (!cancelled) {
        setDownloadUrl(result.ok ? result.url : null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [avatarUrl, avatarVersion]);

  // Get display name from user metadata or email
  const getDisplayName = (): string => {
    if (!user) return "";
    return user.user_metadata?.name as string | undefined || user.email || "";
  };

  if (isLoading && !downloadUrl) {
    return (
      <div
        className="rounded-full bg-canvas-raised animate-pulse"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  if (downloadUrl) {
    return (
      <img
        src={downloadUrl}
        alt=""
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }

  return <AvatarFallback name={getDisplayName()} size={size} />;
}