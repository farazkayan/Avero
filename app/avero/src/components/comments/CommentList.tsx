import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../ui/EmptyState";
import Spinner from "../ui/Spinner";
import { MoreIcon, PencilIcon, TrashIcon } from "../ui/icons";
import CommentInput from "./CommentInput";
import CommentReactionControl from "./CommentReactionControl";
import {
  MAX_COMMENT_LENGTH,
  commentAuthorName,
  deleteComment,
  fetchMemoryComments,
  formatCommentTime,
  updateComment,
} from "../../lib/comments";
import type { CommentWithAuthor } from "../../types/comment";

type CommentListProps = {
  /** The Memory whose comments should be loaded. */
  memoryId: string;
  /** The current user's id — used to (a) attribute new comments, (b) gate the
   *  edit affordance to the comment's author (comments_update = author only),
   *  and (c) gate the delete affordance to the author OR a Space owner
   *  (comments_delete = author OR owner). */
  currentUserId: string;
  /** Whether the current user is a Space owner — owners may also delete
   *  comments (mirrors the `comments_delete` RLS policy: author OR owner).
   *  Owners may NOT edit others' comments (comments_update = author only). */
  isOwner: boolean;
};

/** The two sort orders for the comment list (feature-specs §4 enhancement). */
type CommentSortOrder = "newest" | "oldest";

