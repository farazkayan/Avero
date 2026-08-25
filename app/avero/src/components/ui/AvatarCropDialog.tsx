// ============================================================================
// Avatar Crop Dialog (roadmap Phase 6 — Avatar crop-positioning + zoom)
// ----------------------------------------------------------------------------
// A position-and-zoom step inserted between file selection and the final
// resize→WebP→upload pipeline. The user picks an image, drags it so the
// subject sits inside a fixed circular frame, and adjusts zoom to crop
// tighter or wider. The dialog reports an explicit square crop window in
// *source* pixels so `uploadAvatar(file, crop)` samples exactly the region
// the user saw — no coordinate-space surprises.
//
// Design constraints (from the task):
//  - Fixed circular frame sized to a 256×256 output. Pan + zoom only: no
//    rotation. The frame is the avatar's final aspect, so what you see is
//    what you get.
//  - Zoom slider: minimum zoom is the smallest scale where the image still
//    fully covers the circular frame (no empty gaps) — i.e. zoom = 1 is
//    "cover". Maximum is a reasonable upper bound (3×) so users can zoom
//    into a face/detail without pixelating too badly.
//  - Combined drag + zoom: dragging repositions the image at whatever zoom
//    is currently set — the two interactions compose, not replace.
//  - Visual polish — dimmed overflow: the full image is shown with the area
//    outside the circle dimmed/darkened (semi-transparent overlay) so the
//    user sees context around the crop, not a floating circle on blank
//    space. The circle itself stays at full brightness/clarity.
//  - Constrain panning: the drag can't move the image so far that empty
//    space appears inside the circle at any zoom level — the image must
//    always fully cover the circular frame.
//  - Confirm / Cancel actions. Cancel is non-destructive: nothing uploads.
//  - Preserve existing validation (image/*, ≤ 2 MB) — that runs before this
//    dialog opens, so by the time we're here the file is already valid.
//  - Non-destructive failure handling: a drag that goes out of bounds is
//    clamped, never an error.
//
// Crop math (pan + zoom → source rectangle):
//  coverScale = FRAME_SIZE / min(naturalW, naturalH)   // shorter side = frame
//  effectiveScale = coverScale * zoom                  // zoom ∈ [1, 3]
//  renderedW = naturalW * effectiveScale, renderedH = naturalH * effectiveScale
//  maxPanX = (renderedW - FRAME_SIZE) / 2              // grows with zoom
//  maxPanY = (renderedH - FRAME_SIZE) / 2
//  pan clamped to ±maxPan so the rendered image always covers the frame.
//
//  On confirm, map the frame window back to source pixels as an explicit
//  square crop rectangle (top-left + size):
//   sourceSize = FRAME_SIZE / effectiveScale = min(naturalW, naturalH) / zoom
//   sx = naturalW/2 - pan.x/effectiveScale - sourceSize/2
//   sy = naturalH/2 - pan.y/effectiveScale - sourceSize/2
//  The pan clamp guarantees sx ∈ [0, naturalW - sourceSize] and
//  sy ∈ [0, naturalH - sourceSize], so the window never leaves the image.
//  At zoom = 1, pan = 0 this reduces exactly to the historical center-crop
//  (sx = (naturalW - minSide)/2, sy = (naturalH - minSide)/2, size = minSide).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type AvatarCropDialogProps = {
  /** The already-loaded source image (decoded once, reused for upload). */
  image: HTMLImageElement;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Whether the upload is currently in flight (disables actions). */
  loading?: boolean;
  /** Called with the explicit square crop window in source pixels when the
   *  user confirms: `{ x, y, size }` = top-left + side length. */
  onConfirm: (crop: { x: number; y: number; size: number }) => void;
  /** Called when the user cancels (button, backdrop, or Escape). */
  onCancel: () => void;
};

/** Display size of the crop frame (px). The output is 256×256; this is just
 *  the on-screen preview size. A fixed, comfortable size that fits mobile. */
const FRAME_SIZE = 280;

/** Minimum zoom: 1 = "cover" (shorter side exactly fills the frame, the
 *  smallest scale where the image still fully covers the circle — no gaps). */
