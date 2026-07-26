import Spinner from "./Spinner";

export type PrimaryButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

/**
 * The single filled accent element on an auth screen — the way forward
 * (auth-design §2). Soft, not aggressive, with clear hover/press/disabled/
 * loading states (Design System §6). In the loading state it shows a small
 * inline spinner and becomes non-interactive to prevent duplicate submissions.
 */
export default function PrimaryButton({
  children,
  loading = false,
  disabled,
  className = "",
  type = "submit",
  ...buttonProps
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex w-full items-center justify-center gap-2 rounded-lg",
        "px-4 py-2.5 text-base font-semibold text-white",
        "bg-accent-600 transition-colors duration-200",
        "hover:bg-accent-500 active:bg-accent-700",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        isDisabled
          ? "cursor-not-allowed opacity-60 hover:bg-accent-600 active:bg-accent-600"
          : "",
        className,
      ].join(" ")}
      {...buttonProps}
    >
      {loading && <Spinner size={18} />}
      <span>{children}</span>
    </button>
  );
}
