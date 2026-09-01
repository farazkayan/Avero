import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import GhostLink from "../components/ui/GhostLink";
import Spinner from "../components/ui/Spinner";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import MediaGallery from "../components/media/MediaGallery";
import CommentList from "../components/comments/CommentList";
import ReactionBar from "../components/reactions/ReactionBar";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { deleteMemory } from "../lib/memories";
import {
  AUTHENTICATED_HOME_PATH,
  memoryEditPath,
  spaceDetailPath,
} from "../constants/routes";
import type { Memory, MemoryType } from "../types/memory";
import type { SpaceMember } from "../types/space";
import type { Tag } from "../types/tag";
import { fetchMemoryTags } from "../lib/tags";

/**
 * Friendly display labels for each {@link MemoryType}, keyed by the stored
 * snake_case value. Mirrors the labels used on the timeline and the create
 * screen so every Memories screen always agrees on how a type is shown.
 */
const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  trip: "Trip",
  milestone: "Milestone",
  hangout: "Hangout",
  celebration: "Celebration",
  adventure: "Adventure",
  side_quest: "Side Quest",
};

/**
 * Memory detail view (feature-specs §2).
 *
 * Route: `/spaces/:spaceId/memories/:memoryId`
 *
 * Fetches a single Memory row by id and renders its text content — title,
 * formatted memory_date, location (if present), and description — followed by
 * a media gallery ({@link MediaGallery}) of the Memory's photos and videos.
 * The gallery fetches the Memory's `media` rows and requests a short-lived
 * presigned GET URL for each from the `media-storage` Edge Function, mirroring
 * the upload auth pattern. If the Memory has no media, the gallery renders
 * nothing and only the text content is shown (Task 1 contract preserved).
 *
 * Access control follows the same pattern as {@link SpaceDetailPage}:
 * `ProtectedRoute` gates authentication, and RLS gates Space membership. A
 * non-member (or a request for a non-existent Memory) receives no rows from
 * the query, which resolves to a calm "not found or no access" state rather
 * than a raw error (spaces-design §8 — "RLS will naturally return nothing for
 * unauthorized access").
 *
 * The query explicitly filters `deleted_at IS NULL` (database §6 soft-delete)
 * so soft-deleted memories are never shown, even though the `memories_select`
 * RLS policy already excludes them — defense-in-depth so the intent is visible
 * at the query site.
 */
