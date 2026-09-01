import { useEffect, useRef, useState } from "react";
import { getMediaDownloadUrl } from "../../lib/media";
import { asMediaType, type Media } from "../../types/media";

/**
 * Display state of a single mosaic media item, keyed by media row id.
 */
type MosaicThumbState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

type MultiPhotoMosaicProps = {
  /** Up to 3 media rows (thumbnail_grid_path preferred). */
  media: Media[];
  /** Additional styling. */
  className?: string;
  /** Aspect ratio of the mosaic area. Default: square. */
  aspectRatio?: "square" | "landscape";
  /** Fixed height for the mosaic (like single photo). Overrides aspectRatio if provided. */
  height?: string;
};

/**
 * Multi-photo mosaic layout used by:
 * - Spaces Dashboard cards: most recent photos across ALL memories in a Space
 * - Space Detail Timeline Memory cards: most recent photos within that specific Memory
 *
 * Layout states (recomputed on every load, not cached):
 * - 0 photos: calm placeholder (icon/pattern using accent sparingly)
 * - 1 photo: single image fills the area
 * - 2 photos: two-photo split (50/50)
 * - 3+ photos: three-photo mosaic (always capped at 3)
 *
 * Uses thumbnail_grid_path (300px WebP) — never full-size originals.
 * This is a list/preview context, same performance category as existing B-series work.
 */
export default function MultiPhotoMosaic({
  media,
  className = "",
  aspectRatio = "square",
  height,
}: MultiPhotoMosaicProps) {
  // Clamp to max 3 photos
  const displayMedia = media.slice(0, 3);
  const photoCount = displayMedia.length;

  // Build container classes - use fixed height if provided, otherwise aspect-ratio
  const containerClasses = [
    "relative overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised w-full max-w-full",
    height ? height : (aspectRatio === "landscape" ? "aspect-[4/3]" : "aspect-square"),
    className,
  ].join(" ");

  // 0 photos → calm placeholder
  if (photoCount === 0) {
    return (
      <div
        className={containerClasses}
        aria-hidden="true"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-ink-muted/30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      </div>
    );
  }

  // 1 photo → single image fills area
  if (photoCount === 1) {
    return <SinglePhoto media={displayMedia[0]} aspectRatio={aspectRatio} height={height} className={className} />;
  }

  // 2 photos → split layout
  if (photoCount === 2) {
    return (
      <SplitLayout
        media={displayMedia}
        aspectRatio={aspectRatio}
        height={height}
        className={className}
      />
    );
  }

  // 3+ photos → three-photo mosaic
  return (
    <MosaicLayout
      media={displayMedia}
      aspectRatio={aspectRatio}
      height={height}
      className={className}
    />
  );
}

/** Single photo fills the entire area. */
function SinglePhoto({
  media,
  aspectRatio,
  height,
  className,
}: {
  media: Media;
  aspectRatio: "square" | "landscape";
  height?: string;
  className: string;
}) {
  const [state, setState] = useState<MosaicThumbState>({ status: "loading" });
  const inFlight = useRef(false);

  useEffect(() => {
    // Reset on every effect run so a remount with the same `media` after an
    // earlier unmount-mid-fetch can still resolve (see M-18 in the audit).
    inFlight.current = false;

    if (inFlight.current) return;
    inFlight.current = true;

    let cancelled = false;
    const fileKey = media.thumbnail_detail_path ?? media.thumbnail_path ?? media.url;
    getMediaDownloadUrl(fileKey).then((result) => {
      if (cancelled || !inFlight.current) return;
      setState(
        result.ok
          ? { status: "ready", url: result.url }
          : { status: "error" }
      );
      inFlight.current = false;
    });
    return () => {
      cancelled = true;
      inFlight.current = false;
    };
  }, [media]);

  const type = asMediaType(media.type);
  const renderAsImage = type === "image" || Boolean(media.thumbnail_detail_path ?? media.thumbnail_path);

  if (state.status === "error" || type === null) {
    return (
      <div
        className={[
          "relative overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised w-full max-w-full",
          height ? height : (aspectRatio === "landscape" ? "aspect-[4/3]" : "aspect-square"),
          className,
        ].join(" ")}
        aria-hidden="true"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-ink-muted/30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "relative overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised w-full max-w-full",
        height ? height : (aspectRatio === "landscape" ? "aspect-[4/3]" : "aspect-square"),
        className,
      ].join(" ")}
      aria-hidden="true"
    >
      {state.status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-canvas-raised/50" />
      )}
      {renderAsImage ? (
        <img
          src={state.status === "ready" ? state.url : ""}
          alt=""
          loading="lazy"
          className={[
            "pointer-events-none h-full w-full select-none object-cover transition-opacity duration-300",
            state.status === "ready" ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
      ) : (
        <video
          src={state.status === "ready" ? state.url : ""}
          preload="metadata"
          muted
          className="pointer-events-none h-full w-full object-cover"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Two-photo split (50/50). */
function SplitLayout({
  media,
  aspectRatio,
  height,
  className,
}: {
  media: Media[];
  aspectRatio: "square" | "landscape";
  height?: string;
  className: string;
}) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised w-full max-w-full",
        height ? height : (aspectRatio === "landscape" ? "aspect-[4/3]" : "aspect-square"),
        className,
      ].join(" ")}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex">
        {media.map((m, i) => (
          <MosaicPhoto
            key={m.id}
            media={m}
            index={i}
            className="flex-1 min-w-0"
          />
        ))}
      </div>
    </div>
  );
}

