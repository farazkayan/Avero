import { useId } from "react";
import { SearchIcon, CloseIcon } from "./icons";

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
};

/**
 * A calm, instant search box for filtering an in-memory list
 * (feature-specs §7, Design System §6 Inputs).
 *
 * Unlike TextField (a form field with a visible label), this is a label-less
 * filter affordance: a leading magnifying-glass glyph, a placeholder, and a
 * trailing clear (×) button that appears only when there is text to clear.
 * The input styling mirrors TextField exactly (minimal border, accent focus
 * ring, canvas background) so it reads as a natural sibling of the other
 * inputs (Blueprint Principle #4: Consistency Builds Confidence).
 *
 * The component is fully controlled (`value` / `onChange`) and owns no
 * state. Filtering itself happens in the parent — this component only
 * reports the query — so the parent keeps the source list and the derived
 * results in one place and clears the search by setting `value` to "".
 *
 * The right padding is reserved even when the clear button is absent so the
 * input's layout never shifts as the user types or clears (Design System §7:
 * "Motion should explain change, not distract" — a stable box is calmer
 * than a jumping one).
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  ariaLabel = "Search",
  id,
  className = "",
}: SearchInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = value.length > 0;

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
            // Room for the leading search glyph and the trailing clear button
            // so the typed text never underlaps either.
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
