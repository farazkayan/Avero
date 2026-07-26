import { useEffect, useState } from "react";

/** The localStorage key recording that the user has seen the reaction hint. */
const HINT_SEEN_KEY = "avero.reactionHintSeen";

/**
 * Module-level guard ensuring only the **first** `TimelineReactionControl`
 * mounted in a session shows the discoverability hint. Without this, every
 * card on the timeline would pulse simultaneously on the user's first visit —
 * noisy and against Design System §7 ("Motion should explain change, not
 * distract"). Once any card has claimed the hint for this session, later
 * mounts read `false` even before the localStorage flag is written.
 */
let hintClaimedThisSession = false;

/**
 * A one-time, lightweight visual hint for the timeline reaction pill.
 *
 * The reaction control is a new, non-obvious affordance (a pill that hides a
 * full emoji picker behind a hover/long-press). To help first-time discovery
 * without being noisy, a single calm pulse/glow plays on the pill the first
 * time a user encounters a Memory card — then never again.
 *
 * This hook gates that pulse:
 *  - It returns `showHint = true` for exactly one mount per browser (the first
 *    `TimelineReactionControl` to mount when the localStorage flag is absent).
 *  - A module-level session guard (`hintClaimedThisSession`) ensures only one
 *    card claims the hint even if many mount in the same tick.
 *  - On claiming, the localStorage flag is written so the hint never returns
 *    on future visits.
 *  - `prefers-reduced-motion` is respected: if the user has reduced motion
 *    enabled, the hook still returns `showHint = true` (so a static, calm
 *    ring can be shown) but the caller's CSS is responsible for making the
 *    animation near-instant — see the `reaction-hint-pulse` keyframe in
 *    `index.css`, which the global reduced-motion rule shortens.
 *
 * The hint never blocks interaction, shows no tooltip/modal, and clears
 * itself after one play (the caller removes the class once the animation
 * ends, or simply leaves it — the keyframe runs once via `animation-iteration-
 * count: 1`).
 *
 * @returns `showHint` — whether this pill should play the one-time hint.
 */
export function useReactionHint(): boolean {
  // Decide once, during initial render, whether this card should show the
  // one-time hint. The session guard is claimed synchronously here (not in an
  // effect) so that sibling cards mounting in the same tick observe it as
  // already claimed and don't pulse too. localStorage is read here to respect
  // prior visits. This replaces a synchronous setState that previously ran in
  // an effect body (react-hooks/set-state-in-effect).
  const [showHint] = useState(() => {
    // If another card already claimed the hint this session, never show.
    if (hintClaimedThisSession) {
      return false;
    }

    // If the user has already seen the hint on a previous visit, never show.
    try {
      if (window.localStorage.getItem(HINT_SEEN_KEY) === "1") {
        hintClaimedThisSession = true;
        return false;
      }
    } catch {
      // localStorage may be unavailable (private mode / disabled). Fail
      // closed: don't show the hint repeatedly, but don't crash either.
      hintClaimedThisSession = true;
      return false;
    }

    // Claim the hint for this session. Persisting the flag is done in the
    // effect below (a pure external-system update with no setState).
    hintClaimedThisSession = true;
    return true;
  });

  // Persist the "seen" flag so the hint never returns on future visits. This
  // effect only updates an external system (localStorage) — it does not call
  // setState — so it doesn't trigger react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!showHint) {
      return;
    }
    try {
      window.localStorage.setItem(HINT_SEEN_KEY, "1");
    } catch {
      // Ignore write failures (private mode) — the session guard still
      // prevents repeated pulses within this session.
    }
  }, [showHint]);

  return showHint;
}
