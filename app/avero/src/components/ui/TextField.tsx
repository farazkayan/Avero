import { forwardRef, useId } from "react";

export type TextFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  label: string;
  error?: string;
  helperText?: string;
  leadingIcon?: React.ReactNode;
  /**
   * Optional content rendered inside the input's inner container, aligned to
   * the right edge. Used by PasswordField for its show/hide toggle. Because it
   * lives in the same `relative` box as the <input>, it stays vertically
   * centered against the input height regardless of label/helper text.
   */
  trailingAddon?: React.ReactNode;
};

/**
 * A single, reusable text input for email, name, and other short text entry
 * (auth-design §5). Minimal borders, clear focus ring in the accent tone,
 * and an accessible label association (Design System §6; ai-context §9).
 *
 * PasswordField composes this component, so behavior stays predictable
 * everywhere (Blueprint Principle #4: Consistency Builds Confidence).
 *
 * Labels are screen-reader-only (sr-only) per the Stitch source — placeholder
 * text alone serves the visual labeling purpose.
 */
const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { label, error, helperText, leadingIcon, trailingAddon, id, className = "", ...inputProps },
    ref
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const describedById = `${inputId}-describe`;

    const hasError = Boolean(error);
    const descriptionParts: string[] = [];
    if (helperText) descriptionParts.push(helperText);
    if (error) descriptionParts.push(error);

    return (
      <div className={className}>
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>

        <div className="relative">
          {leadingIcon && (
            <span
              className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-disabled"
              aria-hidden="true"
            >
              {leadingIcon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            aria-describedby={
              descriptionParts.length > 0 ? describedById : undefined
            }
            aria-invalid={hasError || undefined}
            className={[
              "auth-input w-full rounded-md py-3 px-4 text-base transition-all",
              leadingIcon ? "pl-10" : "",
              // Reserve space for a trailing addon so text never underlaps it.
              trailingAddon ? "pr-12" : "",
            ].join(" ")}
            {...inputProps}
          />

          {trailingAddon}
        </div>

        {(helperText || error) && (
          <p
            id={describedById}
            className={`auth-helper mt-2 text-sm ${hasError ? "auth-helper-error" : ""}`}
          >
            {error ?? helperText}
          </p>
        )}
      </div>
    );
  }
);

export default TextField;
