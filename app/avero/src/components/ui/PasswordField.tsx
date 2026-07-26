import { forwardRef, useId, useState } from "react";
import TextField from "./TextField";
import type { TextFieldProps } from "./TextField";
import { EyeIcon, EyeOffIcon } from "./icons";

type PasswordFieldProps = Omit<TextFieldProps, "type">;

/**
 * TextField composed with a show/hide visibility toggle
 * (auth-design §5). The toggle is a real, focusable button with an
 * accessible label (Design System §9; ai-context §9 Accessibility).
 *
 * The toggle is passed to TextField as a trailing addon so it renders inside
 * the input's inner container and stays vertically centered against the input
 * height alone — independent of the label and helper text above/below.
 */
const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ id, disabled, ...props }, ref) {
    const [isVisible, setIsVisible] = useState(false);
    const generatedId = useId();
    const toggleId = id ? `${id}-toggle` : `${generatedId}-toggle`;

    const toggle = (
      <button
        type="button"
        id={toggleId}
        disabled={disabled}
        onClick={() => setIsVisible((visible) => !visible)}
        aria-pressed={isVisible}
        aria-label={isVisible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-ink-muted transition-colors duration-200 hover:text-ink focus:outline-none focus:text-ink focus-visible:ring-2 focus-visible:ring-accent-500/60 rounded-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-ink-muted"
      >
        {isVisible ? (
          <EyeOffIcon className="h-5 w-5" />
        ) : (
          <EyeIcon className="h-5 w-5" />
        )}
      </button>
    );

    return (
      <TextField
        ref={ref}
        id={id}
        type={isVisible ? "text" : "password"}
        trailingAddon={toggle}
        {...props}
      />
    );
  }
);

export default PasswordField;
