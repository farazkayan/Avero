import { useEffect, useRef, useState } from "react";
import { getMediaDownloadUrl } from "../../lib/media";
import { asMediaType, type Media } from "../../types/media";

/**
 * The display state of a single thumbnail media item, keyed by the media row's
 * id. Mirrors the {@link TileState} shape used by `MediaGallery` so the
 * resolution lifecycle reads identically.
 *
 * - `loading` — the presigned GET URL is being fetched from the Edge Function.
 * - `ready` — the URL resolved; the thumbnail can render.
 * - `error` — the URL request failed; the thumbnail renders nothing (calm —
 *   no broken-image icon, since the thumbnail is decorative, not primary
 *   content).
 */
type ThumbState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

type MemoryThumbnailProps = {
  /**
   * The first 1–2 media rows for the Memory, ordered by `created_at` ASC
   * (oldest first — matches the gallery's reading order). Comes from the
   * page's batch fetch ({@link fetchTimelineThumbnailsBatch}). An empty array
   * means the Memory has no media; the component renders nothing.
   */
  media: Media[];
};

/**
 * The small photo thumbnail on a Space timeline Memory card (feature-specs §3
 * — the deferred photo-thumbnail feature, now built in the v2.0 visual
 * language).
 *
 * Placement: top-right corner of the card, ~64px square, rounded corners
 * consistent with the card's radius. The card owns the layout; this component
 * owns only the thumbnail's resolution + render.
 *
 * Behavior:
 *  - **No media** (`media.length === 0`) → renders `null`. No placeholder, no
 *    broken-image icon — the card simply has no thumbnail (spec).
 *  - **Single photo** → shows it directly.
 *  - **Multiple photos** → shows the first (by `created_at`) with a subtle
 *    stacked/fanned effect: 1 photo edge peeking out behind it at a small
 *    offset + slight rotation. Restrained, not cartoonish (Design System §7 —
 *    "motion should explain change, not distract").
 *  - **First item is a video** → if a thumbnail variant exists (poster frame
 *    extracted at upload time), renders it as an `<img>` (zero video bytes
 *    downloaded at display time). If no thumbnail exists (old media or failed
 *    generation), falls back to a `<video preload="metadata">` poster frame
 *    using the exact `MediaTile` pattern (`muted`, `pointer-events-none`). No
 *    play affordance on the card thumbnail — the card isn't a media viewer;
 *    clicking the card navigates to Memory Detail.
 *
 * Data fetching: the page batch-fetches only the first 1–2 media rows per
 * Memory (ordered by `created_at`) via {@link fetchTimelineThumbnailsBatch},
 * so this component never receives more than 2 rows. It then resolves a
 * short-lived presigned GET URL per media id via {@link getMediaDownloadUrl}
 * (the same helper `MediaGallery` uses), guarded by an `inFlight` ref so a
 * re-run never restarts a fetch that is already underway. This mirrors the
 * `MediaGallery` URL-resolution pattern exactly, just for ≤2 items.
 *
 * No lightbox/click-to-enlarge from the card — the thumbnail is not
 * interactive; clicking the card still navigates to Memory Detail as it does
 * now.
 *
 * Thumbnail variant: when a media row has a non-null `thumbnail_path`, this
 * component resolves and renders that small (~15-40KB WebP, 400px max edge)
 * variant instead of the full-resolution original — a 10-50x bandwidth
 * reduction for a ~64px square. When `thumbnail_path` is NULL (old media or
 * failed thumbnail generation), it falls back to the original with no
 * regression. See `plans/media-web-optimizer.md`.
 */
export default function MemoryThumbnail({ media }: MemoryThumbnailProps) {
  // No media → no thumbnail, no placeholder, no broken-image icon (spec).
  if (media.length === 0) {
    return null;
  }

  return <ThumbnailStack media={media} />;
}

