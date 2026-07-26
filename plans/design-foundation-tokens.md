# Plan: Avero Design Foundation — Tokens & Primitives

**Scope:** Color tokens, glass/elevation system, typography (mono accent), motion tokens, and `design-system.md` update. **No page/component redesigns.**

**Strategy:** The existing token *names* (`canvas`, `canvas-soft`, `canvas-raised`, `ink`, `ink-muted`, `ink-disabled`, `accent.400/500/600/700/soft`, `error`) are referenced via Tailwind classes across ~220 usages. We swap **values**, not names → every component auto-inherits the new skin with zero structural code changes. This is the "build once, in the right skin" win.

---

## 1. Color Tokens — proposed values & reasoning

Direction: modern-nostalgic minimalism (Nothing-adjacent). Near-black base, off-white ink, muted grays, **one restrained aged-brass accent**. All values tuned warm-neutral (hue ≈ 75° in OKLCH) so the palette reads as monochrome+brass, not cool SaaS-blue.

### Base / surface levels
| Token | OKLCH | Hex (approx) | Role | Reasoning |
|---|---|---|---|---|
| `canvas` | `oklch(0.14 0.004 75)` | `#0b0b0c` | Page background | Near-black, barely warm. Current `#0a0d12` is cool blue-black; shifting to neutral-warm aligns with the monochrome/brass language. Chroma 0.004 = almost pure, just enough warmth to avoid a sterile zinc feel. |
| `canvas-soft` | `oklch(0.18 0.004 75)` | `#131314` | Cards / raised surfaces | One perceptual step above canvas. Same warm-neutral hue so the step reads as elevation, not a color change. |
| `canvas-raised` | `oklch(0.23 0.005 75)` | `#1c1c1e` | Elevated / glass base | Top of the solid-surface ladder; also the base color blended into the glass panel's translucent fill. |

### Ink / text levels
| Token | OKLCH | Hex (approx) | Role | Reasoning |
|---|---|---|---|---|
| `ink` | `oklch(0.92 0.004 75)` | `#ececec` | Primary text | Off-white, not pure `#fff` — softer on a near-black bg, matches "soft white" principle (§2). Contrast on canvas ≈ 15:1. |
| `ink-muted` | `oklch(0.62 0.006 75)` | `#8d8d8a` | Secondary / muted text | Warm-neutral gray. Contrast on canvas ≈ 5.4:1 (passes AA for body). |
| `ink-disabled` | `oklch(0.42 0.006 75)` | `#5a5a57` | Disabled / faint | Below AA — used only for placeholders/disabled, never body copy. |

### Accent — aged brass (the one restrained accent)
**Goal:** muted, slightly desaturated "aged brass," NOT bright/saturated gold. Warning yellow lives at hue ≈ 90–100°, chroma ≈ 0.15+. Brass sits at **hue ≈ 75°, chroma ≈ 0.085** — pulled toward orange-brown, well below the caution-color zone.

| Token | OKLCH | Hex (approx) | Role | Reasoning |
|---|---|---|---|---|
| `accent-400` | `oklch(0.72 0.085 75)` | `#b89668` | Text / icons on dark bg | Lightest brass. Contrast on canvas ≈ 6.8:1 ✓ (AA). Used for links, active icons, status text. |
| `accent-500` | `oklch(0.62 0.085 75)` | `#9c7d52` | Core — focus rings, borders, hover fills | Mid brass. The "one hairline glow on hover" color. |
| `accent-600` | `oklch(0.52 0.085 75)` | `#806540` | Solid fills w/ **white** text (PrimaryButton) | **Deep** brass — required so white text passes AA. Contrast white-on-`#806540` ≈ 5.4:1 ✓. A bright brass here would fail; the depth actually fits "aged/dulled brass" better than a bright tone would. |
| `accent-700` | `oklch(0.45 0.085 75)` | `#6b5535` | Pressed / active | Darkest step for `active:` states. |
| `accent-soft` | — | `rgba(184, 150, 104, 0.12)` | Tinted backgrounds (badges, selected pills) | Same 12% alpha pattern as current; rgb = accent-400 channels. |

> **Contrast flag:** `accent-600` is deliberately the *deep* end of the scale so `PrimaryButton`'s `bg-accent-600 text-white` keeps WCAG AA. If we ever want a brighter brass fill, the button text must switch to ink — out of scope for this task.

### Semantic — error (retained, temperature-aligned)
| Token | Hex | Reasoning |
|---|---|---|
| `error` | `#c98a7a` | **Kept as-is.** Already a calm, desaturated warm terracotta — fits the warm-neutral palette. No churn. |
| `error-soft` | `rgba(201, 138, 122, 0.12)` | Kept as-is. |

> No success/positive semantic exists today; not adding one in this task (no current consumers).

---

## 2. Glass / Elevation System

