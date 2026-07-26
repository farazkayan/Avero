import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { getAvatarDownloadUrl } from "../../lib/avatar";
import { AvatarFallback } from "./AvatarFallback";

/**
 * Avatar display component.
 * Shows the user's uploaded avatar if available, otherwise falls back to initials.
 */
export default function Avatar({ size = 32 }: { size?: number }) {
  const { user, avatarUrl } = useAuth();
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

    getAvatarDownloadUrl(avatarUrl).then((url) => {
      if (!cancelled) {
        setDownloadUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

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