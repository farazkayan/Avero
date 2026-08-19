/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
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
        // Stitch source colors for auth pages
        "canvas-warm": "#fbf9f5",
        "surface-container-low": "#faf2ec",
        "on-tertiary-fixed": "#041d33",
        "secondary-container": "#e1dfdc",
        "primary-fixed-dim": "#e5c190",
        secondary: "#5e5e5c",
        "on-primary-fixed": "#291800",
        "surface-container-high": "#efe7e1",
        "card-warm": "#ffffff",
        "on-primary": "#ffffff",
        "on-surface": "#1e1b18",
        "accent-warm": "#9c7d52",
        primary: "#725730",
        "primary-container": "#8d6f46",
        tertiary: "#495e77",
        background: "#fff8f4",
        "on-secondary-fixed-variant": "#474744",
        "surface-container": "#f4ece6",
        "on-primary-container": "#fffbff",
        "accent-dark": "#806540",
        "on-secondary-fixed": "#1b1c1a",
        "surface-tint": "#755a32",
        "surface-container-highest": "#e9e1db",
        "on-error": "#ffffff",
        outline: "#80756a",
        "on-surface-variant": "#4e453b",
        "tertiary-fixed": "#d1e4ff",
        "inverse-primary": "#e5c190",
        "secondary-fixed-dim": "#c8c6c3",
        "on-background": "#1e1b18",
        "card-dark": "#131314",
        "surface-variant": "#e9e1db",
        "on-tertiary-container": "#fdfcff",
        error: "#ba1a1a",
        "inverse-on-surface": "#f7efe9",
        "on-primary-fixed-variant": "#5b421d",
        "outline-variant": "#d1c4b7",
        "surface-container-lowest": "#ffffff",
        "primary-fixed": "#ffddb2",
        "tertiary-container": "#617691",
        "tertiary-fixed-dim": "#b3c8e6",
        "surface-bright": "#fff8f4",
        "inverse-surface": "#33302c",
        "on-error-container": "#93000a",
        surface: "#fff8f4",
        "on-tertiary": "#ffffff",
        "canvas-dark": "#0b0b0c",
        "on-secondary": "#ffffff",
        "on-secondary-container": "#636360",
        "on-tertiary-fixed-variant": "#334861",
        "secondary-fixed": "#e4e2de",
        "surface-dim": "#e0d9d3",
        "error-container": "#ffdad6",
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
        // Stitch source font families
        "headline-lg-mobile": ["Inter"],
        "body-sm": ["Inter"],
        "body-md": ["Inter"],
        "headline-md": ["Inter"],
        "mono-data": ["JetBrains Mono"],
        "mono-label": ["JetBrains Mono"],
        "headline-lg": ["Inter"],
      },
      fontSize: {
        "headline-lg-mobile": ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        "body-sm": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        "headline-md": ["20px", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "500" }],
        "mono-data": ["14px", { lineHeight: "1.4", fontWeight: "400" }],
        "mono-label": ["12px", { lineHeight: "1.0", letterSpacing: "0.05em", fontWeight: "500" }],
        "headline-lg": ["32px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      spacing: {
        unit: "4px",
        "margin-desktop": "48px",
        "container-max": "1280px",
        "margin-mobile": "16px",
        gutter: "24px",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
        sm: "0.125rem",
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