A **fixed set of 3 elevation levels + 1 scrim**, so every future glass surface pulls from defined values instead of inventing blur/opacity per-component (mirrors §5's consistency philosophy).

| Level | Background | Border | Backdrop filter | Use |
|---|---|---|---|---|
| `elevation-base` | `canvas` | none | none | Page background |
| `elevation-raised` | `canvas-soft` | `1px solid rgba(255,255,255,0.05)` | none | Cards, inputs, list rows |
| `elevation-glass` | `rgba(28,28,30,0.60)` | `1px solid rgba(255,255,255,0.08)` | `blur(16px) saturate(140%)` | Overlay panels, stat strips on Space headers — **honest layering only** |
| `scrim` | `rgba(0,0,0,0.70)` | none | `blur(8px)` | Modal/lightbox backdrops (formalizes existing `ConfirmDialog`/`MediaLightbox`) |

**Implementation:** CSS custom properties + two reusable utility classes in `index.css`:
- `.glass-panel` → applies `elevation-glass` (bg + border + backdrop-filter). Components add this class instead of hand-rolling `backdrop-blur-*` + `bg-*/opacity`.
- `.scrim` → applies the scrim level. Replaces the two existing ad-hoc `bg-black/60 backdrop-blur-sm` / `bg-black/85 backdrop-blur-sm` usages (low-risk value swap, same visual intent).

> `backdrop-filter` requires a `-webkit-` prefix for Safari; the utility class handles it once so components never repeat it.

---

## 3. Typography — secondary mono accent

Add a `font-mono` stack to Tailwind (none exists today — search confirmed 0 usages):

```
font-mono: ["ui-monospace", "SFMono-Regular", "JetBrains Mono", "Menlo", "Consolas", "monospace"]
```

- **Primary** sans-serif stays as-is for titles + body copy.
- **Mono** is reserved for the quiet signature detail: dates, counts, stat numbers, metadata labels. **Not** applied to body or titles.
- Application to actual components is the *next* phase (card/page redesign). This task only ships the token so it's available.

---

## 4. Motion Tokens

Restraint per §7 ("motion should explain change, not distract"). No bounce, no overshoot.

| Token | Value | Role |
|---|---|---|
| `ease-calm` | `cubic-bezier(0.22, 1, 0.36, 1)` | Ease-out-quint — single shared easing, no overshoot |
| `duration-lift` | `180ms` | Hover lift / border transitions |
| `duration-glow` | `220ms` | Soft glow-in (slightly slower to feel gentle) |

**Reusable pattern — `.hover-lift` utility class** in `index.css`:
- `transition: transform var(--duration-lift) var(--ease-calm), border-color var(--duration-lift) var(--ease-calm), box-shadow var(--duration-glow) var(--ease-calm)`
- `:hover` → `translateY(-2px)`, `border-color: rgba(var(--accent-rgb), 0.40)`, `box-shadow: 0 0 0 1px rgba(var(--accent-rgb),0.10), 0 8px 24px -12px rgba(var(--accent-rgb),0.25)` (the one hairline glow)
- Respects `prefers-reduced-motion` (existing global rule already shortens durations).

This becomes the canonical hover affordance for interactive surfaces, replacing the repeated `transition-colors duration-200` one-offs over time (component phase, not now).

---

## 5. CSS variable plumbing (prevents future drift)

Introduce RGB-channel custom properties in `index.css` `:root` so any `rgba()` need (keyframes, gradients, glows) references the token instead of hardcoding hex channels:

```css
:root {
  --accent-rgb: 184, 150, 104;        /* accent-400 channels */
  --error-rgb: 201, 138, 122;
}
```

**Two low-risk mechanical swaps** (value-only, no structural change — the only component touches in this task):
1. `index.css` `reaction-hint-pulse` keyframes — hardcoded `rgba(75, 160, 184, …)` (old teal) → `rgba(var(--accent-rgb), …)`.
2. `AuthShell.tsx` ambient radial gradient — hardcoded `rgba(61, 141, 163, 0.14)` (old teal) → `rgba(var(--accent-rgb), 0.14)`.

Both are pure value swaps to the new accent; same visual intent, now tokenized so they never drift again.

---

## 6. Grain / texture (base-layer primitive)

Subtle SVG noise on the page background via `body::before` in `index.css`:
- `position: fixed; inset: 0; pointer-events: none; z-index: 0;`
- `background-image: url("data:image/svg+xml,…")` (tiny inline feTurbulence noise)
- `opacity: 0.035` — warmth without noise.
- Body content sits above (`position: relative; z-index: 1`).
- Static (no motion concern). This is a base primitive, not page-specific.

---

## 7. `design-system.md` updates

Replace/add sections so the doc is the source of truth (not stale):
- **§2 Color System** — replace with the new token table (base/ink/accent/error + OKLCH reasoning + contrast notes).
- **§3 Typography** — add the mono accent stack + its reserved use case.
- **New §5.1 Glass & Elevation System** — the 3 levels + scrim table + "honest layering only" rule.
- **§7 Motion** — add the timing/easing tokens + `.hover-lift` pattern reference.
- Bump version to 2.0; keep §1, §4, §6, §8–10 principles intact (they already align).

---

## Out of scope (explicit)
- No component structural redesigns (Button, Card, inputs stay as-is).
- No page work (Space list, timeline, Memory Detail) — next phase.
- No timeline photo-thumbnail feature.
- No new semantic colors beyond retaining `error`.

## Files touched
1. `app/avero/tailwind.config.js` — color values, `font-mono`, motion theme keys.
2. `app/avero/src/index.css` — `:root` CSS vars, grain `::before`, `.glass-panel` / `.scrim` / `.hover-lift` utilities, keyframe rgba → var swap.
3. `app/avero/src/components/auth/AuthShell.tsx` — one-line gradient rgba → var (mechanical).
4. `docs/design-system.md` — §2/§3/§5.1/§7 rewrite + version bump.

## Risk
**Low.** Value swaps only; token names unchanged → ~220 class usages auto-inherit. The 2 component touches are mechanical rgba→var. No logic, structure, or a11y behavior changes.
