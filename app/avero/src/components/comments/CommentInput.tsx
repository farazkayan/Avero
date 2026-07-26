import { useId, useState } from "react";
import { MAX_COMMENT_LENGTH, addComment } from "../../lib/comments";
import type { CommentWithAuthor } from "../../types/comment";

type CommentInputProps = {
  /** The Memory being commented on. */
  memoryId: string;
  /** The current user's id — set on the insert row (RLS enforces
   *  `user_id = auth.uid()`). */
  userId: string;
  /** Called when a comment is posted successfully, with the new row (author
   *  name already resolved) so the parent can append it without a refetch. */
  onPosted: (comment: CommentWithAuthor) => void;
};

/**
 * The "add a comment" control for the Memory detail page (feature-specs §4).
 *
 * A textarea + submit, visible to any Space member. The page is already
 * member-gated by RLS (if you can see the Memory you can comment), so no
 * extra permission check is needed here — the `comments_insert` RLS policy
 * is the real gate.
 *
 * Submit calls {@link addComment}; on success the new comment is reported up
 * via `onPosted` so the list appends it immediately (no full page reload).
 * The control is disabled while submitting and shows a calm inline error on
 * failure. The textarea clears on success.
 *
 * Keyboard: Cmd/Ctrl+Enter submits (so plain Enter keeps its newline meaning
 * in a textarea — no accidental submits). The submit button is the primary
 * affordance.
 *
 * Styling mirrors `TextField` (border, accent focus ring) and the
 * "Create Memory" link button (accent-600 fill) so the control reads as part
 * of the same set (Design System §6).
 */
export default function CommentInput({
  memoryId,
  userId,
  onPosted,
}: CommentInputProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const textareaId = useId();

  const trimmed = content.trim();
  const isValid = trimmed.length > 0 && trimmed.length <= MAX_COMMENT_LENGTH;
  const isOverLimit = content.length > MAX_COMMENT_LENGTH;

  async function handleSubmit() {
    if (!isValid || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    const result = await addComment({
      memoryId,
      userId,
      content: trimmed,
    });

    setIsSubmitting(false);

    if (result.ok) {
      setContent("");
      onPosted(result.comment);
    } else {
      setError(result.error);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter submits; plain Enter inserts a newline (textarea default).
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSubmit();
    }
  }

  const remaining = MAX_COMMENT_LENGTH - content.length;

  return (
    <div>
      <label htmlFor={textareaId} className="sr-only">
        Add a comment
      </label>
      <textarea
        id={textareaId}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          if (error) {
            setError(undefined);
          }
        }}
        onKeyDown={handleKeyDown}
        disabled={isSubmitting}
        rows={3}
        placeholder="Add a comment…"
        aria-invalid={isOverLimit || undefined}
        aria-describedby={
          error || isOverLimit ? `${textareaId}-describe` : undefined
        }
        className={[
          "w-full resize-y rounded-lg border bg-canvas px-3.5 py-2.5",
          "text-base text-ink placeholder:text-ink-disabled",
          "transition-colors duration-200",
          "focus:outline-none focus:ring-2 focus:ring-accent-500/60 focus:border-accent-500",
          isOverLimit
            ? "border-error/60 focus:border-error focus:ring-error/30"
            : "border-white/10 hover:border-white/20",
          "disabled:opacity-60",
        ].join(" ")}
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {error ? (
            <p id={`${textareaId}-describe`} className="text-sm text-error">
              {error}
            </p>
          ) : isOverLimit ? (
            <p id={`${textareaId}-describe`} className="text-sm text-error">
              Comments are limited to {MAX_COMMENT_LENGTH} characters.
            </p>
          ) : (
            // Reserve the line so the button never shifts when an error appears.
            <p className="text-sm text-transparent" aria-hidden="true">
              .
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {content.length > 0 && (
            <span
              className={`text-xs ${
                remaining < 0 ? "text-error" : "text-ink-muted"
              }`}
              aria-hidden="true"
            >
              {remaining}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!isValid || isSubmitting}
            aria-busy={isSubmitting || undefined}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-lg",
              "px-4 py-2 text-sm font-semibold text-white",
              "bg-accent-600 transition-colors duration-200",
              "hover:bg-accent-500 active:bg-accent-700",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-accent-600 disabled:active:bg-accent-600",
            ].join(" ")}
          >
            {isSubmitting ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
