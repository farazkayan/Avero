import { useId } from "react";
import { SearchIcon, CloseIcon } from "./icons";

export type SearchInputVariant = "default" | "underline";

export type SearchInputProps = {
  /** Controlled current value of the search box. */
  value: string;
  /** Called with the next value on every keystroke (instant filtering). */
  onChange: (value: string) => void;
  /** Placeholder shown when the input is empty. */
  placeholder?: string;
  /** Accessible name for the input (no visible label is rendered). */
  ariaLabel?: string;
  /** Optional id for the input element. */
  id?: string;
  /** Optional wrapper className (e.g. for layout spacing). */
  className?: string;
  /** Visual variant: "default" (rounded) or "underline" (Stitch source style) */
  variant?: SearchInputVariant;
};

/**
 * A calm, instant search box for filtering an in-memory list
 * (feature-specs §7, Design System §6 Inputs).
 *
 * Variants:
 * - "default": rounded input with background, clear button (original design)
 * - "underline": underline style matching Stitch source — transparent bg,
 *   bottom border only, leading search icon, no clear button
 *
 * The component is fully controlled (`value` / `onChange`) and owns no
 * state. Filtering itself happens in the parent.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  ariaLabel = "Search",
  id,
  className = "",
  variant = "default",
}: SearchInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = value.length > 0;

  if (variant === "underline") {
    return (
      <div className={className}>
        <div className="relative w-full sm:w-72">
          <span
            className="material-symbols-outlined absolute left-0 top-2.5 text-outline-variant/70 dark:text-secondary-fixed-dim/70 text-[20px] transition-colors duration-300"
            data-icon="search"
            aria-hidden="true"
          >
            search
          </span>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={[
              "journal-input w-full bg-transparent",
              "border-b border-outline-variant/50 dark:border-secondary-fixed-dim/50",
              "pl-8 pr-4 py-2",
              "font-body-sm text-body-sm",
              "text-on-surface dark:text-surface-container-lowest",
              "placeholder:text-on-surface-variant/50 dark:placeholder:text-secondary-fixed-dim/50",
              "transition-colors",
            ].join(" ")}
          />
        </div>
      </div>
    );
  }

  // Default variant (rounded with clear button)
  return (
    <div className={className}>
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-disabled"
          aria-hidden="true"
        >
          <SearchIcon />
        </span>

        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={[
            "w-full rounded-lg border bg-canvas px-3.5 py-2.5 text-base text-ink",
            "placeholder:text-ink-disabled",
            "transition-colors duration-200",
            "focus:outline-none focus:ring-2 focus:ring-accent-500/60 focus:border-accent-500",
            "pl-10 pr-10",
            "border-ink/10 hover:border-ink/20",
          ].join(" ")}
        />

        {hasValue && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-disabled transition-colors duration-200 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 rounded-md"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}