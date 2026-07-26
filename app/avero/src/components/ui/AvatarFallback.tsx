import { useMemo } from "react";

/**
 * AvatarFallback — deterministic initials avatar using the design system palette.
 *
 * Design (design-system.md §2, §6):
 * - Circle, canvas-raised surface (#1c1c1e)
 * - Aged-brass accent text (accent-500 #9c7d52)
 * - Mono font (font-mono) for initials — the design system reserves mono for
 *   "dates, counts, stat numbers, and metadata labels" (§3), and initials
 *   read as a compact metadata label.
 * - Deterministic background hue from the name string so the same user always
 *   gets the same color (subtle variation within the warm-neutral family).
 */
interface AvatarFallbackProps {
  /** Full display name (e.g., "Ada Lovelace") — used to derive initials and color. */
  name: string;
  /** Diameter in pixels (default: 32). */
  size?: number;
}

export function AvatarFallback({ name, size = 32 }: AvatarFallbackProps) {
  // Derive initials (max 2 chars, uppercase)
  const initials = useMemo(() => {
    if (!name.trim()) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }, [name]);

  // Deterministic hue shift within the warm-neutral family (hue ≈ 75° ± 10°)
  // so every user gets a consistent but subtly distinct background.
  const bgStyle = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    // Map to a narrow hue range around 75° (aged brass hue)
    const hue = 70 + (Math.abs(hash) % 21); // 70–90°
    // Keep chroma very low (near-neutral) and lightness at canvas-raised level
    return {
      backgroundColor: `oklch(0.23 0.005 ${hue})`, // canvas-raised with subtle hue
    };
  }, [name]);

  return (
    <div
      className="inline-flex items-center justify-center rounded-full font-mono text-accent-500 select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38, // ~12px at 32px, scales proportionally
        ...bgStyle,
      }}
      aria-label={name || "User avatar"}
    >
      {initials}
    </div>
  );
}