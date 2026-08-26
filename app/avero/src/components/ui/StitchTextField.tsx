import { forwardRef, useId } from "react";

export type StitchTextFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  label: string;
  error?: string;
  helperText?: string;
};

/**
 * Stitch-styled text input with bottom border only (for delete confirmation modal).
 * Uses mono-label typography for the label, card background, and accent focus border.
 */
const StitchTextField = forwardRef<HTMLInputElement, StitchTextFieldProps>(
  function StitchTextField(
    { label, error, helperText, id, className = "", ...inputProps },
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
        <label htmlFor={inputId} className="font-mono-label text-mono-label text-on-surface-variant tracking-[0.05em] uppercase dark:text-[#a1a1aa] mb-2 block">
          {label}
        </label>

        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            aria-describedby={
              descriptionParts.length > 0 ? describedById : undefined
            }
            aria-invalid={hasError || undefined}
            className={[
              "w-full bg-surface-container-highest dark:bg-[#0c0f0f] border-b-2 border-transparent dark:border-[#3f3f46] focus:border-error rounded-t-DEFAULT shadow-sm px-4 py-3 font-body-md text-body-md text-on-surface dark:text-[#f4f4f5] placeholder:text-on-surface-variant/40 dark:placeholder:text-[#a1a1aa]/40 focus:outline-none transition-all duration-200",
            ].join(" ")}
            {...inputProps}
          />
        </div>

        {(helperText || error) && (
          <p
            id={describedById}
            className={`mt-2 text-sm ${hasError ? "text-error" : "text-on-surface-variant dark:text-[#a1a1aa]"}`}
          >
            {error ?? helperText}
          </p>
        )}
      </div>
    );
  }
);

export default StitchTextField;