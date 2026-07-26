import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { HeartIcon } from "../ui/icons";
import { useLongPress } from "../../hooks/useLongPress";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { useReactionHint } from "../../hooks/useReactionHint";
import type { MemoryReactionSummary } from "../../lib/reactions";
import {
  REACTION_EMOJI,
  REACTION_LABELS,
  REACTION_TYPES,
  type ReactionType,
} from "../../types/reaction";

/** The default reaction toggled by a quick click/tap/Enter (Facebook-style). */
const DEFAULT_REACTION: ReactionType = "heart";

/** How long (ms) the desktop pointer must hover the pill before the popup
 *  opens. Within the 400–500ms spec range. */
const HOVER_OPEN_DELAY = 450;

/** Grace period (ms) before closing the popup after the pointer leaves both the
 *  pill and the popup — gives the user room to move onto the popup. */
const HOVER_CLOSE_DELAY = 150;

/** CSS selector identifying the popup's emoji targets for slide-to-emoji. */
const EMOJI_TARGET_SELECTOR = "[data-reaction-index]";

type TimelineReactionControlProps = {
  /** The Memory this control reacts on. */
  memoryId: string;
  /** The current user's id — scopes the toggle direction (add vs. remove). */
  currentUserId: string;
  /** The batch-fetched summary for this Memory (page-owned source of truth). */
  summary: MemoryReactionSummary;
  /** The reaction type currently in flight for this Memory (subtle "working"
   *  state), or `null` when idle. Page-owned so a single in-flight type per
   *  card is enforced. */
  isPending: ReactionType | null;
  /** Apply a reaction: add if none, remove if it's the current one, or switch
   *  to it from another type. The parent owns the optimistic update + the
   *  add/remove calls + revert-on-error. */
  onToggle: (type: ReactionType) => void;
};

/**
 * The inline reaction control on a Space timeline Memory card (feature-specs
 * §5).
 *
 * A single pill-shaped button is always visible on every card. It mirrors
 * Facebook's Like/Reactions pattern:
 *  - **Default state** — shows the user's current reaction emoji if they've
 *    reacted (the *specific* emoji, e.g. 🔥, not a heart), or a neutral
 *    outline heart if they haven't, plus the total reaction count across all
 *    types when > 0.
 *  - **Quick toggle** (desktop click / mobile tap / Enter / Space) — toggles
 *    the default heart: add if none, remove if already heart, switch to heart
 *    if another type.
 *  - **Full picker** — revealed by hovering the pill (desktop, ~450ms) or by a
 *    press-and-hold long-press (touch, ~450ms). On touch, sliding onto an
 *    emoji and releasing applies it; releasing off cancels. On desktop,
 *    clicking an emoji applies it; leaving both closes without change.
 *  - **Keyboard** — the pill is a focusable button; Enter/Space toggles heart;
 *    ArrowDown opens the picker as a `role="menu"` and focuses the first emoji;
 *    arrows navigate; Enter/Space selects; Esc closes and returns focus.
 *
 * Data + logic are **reused, not duplicated**: the summary comes from the
 * page's batch fetch ([`fetchMemoryReactionsBatch`](../../lib/reactions.ts)),
 * and `onToggle` delegates to the page which calls the existing
 * `addReaction`/`removeReaction` helpers with optimistic UI + revert. No
 * confirm dialog — reactions are low-stakes and instantly reversible, the
 * same as [`ReactionBar`](./ReactionBar.tsx).
 *
 * Refresh-based, not realtime (database §14): the acting user's own action
 * updates local state immediately; other users' reactions appear on reload.
 *
 * The popup is viewport-aware (flips below near the top, clamps horizontally)
 * via [`usePopoverPosition`](../../hooks/usePopoverPosition.ts). A one-time
 * discoverability pulse plays on the first card a user ever sees, gated by
 * [`useReactionHint`](../../hooks/useReactionHint.ts) + localStorage.
 */
