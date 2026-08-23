import { useId } from "react";

export type SortOption = "newest" | "oldest" | "location";

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
  { value: "location", label: "By Location" },
];

/**
 * Sort control with underline style matching Stitch source.
 * Custom-styled <select> with underline border, chevron icon.
 * Options: Newest first, Oldest first, By Location.
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
      <div className="relative inline-block w-48 group">
        <select
          id={selectId}
          value={value}
          onChange={(event) => onChange(event.target.value as SortOption)}
          aria-label={ariaLabel}
          className={[
            "appearance-none w-full bg-transparent",
            "border-b border-outline-variant/50 dark:border-secondary-fixed-dim/50",
            "py-2 pl-0 pr-8",
            "font-mono-data text-mono-data",
            "text-on-surface-variant dark:text-secondary-fixed-dim",
            "cursor-pointer",
            "hover:border-accent-warm dark:hover:border-primary-fixed-dim",
            "focus:outline-none focus:border-accent-warm",
            "transition-colors",
          ].join(" ")}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {/* Decorative chevron — purely visual, not interactive */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-on-surface-variant dark:text-secondary-fixed-dim group-hover:text-accent-warm dark:group-hover:text-primary-fixed-dim transition-colors">
          <span className="material-symbols-outlined text-[18px]" data-icon="expand_more">
            expand_more
          </span>
        </div>
      </div>
    </div>
  );
}