/** Three-photo mosaic: one large (2/3) + two small stacked (1/3). */
function MosaicLayout({
  media,
  aspectRatio,
  height,
  className,
}: {
  media: Media[];
  aspectRatio: "square" | "landscape";
  height?: string;
  className: string;
}) {
  const [main, ...rest] = media;

  return (
    <div
      className={[
        "relative overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised w-full max-w-full",
        height ? height : (aspectRatio === "landscape" ? "aspect-[4/3]" : "aspect-square"),
        className,
      ].join(" ")}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex">
        {/* Main photo: 2/3 width */}
        <div className="relative w-2/3 min-w-0">
          <MosaicPhoto media={main} index={0} className="h-full w-full" />
        </div>
        {/* Stack of two small photos: 1/3 width */}
        <div className="relative w-1/3 min-w-0 flex flex-col">
          {rest.map((m, i) => (
            <MosaicPhoto
              key={m.id}
              media={m}
              index={i + 1}
              className="flex-1 min-h-0"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Individual photo in a mosaic/split layout. */
function MosaicPhoto({
  media,
  index,
  className,
}: {
  media: Media;
  index: number;
  total?: number;
  className: string;
}) {
  const [state, setState] = useState<MosaicThumbState>({ status: "loading" });
  const inFlight = useRef(false);

  useEffect(() => {
    inFlight.current = false;

    if (inFlight.current) return;
    inFlight.current = true;

    let cancelled = false;
    const fileKey = media.thumbnail_detail_path ?? media.thumbnail_path ?? media.url;
    getMediaDownloadUrl(fileKey).then((result) => {
      if (cancelled || !inFlight.current) return;
      setState(
        result.ok
          ? { status: "ready", url: result.url }
          : { status: "error" }
      );
      inFlight.current = false;
    });
    return () => {
      cancelled = true;
      inFlight.current = false;
    };
  }, [media]);

  const type = asMediaType(media.type);
  const renderAsImage = type === "image" || Boolean(media.thumbnail_detail_path ?? media.thumbnail_path);

  if (state.status === "error" || type === null) {
    return (
      <div
        className={[
          "absolute inset-0 overflow-hidden bg-canvas-raised",
          className,
        ].join(" ")}
        aria-hidden="true"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-ink-muted/30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      </div>
    );
  }

  // Subtle border between photos in mosaic
  const borderStyle = index > 0 ? "border-l border-ink/5" : "";

  return (
    <div
      className={[
        "relative overflow-hidden bg-canvas-raised",
        borderStyle,
        className,
      ].join(" ")}
      aria-hidden="true"
    >
      {state.status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-canvas-raised/50" />
      )}
      {renderAsImage ? (
        <img
          src={state.status === "ready" ? state.url : ""}
          alt=""
          loading="lazy"
          className={[
            "pointer-events-none h-full w-full select-none object-cover transition-opacity duration-300",
            state.status === "ready" ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
      ) : (
        <video
          src={state.status === "ready" ? state.url : ""}
          preload="metadata"
          muted
          className="pointer-events-none h-full w-full object-cover"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
    </div>
  );
}