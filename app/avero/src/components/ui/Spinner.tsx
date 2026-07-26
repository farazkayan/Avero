type SpinnerProps = {
  size?: number;
  className?: string;
};

/**
 * Small, subtle loading indicator (Design System §7).
 * Used inside PrimaryButton and future full-screen loading states.
 * The spin is functional feedback, so it is intentionally kept even under
 * reduced-motion preferences.
 */
export default function Spinner({ size = 16, className = "" }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
