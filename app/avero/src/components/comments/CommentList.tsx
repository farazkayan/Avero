import { useCallback, useEffect, useState } from "react";
import EmptyState from "../ui/EmptyState";
import Spinner from "../ui/Spinner";
import { TrashIcon } from "../ui/icons";
import CommentInput from "./CommentInput";
import {
  commentAuthorName,
  deleteComment,
  fetchMemoryComments,
  formatCommentTime,
} from "../../lib/comments";
import type { CommentWithAuthor } from "../../types/comment";

type CommentListProps = {
  /** The Memory whose comments should be loaded. */
  memoryId: string;
  /** The current user's id — used to (a) attribute new comments and (b) gate
   *  the delete affordance to the comment's author. */
  currentUserId: string;
  /** Whether the current user is a Space owner — owners may also delete
   *  comments (mirrors the `comments_delete` RLS policy: author OR owner). */
  isOwner: boolean;
};

/**
 * The comments section for the Memory detail view (feature-specs §4).
 *
 * Renders below the media gallery. Fetches the Memory's comments on mount
 * (RLS auto-filters to Space members; the `comments_select` policy's
 * subquery against `memories` also excludes comments on soft-deleted
 * memories), shows them in chronological order, and provides an input to add
 * a new comment (any Space member).
 *
 * **Add:** {@link CommentInput} reports each posted comment up via `onPosted`;
 * the list appends it to local state immediately — no full page reload
 * (feature-specs §4 UI). New comments appear at the bottom (chronological
 * ascending).
 *
 * **Delete:** a trash affordance appears on hover/focus over comments the
 * current user may delete — the **author OR a Space owner**, matching the
 * `comments_delete` RLS policy and the media-delete precedent. Clicking it
 * swaps the comment to an inline two-step confirm ("Delete this comment?
 * [Delete] [Cancel]") so a single accidental click can't remove a comment —
 * the same lightweight pattern used by `MediaTile`. On confirm the row is
 * removed optimistically; on error it reverts with a calm inline message.
 *
 * States mirror `MediaGallery`: a loading skeleton while fetching, a calm
 * load-error box, and a calm empty state ("No comments yet") when the Memory
 * has no comments.
 */
