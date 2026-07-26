# Avero Design System



**Version:** 2.0

**Status:** 🟡 In Progress



---



# 1. Design Philosophy



Avero is calm, personal, and intentional.



It should never feel noisy, overwhelming, or addictive.



The design should feel like:



* A private space

* A memory album

* A quiet, premium journal of life



Everything should support **clarity, emotion, and simplicity**.



---



# 2. Color System

The palette is **modern-nostalgic minimalism**: a single warm-neutral monochrome family (near-black base, off-white ink, muted grays) with **one restrained "aged brass" accent** used sparingly. All surfaces and inks share hue ≈ 75° at near-zero chroma, so the palette reads as one family with brass as the only chromatic note — closer to Nothing's design philosophy than a typical SaaS dark theme.

Tokens are defined in `tailwind.config.js` and consumed as Tailwind classes (`bg-canvas`, `text-ink`, `bg-accent-600`, etc.). RGB-channel CSS variables (`--accent-rgb`, `--error-rgb`) live in `index.css` so keyframes, gradients, and glows can use `rgba(var(--accent-rgb), <alpha>)` without hardcoding hex channels.

## Surfaces (base / raised / elevated)

| Token | Hex | OKLCH | Role |
|---|---|---|---|
| `canvas` | `#0b0b0c` | `oklch(0.14 0.004 75)` | Page background — warm near-black |
| `canvas-soft` | `#131314` | `oklch(0.18 0.004 75)` | Cards / raised surfaces |
| `canvas-raised` | `#1c1c1e` | `oklch(0.23 0.005 75)` | Elevated / glass base |

Each step is one perceptual lightness step; same warm-neutral hue so the step reads as elevation, not a color change.

## Ink (text)

| Token | Hex | OKLCH | Role | Contrast on canvas |
|---|---|---|---|---|
| `ink` | `#ececec` | `oklch(0.92 0.004 75)` | Primary text — off-white, not pure | 16.6:1 ✓ |
| `ink-muted` | `#8d8d8a` | `oklch(0.62 0.006 75)` | Secondary / muted text | ~5.4:1 ✓ (AA body) |
| `ink-disabled` | `#5a5a57` | `oklch(0.42 0.006 75)` | Faint / placeholders — never body copy | below AA (intentional) |

## Accent — aged brass (the one restrained accent)

A muted, slightly desaturated "aged brass," **not** bright/saturated gold. Tuned at OKLCH **hue 75° / chroma 0.085** — deliberately below the warning-yellow zone (hue 90–100°, chroma 0.15+) so it never reads as a caution color. Used sparingly: primary actions, active/selected states, one hairline glow on hover — not broadly across UI chrome.

| Token | Hex | OKLCH | Role | Contrast |
|---|---|---|---|---|
| `accent-400` | `#b89668` | `oklch(0.72 0.085 75)` | Lightest — text/icons on dark, links, status | 7.1:1 on canvas ✓ |
| `accent-500` | `#9c7d52` | `oklch(0.62 0.085 75)` | Core — focus rings, borders, hover fills, the glow | — |
| `accent-600` | `#806540` | `oklch(0.52 0.085 75)` | Solid fills w/ **white** text (primary actions) | 5.45:1 (white) ✓ |
| `accent-700` | `#6b5535` | `oklch(0.45 0.085 75)` | Pressed / active | — |
| `accent-soft` | `rgba(184,150,104,0.12)` | — | Tinted backgrounds (badges, selected pills) | — |

> **Contrast note:** `accent-600` is intentionally the *deep* end of the scale so `PrimaryButton`'s `bg-accent-600 text-white` keeps WCAG AA. A brighter brass would fail white-text contrast; the depth also reinforces the "aged/dulled brass" read. If a brighter brass fill is ever needed, the button text must switch to `ink`.

## Semantic — error

| Token | Hex | Role |
|---|---|---|
| `error` | `#c98a7a` | Calm, desaturated warm terracotta — retained; already fits the warm-neutral temperature |
| `error-soft` | `rgba(201,138,122,0.12)` | Tinted error backgrounds |

No success/positive semantic exists yet; add one only when a consumer needs it.

## Grain / texture

A subtle SVG noise overlay (`body::before` in `index.css`) at ~3.5% opacity gives the base background warmth without looking noisy. Fixed, pointer-events-none, static.

---



# 3. Typography

## Font stacks

* **Primary sans-serif** (`font-sans`): clean, modern system stack — titles and body copy. Prioritize readability over style.
* **Secondary mono** (`font-mono`): `ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace` — a quiet signature detail reserved for **dates, counts, stat numbers, and metadata labels**. Not applied to body or titles. The mono/sans contrast is deliberate and restrained, not used everywhere.

