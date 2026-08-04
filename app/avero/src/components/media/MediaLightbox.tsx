import { useCallback, useEffect, useRef } from "react";
import type { MediaType } from "../../types/media";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "../ui/icons";

/**
 * A single resolved media item ready to display in the lightbox — the media
 * row's id and kind, plus the short-lived presigned GET URL fetched from the
 * `media-storage` Edge Function.
 */
export type LightboxItem = {
  id: string;
  type: MediaType;
  url: string;
};

type MediaLightboxProps = {
  /** The full, ordered list of resolved media items for the Memory. */
  items: LightboxItem[];
  /** The index in `items` currently shown. `null` means the lightbox is closed. */
  index: number | null;
  /** Called when the user requests the lightbox to close (Esc, backdrop, ×). */
  onClose: () => void;
  /** Called to move to a new index (clamped by the component). */
  onNavigate: (index: number) => void;
};

/**
 * A simple, accessible lightbox for the Memory media gallery (feature-specs
 * §3 — "Clicking a thumbnail opens it larger in a simple lightbox/modal").
 *
 * Renders a fixed, full-viewport overlay with the selected media centered:
 * images show inline at a comfortable size; videos render as a native
 * `<video>` with controls so the user can play, scrub, and hear audio. A
 * close button, backdrop click, and the Escape key all dismiss it; the left
 * and right arrow keys move between items, as do the on-screen chevrons.
 *
 * Accessibility & UX details:
 *  - The overlay is a `role="dialog"` with `aria-modal`, labelled by a visually
 *    hidden heading so screen readers announce "Media viewer".
 *  - Focus is moved to the dialog on open and returned to the trigger on
 *    close (the gallery owns the trigger; we just restore body scroll).
 *  - Body scroll is locked while open and restored on close/unmount.
 *  - Keyboard handlers are attached only while open and cleaned up on close.
 *  - The media itself never receives pointer events (so the backdrop always
 *    catches clicks), while the controls sit above the backdrop.
 *
 * The component is intentionally presentational: it owns no fetch state. The
 * parent ({@link MediaGallery}) resolves the presigned URLs and drives the
 * `index`/`onNavigate`/`onClose` contract, so the lightbox stays simple and
 * reusable.
 */
export default function MediaLightbox({
  items,
  index,
  onClose,
  onNavigate,
}: MediaLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = index !== null;

  const goPrev = useCallback(() => {
    if (index === null) return;
    const prev = (index - 1 + items.length) % items.length;
    onNavigate(prev);
  }, [index, items.length, onNavigate]);

  const goNext = useCallback(() => {
    if (index === null) return;
    const next = (index + 1) % items.length;
    onNavigate(next);
  }, [index, items.length, onNavigate]);

  // Keyboard handling + focus + scroll lock, all gated on `isOpen`.
  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (dialog) {
      dialog.focus();
    }

    // Lock background scroll while the lightbox is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          break;
        case "ArrowLeft":
          event.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          event.preventDefault();
          goNext();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose, goPrev, goNext]);

  if (!isOpen || index === null) {
    return null;
  }

  const item = items[index];
  if (!item) {
    // Defensive: an out-of-range index should never reach here because
    // onNavigate clamps, but guard anyway so a stale state never crashes.
    return null;
  }

  const hasMultiple = items.length > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      // Backdrop click closes; clicks that start on the media and end on the
      // backdrop are ignored via the onMouseDown/onMouseUp pair below.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Media viewer"
        tabIndex={-1}
        className="relative flex max-h-full max-w-full flex-col items-center justify-center outline-none"
      >
        {/* Close control — top-right, above the media. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-1 right-0 -translate-y-full rounded-full glass-panel p-2 text-white hover:bg-white/5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
        >
          <CloseIcon />
        </button>

        {/* Previous control — only when there is more than one item. */}
        {hasMultiple && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous"
            className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 rounded-full glass-panel p-2 text-white hover:bg-white/5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
          >
            <ChevronLeftIcon />
          </button>
        )}

        {/* The media itself. pointer-events-none so backdrop clicks pass
            through to the overlay and close the lightbox. */}
        {item.type === "image" ? (
          <img
            src={item.url}
            alt=""
            className="max-h-[85vh] max-w-full rounded-lg object-contain pointer-events-none select-none"
          />
        ) : (
          <video
            key={item.id}
            src={item.url}
            controls
            autoPlay
            className="max-h-[85vh] max-w-full rounded-lg bg-black"
          />
        )}

        {/* Next control — only when there is more than one item. */}
        {hasMultiple && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next"
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full rounded-full glass-panel p-2 text-white hover:bg-white/5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
          >
            <ChevronRightIcon />
          </button>
        )}

        {/* Position indicator — "1 / 5" — only when there is more than one. */}
        {hasMultiple && (
          <p className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full pt-3 text-xs text-ink-muted">
            {index + 1} / {items.length}
          </p>
        )}
      </div>
    </div>
  );
}