export default function CommentList({
  memoryId,
  currentUserId,
  isOwner,
}: CommentListProps) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // --- Delete state ---
  // The comment id currently in the inline confirm state. Only one comment
  // can be confirming at a time (same constraint as MediaGallery's tiles).
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  // The comment id whose delete is in flight (shows a "Deleting…" state).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // A transient per-comment delete error (shown inline, then reverts).
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);

  // --- Fetch comments ---

  useEffect(() => {
    if (!memoryId) {
      // React Router guarantees :memoryId on this route; this guard only
      // satisfies the type system and must not setState synchronously.
      return;
    }

    let cancelled = false;

    async function fetchComments(id: string) {
      setIsLoading(true);
      setLoadError(undefined);

      try {
        const rows = await fetchMemoryComments(id);

        if (cancelled) return;

        setComments(rows);
      } catch {
        if (cancelled) return;
        setLoadError("We couldn't load the comments for this Memory.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchComments(memoryId);

    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  // --- Add handler (appends without a reload) ---

  const handlePosted = useCallback((comment: CommentWithAuthor) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  // --- Delete handler ---

  const handleConfirmDelete = useCallback(async (commentId: string) => {
    setDeletingId(commentId);
    setDeleteErrorId(null);

    const result = await deleteComment(commentId);

    setDeletingId(null);

    if (result.ok) {
      // Remove the row optimistically — no full reload.
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setConfirmingDeleteId(null);
    } else {
      // Show a calm error on the comment and revert to the normal state.
      setDeleteErrorId(commentId);
      setConfirmingDeleteId(null);
    }
  }, []);

  // --- Render ---

  return (
    <section className="mt-10" aria-label="Comments">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Comments
      </h2>

      {/* Add a comment — any Space member (the page is already member-gated
          by RLS, so if you can see the Memory you can comment). Rendered
          above the list so it's always reachable. */}
      <div className="mt-4">
        <CommentInput
          memoryId={memoryId}
          userId={currentUserId}
          onPosted={handlePosted}
        />
      </div>

      {/* Comments list */}
      <div className="mt-6">
        {isLoading ? (
          <div
            className="flex items-center justify-center py-8 text-accent-400"
            role="status"
            aria-live="polite"
          >
            <Spinner size={22} />
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-white/5 bg-canvas-soft p-4 text-center">
            <p className="text-sm text-error">{loadError}</p>
          </div>
        ) : comments.length === 0 ? (
          <EmptyState
            title="No comments yet"
            titleAs="h2"
            description="Be the first to add to this memory — a thought, a detail, a moment only you remember."
          />
        ) : (
          <ul className="space-y-4">
            {comments.map((comment) => (
              <li key={comment.id}>
                <CommentRow
                  comment={comment}
                  canDelete={
                    comment.user_id === currentUserId || isOwner
                  }
                  isConfirming={confirmingDeleteId === comment.id}
                  isDeleting={deletingId === comment.id}
                  hasDeleteError={deleteErrorId === comment.id}
                  onRequestDelete={() => {
                    setDeleteErrorId(null);
                    setConfirmingDeleteId(comment.id);
                  }}
                  onCancelDelete={() => setConfirmingDeleteId(null)}
                  onConfirmDelete={() => void handleConfirmDelete(comment.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// CommentRow
// ----------------------------------------------------------------------------

type CommentRowProps = {
  comment: CommentWithAuthor;
  canDelete: boolean;
  isConfirming: boolean;
  isDeleting: boolean;
  hasDeleteError: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

/**
 * A single comment row. Renders the author name (medium weight), the content
 * (preserving line breaks via `whitespace-pre-line`), and a relative
 * timestamp.
 *
 * When `canDelete` is true (author OR Space owner), a trash icon appears on
 * hover/focus (calm, not always-visible, per Design System §6/§8) — mirroring
 * `MediaTile`. Clicking it swaps the row to an inline two-step confirm so a
 * single accidental click can't remove a comment. A transient delete error is
 * shown inline and reverts to the normal state.
 */
function CommentRow({
  comment,
  canDelete,
  isConfirming,
  isDeleting,
  hasDeleteError,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: CommentRowProps) {
  return (
    <div className="group rounded-xl border border-white/5 bg-canvas-soft p-4 transition-colors duration-200 hover:border-white/10 focus-within:border-white/10">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-medium text-ink">
            {commentAuthorName(comment)}
          </span>
          <span className="text-xs text-ink-muted">
            {formatCommentTime(comment.created_at)}
          </span>
        </div>

        {/* Delete affordance — appears on hover/focus (calm, per Design
            System §6/§8). Only rendered when canDelete (author OR owner). */}
        {canDelete && !isConfirming && !hasDeleteError && (
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label="Delete this comment"
            className="flex shrink-0 h-8 w-8 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity duration-200 hover:text-error focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 group-hover:opacity-100"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* Content — preserve the author's line breaks. */}
      <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">
        {comment.content}
      </p>

      {/* Inline two-step confirm — a deliberate second action prevents
          accidental deletion (lighter than a full-screen ConfirmDialog),
          mirroring MediaTile. */}
      {isConfirming && (
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="mr-auto text-sm text-ink-muted">
            Delete this comment?
          </span>
          <button
            type="button"
            onClick={onCancelDelete}
            disabled={isDeleting}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            disabled={isDeleting}
            className="rounded-md bg-error px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-error/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/60 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}

      {/* Transient delete error — shown inline, reverts to normal state. */}
      {hasDeleteError && (
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="mr-auto text-xs text-error">
            Couldn't delete. Try again.
          </span>
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-md text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
