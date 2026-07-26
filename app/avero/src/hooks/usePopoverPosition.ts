import { useLayoutEffect, useState } from "react";

/**
 * The vertical placement of the popover relative to its trigger, decided by
 * the viewport-aware flip logic in {@link usePopoverPosition}.
 */
export type PopoverPlacement = "top" | "bottom";

/**
 * The computed inline style + placement for a popover anchored to a trigger
 * element. `position: fixed` with absolute viewport coordinates is used so the
 * popover is unaffected by transformed or positioned ancestors (the timeline
 * cards live inside a scrolling container) — matching how an overlay should
 * behave.
 */
export type PopoverPosition = {
  /** The CSS `top` in pixels (viewport-relative, for `position: fixed`). */
  top: number;
  /** The CSS `left` in pixels (viewport-relative, for `position: fixed`). */
  left: number;
  /** Whether the popover sits above or below the trigger. */
  placement: PopoverPlacement;
};

/** Minimum gap (px) between the popover and the viewport edge / trigger. */
const VIEWPORT_MARGIN = 8;
/** Gap (px) between the trigger and the popover itself. */
const TRIGGER_GAP = 8;

/**
 * Clamps a number into the inclusive range [`min`, `max`].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Viewport-aware popover positioning for the timeline reaction picker.
 *
 * Given a trigger element ref, the popover's pixel dimensions, and whether the
 * popover is currently open, this hook returns a {@link PopoverPosition} that:
 *  - **Flips vertically** — the popover defaults to opening *above* the trigger
 *    (the Facebook-reactions convention), but if there isn't enough room above
 *    (the card is near the top of the screen) it flips to *below*.
 *  - **Clamps horizontally** — the popover is centered on the trigger, then
 *    clamped so it never clips off the left/right edge of the viewport.
 *
 * Position is recomputed in a `useLayoutEffect` whenever the popover opens or
 * its size changes, and on `scroll`/`resize` while open (so a popover that's
 * open during a scroll stays anchored). All listeners are cleaned up on close.
 *
 * There is no existing popover-flip pattern in the app — [`MediaLightbox`](
 * ../components/media/MediaLightbox.tsx) is a full-screen fixed overlay, not a
 * positioned popover — so this is the established viewport-positioning primitive
 * for this feature.
 *
 * @param triggerRef  Ref to the anchor element (the reaction pill).
 * @param popoverSize The popover's `{ width, height }` in pixels. The caller is
 *   responsible for measuring the rendered popover (e.g. via a ref + state) and
 *   passing the real size so the flip/clamp math is accurate.
 * @param isOpen      Whether the popover is currently open. When false the hook
 *   returns `null` and attaches no listeners.
 * @returns The computed position, or `null` when closed.
 */
export function usePopoverPosition(
  triggerRef: React.RefObject<HTMLElement | null>,
  popoverSize: { width: number; height: number } | null,
  isOpen: boolean,
): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !popoverSize) {
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    function compute(): void {
      const triggerEl = triggerRef.current;
      if (!triggerEl || !popoverSize) {
        return;
      }

      const rect = triggerEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // --- Vertical: flip if there isn't room above ---
      const spaceAbove = rect.top;
      const spaceBelow = viewportHeight - rect.bottom;
      const placement: PopoverPlacement =
        spaceAbove >= popoverSize.height + TRIGGER_GAP + VIEWPORT_MARGIN ||
        spaceAbove >= spaceBelow
          ? "top"
          : "bottom";

      const top =
        placement === "top"
          ? rect.top - popoverSize.height - TRIGGER_GAP
          : rect.bottom + TRIGGER_GAP;

      // --- Horizontal: center on the trigger, then clamp to the viewport ---
      const centeredLeft =
        rect.left + rect.width / 2 - popoverSize.width / 2;
      const left = clamp(
        centeredLeft,
        VIEWPORT_MARGIN,
        viewportWidth - popoverSize.width - VIEWPORT_MARGIN,
      );

      setPosition({ top, left, placement });
    }

    // Compute immediately (layout phase) so the first paint is correct.
    compute();

    // Recompute on scroll/resize while open. `scroll` can fire a lot during a
    // drag; this is cheap (a few arithmetic ops + a setState that React
    // bails out of when the value is unchanged), so no throttling is needed.
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);

    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [triggerRef, popoverSize, isOpen]);

  // When closed or unmeasured the position is always null — derive it during
  // render instead of syncing via setState in the effect above
  // (react-hooks/set-state-in-effect). Any stale position left in state while
  // closed is never returned, and the layout effect recomputes (before paint)
  // the moment the popover reopens.
  return !isOpen || !popoverSize ? null : position;
}
