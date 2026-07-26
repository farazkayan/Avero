import { useId, useRef, useState } from "react";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_MEMORY } from "../../lib/tags";

export type TagInputProps = {
  /** Stable id for the inner text input (also wires the <label>). */
  id: string;
  /** Visible label, styled to match TextField. */
  label: string;
  /** Optional muted helper text shown below the input. */
  helperText?: string;
  /** Controlled list of current tag names. */
  value: string[];
  /** Called with the next tag array whenever a tag is added or removed. */
  onChange: (tags: string[]) => void;
  /** Disables the input and the remove buttons when true. */
  disabled?: boolean;
  /** Optional error string rendered in the error tone below the input. */
  error?: string;
  /** Max number of tags (defaults to {@link MAX_TAGS_PER_MEMORY}). */
  maxTags?: number;
  /** Max length of a single tag name (defaults to {@link MAX_TAG_LENGTH}). */
  maxLength?: number;
};

/**
 * A simple multi-tag input (feature-specs §6, Design System §1/§6).
 *
 * Deliberately lightweight — not a heavy tag-picker. The user types into a
 * text field and presses Enter or comma to add a tag; clicking a chip's ×
 * removes it. This mirrors the "simplicity is premium" principle and the
 * existing TextField styling (minimal borders, clear focus ring in the accent
 * tone) so it reads as a natural sibling of the other form fields.
 *
 * Behavior:
 *  - **Add**: Enter or comma commits the trimmed input. Commas are stripped
 *    (they are the delimiter, not part of the tag). Duplicates
 *    (case-insensitive) and blanks are ignored silently — a calm no-op rather
 *    than an error, since the user's intent is clear either way.
 *  - **Remove**: clicking a chip's × removes that tag. Pressing Backspace on
 *    an empty input removes the last tag (a familiar affordance).
 *  - **Limits**: a tag longer than `maxLength` is not added; the input keeps
 *    its text so the user can edit it down. Adding beyond `maxTags` is a no-op.
 *
 * The component is fully controlled (`value`/`onChange`); it owns only the
 * transient text-buffer state for the in-progress tag.
 */
export default function TagInput({
  id,
  label,
  helperText,
  value,
  onChange,
  disabled = false,
  error,
  maxTags = MAX_TAGS_PER_MEMORY,
  maxLength = MAX_TAG_LENGTH,
}: TagInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-describe`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState("");

  const hasError = Boolean(error);
  const descriptionParts: string[] = [];
  if (helperText) descriptionParts.push(helperText);
  if (error) descriptionParts.push(error);

  const atLimit = value.length >= maxTags;

  /**
   * Commits the current draft as a tag (if valid) and clears the input.
   * Shared by the Enter, comma, and blur-style commit paths.
   */
  function commitDraft() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setDraft("");
      return;
    }
    if (trimmed.length > maxLength) {
      // Keep the text so the user can shorten it; do not add an over-long tag.
      return;
    }
    // Case-insensitive duplicate check against the existing set. A duplicate
    // is a calm no-op: clear the draft and move on.
    const isDuplicate = value.some(
      (existing) => existing.toLowerCase() === trimmed.toLowerCase(),
    );
    if (isDuplicate || atLimit) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    // Enter commits the draft. We prevent form submission so the tag is added
    // without submitting the whole form (the form's submit button handles
    // that separately).
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      return;
    }

    // Comma commits the draft (comma is the delimiter, not part of the tag).
    if (event.key === ",") {
      event.preventDefault();
      commitDraft();
      return;
    }

    // Backspace on an empty input removes the last tag — a familiar
    // affordance borrowed from common tag inputs.
    if (event.key === "Backspace" && draft.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    // Strip commas from the buffer — they are the delimiter, never part of a
    // tag. This also prevents a stray comma from lingering after a commit.
    setDraft(event.target.value.replace(/,/g, ""));
  }

  function handleRemoveTag(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-ink-muted mb-2"
      >
        {label}
      </label>

      <div
        className={[
          "flex flex-wrap items-center gap-1.5 rounded-lg border bg-canvas px-2.5 py-2",
          "transition-colors duration-200",
          "focus-within:ring-2 focus-within:ring-accent-500/60 focus-within:border-accent-500",
          hasError
            ? "border-error/60 focus-within:border-error focus-within:ring-error/30"
            : "border-white/10 hover:border-white/20",
          disabled ? "opacity-60" : "",
        ].join(" ")}
      >
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-canvas-raised px-2.5 py-0.5 text-xs font-medium text-ink-muted"
          >
            {tag}
            <button
              type="button"
              onClick={() => handleRemoveTag(index)}
              disabled={disabled}
              aria-label={`Remove tag ${tag}`}
              className="text-ink-disabled transition-colors duration-200 hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 rounded-full"
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={draft}
          disabled={disabled || atLimit}
          maxLength={maxLength}
          autoComplete="off"
          placeholder={atLimit ? "Tag limit reached" : "Add a tag…"}
          aria-describedby={
            descriptionParts.length > 0 ? describedById : undefined
          }
          aria-invalid={hasError || undefined}
          className={[
            "min-w-[8rem] flex-1 bg-transparent py-0.5 text-base text-ink",
            "placeholder:text-ink-disabled",
            "focus:outline-none",
            disabled || atLimit ? "cursor-not-allowed" : "",
          ].join(" ")}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>

      {(helperText || error) && (
        <p
          id={describedById}
          className={`mt-1.5 text-sm ${
            hasError ? "text-error" : "text-ink-muted"
          }`}
        >
          {error ?? helperText}
        </p>
      )}
    </div>
  );
}
