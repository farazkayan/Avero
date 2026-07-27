/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds — warm-neutral near-black (Design System §2).
        // Hue ≈ 75° at near-zero chroma so the palette reads as a single
        // warm-neutral monochrome family with brass as the only chromatic note.
        //
        // Values are CSS variables so the same Tailwind classes resolve to the
        // dark palette by default and the light palette under `html.light`
        // (roadmap Phase 6 — Theming). The RGB triplets live in `index.css`
        // (`:root` = dark, `:root.light` = light). `<alpha-value>` lets the
        // `/opacity` modifier (e.g. `bg-canvas/60`) keep working.
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        "canvas-soft": "rgb(var(--color-canvas-soft) / <alpha-value>)",
        "canvas-raised": "rgb(var(--color-canvas-raised) / <alpha-value>)",
        // Text — off-white ink, muted gray, faint (Design System §2).
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--color-ink-muted) / <alpha-value>)",
        "ink-disabled": "rgb(var(--color-ink-disabled) / <alpha-value>)",
        // Accent — restrained "aged brass" (Design System §2).
        // OKLCH hue 75° / chroma 0.085 — deliberately below the warning-yellow
        // zone (hue 90–100°, chroma 0.15+) so it reads as muted brass, not gold.
        // accent-600 is the deep end so white text on solid fills passes AA.
        //
        // On the light theme the ramp is remapped (same brass hexes, reordered
        // for contrast on a light surface): accent-400 darkens to the brass
        // deep end so text/icons/links stay legible, while accent-600 keeps the
        // same hex so `bg-accent-600 text-white` buttons pass AA in both themes.
        accent: {
          400: "rgb(var(--color-accent-400) / <alpha-value>)",
          500: "rgb(var(--color-accent-500) / <alpha-value>)",
          600: "rgb(var(--color-accent-600) / <alpha-value>)",
          700: "rgb(var(--color-accent-700) / <alpha-value>)",
          soft: "rgb(var(--color-accent-400) / 0.12)",
        },
        // Error — calm, desaturated warm terracotta (Design System §8).
        // Retained as-is; already fits the warm-neutral palette temperature.
        error: {
          DEFAULT: "rgb(var(--color-error) / <alpha-value>)",
          soft: "rgb(var(--color-error) / 0.12)",
        },
      },
      fontFamily: {
        // Primary sans-serif — titles + body copy.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // Secondary mono accent — reserved for dates, counts, stat numbers,
        // and metadata labels (Design System §3). NOT for body or titles.
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "JetBrains Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      // Motion tokens — restrained, no bounce/overshoot (Design System §7).
      transitionTimingFunction: {
        // ease-out-quint — the single shared easing for the design system.
        calm: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        // Hover lift / border transitions.
        lift: "180ms",
        // Soft glow-in — slightly slower to feel gentle.
        glow: "220ms",
      },
    },
  },
  plugins: [],
}