/**
 * The comments section for the Memory detail view (feature-specs §4).
 *
 * Renders below the media gallery. Fetches the Memory's comments on mount
 * (RLS auto-filters to Space members; the `comments_select` policy's
 * subquery against `memories` also excludes comments on soft-deleted
 * memories), shows them in the chosen sort order, and provides an input to
 * add a new comment (any Space member).
 *
 * **Sort** (feature-specs §4 enhancement): a small toggle (Newest / Oldest)
 * controls the display order. The fetch always returns chronological ASC
 * (oldest first) from the DB; the sort toggle reverses the slice client-side
 * so switching is instant with no extra round trip. "Oldest" is the default
 * (matches the original chronological behavior and the feature-specs §4
 * "Comments appear in chronological order" baseline).
 *
 * **Add:** {@link CommentInput} reports each posted comment up via `onPosted`;
 * the list appends it to local state immediately — no full page reload
 * (feature-specs §4 UI). New comments always land at the chronological end
 * of the underlying list; under "newest" sort they appear at the top.
 *
 * **⋮ overflow menu** (feature-specs §4 enhancement): replaces the old
 * single-purpose trash icon. The menu contents depend on ownership:
 *  - **Own comment** (or Space owner viewing any comment) → Edit (author
 *    only) + Delete (author OR owner).
 *  - **Others' comment** → Report.
 * "Report" is a calm, honest placeholder for MVP — it surfaces a small inline
 * notice ("Reporting isn't available yet") rather than a no-op or a broken
 * link, so the affordance is honest about its current state.
 *
 * **Edit** (feature-specs §4 enhancement): swaps the comment to an inline
 * edit mode (textarea + Save / Cancel). Save calls `updateComment` (RLS:
 * author only); on success the row is swapped in place (no reload). The
 * `comments_update` RLS policy is `user_id = auth.uid()`, so only the author
 * can edit — the menu only offers Edit on the author's own comments.
 *
 * **Delete:** clicking Delete in the ⋮ menu swaps the comment to an inline
 * two-step confirm ("Delete this comment? [Delete] [Cancel]") so a single
 * accidental click can't remove a comment — the same lightweight pattern used
 * by `MediaTile`. On confirm the row is removed optimistically; on error it
 * reverts with a calm inline message. Hard delete only (no soft-delete).
 *
 * **Comment reactions** (feature-specs §4 enhancement): each comment renders
 * a compact {@link CommentReactionControl} below its content — the same six
 * reaction types as Memory-level reactions, scoped to the comment via the
 * `comment_reactions` table.
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
  // The underlying list is always stored in chronological ASC (oldest first),
  // exactly as fetched. The sort toggle only affects the rendered order, so
  // switching is instant and the underlying order is stable across toggles.
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<CommentSortOrder>("oldest");

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

  // --- Edit state ---
  // The comment id currently in inline edit mode. Only one at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  // The comment id whose edit save is in flight (shows a "Saving…" state).
  const [savingId, setSavingId] = useState<string | null>(null);
  // A transient per-comment edit error (shown inline, then reverts).
  const [editErrorId, setEditErrorId] = useState<string | null>(null);

  // --- ⋮ menu state ---
  // The comment id whose overflow menu is open. Only one at a time.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // --- Report state ---
  // The comment id showing the "reporting isn't available yet" notice.
  const [reportNoticeId, setReportNoticeId] = useState<string | null>(null);

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

  // --- Derived: the rendered order (client-side sort, no refetch) ---

  const orderedComments = useMemo(() => {
    if (sortOrder === "oldest") {
      // Underlying list is already chronological ASC.
      return comments;
    }
    // Newest first — reverse a copy (don't mutate the source).
    return [...comments].reverse();
  }, [comments, sortOrder]);

  // --- Add handler (appends without a reload) ---

  const handlePosted = useCallback((comment: CommentWithAuthor) => {
    // Always append to the chronological end of the underlying list; the
    // rendered order is derived, so a "newest" view shows it at the top
    // automatically.
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
      setMenuOpenId(null);
    } else {
      // Show a calm error on the comment and revert to the normal state.
      setDeleteErrorId(commentId);
      setConfirmingDeleteId(null);
    }
  }, []);

  // --- Edit handler ---

  const handleSaveEdit = useCallback(
    async (commentId: string, nextContent: string) => {
      setSavingId(commentId);
      setEditErrorId(null);

      const result = await updateComment({
        commentId,
        userId: currentUserId,
        content: nextContent,
      });

      setSavingId(null);

      if (result.ok) {
        // Swap the row in place — no full reload. Preserve the underlying
        // chronological order (the comment keeps its original created_at).
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? result.comment : c)),
        );
        setEditingId(null);
      } else {
        setEditErrorId(commentId);
      }
    },
    [currentUserId],
  );

  // --- Render ---

  return (
    <section className="mt-10" aria-label="Comments">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Comments
        </h2>

        {/* Sort toggle — Newest / Oldest. Only rendered once comments are
            loaded and there's more than one (a single comment has no sort
            ambiguity). Calm, segmented control styling. */}
        {!isLoading && !loadError && comments.length > 1 && (
          <div
            className="inline-flex rounded-lg border border-ink/10 bg-canvas-soft p-0.5"
            role="group"
            aria-label="Sort comments"
          >
            <SortButton
              label="Newest"
              isActive={sortOrder === "newest"}
              onClick={() => setSortOrder("newest")}
            />
            <SortButton
              label="Oldest"
              isActive={sortOrder === "oldest"}
              onClick={() => setSortOrder("oldest")}
            />
          </div>
        )}
      </div>

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
          <div className="rounded-xl border border-ink/5 bg-canvas-soft p-4 text-center">
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
            {orderedComments.map((comment) => {
              const isOwn = comment.user_id === currentUserId;
              const canDelete = isOwn || isOwner;
              // Edit is author-only (comments_update = user_id = auth.uid()).
              const canEdit = isOwn;

              return (
                <li key={comment.id}>
                  <CommentRow
                    comment={comment}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    isOwn={isOwn}
                    currentUserId={currentUserId}
                    isMenuOpen={menuOpenId === comment.id}
                    onToggleMenu={() =>
                      setMenuOpenId((prev) =>
                        prev === comment.id ? null : comment.id,
                      )
                    }
                    onCloseMenu={() => setMenuOpenId(null)}
                    onRequestEdit={() => {
                      setMenuOpenId(null);
                      setEditingId(comment.id);
                      setEditErrorId(null);
                    }}
                    isEditing={editingId === comment.id}
                    isSaving={savingId === comment.id}
                    hasEditError={editErrorId === comment.id}
                    onSaveEdit={(next) =>
                      void handleSaveEdit(comment.id, next)
                    }
                    onCancelEdit={() => {
                      setEditingId(null);
                      setEditErrorId(null);
                    }}
                    onRequestDelete={() => {
                      setMenuOpenId(null);
                      setDeleteErrorId(null);
                      setConfirmingDeleteId(comment.id);
                    }}
                    isConfirming={confirmingDeleteId === comment.id}
                    isDeleting={deletingId === comment.id}
                    hasDeleteError={deleteErrorId === comment.id}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                    onConfirmDelete={() => void handleConfirmDelete(comment.id)}
                    onReport={() => {
                      setMenuOpenId(null);
                      setReportNoticeId(comment.id);
                    }}
                    isReportNotice={reportNoticeId === comment.id}
                    onDismissReportNotice={() => setReportNoticeId(null)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// SortButton
// ----------------------------------------------------------------------------

type SortButtonProps = {
  label: string;
  isActive: boolean;
  onClick: () => void;
};

/** A single segment of the sort toggle. */
function SortButton({ label, isActive, onClick }: SortButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={[
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
        isActive
          ? "bg-canvas text-ink shadow-sm"
          : "text-ink-muted hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// ----------------------------------------------------------------------------
// CommentRow
// ----------------------------------------------------------------------------

type CommentRowProps = {
  comment: CommentWithAuthor;
  /** Whether the current user may edit this comment (author only). */
  canEdit: boolean;
  /** Whether the current user may delete this comment (author OR owner). */
  canDelete: boolean;
  /** Whether this comment belongs to the current user (drives the ⋮ menu
   *  contents: own → Edit/Delete, others' → Report). */
  isOwn: boolean;
  /** The current user's id — passed through to the per-comment reaction
   *  control. */
  currentUserId: string;
  // ⋮ menu
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  // Edit
  onRequestEdit: () => void;
  isEditing: boolean;
  isSaving: boolean;
  hasEditError: boolean;
  onSaveEdit: (nextContent: string) => void;
  onCancelEdit: () => void;
  // Delete
  onRequestDelete: () => void;
  isConfirming: boolean;
  isDeleting: boolean;
  hasDeleteError: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  // Report
  onReport: () => void;
  isReportNotice: boolean;
  onDismissReportNotice: () => void;
};

/**
 * A single comment row. Renders the author name (medium weight), the content
 * (preserving line breaks via `whitespace-pre-line`), a relative timestamp,
 * a ⋮ overflow menu, and a compact per-comment reaction control.
 *
 * **⋮ menu** (feature-specs §4 enhancement): appears on hover/focus (calm,
 * not always-visible, per Design System §6/§8). Contents:
 *  - Own comment → Edit (if canEdit) + Delete (if canDelete).
 *  - Others' comment → Report.
 * The menu closes on Escape, outside-click, or after any action is chosen.
 *
 * **Edit mode**: swaps the content for a textarea + Save / Cancel. Save is
 * disabled while the content is empty/unchanged/over-limit or while saving.
 *
 * **Delete**: an inline two-step confirm (lighter than a full-screen
 * ConfirmDialog), mirroring MediaTile. A transient delete error is shown
 * inline and reverts to the normal state.
 *
 * **Report**: a calm, honest placeholder for MVP — shows a small inline
 * notice ("Reporting isn't available yet") with a Dismiss link, rather than
 * a no-op or a broken link.
 */
function CommentRow({
  comment,
  canEdit,
  canDelete,
  isOwn,
  currentUserId,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onRequestEdit,
  isEditing,
  isSaving,
  hasEditError,
  onSaveEdit,
  onCancelEdit,
  onRequestDelete,
  isConfirming,
  isDeleting,
  hasDeleteError,
  onCancelDelete,
  onConfirmDelete,
  onReport,
  isReportNotice,
  onDismissReportNotice,
}: CommentRowProps) {
  // The ⋮ menu is always offered: own comments get Edit/Delete, others'
  // comments get Report. (There is no comment that offers neither.)
  const hasMenu = true;

  return (
    <div className="group rounded-xl border border-ink/5 bg-canvas-soft p-4 transition-colors duration-200 hover:border-ink/10 focus-within:border-ink/10">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-medium text-ink">
            {commentAuthorName(comment)}
          </span>
          <span className="text-xs text-ink-muted">
            {formatCommentTime(comment.created_at)}
          </span>
          {/* "edited" indicator — shown when updated_at is later than
              created_at (the trigger bumps updated_at on edit). */}
          {comment.updated_at !== comment.created_at && (
            <span className="text-xs text-ink-disabled">(edited)</span>
          )}
        </div>

        {/* ⋮ overflow menu — appears on hover/focus (calm, per Design
            System §6/§8). Hidden while editing or confirming/recovering
            from a delete so the row stays focused on the active flow. */}
        {hasMenu && !isEditing && !isConfirming && !hasDeleteError && (
          <CommentMenu
            isOpen={isMenuOpen}
            canEdit={canEdit}
            canDelete={canDelete}
            isOwn={isOwn}
            onToggle={onToggleMenu}
            onClose={onCloseMenu}
            onRequestEdit={onRequestEdit}
            onRequestDelete={onRequestDelete}
            onReport={onReport}
          />
        )}
      </div>

      {/* Content — preserve the author's line breaks. In edit mode, swap to
          an inline editor. */}
      {isEditing ? (
        <CommentEditor
          initialContent={comment.content}
          isSaving={isSaving}
          hasError={hasEditError}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">
          {comment.content}
        </p>
      )}

      {/* Inline two-step delete confirm — a deliberate second action prevents
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

      {/* Report notice — calm, honest placeholder for MVP. */}
      {isReportNotice && (
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="mr-auto text-xs text-ink-muted">
            Reporting isn't available yet.
          </span>
          <button
            type="button"
            onClick={onDismissReportNotice}
            className="rounded-md text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Per-comment reactions — compact control below the content. Hidden
          while editing/confirming so the row stays focused on the active
          flow. */}
      {!isEditing && !isConfirming && !hasDeleteError && (
        <div className="mt-3">
          <CommentReactionControl
            commentId={comment.id}
            currentUserId={currentUserId}
          />
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// CommentMenu (⋮ overflow)
// ----------------------------------------------------------------------------

type CommentMenuProps = {
  isOpen: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isOwn: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRequestEdit: () => void;
  onRequestDelete: () => void;
  onReport: () => void;
};

/**
 * The ⋮ overflow menu for a comment. A small trigger button (appearing on
 * hover/focus) opens a dropdown whose contents depend on ownership:
 *  - Own comment → Edit (if canEdit) + Delete (if canDelete).
 *  - Others' comment → Report.
 *
 * Closes on Escape, outside-click, or after an action is chosen. Positioned
 * absolutely under the trigger.
 */
function CommentMenu({
  isOpen,
  canEdit,
  canDelete,
  isOwn,
  onToggle,
  onClose,
  onRequestEdit,
  onRequestDelete,
  onReport,
}: CommentMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on Escape and on outside-click.
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        // Return focus to the trigger for keyboard users.
        triggerRef.current?.focus();
      }
    }
    function handlePointerDown(event: MouseEvent) {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        trigger &&
        !trigger.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-label="Comment actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity duration-200 hover:text-ink focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 group-hover:opacity-100"
      >
        <MoreIcon />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Comment actions"
          className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-ink/10 bg-canvas py-1 shadow-lg"
        >
          {isOwn ? (
            <>
              {canEdit && (
                <MenuItem
                  icon={<PencilIcon />}
                  label="Edit"
                  onClick={onRequestEdit}
                />
              )}
              {canDelete && (
                <MenuItem
                  icon={<TrashIcon />}
                  label="Delete"
                  danger
                  onClick={onRequestDelete}
                />
              )}
            </>
          ) : (
            <MenuItem label="Report" onClick={onReport} />
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// MenuItem
// ----------------------------------------------------------------------------

type MenuItemProps = {
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
};

/** A single item in the ⋮ overflow menu. */
function MenuItem({ icon, label, danger, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
        "transition-colors duration-150",
        "focus:outline-none focus-visible:bg-canvas-soft",
        danger
          ? "text-error hover:bg-error/10"
          : "text-ink hover:bg-canvas-soft",
      ].join(" ")}
    >
      {icon && (
        <span className="flex h-4 w-4 items-center justify-center">
          {icon}
        </span>
      )}
      {label}
    </button>
  );
}

// ----------------------------------------------------------------------------
// CommentEditor (inline edit mode)
// ----------------------------------------------------------------------------

type CommentEditorProps = {
  initialContent: string;
  isSaving: boolean;
  hasError: boolean;
  onSave: (nextContent: string) => void;
  onCancel: () => void;
};

/**
 * The inline editor shown when a comment is in edit mode. A textarea
 * pre-filled with the current content, plus Save / Cancel. Save is disabled
 * while the content is empty, unchanged, over the limit, or while saving.
 * Mirrors the CommentInput styling (border, accent focus ring).
 */
function CommentEditor({
  initialContent,
  isSaving,
  hasError,
  onSave,
  onCancel,
}: CommentEditorProps) {
  const [draft, setDraft] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea on mount and select all so the user can immediately
  // retype or edit. Runs once per edit session.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  }, []);

  const trimmed = draft.trim();
  const isUnchanged = trimmed === initialContent.trim();
  const isOverLimit = draft.length > MAX_COMMENT_LENGTH;
  const canSave = trimmed.length > 0 && !isUnchanged && !isOverLimit;

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter saves; plain Enter inserts a newline.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (canSave && !isSaving) {
        onSave(trimmed);
      }
    }
    // Escape cancels the edit (restores the original).
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  const remaining = MAX_COMMENT_LENGTH - draft.length;

  return (
    <div className="mt-1.5">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isSaving}
        rows={3}
        aria-label="Edit comment"
        className={[
          "w-full resize-y rounded-lg border bg-canvas px-3.5 py-2.5",
          "text-sm text-ink",
          "transition-colors duration-200",
          "focus:outline-none focus:ring-2 focus:ring-accent-500/60 focus:border-accent-500",
          isOverLimit
            ? "border-error/60 focus:border-error focus:ring-error/30"
            : "border-ink/10 hover:border-ink/20",
          "disabled:opacity-60",
        ].join(" ")}
      />

      <div className="mt-2 flex items-center justify-end gap-3">
        <div className="min-w-0 flex-1">
          {hasError ? (
            <p className="text-sm text-error">Couldn't save. Try again.</p>
          ) : isOverLimit ? (
            <p className="text-sm text-error">
              Comments are limited to {MAX_COMMENT_LENGTH} characters.
            </p>
          ) : (
            <p className="text-sm text-transparent" aria-hidden="true">
              .
            </p>
          )}
        </div>

        {draft.length > 0 && (
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
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(trimmed)}
          disabled={!canSave || isSaving}
          className="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-600"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
