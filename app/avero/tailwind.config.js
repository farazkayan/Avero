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
        canvas: "#0b0b0c",
        "canvas-soft": "#131314",
        "canvas-raised": "#1c1c1e",
        // Text — off-white ink, muted gray, faint (Design System §2).
        ink: "#ececec",
        "ink-muted": "#8d8d8a",
        "ink-disabled": "#5a5a57",
        // Accent — restrained "aged brass" (Design System §2).
        // OKLCH hue 75° / chroma 0.085 — deliberately below the warning-yellow
        // zone (hue 90–100°, chroma 0.15+) so it reads as muted brass, not gold.
        // accent-600 is the deep end so white text on solid fills passes AA.
        accent: {
          400: "#b89668", // lightest — text/icons on dark (7.1:1 on canvas)
          500: "#9c7d52", // core — focus rings, borders, hover fills, glow
          600: "#806540", // solid fills w/ white text (5.45:1 AA ✓)
          700: "#6b5535", // pressed / active
          soft: "rgba(184, 150, 104, 0.12)", // tinted backgrounds (badges, pills)
        },
        // Error — calm, desaturated warm terracotta (Design System §8).
        // Retained as-is; already fits the warm-neutral palette temperature.
        error: {
          DEFAULT: "#c98a7a",
          soft: "rgba(201, 138, 122, 0.12)",
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
