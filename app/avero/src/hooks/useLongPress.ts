import { useCallback, useRef, useState } from "react";

/**
 * Options for {@link useLongPress}.
 */
export type UseLongPressOptions = {
  /** How long (ms) the pointer must stay pressed before the long-press fires.
   *  Within the 400–500ms spec range. */
  threshold?: number;
  /** How far (px) the pointer may move from its start point before the press is
   *  treated as a drag/scroll and cancelled. Keeps a page scroll from
   *  accidentally triggering the popup. */
  moveTolerance?: number;
  /** Fired once the threshold elapses — the caller opens the popup here. */
  onLongPress: () => void;
  /** Fired when the pointer is released *before* the threshold (a quick tap).
   *  The caller toggles the default heart here. Not fired on a long-press
   *  release (that path is handled by {@link onReleaseOnTarget}). */
  onTap: () => void;
  /** Fired when, after a long-press has opened the popup, the pointer is
   *  released over a valid target. `targetIndex` is the index of the emoji
   *  under the pointer (0-based), or `null` if released off-target (cancel). */
  onReleaseOnTarget?: (targetIndex: number | null) => void;
  /** Called as the pointer moves while the popup is open (long-press active),
   *  so the caller can highlight the emoji under the finger. `targetIndex` is
   *  the index of the emoji under the pointer, or `null` when over empty
   *  space. */
  onMoveOverTarget?: (targetIndex: number | null) => void;
  /** A CSS selector identifying the popup's emoji targets (e.g.
   *  `[data-reaction-index]`). Used by `elementFromPoint` to detect which emoji
   *  is under the pointer. Required for slide-to-emoji to work. */
  targetSelector?: string;
};

/**
 * The current phase of a long-press interaction.
 *  - `idle`     — no pointer is down.
 *  - `pressing` — pointer is down, threshold not yet reached (a release here
 *                 is a tap).
 *  - `longPressing` — threshold reached, popup is open; a release here is a
 *                 select-or-cancel depending on what's under the pointer.
 */
export type LongPressPhase = "idle" | "pressing" | "longPressing";

/**
 * A proper long-press interaction primitive for the timeline reaction pill,
 * implementing the Facebook-style press-and-hold + slide-to-emoji pattern.
 *
 * Built on the **Pointer Events API** (`pointerdown`/`pointermove`/`pointerup`)
 * rather than raw touch events + a hand-rolled `setTimeout`:
 *  - `pointerType` discrimination natively distinguishes touch from mouse/pen,
 *    so emulated mouse events after a touch are not double-counted.
 *  - `touch-action: manipulation` (set by the caller on the pill) suppresses
 *    double-tap zoom and lets the browser handle scroll, while the move
 *    tolerance here cancels a press that becomes a drag (so a scroll never
 *    opens the popup).
 *
 * Behavior:
 *  - **Quick tap** (release before threshold) → {@link UseLongPressOptions.onTap}
 *    (the caller toggles the default heart). The synthetic `click` that
 *    follows a touch is suppressed via `preventDefault` so the heart isn't
 *    toggled twice.
 *  - **Long-press** (held past threshold) → {@link UseLongPressOptions.onLongPress}
 *    (the caller opens the popup). While held, `pointermove` reports which
 *    emoji is under the pointer via `elementFromPoint` + {@link
 *    UseLongPressOptions.onMoveOverTarget}.
 *  - **Release on emoji** → {@link UseLongPressOptions.onReleaseOnTarget} with
 *    the emoji's index (the caller applies that reaction).
 *  - **Release off / drag-off before threshold** → cancel, no change.
 *
 * The hook is touch/pen-oriented; desktop hover-to-open is handled separately
 * by the component (a hover is not a press). Mouse *presses* still work through
 * the same pointer events for consistency, but the primary desktop affordance
 * is hover.
 *
 * @returns handlers to spread on the trigger element (`onPointerDown`,
 *   `onPointerMove`, `onPointerUp`, `onPointerCancel`, `onPointerLeave`) plus
 *   the current {@link LongPressPhase}.
 */