/**
 * IntersectionObserver root margin for the lazy-gate: fetch a thumbnail's
 * presigned URL only once it scrolls within this distance of the viewport.
 *
 * `200px` ≈ two card heights (cards are ~88px tall) — a small "near-view"
 * buffer so normal scroll speed never flashes a skeleton, while cards well
 * below the fold still withhold their egress-causing fetch. This is the only
 * mechanism needed to limit the initial fetch to roughly the viewport's worth
 * of cards (~8 on a typical laptop content area), since a card whose
 * container never intersects the expanded root simply never resolves.
 */
const LAZY_ROOT_MARGIN = "200px";

/**
 * The resolving + rendering core, separated so the early `null` return for
 * empty media doesn't mount the hooks (Rules of Hooks). Receives 1–2 rows.
 */
function ThumbnailStack({ media }: { media: Media[] }) {
  // Per-media-id resolution state, keyed by media id. Mirrors MediaGallery's
  // `tiles` map. Every row starts `loading` until its presigned URL resolves.
  const [states, setStates] = useState<Record<string, ThumbState>>({});
  // Media ids whose presigned-URL request is currently in flight. Kept in a
  // ref (not state) so updating it never re-renders, and so the resolution
  // effect can read the latest set on every run without re-subscribing.
  const inFlight = useRef<Set<string>>(new Set());

  // --- Lazy gate (B2 egress reduction) -------------------------------------
  // The thumbnail's presigned-URL resolution is deferred until its container
  // scrolls near the viewport. Below-the-fold cards stay in their default
  // `loading` state (rendering the skeleton) so they never trigger a B2
  // download on mount. Once a card intersects the expanded root, `isVisible`
  // flips to true and stays true for the component's lifetime — there is no
  // re-lazy-load on scroll-away (the session cache in `getMediaDownloadUrl`
  // handles reuse if the same media is ever re-resolved).
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Already visible — no observer needed (idempotent; also guards the
    // re-run triggered when isVisible flips to true).
    if (isVisible) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            // One-shot: once visible we never need to observe again.
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  const resolveOne = async (row: Media) => {
    if (inFlight.current.has(row.id)) return;
    inFlight.current.add(row.id);

    // Prefer the grid thumbnail variant (thumbnail_grid_path) when available
    // (media web optimizer). Falls back to the deprecated thumbnail_path for
    // backward compatibility, then to the original for old media or when
    // thumbnail generation failed. The grid thumbnail is a ~15-40KB WebP — a
    // 10-50x reduction from a full-resolution original for a ~64px square.
    const result = await getMediaDownloadUrl(
      row.thumbnail_grid_path ?? row.thumbnail_path ?? row.url
    );

    setStates((prev) => {
      const current = prev[row.id];
      // Unlike MediaGallery (which pre-seeds every tile as { status: "loading"
      // } before resolving), this component's `states` map starts empty and is
      // populated lazily. So `current` is `undefined` for a row's first
      // resolution — that must NOT bail. Only skip the update when the row
      // already resolved to a terminal state (ready/error), which would happen
      // if a stale request completes after a newer one already settled.
      if (current && current.status !== "loading") {
        return prev;
      }
      return {
        ...prev,
        [row.id]: result.ok
          ? { status: "ready", url: result.url }
          : { status: "error" },
      };
    });

    inFlight.current.delete(row.id);
  };

  // Resolve presigned URLs for any row still `loading`. Depends on `media`
  // (stable per Memory — only changes when the page's batch fetch re-runs),
  // NOT on `states` (which changes on every status update). The `inFlight`
  // ref guards against duplicate requests across re-runs. This is the exact
  // MediaGallery pattern, just for ≤2 items.
  //
  // **Lazy gate:** the loop is skipped entirely until `isVisible` is true, so
  // a below-the-fold card never requests a presigned URL (and never triggers
  // the full-resolution B2 download that resolves it) on mount. The card
  // stays in its default `loading` skeleton until it scrolls near the
  // viewport (see the IntersectionObserver above). `isVisible` is one-shot —
  // once true it stays true — so the effect re-runs once to begin resolving
  // and never re-defers.
  useEffect(() => {
    if (!isVisible) return;
    for (const row of media) {
      const state = states[row.id];
      if (!state || state.status === "loading") {
        void resolveOne(row);
      }
    }
    // `states` is intentionally read here (to decide what to fetch) but omitted
    // from the deps so a status update doesn't re-trigger fetches. `media` and
    // `isVisible` are the stable triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, isVisible]);

  // The first row is the visible thumbnail; a second row (if present) is the
  // "peeking" edge behind it. Both are square, object-cover, rounded to match
  // the card's radius. The stack is a small relative box so the fanned edge can
  // sit behind the front thumbnail.
  const front = media[0];
  const back = media[1];
  const frontType = asMediaType(front.type);
  const frontState = states[front.id] ?? { status: "loading" };

  // If the front thumbnail's URL resolution failed or its type is unknown,
  // render nothing at all — no container box, no broken-image icon (spec: the
  // thumbnail is decorative, so a calm null is correct, not a visible blank
  // square). The loading skeleton is intentional (shows while the URL is
  // being fetched); only error and unknown-type are the "render null" cases.
  if (frontState.status === "error" || frontType === null) {
    return null;
  }

  return (
    // `containerRef` is the IntersectionObserver target for the lazy gate —
    // it must wrap the visible thumbnail box so intersection reflects real
    // scroll position. The `h-16 w-16` layout is preserved exactly.
    <div ref={containerRef} className="relative h-16 w-16 shrink-0">
      {/* The peeking edge behind the front thumbnail (only when there's a
          second photo). A small offset + slight rotation conveys "more than
          one" without cartoonishness. It sits behind (lower z) and is clipped
          by the card's overflow — restrained, per Design System §7. */}
      {back && <PeekingEdge media={back} state={states[back.id]} />}

      {/* The front thumbnail. */}
      <ThumbnailFace
        type={frontType}
        state={frontState}
        isStacked={Boolean(back)}
        hasThumbnail={Boolean(front.thumbnail_grid_path ?? front.thumbnail_path)}
        media={front}
      />
    </div>
  );
}

/**
 * The front (visible) thumbnail. Renders a loading skeleton, nothing on error
 * (calm — decorative content), or the media itself: an inline `<img>` for a
 * photo, or a `<video preload="metadata">` poster frame for a video (reusing
 * the exact `MediaTile` pattern — `muted`, `pointer-events-none`, no controls).
 *
 * When `hasThumbnail` is true, the resolved URL points to a small WebP
 * thumbnail variant (not the original), so an `<img>` is always rendered —
 * even for videos (the thumbnail is a poster frame extracted at upload time).
 * This means zero video bytes are downloaded at display time. When false,
 * videos fall back to `<video preload="metadata">` and images use `<img>`.
 */
function ThumbnailFace({
  type,
  state,
  isStacked,
  hasThumbnail,
  media,
}: {
  type: "image" | "video" | null;
  state: ThumbState;
  isStacked: boolean;
  hasThumbnail: boolean;
  media: Media;
}) {
  // SPEC B.2: LQIP — use grid thumbnail (300px WebP, ~15-40KB) as blur placeholder
  // Only fetch blur placeholder when loading and grid thumbnail exists
  const blurSrc = media.thumbnail_grid_path
    ? media.thumbnail_grid_path
    : media.url;
  const [blurUrl, setBlurUrl] = useState<string | null>(null);
  // SPEC B.2: LQIP cross-fade — keep blurred placeholder as base, fade in sharp image
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (state.status !== "loading") return;
    let cancelled = false;
    getMediaDownloadUrl(blurSrc).then((result) => {
      if (!cancelled && result.ok) {
        setBlurUrl(result.url);
      }
    });
    return () => { cancelled = true; };
  }, [blurSrc, state.status]);

  // A loading skeleton with LQIP blur-up placeholder — show blurred grid
  // thumbnail as background while full thumbnail loads, then cross-fade.
  if (state.status === "loading") {
    return (
      <div
        className="absolute inset-0 overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised"
        style={{
          backgroundImage: blurUrl ? `url(${blurUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(20px)",
          transform: "scale(1.1)", // Hide blur edges
        }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 animate-pulse bg-canvas-raised/50" />
      </div>
    );
  }

  // A URL resolution failure is calm: render nothing. The thumbnail is
  // decorative, not primary content, so no retry/broken-icon — the card just
  // has no thumbnail. (The gallery shows a retry because its tiles ARE the
  // content; here they aren't.)
  if (state.status === "error") {
    return null;
  }

  // Drop rows whose type is neither image nor video (defensive — the batch
  // helper already filters these, but guard so a stray row can't crash).
  if (type === null) {
    return null;
  }

  // When a thumbnail variant exists, always render an <img> — the thumbnail is
  // a WebP image even for videos (a poster frame extracted at upload time).
  // This means zero video bytes are downloaded at display time. When no
  // thumbnail exists (old media or failed generation), fall back to the
  // original: <video> for videos, <img> for images.
  const renderAsImage = type === "image" || hasThumbnail;

  return (
    <div
      className={[
        "absolute inset-0 overflow-hidden rounded-lg border border-ink/5",
        "bg-canvas-raised",
        // When stacked, lift the front above the peeking edge.
        isStacked ? "z-10" : "",
      ].join(" ")}
    >
      {/* LQIP base layer: blurred grid thumbnail */}
      {media.thumbnail_grid_path && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${state.url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(20px)",
            transform: "scale(1.1)",
            opacity: imageLoaded ? 0 : 1,
            transition: "opacity 300ms ease-out",
          }}
          aria-hidden="true"
        />
      )}
      {/* Sharp image layer: fades in over blurred base */}
      {renderAsImage ? (
        <img
          src={state.url}
          alt=""
          loading="lazy"
          className="pointer-events-none h-full w-full select-none object-cover"
          style={{
            opacity: imageLoaded ? 1 : 0,
            transition: "opacity 300ms ease-out",
          }}
          onLoad={() => setImageLoaded(true)}
        />
      ) : (
        <video
          src={state.url}
          // `metadata` loads the first frame for the poster without buffering
          // the whole file; preload keeps the tile light. Exact MediaTile
          // pattern.
          preload="metadata"
          muted
          // Non-interactive: no controls, no tab stop. pointer-events-none so
          // the card's click (navigate to Memory Detail) isn't stolen.
          className="pointer-events-none h-full w-full object-cover"
          tabIndex={-1}
          aria-hidden="true"
          onLoadedData={() => setImageLoaded(true)}
        />
      )}
    </div>
  );
}

/**
 * The second photo rendered as a "peeking" edge behind the front thumbnail —
 * a small offset + slight rotation so 1–2 photo edges peek out, conveying
 * "more than one" without cartoonishness. Sits behind the front (lower z) and
 * is clipped by the card's overflow.
 */
function PeekingEdge({ media, state }: { media: Media; state?: ThumbState }) {
  // Only show the peeking edge once its URL has resolved; while loading or on
  // error, render nothing so the front thumbnail stands alone cleanly.
  if (!state || state.status !== "ready") {
    return null;
  }

  const type = asMediaType(media.type);

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-lg border border-ink/5 bg-canvas-raised"
      // Restrained fanned effect: a small offset up-left + a slight clockwise
      // rotation. Reads as a stacked photo edge, not a cartoon fan.
      style={{
        transform: "translate(-5px, -4px) rotate(-4deg)",
      }}
      aria-hidden="true"
    >
      {/* When a thumbnail variant exists, always render an <img> — the
          thumbnail is a WebP image even for videos. Falls back to <video>
          for videos without a thumbnail (old media or failed generation). */}
      {type === "video" && !media.thumbnail_grid_path && !media.thumbnail_path ? (
        <video
          src={state.url}
          preload="metadata"
          muted
          className="pointer-events-none h-full w-full object-cover"
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : type === "image" || media.thumbnail_grid_path || media.thumbnail_path ? (
        <img
          src={state.url}
          alt=""
          loading="lazy"
          className="pointer-events-none h-full w-full select-none object-cover"
        />
      ) : null}
    </div>
  );
}
