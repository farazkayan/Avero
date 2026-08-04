import { useId } from "react";
import { ChevronDownIcon } from "../ui/icons";

export type SortOption = "newest" | "oldest" | "recently-added";

export type SortControlProps = {
  /** Current sort option */
  value: SortOption;
  /** Called when the sort option changes */
  onChange: (value: SortOption) => void;
  /** Optional wrapper className for layout spacing */
  className?: string;
  /** Accessible label for the select */
  ariaLabel?: string;
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "recently-added", label: "Recently added" },
];

/**
 * A subtle sort control for the Memories timeline (feature-specs §2).
 *
 * Per Design System §5 ("One primary focus per screen," no clutter) — this is
 * a single small control near the Timeline header, not a prominent feature.
 * Should feel like a subtle utility, not compete visually with the "Create
 * Memory" button or other primary actions.
 *
 * Uses the same input styling as SearchInput/TextField (minimal border,
 * accent focus ring, canvas background) so it reads as a natural sibling of
 * the other inputs (Blueprint Principle #4: Consistency Builds Confidence).
 *
 * Persistence: The selected sort order persists across visits via localStorage
 * (key: `avero:timeline:sort`). This is intentional — users who prefer a
 * specific view (e.g., "Recently added" to see what's new) shouldn't have to
 * re-select it every time they open a Space.
 */
export default function SortControl({
  value,
  onChange,
  className = "",
  ariaLabel = "Sort memories",
}: SortControlProps) {
  const generatedId = useId();
  const selectId = `sort-control-${generatedId}`;

  return (
    <div className={className}>
      <label htmlFor={selectId} className="sr-only">
        {ariaLabel}
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(event) => onChange(event.target.value as SortOption)}
          aria-label={ariaLabel}
          className={[
            "appearance-none",
            "rounded-lg border bg-canvas px-3 py-2 text-sm text-ink",
            "transition-colors duration-200",
            "focus:outline-none focus:ring-2 focus:ring-accent-500/60 focus:border-accent-500",
            "border-ink/10 hover:border-ink/20",
            // Reserve space for the chevron so text doesn't underlap
            "pr-8",
            // Subtle sizing — not a primary action
            "w-auto min-w-[160px]",
          ].join(" ")}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {/* Decorative chevron — purely visual, not interactive */}
        <span
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        >
          <ChevronDownIcon className="w-4 h-4" />
        </span>
      </div>
    </div>
  );
}