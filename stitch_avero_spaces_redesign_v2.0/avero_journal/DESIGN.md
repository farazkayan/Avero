---
name: Avero Journal
colors:
  surface: '#fff8f4'
  surface-dim: '#e0d9d3'
  surface-bright: '#fff8f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#faf2ec'
  surface-container: '#f4ece6'
  surface-container-high: '#efe7e1'
  surface-container-highest: '#e9e1db'
  on-surface: '#1e1b18'
  on-surface-variant: '#4e453b'
  inverse-surface: '#33302c'
  inverse-on-surface: '#f7efe9'
  outline: '#80756a'
  outline-variant: '#d1c4b7'
  surface-tint: '#755a32'
  primary: '#725730'
  on-primary: '#ffffff'
  primary-container: '#8d6f46'
  on-primary-container: '#fffbff'
  inverse-primary: '#e5c190'
  secondary: '#5e5e5c'
  on-secondary: '#ffffff'
  secondary-container: '#e1dfdc'
  on-secondary-container: '#636360'
  tertiary: '#495e77'
  on-tertiary: '#ffffff'
  tertiary-container: '#617691'
  on-tertiary-container: '#fdfcff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffddb2'
  primary-fixed-dim: '#e5c190'
  on-primary-fixed: '#291800'
  on-primary-fixed-variant: '#5b421d'
  secondary-fixed: '#e4e2de'
  secondary-fixed-dim: '#c8c6c3'
  on-secondary-fixed: '#1b1c1a'
  on-secondary-fixed-variant: '#474744'
  tertiary-fixed: '#d1e4ff'
  tertiary-fixed-dim: '#b3c8e6'
  on-tertiary-fixed: '#041d33'
  on-tertiary-fixed-variant: '#334861'
  background: '#fff8f4'
  on-background: '#1e1b18'
  surface-variant: '#e9e1db'
  canvas-dark: '#0b0b0c'
  card-dark: '#131314'
  accent-dark: '#806540'
  canvas-warm: '#fbf9f5'
  card-warm: '#ffffff'
  accent-warm: '#9c7d52'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
  container-max: 1280px
---

## Brand & Style

The design system is an evolution of "Industrial Elegance" into a dual-mode "Journal" aesthetic. It balances the precision of an engineering ledger with the tactile warmth of high-end stationery. The brand identity is built on two pillars: the **Dark Theme** (Technical/Stealth) and the **Warm Light Mode** (Paper/Discovery).

The style is primarily **Minimalist** with a **Tactile** execution. It favors physical metaphors—paper textures, subtle ink-like contrast, and soft shadows—over digital abstractions. The target audience values meticulous organization and a focused, serene environment for deep work. The emotional response should be one of quiet sophistication, timelessness, and intellectual clarity.

## Colors

The system employs a contextual palette that shifts between a deep, technical "Stealth" environment and a breathable "Warm Paper" environment.

### Warm Light Mode (Primary)
- **The Foundation**: `canvas-warm` (#fbf9f5) serves as a soft, non-reflective paper base to reduce glare. `card-warm` (#ffffff) provides pure-white surfaces for content isolation.
- **The Accent**: Warm Ochre (#9c7d52) is used for call-to-actions and semantic highlights, echoing the tone of natural leather or aged parchment.

### Dark Mode
- **The Foundation**: `canvas-dark` (#0b0b0c) provides a near-black "void" for high-focus tasks. `card-dark` (#131314) acts as the primary container surface.
- **The Accent**: Muted Brass (#806540) provides low-energy visibility that maintains night-vision comfort while indicating interactivity.

## Typography

The "Journal" typography system relies on a strict hierarchy between human communication and technical metadata.

- **Inter (Headings & UI)**: Used for the primary narrative. Headlines should be set with tight tracking and a slightly heavier weight to feel authoritative. It represents the "voice" of the user and the system.
- **JetBrains Mono (Metadata & Ledger)**: Used for all non-narrative data—timestamps, IDs, coordinates, and labels. This creates a "ledger" effect, signaling to the user that this information is technical or system-generated. 

All mono text should be rendered with slightly higher line height when used for data tables to ensure the monospace characters remain legible in dense clusters.

## Layout & Spacing

The layout is governed by a **Fluid Grid** with a meticulous 4px incremental rhythm.

- **Grid Architecture**: 12 columns on desktop (1280px max) and 4 columns on mobile. 
- **The 24px Gutter**: This is the "Golden Gap" of the system. It is used for both the space between cards and the internal padding within them. This 1:1 ratio between internal and external space creates a perfectly balanced "Journal" page feel.
- **Reflow Rules**: On mobile, all horizontal card layouts must stack vertically. Spacing between stacked items should be reduced to 16px to maintain visual momentum.

## Elevation & Depth

This system uses **Tactile Layers** to differentiate between the canvas and interactive content.

- **Warm Light Mode**: Depth is conveyed through soft, ambient light. Surfaces use a "Shadow-Stone" effect: `0 4px 20px -2px rgba(28, 25, 23, 0.05)`. This feels like a physical sheet of paper resting on a desk.
- **Dark Mode**: Depth is conveyed through "Atmospheric Borders." Shadows are omitted in favor of a 1px border of `rgba(255, 255, 255, 0.1)` on all containers to define the physical edge against the void.
- **Surface Tiering**: Content cards are always one tier above the canvas. Modals or popovers use an additional `backdrop-blur-sm` (4px) to subtly obscure the layers beneath without losing the overall context of the page.

## Shapes

The shape language is "Soft Geometry." 

- **Containers**: Cards and input fields use a `0.5rem` (8px) radius. This provides a approachable feel that avoids the coldness of sharp corners while remaining professional.
- **Interactive Triggers**: Buttons and selection indicators use the standard radius to maintain structural alignment.
- **System Tags**: Badges and metadata chips use a full pill-shape (`rounded-xl` / `1.5rem`) to visually separate "Data" from "Structure."

## Components

### Buttons
- **Primary**: Solid Accent color (`#9c7d52` Light / `#806540` Dark). Text is `canvas-warm` or `canvas-dark`. 
- **Secondary**: Outlined in 1px `outline-variant`. On hover, the background fills with a 5% opacity of the accent color.

### Cards (Tactile Style)
- **Light**: Background `#ffffff`, subtle 1px border `#f0ede4`, soft stone shadow.
- **Dark**: Background `#131314`, 1px border `rgba(255,255,255,0.1)`. No shadow.
- **Hover**: Both modes should lift slightly (-2px Y-axis) to confirm interactivity.

### Input Fields
- **Journal Style**: Fields should feel like a line in a notebook. In Warm Light mode, use a solid white background with a bottom-heavy focus border. In Dark mode, use a recessed `canvas-dark` background.

### Lists & Tables
- Metadata within lists must use `JetBrains Mono` at `12px` or `14px`. 
- Row separators should be ultra-fine (0.5px or 1px) with low opacity to maintain a clean "ledger" look.

### Checkboxes & Radios
- These components use the primary accent color for the "Checked" state. The "Unchecked" state should use a neutral border that matches the card's border tokens.