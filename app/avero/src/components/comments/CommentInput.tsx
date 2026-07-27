import { useEffect, useId, useRef, useState } from "react";
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
 * A curated set of emoji offered in the comment composer's emoji picker
 * (feature-specs §4 comments enhancement).
 *
 * Kept small and calm (Design System §1: "never feel noisy, overwhelming, or
 * addictive") — a focused palette of commonly-used emoji rather than the full
 * Unicode catalog. Grouped loosely by intent (faces, hearts, hands, misc) so
 * the picker reads at a glance. The emoji are inserted as literal characters
 * into the comment text (the `content` column is `text` and stores them
 * fine); they are NOT reaction types (reactions use stable text enum strings).
 */
const EMOJI_PALETTE: readonly string[] = [
  "😀", "😄", "😍", "🥰", "😎", "🤔", "😅", "🙂",
  "😢", "😭", "😮", "😱", "🥹", "😂", "🤣", "😴",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
  "👍", "👎", "👏", "🙌", "🙏", "🤝", "✌️", "🤞",
  "🔥", "✨", "🎉", "🎊", "💯", "⭐", "🌟", "💫",
  "☀️", "🌈", "🌸", "🌺", "🍃", "🌊", "🏔️", "🏕️",
] as const;

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
 * **Emoji picker** (feature-specs §4 enhancement): a small smiley button
 * toggles a compact palette of curated emoji. Clicking an emoji inserts it
 * at the cursor position in the textarea (not just appended to the end), so
 * the user can place it mid-sentence. The palette closes after each pick
 * (calm — no lingering popover) and on Escape / outside-click.
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
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

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
    // Escape closes the emoji palette if open (plain Enter still inserts a
    // newline — Escape on a textarea doesn't have a default to prevent).
    if (event.key === "Escape" && isEmojiOpen) {
      setIsEmojiOpen(false);
    }
  }

  /**
   * Inserts an emoji at the current cursor position in the textarea (not just
   * appended to the end), so the user can place it mid-sentence. Restores the
   * selection right after the inserted emoji and refocuses the textarea.
   */
  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      // Fallback: append if we somehow lost the ref.
      setContent((prev) => prev + emoji);
      setIsEmojiOpen(false);
      return;
    }

    const start = textarea.selectionStart ?? content.length;
    const end = textarea.selectionEnd ?? content.length;
    const next = content.slice(0, start) + emoji + content.slice(end);
    setContent(next);
    setIsEmojiOpen(false);

    // Restore focus + place the caret right after the inserted emoji on the
    // next tick (after React re-renders the new value).
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  /**
   * Toggles the emoji palette, closing it when clicking outside the palette
   * or its trigger button. Uses a lightweight document listener while open.
   */
  function handleEmojiToggle() {
    setIsEmojiOpen((prev) => !prev);
  }

  const remaining = MAX_COMMENT_LENGTH - content.length;

  return (
    <div>
      <label htmlFor={textareaId} className="sr-only">
        Add a comment
      </label>
      <textarea
        ref={textareaRef}
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
            : "border-ink/10 hover:border-ink/20",
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

          {/* Emoji picker trigger — a small smiley button. Toggles a compact
              palette of curated emoji (calm, not the full Unicode catalog). */}
          <div className="relative">
            <button
              ref={emojiButtonRef}
              type="button"
              onClick={handleEmojiToggle}
              disabled={isSubmitting}
              aria-label="Insert emoji"
              aria-expanded={isEmojiOpen}
              aria-haspopup="dialog"
              className={[
                "flex h-9 w-9 items-center justify-center rounded-lg",
                "text-lg leading-none transition-colors duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
                isEmojiOpen
                  ? "bg-accent-soft text-ink"
                  : "text-ink-muted hover:bg-canvas-soft hover:text-ink",
                "disabled:cursor-not-allowed disabled:opacity-60",
              ].join(" ")}
            >
              <span aria-hidden="true">😊</span>
            </button>

            {isEmojiOpen && (
              <EmojiPalette
                onPick={insertEmoji}
                onClose={() => setIsEmojiOpen(false)}
                triggerRef={emojiButtonRef}
              />
            )}
          </div>

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

// ----------------------------------------------------------------------------
// EmojiPalette
// ----------------------------------------------------------------------------

type EmojiPaletteProps = {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** The trigger button ref, used to ignore its own click when detecting
   *  outside-clicks (the toggle handler already closes the palette). */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

/**
 * The compact emoji palette popover for the comment composer. Renders the
 * curated {@link EMOJI_PALETTE} in a small grid. Closes on pick, on Escape
 * (handled by the parent's keydown), or on a click outside the palette /
 * trigger.
 *
 * Positioned absolutely under the trigger. Kept deliberately small (calm) —
 * a focused palette, not a searchable catalog.
 */
function EmojiPalette({ onPick, onClose, triggerRef }: EmojiPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null);

  // Close on outside-click (ignoring the trigger button itself, which toggles).
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const palette = paletteRef.current;
      const trigger = triggerRef.current;
      if (
        palette &&
        !palette.contains(event.target as Node) &&
        trigger &&
        !trigger.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose, triggerRef]);

  return (
    <div
      ref={paletteRef}
      role="dialog"
      aria-label="Emoji picker"
      className={[
        "absolute right-0 top-full z-20 mt-1",
        "w-64 rounded-xl border border-ink/10 bg-canvas p-2 shadow-lg",
        "grid grid-cols-8 gap-0.5",
      ].join(" ")}
    >
      {EMOJI_PALETTE.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          className={[
            "flex h-8 w-8 items-center justify-center rounded-md",
            "text-lg leading-none transition-colors duration-150",
            "hover:bg-canvas-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
          ].join(" ")}
          aria-label={`Insert ${emoji}`}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}