const MIN_ZOOM = 1;
/** Maximum zoom: a reasonable upper bound so users can zoom into a face or
 *  detail without pixelating too badly. */
const MAX_ZOOM = 3;

/**
 * A modal that lets the user drag and zoom the selected image to position it
 * inside a fixed circular avatar frame, then confirm or cancel.
 *
 * The pan is tracked in *frame* pixels during the drag; zoom is a multiplier
 * on top of the cover scale. On confirm both are resolved into an explicit
 * square crop rectangle in *source* pixels, matching the coordinate space
 * `resizeAndEncodeAvatar` expects.
 */
export default function AvatarCropDialog({
  image,
  confirmLabel = "Save avatar",
  loading = false,
  onConfirm,
  onCancel,
}: AvatarCropDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // coverScale = how much the source is scaled so its shorter side covers the
  // frame. zoom multiplies on top of it; effectiveScale is the true on-screen
  // scale of the rendered image.
  const coverScale =
    FRAME_SIZE / Math.min(image.naturalWidth, image.naturalHeight);
  // Maximum pan in frame px before the image edge meets the frame edge, as a
  // function of zoom (more room when zoomed in).
  const maxPanX = (zoom: number) =>
    (image.naturalWidth * coverScale * zoom - FRAME_SIZE) / 2;
  const maxPanY = (zoom: number) =>
    (image.naturalHeight * coverScale * zoom - FRAME_SIZE) / 2;

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => ({
      x: Math.max(-maxPanX(z), Math.min(maxPanX(z), x)),
      y: Math.max(-maxPanY(z), Math.min(maxPanY(z), y)),
    }),
    // maxPanX/maxPanY close over image + coverScale (stable for this dialog).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // When zoom changes, re-clamp the existing pan so the image never reveals
  // a gap inside the circle at the new zoom level. This keeps drag + zoom
  // consistent: zooming in always leaves a valid (possibly smaller) pan
  // range, and we pull the pan back inside it if needed.
  const handleZoomChange = useCallback(
    (nextZoom: number) => {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      setZoom(z);
      setPan((p) => clampPan(p.x, p.y, z));
    },
    [clampPan],
  );

  // Pointer drag — pan-only, at the current zoom. Works for mouse and touch
  // via Pointer Events.
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (loading) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [loading, pan],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setPan(clampPan(drag.panX + dx, drag.panY + dy, zoom));
    },
    [clampPan, zoom],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
    },
    [],
  );

  // Wheel-to-zoom (trackpad / mouse wheel) over the crop stage. Prevents page
  // scroll while the pointer is over the frame. Small, clamped step.
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (loading) return;
      event.preventDefault();
      // deltaY > 0 = zoom out, < 0 = zoom in. Step scaled to feel natural.
      const step = 0.0015 * Math.abs(event.deltaY);
      const next = event.deltaY > 0 ? zoom - step : zoom + step;
      handleZoomChange(next);
    },
    [loading, zoom, handleZoomChange],
  );

  // Move focus to the confirm button on open — the user has already chosen a
  // file and is actively editing, so the primary action is the natural landing.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Close on Escape unless an upload is in flight.
  useEffect(() => {
    if (loading) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onCancel]);

  const handleConfirm = useCallback(() => {
    if (loading) return;
    // Resolve the frame window into an explicit source-pixel crop rectangle.
    // effectiveScale = coverScale * zoom; sourceSize = FRAME_SIZE / effective.
    const effectiveScale = coverScale * zoom;
    const sourceSize = FRAME_SIZE / effectiveScale;
    // pan.x > 0 moves the image right, so the frame sees a *smaller* source X
    // (more of the left side is revealed) — hence the negation. The center of
    // the crop window in source space is (naturalW/2 - pan.x/effectiveScale),
    // and the top-left is center - sourceSize/2.
    const sx =
      image.naturalWidth / 2 - pan.x / effectiveScale - sourceSize / 2;
    const sy =
      image.naturalHeight / 2 - pan.y / effectiveScale - sourceSize / 2;
    onConfirm({ x: sx, y: sy, size: sourceSize });
  }, [loading, onConfirm, pan, zoom, coverScale, image]);

  // Rendered (zoomed) image dimensions for the <img> element.
  const renderedWidth = image.naturalWidth * coverScale * zoom;
  const renderedHeight = image.naturalHeight * coverScale * zoom;

  // Slider tick percentages for the +/- buttons (10% of the range per click).
  const zoomStep = (MAX_ZOOM - MIN_ZOOM) / 10;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-crop-title"
      // The crop dialog is portaled to document.body to escape any
      // overflow-hidden ancestors (e.g., the SettingsPage avatar container).
      // We still stop propagation here to prevent clicks inside the modal
      // from bubbling to any parent click handlers.
      onClick={(event) => event.stopPropagation()}
      // Prevent page scroll when wheeling anywhere in the dialog (backdrop, panel, crop stage)
      onWheel={(event) => event.preventDefault()}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Cancel avatar crop"
        tabIndex={-1}
        onClick={loading ? undefined : onCancel}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <div className="relative w-full max-w-sm rounded-2xl border border-ink/10 bg-canvas-soft p-6 shadow-2xl">
        <h2
          id="avatar-crop-title"
          className="text-lg font-semibold text-ink"
        >
          Position your avatar
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Drag to move, use the slider to zoom. What's inside the circle is
          your avatar.
        </p>

        {/* Crop stage — the full image is shown with the area outside the
            circle dimmed (semi-transparent dark overlay), so the user sees
            context around the crop instead of a floating circle on blank
            space. The circle itself stays at full brightness. The image is
            draggable (pan) at the current zoom; the overlay is pointer-events-
            none so it never intercepts the drag.
            
            The container has a fixed size (FRAME_SIZE) with overflow:hidden to
            prevent the image from visually overlapping the controls below,
            regardless of the source image's aspect ratio or zoom level. */}
        <div className="mt-5 flex justify-center">
          <div
            className="relative touch-none select-none overflow-hidden rounded-full"
            style={{ width: FRAME_SIZE, height: FRAME_SIZE }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            {/* The draggable image, centered, translated by the pan and
                scaled by zoom. It's contained within the fixed-size circular
                frame so it never bleeds into the controls below. */}
            <img
              src={image.src}
              alt="Avatar preview"
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: renderedWidth,
                height: renderedHeight,
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: "center",
              }}
              loading="lazy"
            />
            {/* Dimmed overflow overlay: a full-stage dark layer with a
                circular cutout (full brightness) at the frame. Built as four
                rounded rectangles around the circle + a ring. Using a single
                box-shadow-based mask would also work, but a radial mask via
                box-shadow on an inner circle is the simplest robust approach:
                a transparent circle punched out of a dark rectangle using a
                huge spread box-shadow (the "ring shadow" trick). */}
            {/* Dark overlay with a circular hole. The inner circle is
                transparent; its box-shadow spreads outward to fill the
                surrounding area with the dim color, leaving the circle
                itself clear. */}
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              <div
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: FRAME_SIZE,
                  height: FRAME_SIZE,
                  transform: "translate(-50%, -50%)",
                  // A huge spread shadow paints the dim color everywhere
                  // outside the circle; the circle itself is transparent.
                  boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.55)`,
                }}
              />
            </div>
            {/* Subtle inner ring to read the circle edge on light images. */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 rounded-full ring-1 ring-inset ring-white/20"
              style={{
                width: FRAME_SIZE,
                height: FRAME_SIZE,
                transform: "translate(-50%, -50%)",
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Zoom slider — horizontal range below the crop circle, with - / +
            buttons. Min = cover (no gaps), max = 3×. */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleZoomChange(zoom - zoomStep)}
            disabled={loading || zoom <= MIN_ZOOM + 1e-6}
            aria-label="Zoom out"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink/10 text-ink-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            disabled={loading}
            aria-label="Zoom"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink/15 accent-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => handleZoomChange(zoom + zoomStep)}
            disabled={loading || zoom >= MAX_ZOOM - 1e-6}
            aria-label="Zoom in"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink/10 text-ink-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-ink/10 px-4 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={handleConfirm}
            disabled={loading}
            aria-busy={loading || undefined}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