export default function TimelineReactionControl({
  summary,
  isPending,
  onToggle,
}: TimelineReactionControlProps) {
  const pillRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  // The emoji currently highlighted under a touch finger (slide-to-emoji) or
  // focused by the keyboard. `null` = none.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // The popup's measured size, fed to usePopoverPosition for flip/clamp math.
  const [popupSize, setPopupSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Timers for the desktop hover-intent open/close.
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Whether the popup was opened by the keyboard (so we manage focus into it).
  const keyboardOpenRef = useRef(false);

  const showHint = useReactionHint();

  // --- Derived display state -------------------------------------------------

  // The user's current reaction type, if any. `mine` is a Set; take the first
  // (a user has at most one reaction per type, but could in principle have
  // multiple types — the pill shows the "primary" one, preferring heart).
  const myReaction = getPrimaryReaction(summary.mine);
  const totalCount = totalReactionCount(summary.counts);
  const hasReacted = myReaction !== null;

  // --- Helpers ---------------------------------------------------------------

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPopup = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setIsOpen(true);
  }, [clearCloseTimer, clearOpenTimer]);

  const closePopup = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    keyboardOpenRef.current = false;
    setIsOpen(false);
    setActiveIndex(null);
    // Reset the measured popup size so the next open re-measures from
    // scratch. Done here (not in the useLayoutEffect below) so the effect's
    // `!isOpen` branch can early-return without a synchronous setState —
    // which would trigger the react-hooks/set-state-in-effect lint rule.
    setPopupSize(null);
  }, [clearCloseTimer, clearOpenTimer]);

  // --- Desktop hover open/close (hover-intent) -------------------------------

  const handleMouseEnter = useCallback(() => {
    // Don't open on hover if a touch interaction is in progress or the popup
    // is already open via keyboard/long-press.
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openPopup();
    }, HOVER_OPEN_DELAY);
  }, [clearCloseTimer, clearOpenTimer, openPopup]);

  const handleMouseLeave = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closePopup();
    }, HOVER_CLOSE_DELAY);
  }, [clearOpenTimer, clearCloseTimer, closePopup]);

  // Keep the popup open while the pointer is over the popup itself.
  const handlePopupMouseEnter = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  const handlePopupMouseLeave = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closePopup();
    }, HOVER_CLOSE_DELAY);
  }, [clearCloseTimer, closePopup]);

  // --- Touch long-press + slide-to-emoji -------------------------------------

  const { handlers: longPressHandlers } = useLongPress({
    onLongPress: openPopup,
    onTap: () => {
      // A quick tap toggles the default heart, identical to a desktop click.
      onToggle(DEFAULT_REACTION);
    },
    onMoveOverTarget: (index) => {
      setActiveIndex(index);
    },
    onReleaseOnTarget: (index) => {
      if (index !== null) {
        const type = REACTION_TYPES[index];
        if (type) {
          onToggle(type);
        }
      }
      closePopup();
    },
    targetSelector: EMOJI_TARGET_SELECTOR,
  });

  // --- Quick toggle (click / Enter / Space) ----------------------------------

  const handleClick = useCallback(() => {
    // The touch tap is handled by useLongPress.onTap (which calls onToggle and
    // suppresses the synthetic click). For mouse + keyboard, the click is the
    // quick toggle. Clicking the pill while the popup is open (e.g. after a
    // hover) also toggles heart and closes the popup.
    if (isOpen) {
      closePopup();
    }
    onToggle(DEFAULT_REACTION);
  }, [closePopup, isOpen, onToggle]);

  // --- Keyboard menu ---------------------------------------------------------

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Enter / Space → quick toggle heart (the button's default action).
      if (event.key === "Enter" || event.key === " ") {
        // Let the native click fire (handled by handleClick); just prevent the
        // popup from also opening.
        return;
      }
      // ArrowDown (or Alt+ArrowDown) → open the picker menu and focus the
      // first emoji. This is the explicit, discoverable keyboard path to the
      // full picker (no timer-based "open on focus" guess).
      if (event.key === "ArrowDown") {
        event.preventDefault();
        keyboardOpenRef.current = true;
        setActiveIndex(0);
        openPopup();
      } else if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        closePopup();
      }
    },
    [closePopup, isOpen, openPopup],
  );

  // --- Popup size measurement (for viewport positioning) --------------------

  useLayoutEffect(() => {
    if (!isOpen) {
      // popupSize is reset in closePopup (above), not here, to avoid a
      // synchronous setState in the effect body (react-hooks/set-state-in-
      // effect).
      return;
    }
    const popup = popupRef.current;
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    setPopupSize({ width: rect.width, height: rect.height });
  }, [isOpen]);

  const position = usePopoverPosition(pillRef, popupSize, isOpen);

  // --- Focus management for keyboard-opened menu ----------------------------

  useEffect(() => {
    if (!isOpen) return;
    if (!keyboardOpenRef.current) return;
    // Move focus to the highlighted emoji when the menu opens via keyboard.
    const popup = popupRef.current;
    if (!popup) return;
    const target = popup.querySelector<HTMLElement>(
      `[data-reaction-index="${activeIndex ?? 0}"]`,
    );
    target?.focus();
  }, [isOpen, activeIndex]);

  // --- Close on outside click / Esc (when open via hover/long-press) --------

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      // Ignore emulated mouse events from touch (touch is handled by the
      // long-press hook). Only close for a real mouse click outside.
      if (event.pointerType !== "mouse") return;
      const popup = popupRef.current;
      const pill = pillRef.current;
      if (popup?.contains(event.target as Node)) return;
      if (pill?.contains(event.target as Node)) return;
      closePopup();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePopup();
        // Return focus to the pill so keyboard users aren't stranded.
        pillRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, closePopup]);

  // --- Accessible name -------------------------------------------------------

  const ariaLabel = buildAriaLabel(myReaction, totalCount);

  // The emoji shown on the pill: the user's specific reaction, or the outline
  // heart when they haven't reacted.
  const pillEmoji = myReaction ? REACTION_EMOJI[myReaction] : null;

  return (
    <div className="relative inline-block">
      <button
        ref={pillRef}
        type="button"
        aria-pressed={hasReacted}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={isPending !== null}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        // `touch-action: manipulation` lets the browser handle scroll while
        // suppressing double-tap zoom; the long-press hook cancels on drag.
        style={{ touchAction: "manipulation" }}
        className={[
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
          "text-sm transition-colors duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
          hasReacted
            ? "border-accent-500/60 bg-accent-soft text-ink"
            : "border-white/10 bg-canvas text-ink-muted hover:border-white/20 hover:text-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
          showHint ? "reaction-hint-pulse" : "",
        ].join(" ")}
        {...longPressHandlers}
      >
        {pillEmoji ? (
          <span aria-hidden="true" className="text-base leading-none">
            {pillEmoji}
          </span>
        ) : (
          <HeartIcon className="text-ink-muted" />
        )}
        {totalCount > 0 && (
          <span
            className="text-xs font-medium tabular-nums"
            aria-hidden="true"
          >
            {totalCount}
          </span>
        )}
        {totalCount > 0 && (
          <span className="sr-only">
            {totalCount} {totalCount === 1 ? "reaction" : "reactions"}
          </span>
        )}
      </button>

      {isOpen && (
        <ReactionPickerPopup
          ref={popupRef}
          position={position}
          activeIndex={activeIndex}
          myReaction={myReaction}
          onSelect={(type) => {
            onToggle(type);
            closePopup();
            pillRef.current?.focus();
          }}
          onActiveIndexChange={setActiveIndex}
          onMouseEnter={handlePopupMouseEnter}
          onMouseLeave={handlePopupMouseLeave}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// ReactionPickerPopup
// ----------------------------------------------------------------------------

type ReactionPickerPopupProps = {
  position: { top: number; left: number; placement: "top" | "bottom" } | null;
  /** The emoji index currently highlighted (touch slide / keyboard focus). */
  activeIndex: number | null;
  /** The user's current reaction, to mark the matching emoji as checked. */
  myReaction: ReactionType | null;
  /** Apply the chosen reaction and close. */
  onSelect: (type: ReactionType) => void;
  /** Update the highlighted index (keyboard navigation). */
  onActiveIndexChange: (index: number | null) => void;
  /** Hover-intent: keep the popup open while the pointer is over it. */
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

/**
 * The six-emoji reaction picker shown above (or below) the pill. Renders the
 * canonical six types from [`REACTION_TYPES`](../../types/reaction.ts) as a
 * `role="menu"` of `role="menuitemradio"` buttons, marking the user's current
 * reaction as checked. Purely presentational + emits `onSelect`; all state
 * (open/close, positioning, highlight) is owned by the parent.
 *
 * Calm enter animation (opacity + slight rise, ~150ms, Design System §7).
 * Positioned with `position: fixed` at viewport coordinates from
 * [`usePopoverPosition`](../../hooks/usePopoverPosition.ts) so it's unaffected
 * by the scrolling timeline container.
 *
 * **Portaled to `document.body`** via `createPortal`. The timeline card uses
 * the `.hover-lift` utility, which applies `transform: translateY(-2px)` on
 * hover. Per the CSS spec, a transformed element becomes the containing
 * block for `position: fixed` descendants — so a popup rendered inside the
 * card would be positioned relative to the card, not the viewport, breaking
 * the viewport coordinates from `usePopoverPosition`. Portaling to
 * `document.body` escapes any transformed ancestor so the fixed positioning
 * is truly viewport-relative, as the hook computes.
 */
const ReactionPickerPopup = forwardRef<HTMLDivElement, ReactionPickerPopupProps>(
  function ReactionPickerPopup(
    {
      position,
      activeIndex,
      myReaction,
      onSelect,
      onActiveIndexChange,
      onMouseEnter,
      onMouseLeave,
    },
    ref,
  ) {
    const handleKeyDown = (event: React.KeyboardEvent) => {
      const count = REACTION_TYPES.length;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = activeIndex === null ? 0 : (activeIndex + 1) % count;
        onActiveIndexChange(next);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const prev =
          activeIndex === null
            ? count - 1
            : (activeIndex - 1 + count) % count;
        onActiveIndexChange(prev);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (activeIndex !== null) {
          const type = REACTION_TYPES[activeIndex];
          if (type) onSelect(type);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        // Let the parent's Esc handler close + restore focus.
      }
    };

    // Until the first measurement, position is null — render invisibly so the
    // popup can be measured (it's positioned off-screen to avoid a flash).
    const style: React.CSSProperties = position
      ? { position: "fixed", top: position.top, left: position.left }
      : { position: "fixed", top: -9999, left: -9999, opacity: 0 };

    return createPortal(
      <div
        ref={ref}
        role="menu"
        aria-label="Reactions"
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onKeyDown={handleKeyDown}
        className={[
          "z-50 flex items-center gap-1 rounded-full border border-white/10",
          "bg-canvas-raised p-1.5 shadow-lg",
          "reaction-popup-enter",
        ].join(" ")}
      >
        {REACTION_TYPES.map((type, index) => {
          const label = REACTION_LABELS[type];
          const emoji = REACTION_EMOJI[type];
          const isActive = activeIndex === index;
          const isChecked = myReaction === type;
          return (
            <button
              key={type}
              type="button"
              role="menuitemradio"
              aria-checked={isChecked}
              aria-label={label}
              data-reaction-index={index}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(type)}
              className={[
                "flex h-9 w-9 items-center justify-center rounded-full text-xl",
                "transition-transform duration-150",
                "hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
                isActive ? "scale-125 bg-white/10" : "",
              ].join(" ")}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          );
        })}
      </div>,
      document.body,
    );
  },
);

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

/**
 * The user's "primary" reaction for pill display. A user can hold multiple
 * reaction types (one per type per Memory), but the pill shows a single emoji.
 * Heart is preferred when present (it's the default), otherwise the first
 * reacted type in canonical order.
 */
function getPrimaryReaction(mine: Set<ReactionType>): ReactionType | null {
  if (mine.size === 0) return null;
  if (mine.has("heart")) return "heart";
  for (const type of REACTION_TYPES) {
    if (mine.has(type)) return type;
  }
  return null;
}

/** Sums every type's count into the total reactions on the Memory. */
function totalReactionCount(
  counts: Record<ReactionType, number>,
): number {
  let total = 0;
  for (const type of REACTION_TYPES) {
    total += counts[type] ?? 0;
  }
  return total;
}

/**
 * Builds the pill's accessible name, conveying the current state + total count
 * so a screen reader user knows what the control does and what's there.
 * Consistent with [`ReactionPill`](./ReactionBar.tsx) voice.
 */
function buildAriaLabel(
  myReaction: ReactionType | null,
  totalCount: number,
): string {
  const countPart =
    totalCount > 0
      ? `, ${totalCount} ${totalCount === 1 ? "reaction" : "reactions"}`
      : "";
  if (myReaction === null) {
    return `React with Heart${countPart}`;
  }
  if (myReaction === "heart") {
    return `Remove Heart reaction${countPart}`;
  }
  const label = REACTION_LABELS[myReaction];
  return `You reacted with ${label}. React with Heart${countPart}`;
}
