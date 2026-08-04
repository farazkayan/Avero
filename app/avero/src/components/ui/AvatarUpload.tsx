// ============================================================================
// Avero Avatar Upload
// ----------------------------------------------------------------------------
// Upload button + preview for the AppShell header. Handles file selection,
// validation, the crop-positioning step (Phase C), upload via lib/avatar.ts,
// and immediate UI update via AuthContext refreshAvatar.
//
// Flow (Phase C):
//   pick file → validate (image/*, ≤ 2 MB) → load image → open AvatarCropDialog
//   → user drags + zooms to position → confirm → uploadAvatar(file, crop)
//   → resize→WebP→upload→profiles.avatar_url → refreshAvatar.
// Cancel at the crop step uploads nothing (non-destructive).
// ============================================================================

import { useRef, useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  uploadAvatar,
  getAvatarDownloadUrl,
  loadAvatarImage,
  revokeAvatarImage,
} from "../../lib/avatar";
import { AvatarFallback } from "./AvatarFallback";
import AvatarCropDialog from "./AvatarCropDialog";

interface AvatarUploadProps {
  /** User's display name (for fallback) */
  name: string;
  /** Diameter in pixels (default: 32) */
  size?: number;
}

export function AvatarUpload({ name, size = 32 }: AvatarUploadProps) {
  const { avatarUrl, refreshAvatar, avatarVersion } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [prevAvatarUrl, setPrevAvatarUrl] = useState(avatarUrl);
  // Phase C: the image awaiting crop confirmation. When set, the crop dialog
  // is open; the actual upload happens on confirm with the user's offset.
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const isLoadingAvatar = !!avatarUrl && !downloadUrl;

  // Fetch download URL when avatarUrl changes
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

  // Phase C: validate + load the image, then open the crop dialog. The
  // actual upload happens on confirm (with the user's pan offset). Validation
  // is preserved here so an invalid file never reaches the dialog.
  const handleFileSelect = async (file: File) => {
    setError(null);
    try {
      const img = await loadAvatarImage(file);
      setPendingFile(file);
      setCropImage(img);
    } catch {
      setError("Couldn't load that image. Please try another file.");
    }
  };

  // User confirmed the crop — upload with the chosen source-pixel crop region
  // (top-left + size), resolved from the user's pan + zoom by the dialog.
  const handleCropConfirm = async (crop: {
    x: number;
    y: number;
    size: number;
  }) => {
    if (!pendingFile) return;
    setIsUploading(true);
    // Keep cropImage alive during upload so the dialog stays visible (loading
    // state); revoke + clear once the upload resolves.
    const result = await uploadAvatar(pendingFile, crop);

    if (result.ok) {
      // Refresh avatar from AuthContext (which will re-fetch from profiles)
      await refreshAvatar();
    } else {
      setError(result.error);
    }

    revokeAvatarImage(cropImage);
    setCropImage(null);
    setPendingFile(null);
    setIsUploading(false);
  };

  // User cancelled the crop — nothing uploads (non-destructive).
  const handleCropCancel = () => {
    revokeAvatarImage(cropImage);
    setCropImage(null);
    setPendingFile(null);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    // Reset input so the same file can be selected again
    if (e.target) e.target.value = "";
  };

  // Determine what to show: uploaded avatar, uploading state, loading avatar, or fallback
  const hasAvatar = !!avatarUrl;

  return (
    <div className="relative" onClick={handleClick}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="absolute inset-0 opacity-0 cursor-pointer"
        disabled={isUploading}
        aria-label="Upload avatar"
      />

      {hasAvatar && downloadUrl ? (
        <img
          src={downloadUrl}
          alt={`${name}'s avatar`}
          className="rounded-full object-cover ring-2 ring-accent-600/50"
          style={{ width: size, height: size }}
          loading="lazy"
        />
      ) : hasAvatar && isLoadingAvatar ? (
        <div
          className="rounded-full bg-canvas-raised animate-pulse"
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
      ) : (
        <AvatarFallback name={name} size={size} />
      )}

      {isUploading && (
        <div
          className="absolute inset-0 rounded-full bg-canvas/80 flex items-center justify-center"
          aria-busy="true"
        >
          <svg
            className="animate-spin text-accent-500"
            style={{ width: size * 0.4, height: size * 0.4 }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      )}

      {error && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs text-ink bg-error rounded whitespace-nowrap z-10"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Camera icon overlay on hover */}
      {!isUploading && (
        <div
          className="absolute inset-0 rounded-full bg-canvas/60 opacity-0 hover:opacity-100 transition-opacity duration-180 flex items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          <svg
            className="text-ink-muted"
            style={{ width: size * 0.4, height: size * 0.4 }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
      )}

      {/* Phase C: crop-positioning step. Rendered as a portal-like overlay
          (fixed, z-50) so it escapes the small avatar's clipping context. */}
      {cropImage && (
        <AvatarCropDialog
          image={cropImage}
          loading={isUploading}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}