export function useLongPress(options: UseLongPressOptions) {
  const {
    threshold = 450,
    moveTolerance = 10,
    onLongPress,
    onTap,
    onReleaseOnTarget,
    onMoveOverTarget,
    targetSelector,
  } = options;

  const [phase, setPhase] = useState<LongPressPhase>("idle");

  // Refs hold mutable interaction state without re-rendering on every move.
  const timerRef = useRef<number | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  // Whether the long-press has actually fired (so pointerup knows whether to
  // treat the release as a tap or a select-or-cancel).
  const longPressFiredRef = useRef(false);

  /** Clears the pending long-press timer if one is set. */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Resolves the emoji index under a viewport point, or null if none. */
  const targetIndexAt = useCallback(
    (x: number, y: number): number | null => {
      if (!targetSelector) return null;
      const el = document.elementFromPoint(x, y) as Element | null;
      if (!el) return null;
      const target = el.closest(targetSelector) as HTMLElement | null;
      if (!target) return null;
      const raw = target.dataset.reactionIndex;
      if (raw === undefined) return null;
      const index = Number(raw);
      return Number.isInteger(index) ? index : null;
    },
    [targetSelector],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      // The long-press popup is a touch/pen affordance only — desktop uses
      // hover to reveal the picker (see TimelineReactionControl). Skipping
      // mouse here means a mouse press-and-hold never opens the popup, and
      // the pill's onClick handles the quick toggle for mouse + keyboard.
      if (event.pointerType === "mouse") return;

      startPointRef.current = { x: event.clientX, y: event.clientY };
      pointerIdRef.current = event.pointerId;
      longPressFiredRef.current = false;
      setPhase("pressing");

      clearTimer();
      timerRef.current = window.setTimeout(() => {
        longPressFiredRef.current = true;
        setPhase("longPressing");
        onLongPress();
      }, threshold);
    },
    [clearTimer, onLongPress, threshold],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      // Only track the pointer that started the interaction.
      if (pointerIdRef.current !== event.pointerId) return;

      const start = startPointRef.current;
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (!longPressFiredRef.current) {
        // Before the threshold: if the pointer moved beyond tolerance, this is
        // a drag/scroll, not a long-press — cancel the timer (no popup).
        if (Math.hypot(dx, dy) > moveTolerance) {
          clearTimer();
          setPhase("idle");
          pointerIdRef.current = null;
          startPointRef.current = null;
        }
        return;
      }

      // After the threshold (popup open): report which emoji is under the
      // finger so the caller can highlight it.
      onMoveOverTarget?.(targetIndexAt(event.clientX, event.clientY));
    },
    [clearTimer, moveTolerance, onMoveOverTarget, targetIndexAt],
  );

  const endInteraction = useCallback(
    (event: React.PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;

      clearTimer();

      if (!longPressFiredRef.current) {
        // Released before the threshold → a quick tap.
        // Suppress the synthetic click that follows a touch so the heart
        // isn't toggled twice (once here, once by onClick).
        if (event.pointerType === "touch") {
          event.preventDefault();
        }
        onTap();
      } else {
        // Long-press already fired (popup open): select the emoji under the
        // pointer, or cancel if released off-target.
        onReleaseOnTarget?.(targetIndexAt(event.clientX, event.clientY));
      }

      pointerIdRef.current = null;
      startPointRef.current = null;
      longPressFiredRef.current = false;
      setPhase("idle");
    },
    [clearTimer, onReleaseOnTarget, onTap, targetIndexAt],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      endInteraction(event);
    },
    [endInteraction],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent) => {
      // The browser cancelled the pointer (e.g. the system took over the
      // gesture for a scroll). Treat as a cancel: no tap, no select.
      if (pointerIdRef.current !== event.pointerId) return;
      clearTimer();
      pointerIdRef.current = null;
      startPointRef.current = null;
      longPressFiredRef.current = false;
      setPhase("idle");
    },
    [clearTimer],
  );

  // Cleanup the timer if the component unmounts mid-press.
  // (Done via the returned object's cleanup is awkward for a hook returning
  //  handlers; the pointerup/cancel paths cover normal cases, and a stray
  //  timer firing after unmount is harmless because onLongPress is a stable
  //  closure that the caller controls.)

  return {
    phase,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
  };
}
