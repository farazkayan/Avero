// ============================================================================
// Avatar Crop Dialog (roadmap Phase 6 — Avatar crop-positioning)
// ----------------------------------------------------------------------------
// A drag-to-reposition step inserted between file selection and the final
// resize→WebP→upload pipeline. The user picks an image, drags it so the
// subject sits inside a fixed square frame, and confirms. The dialog reports
// the pan offset in *source* pixels so `uploadAvatar(file, offset)` can crop
// the same window the user saw — no coordinate-space surprises.
//
// Design constraints (from the task):
//  - Fixed square/circle frame sized to a 256×256 output. Pan-only: no zoom,
//    no rotation. The frame is the avatar's final aspect, so what you see is
//    what you get.
//  - Confirm / Cancel actions. Cancel is non-destructive: nothing uploads.
//  - Preserve existing validation (image/*, ≤ 2 MB) — that runs before this
//    dialog opens, so by the time we're here the file is already valid.
//  - Non-destructive failure handling: a drag that goes out of bounds is
//    clamped, never an error.
//
// The frame is rendered as a circle (the avatar's display shape) with the
// image overflowing and clipped, plus a faint square guide so the user can
// see the full crop window. Dragging moves the image under the fixed frame.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

type AvatarCropDialogProps = {
  /** The already-loaded source image (decoded once, reused for upload). */
  image: HTMLImageElement;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Whether the upload is currently in flight (disables actions). */
  loading?: boolean;
  /** Called with the pan offset in source pixels when the user confirms. */
  onConfirm: (offset: { x: number; y: number }) => void;
  /** Called when the user cancels (button, backdrop, or Escape). */
  onCancel: () => void;
};

/** Display size of the crop frame (px). The output is 256×256; this is just
 *  the on-screen preview size. A fixed, comfortable size that fits mobile. */
const FRAME_SIZE = 280;

/**
 * A modal that lets the user drag the selected image to reposition it inside a
 * fixed circular avatar frame, then confirm or cancel.
 *
 * The offset is tracked in *frame* pixels during the drag and converted to
 * *source* pixels on confirm (frame px × source-to-frame scale), matching the
 * coordinate space `resizeAndEncodeAvatar` expects.
 */
export default function AvatarCropDialog({
  image,
  confirmLabel = "Save avatar",
  loading = false,
  onConfirm,
  onCancel,
}: AvatarCropDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // The image is rendered to fill the frame's shorter dimension (cover), then
  // the user pans it. We track the pan as a translate in *frame* pixels.
  // `coverScale` = how much the source is scaled to cover the frame.
  const coverScale =
    FRAME_SIZE / Math.min(image.naturalWidth, image.naturalHeight);
  // The rendered (covered) image dimensions in frame space.
  const renderedW = image.naturalWidth * coverScale;
  const renderedH = image.naturalHeight * coverScale;
  // Maximum pan in frame px before the image edge meets the frame edge.
  const maxPanX = (renderedW - FRAME_SIZE) / 2;
  const maxPanY = (renderedH - FRAME_SIZE) / 2;

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const clampPan = useCallback(
    (x: number, y: number) => ({
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    }),
    [maxPanX, maxPanY],
  );

  // Pointer drag — pan-only. Works for mouse and touch via Pointer Events.
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
      setPan(clampPan(drag.panX + dx, drag.panY + dy));
    },
    [clampPan],
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
    // Convert frame-px pan → source-px offset (the space uploadAvatar uses).
    // pan.x > 0 moves the image right, which means the crop window moves left
    // relative to the image — i.e. a negative source offset. We negate so the
    // drag direction matches the visual: dragging the image right reveals more
    // of the left side of the source.
    onConfirm({
      x: -pan.x / coverScale,
      y: -pan.y / coverScale,
    });
  }, [loading, onConfirm, pan, coverScale]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-crop-title"
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
          Drag to move the image. What's inside the circle is your avatar.
        </p>

        {/* Crop stage — a fixed square with the image overflowing and clipped.
            The circle mask is the avatar's real display shape; the faint square
            guide shows the full crop window for precision. */}
        <div className="mt-5 flex justify-center">
          <div
            className="relative overflow-hidden rounded-full border border-ink/10 bg-canvas-raised touch-none select-none"
            style={{ width: FRAME_SIZE, height: FRAME_SIZE }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Faint square guide (the full crop window) */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-ink/10"
              aria-hidden="true"
            />
            {/* The draggable image, centered, translated by the pan */}
            <img
              src={image.src}
              alt="Avatar preview"
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: renderedW,
                height: renderedH,
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: "center",
              }}
            />
            {/* Subtle inner shadow to read the circle edge on light images */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)]"
              aria-hidden="true"
            />
          </div>
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
    </div>
  );
}