## Hierarchy

* H1: Large, bold, emotional (titles of Memories / Spaces)
* H2: Section headers
* Body: standard readable text
* Caption: small, muted context text
* Metadata/numerals: mono font, muted ink — the secondary accent use case

Rule:

> Text should feel like storytelling, not UI labels.



---



# 4. Spacing System



Use a consistent spacing scale:



* 4px (micro spacing)

* 8px (small spacing)

* 12px

* 16px (base spacing)

* 24px

* 32px

* 48px (section spacing)



Rule:



> If spacing feels "random", it's wrong.



---



# 5. Layout System



## Structure



* Centered content for readability

* Max width for content areas (no endless stretching)

* Mobile-first design



## Principles



* One primary focus per screen

* No cluttered dashboards

* White space is intentional



## 5.1 Glass & Elevation System

A small, fixed set of elevation levels so every glass surface pulls from the same defined values rather than inventing blur/opacity per-component (mirrors the consistency principle above). Defined as utility classes in `index.css`.

| Level | Background | Border | Backdrop filter | Use |
|---|---|---|---|---|
| `elevation-base` | `canvas` | none | none | Page background |
| `elevation-raised` | `canvas-soft` | `1px solid rgba(255,255,255,0.05)` | none | Cards, inputs, list rows |
| `elevation-glass` | `rgba(28,28,30,0.60)` | `1px solid rgba(255,255,255,0.08)` | `blur(16px) saturate(140%)` | Overlay panels, stat strips on Space headers — **honest layering only** |
| `scrim` | `rgba(0,0,0,0.70)` | none | `blur(8px)` | Modal/lightbox backdrops |

**Utility classes:** `.glass-panel` (elevation-glass) and `.scrim`. Components use these instead of hand-rolling `backdrop-blur-*` + `bg-*/opacity`.

> **Rule:** Transparency is an honest structural material, not decoration. Use glass/blur surfaces only where they represent actual layering or depth — never as flat translucent color, never just for effect.



---



# 6. Components



## Buttons



* Primary: filled accent color

* Secondary: outline style

* Ghost: minimal text button



Rules:



* Buttons should feel soft, not aggressive

* Clear hover + press feedback required



---



## Cards



Used for:



* Memories

* Spaces

* Media previews



Rules:



* Slight rounded corners

* Soft shadows or elevation

* Clean separation between items



---



## Inputs



* Minimal borders

* Clear focus state

* No unnecessary decoration



---



# 7. Motion & Animation

Motion is restrained — "perfect minimalism, not empty minimalism." No bounce, no overshoot, no excess movement. Motion tokens are defined in `tailwind.config.js` and a reusable `.hover-lift` utility lives in `index.css` so the hover pattern is consistent, not one-off CSS per component.

## Tokens

| Token | Value | Role |
|---|---|---|
| `ease-calm` | `cubic-bezier(0.22, 1, 0.36, 1)` | Ease-out-quint — the single shared easing, no overshoot |
| `duration-lift` | `180ms` | Hover lift / border transitions |
| `duration-glow` | `220ms` | Soft glow-in — slightly slower to feel gentle |

## Reusable pattern — `.hover-lift`

The canonical hover affordance for interactive surfaces (cards, list rows):

* `translateY(-2px)` lift
* `border-color` transition to `rgba(var(--accent-rgb), 0.40)`
* One soft accent glow-in: `box-shadow: 0 0 0 1px rgba(var(--accent-rgb),0.10), 0 8px 24px -12px rgba(var(--accent-rgb),0.25)`

Components add the `.hover-lift` class instead of hand-rolling transitions. This is the **only** place accent glow is applied on hover.

## Principles

Animations should feel:

* Smooth

* Subtle

* Meaningful

Use motion for:

* Transitions between screens

* Opening Memories

* Adding content

Avoid:

* Bouncy, playful animations

* Excess motion

Rule:

> Motion should explain change, not distract.

All decorative transitions respect `prefers-reduced-motion` (shortened to near-instant); functional spinners keep running.



---



# 8. Interaction Design



Every interaction must:



* Give feedback

* Feel instant

* Never leave user uncertain



Examples:



* Loading states always visible

* Actions confirm visually

* Errors are clear and calm



---



# 9. Icon System



* Simple, outline-style icons

* No overly complex or filled icons

* Consistent stroke width



Icons should support text, not replace it.



---



# 10. Emotional Design Principle



Avero should feel like:



> "This is my space. My people. My memories."



Not:



* Social media

* A productivity tool

* A content feed



Every UI decision should reinforce that feeling.
