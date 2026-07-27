import { useEffect, useRef } from "react";
import Spinner from "./Spinner";

type ConfirmDialogProps = {
  /** Accessible title shown in the dialog header. */
  title: string;
  /** Supporting body copy explaining the consequence of the action. */
  description: React.ReactNode;
  /** Label for the destructive confirm button. */
  confirmLabel: string;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Whether the confirm action is currently in flight. */
  loading?: boolean;
  /** Whether the confirm button is disabled (e.g. validation not met). */
  confirmDisabled?: boolean;
  /** Called when the user confirms the action. */
  onConfirm: () => void;
  /** Called when the user cancels (button click, backdrop, or Escape). */
  onCancel: () => void;
  /** Optional extra content rendered above the actions (e.g. a text input). */
  children?: React.ReactNode;
};

/**
 * A focused confirmation dialog for destructive actions (spaces-design §5.3).
 *
 * Used by the Space detail page for "Delete Space" and "Leave Space" — both
 * are irreversible enough that a single click should never perform them. The
 * dialog is intentionally simple: a title, a description, an optional slot for
 * extra content (such as a typed-name confirmation), and two buttons. The
 * confirm action is visually de-emphasized (subtle border, error tone) so the
 * safe path — cancel — reads as the default.
 *
 * Accessibility:
 *  - The dialog is rendered in a fixed overlay with `role="dialog"` and
 *    `aria-modal="true"`.
 *  - Focus is moved to the cancel button on open so the keyboard user lands on
 *    the safe action first.
 *  - Escape closes the dialog (unless a request is in flight).
 *  - While open, the underlying page is not scroll-locked via a library; the
 *    overlay covers the viewport and the brief interactions make a full
 *    scroll-lock unnecessary for MVP.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Move focus to the cancel button when the dialog opens. The safe action is
  // the default landing point — confirming requires a deliberate second move.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Close on Escape unless a request is in flight (avoid abandoning a
  // half-completed mutation).
  useEffect(() => {
    if (loading) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onCancel]);

  const isConfirmDisabled = loading || confirmDisabled;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={loading ? undefined : onCancel}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md rounded-2xl border border-ink/10 bg-canvas-soft p-6 shadow-2xl">
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-ink"
        >
          {title}
        </h2>

        <div
          id="confirm-dialog-description"
          className="mt-2 text-sm text-ink-muted"
        >
          {description}
        </div>

        {children && <div className="mt-4">{children}</div>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-ink/10 px-4 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            aria-busy={loading || undefined}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-error/40 bg-error-soft px-4 py-2 text-sm font-semibold text-error transition-colors duration-200 hover:bg-error/20 hover:border-error/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Spinner size={16} />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