export default function MemoryDetailPage() {
  const { spaceId, memoryId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [memory, setMemory] = useState<Memory | null>(null);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Delete dialog (creator OR Space owner — mirrors the Edit gate and the
  // memories_delete RLS policy). Deleting a Memory is a destructive,
  // irreversible action (feature-specs §4 establishes the "no soft delete for
  // MVP" precedent for comments; Memories follow the same hard-delete model),
  // so it requires a confirmation step before the delete runs — no accidental
  // single-tap deletes.
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(
    undefined
  );

  useEffect(() => {
    if (!memoryId) {
      // React Router guarantees :memoryId is present when this page mounts
      // (the route only matches /spaces/:spaceId/memories/:memoryId). This
      // guard only satisfies the type system. It must not call setState
      // synchronously (react-hooks/set-state-in-effect), and since the branch
      // is unreachable in practice, leaving the initial loading state is fine.
      return;
    }

    let cancelled = false;

    async function fetchMemory(id: string) {
      setIsLoading(true);
      setNotFound(false);
      setLoadError(undefined);

      try {
        const { data, error } = await supabase
          .from("memories")
          .select("*")
          .eq("id", id)
          // Respect soft-delete (database §6). The memories_select RLS policy
          // already excludes rows with a non-null deleted_at, but filtering
          // here makes the intent explicit at the query site.
          .is("deleted_at", null)
          .maybeSingle();

        if (cancelled) {
          return;
        }

        // A PostgREST error here is either a malformed id (treated as "not
        // found") or a real failure (treated as "try again"). RLS returning no
        // rows resolves to null data with no error, which is the normal "not a
        // member / doesn't exist" path.
        if (error) {
          if (error.code === "22P02") {
            // invalid_text_representation — not a valid UUID
            setNotFound(true);
          } else {
            setLoadError("We couldn't load this Memory. Please try again.");
          }
          return;
        }

        if (!data) {
          // RLS returned no rows — the Memory doesn't exist, was soft-deleted,
          // or the user isn't a member of its Space. All resolve to the same
          // calm state.
          setNotFound(true);
          return;
        }

        setMemory(data as Memory);

        // Fetch the Memory's tags for display (feature-specs §6). A failure
        // here is non-fatal — the detail page still renders; it just shows no
        // tags. RLS on memory_tags/tags ensures only Space members receive
        // rows; a non-member gets an empty result.
        try {
          const memoryTags = await fetchMemoryTags(id);
          if (!cancelled) {
            setTags(memoryTags);
          }
        } catch {
          // Non-fatal: leave tags empty.
        }
      } catch {
        if (cancelled) {
          return;
        }
        setLoadError("We couldn't load this Memory. Please try again.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchMemory(memoryId);

    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  // Fetch the Space's members to determine whether the current user may edit
  // this Memory. The `memories_update` RLS policy is `is_space_owner(space_id)
  // OR created_by = auth.uid()`, so the "Edit" entry point is shown only to the
  // Memory's creator or a Space owner — mirroring the role-based permission
  // pattern used by Space settings/delete (spaces-design §6.3). The member
  // lookup is only needed when the user is not already the creator (the fast
  // path), and is fetched once the Memory is known. A failure here is
  // non-fatal: the page still renders, just without the Edit button.
  useEffect(() => {
    if (!memory || !user || !spaceId) {
      return;
    }

    // Fast path: the current user is the creator — no member lookup needed.
    if (memory.created_by === user.id) {
      return;
    }

    let cancelled = false;

    async function fetchMembers() {
      // Minimal select: we only need (user_id, role) to determine if the
      // current user is a Space owner (M-21 — avoid fetching every column
      // of every member just to find one row).
      const { data } = await supabase
        .from("space_members")
        .select("user_id, role")
        .eq("space_id", spaceId!);

      if (cancelled) {
        return;
      }

      setMembers(((data ?? []) as SpaceMember[]));
    }

    void fetchMembers();

    return () => {
      cancelled = true;
    };
  }, [memory, user, spaceId]);

  const isCreator = user !== null && memory !== null && memory.created_by === user.id;
  const isOwner =
    user !== null &&
    members.some((m) => m.user_id === user.id && m.role === "owner");
  const canEdit = isCreator || isOwner;

  /**
   * Deletes the Memory (feature-specs §2, database §6 + §13).
   *
   * Delegates to `deleteMemory()` (lib/memories.ts), which deletes all
   * attached media first — via `deleteMedia()`, which removes each media row
   * AND its B2 original + thumbnail objects — then deletes the Memory row
   * itself. The DB cascade handles comments, reactions, and memory_tags
   * automatically (all `ON DELETE CASCADE` on `memory_id`).
   *
   * On success, navigates back to the Space timeline (NOT back to the
   * now-deleted Memory). On failure, surfaces a clear error inside the
   * confirm dialog so the user never thinks it succeeded when it didn't.
   */
  async function handleDelete() {
    if (!memoryId || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(undefined);

    try {
      const result = await deleteMemory(memoryId);

      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }

      // Success — the Memory and all its dependent rows are gone. Navigate
      // back to the Space timeline (not the now-deleted Memory detail). Use
      // `replace: true` so the back button doesn't return to the deleted
      // Memory. Fall back to the Spaces dashboard if spaceId is somehow
      // absent (defensive — the route guarantees it).
      navigate(
        spaceId ? spaceDetailPath(spaceId) : AUTHENTICATED_HOME_PATH,
        { replace: true },
      );
    } catch {
      // deleteMemory never throws, but guard against an unexpected error so
      // the user is never left with a stuck loading state.
      setDeleteError("We couldn't delete this Memory. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  /**
   * Closes the delete dialog. Disabled while a delete is in flight so the
   * user can't abandon a half-completed mutation (mirrors the Space settings
   * delete dialog pattern). Clears the error on close so a retried delete
   * starts fresh.
   */
  function closeDeleteDialog() {
    if (isDeleting) {
      return;
    }
    setDeleteError(undefined);
    setIsDeleteDialogOpen(false);
  }

  return (
    <>
      <div className="mb-6">
        {spaceId ? (
          <GhostLink to={spaceDetailPath(spaceId)}>Back to Space</GhostLink>
        ) : (
          <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
        )}
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-24 text-accent-400"
          role="status"
          aria-live="polite"
        >
          <Spinner size={28} />
        </div>
      ) : notFound ? (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
            Memory not found
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-ink-muted sm:text-base">
            This Memory may have been deleted, or you may not have access to it.
          </p>
          <div className="mt-8">
            {spaceId ? (
              <GhostLink to={spaceDetailPath(spaceId)}>Back to Space</GhostLink>
            ) : (
              <GhostLink to={AUTHENTICATED_HOME_PATH}>Back to Spaces</GhostLink>
            )}
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      ) : memory ? (
        <article>
          {/* Header — title, type badge, formatted date, and location.
               "Edit" and "Delete" actions are shown only to authorized users
               (the Memory's creator or a Space owner), mirroring the
               role-based permission pattern used by Space settings/delete
               (spaces-design §6.3) and the `memories_update` /
               `memories_delete` RLS policies (both: creator OR owner). Delete
               is a destructive, irreversible action, so it opens a confirm
               dialog rather than acting on a single tap. */}
          <header>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="break-words text-2xl font-bold leading-tight text-ink sm:text-3xl">
                  {memory.title}
                </h1>
                {memory.memory_type && (
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-400">
                    {formatMemoryType(memory.memory_type)}
                  </span>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-4">
                  {spaceId && (
                    <Link
                      to={memoryEditPath(spaceId, memory.id)}
                      className="inline-flex items-center rounded-md text-sm font-medium text-ink-muted transition-colors duration-200 hover:text-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                    >
                      Edit
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(undefined);
                      setIsDeleteDialogOpen(true);
                    }}
                    className="inline-flex items-center rounded-md text-sm font-medium text-ink-muted transition-colors duration-200 hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {formatMemoryDate(memory.memory_date)}
            </p>
            {memory.location && (
              <p className="mt-1 text-sm text-ink-muted">{memory.location}</p>
            )}

            {/* Tags — small pill/chip badges (feature-specs §6). Styled as a
                muted sibling of the memory_type badge above: same rounded-full
                pill family, but bg-canvas-raised/text-ink-muted to read as
                secondary (plural, organizational) rather than the primary
                accent type badge. Sorted alphabetically by fetchMemoryTags. */}
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-canvas-raised px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </header>

          {/* Description — the story behind the Memory */}
          {memory.description && (
            <section className="mt-6">
              <p className="whitespace-pre-line text-sm text-ink-muted sm:text-base">
                {memory.description}
              </p>
            </section>
          )}

          {/* Media gallery — photos & videos attached to this Memory
              (feature-specs §3). Any Space member can add media; the per-tile
              delete affordance is gated to the creator or a Space owner
              (`canDelete`). Renders the add control alone when the Memory has no
              media (for members), or nothing for non-add contexts. */}
          <MediaGallery
            memoryId={memory.id}
            spaceId={spaceId!}
            canUpload={true}
            canDelete={canEdit}
          />

          {/* Reactions — quick emotional validation of this Memory
              (feature-specs §5). A row of the six reaction emoji above the
              comments section, visually distinct (a horizontal pill row vs.
              the vertical comment list). Any Space member can react, once per
              type per Memory (the `uq_reactions_memory_user_type` UNIQUE
              constraint enforces this); clicking toggles add/remove with no
              confirm dialog (low-stakes, instantly reversible). Refresh-based,
              not realtime — the acting user's own action updates local state
              immediately (same no-reload pattern as Comments/Media); other
              users' reactions appear after a page reload (database §14: "No
              real-time systems needed yet"). The page is already member-gated
              by RLS, so `user` is present here; the `reactions_*` policies
              re-check membership at the database. */}
          {user && (
            <ReactionBar
              memoryId={memory.id}
              currentUserId={user.id}
            />
          )}

          {/* Comments — shared context and storytelling for this Memory
              (feature-specs §4). Any Space member can comment; comments appear
              in chronological order and are permanently tied to the Memory.
              The delete affordance is gated to the comment's author OR a Space
              owner, mirroring the `comments_delete` RLS policy (author OR
              owner) and the media-delete precedent. The page is already
              member-gated by RLS, so `user` is present here (ProtectedRoute
              gates auth); the guard is for the type only. */}
          {user && (
            <CommentList
              memoryId={memory.id}
              currentUserId={user.id}
              isOwner={isOwner}
            />
          )}
        </article>
      ) : null}

      {/* Delete confirmation (creator OR Space owner) — destructive,
          irreversible action (feature-specs §2/§4: no soft delete for MVP).
          Mirrors the Space settings delete dialog pattern: a focused modal
          with the safe path (cancel) as the default, and the confirm button
          visually de-emphasized in an error tone. The dialog stays open and
          surfaces the error inline if the delete fails partway, so the user
          never thinks it succeeded when it didn't. */}
      {isDeleteDialogOpen && memory && (
        <ConfirmDialog
          title="Delete Memory?"
          description="This permanently deletes the Memory and all of its photos, videos, comments, reactions, and tags. This can't be undone."
          confirmLabel="Delete Memory"
          loading={isDeleting}
          onConfirm={handleDelete}
          onCancel={closeDeleteDialog}
        >
          {deleteError && (
            <p role="alert" className="text-sm text-error">
              {deleteError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Formats a stored `memory_type` value (snake_case) into a friendly display
 * label. Falls back to a title-cased version of the raw value if the type
 * isn't in the known set — defensive against future types added to the
 * database before the UI is updated.
 */
function formatMemoryType(rawType: string): string {
  if (rawType in MEMORY_TYPE_LABELS) {
    return MEMORY_TYPE_LABELS[rawType as MemoryType];
  }
  // Title-case fallback for unknown types.
  return rawType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Formats a `memory_date` (stored as `YYYY-MM-DD`) into a readable,
 * locale-aware date label. Returns a calm fallback if the value can't be
 * parsed rather than rendering "Invalid Date".
 */
function formatMemoryDate(memoryDate: string): string {
  // Parse as a local date by appending T00:00:00 so timezone offsets don't
  // shift the day backwards for users east of UTC.
  const date = new Date(`${memoryDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Date unknown";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
