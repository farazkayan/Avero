import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  classifyMediaType,
  deleteMedia,
  getMediaDownloadUrl,
  uploadMediaItem,
  MAX_VIDEO_SIZE_BYTES,
  STATUS_LABELS,
  type SelectedMediaFile,
} from "../../lib/media";
import { asMediaType, type Media, type MediaType } from "../../types/media";
import { PlayIcon, TrashIcon } from "../ui/icons";
import MediaLightbox, { type LightboxItem } from "./MediaLightbox";

type MediaGalleryProps = {
  /** The Memory whose media rows should be loaded. */
  memoryId: string;
  /** The Space the Memory belongs to. Needed for the upload object key and the
   *  Edge Function membership check. */
  spaceId: string;
  /** Whether the "Add photos/videos" control is shown. Any Space member can
   *  add (RLS `media_insert` = `is_space_member`). */
  canAdd: boolean;
  /** Whether the per-tile delete affordance is shown. Creator OR Space owner
   *  (RLS `media_delete` = creator OR owner). */
  canEdit: boolean;
};

/**
 * The display state of a single media tile, keyed by the media row's id.
 *
 * - `loading` — the presigned GET URL is being fetched from the Edge Function.
 * - `ready` — the URL resolved; the thumbnail can render.
 * - `error` — the URL request failed; the tile shows a calm "couldn't load"
 *   state with a retry control instead of a broken image.
 */
type TileState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

/**
 * A media row paired with its resolved {@link TileState}, in display order.
 */
type GalleryItem = {
  media: Media;
  type: MediaType;
  tile: TileState;
};

/**
 * Media gallery for the Memory detail view (feature-specs §3 — "Media is
 * displayed in gallery format inside Memory view").
 *
 * Fetches the Memory's media rows from the `media` table (RLS auto-filters to
 * Space members; the `media_select` policy re-derives the Space from the
 * parent memory). For each row it then requests a short-lived presigned GET
 * URL from the `media-storage` Edge Function (`request-download-url`), which
 * re-runs the same membership check used for uploads. The two fetches are
 * decoupled: the grid renders skeleton tiles immediately and each tile fills
 * in as its URL resolves, so a single slow request never blocks the rest.
 *
 * State is split so URL resolution never re-fetches:
 *  - `rows` holds the raw media rows (stable per Memory; only changes on a
 *    full re-fetch, e.g. when `memoryId` changes).
 *  - `tiles` holds the per-row display state keyed by media id.
 * The URL-resolution effect depends on `rows` (stable), not on `tiles`
 * (which changes on every status update), and it tracks in-flight requests in
 * a ref so a re-run never restarts a fetch that is already underway.
 *
 * **Add media** (when `canAdd`): a dashed-border "Add photos/videos" control
 * above the grid reuses the exact upload pipeline from `CreateMemoryPage`
 * (via the shared `uploadMediaItem` helper). New tiles appear without a full
 * page reload — the returned `media` row is appended to `rows` and seeded as
 * `loading` so the existing URL-resolution effect picks it up.
 *
 * **Remove media** (when `canEdit`): a trash icon appears on hover/focus over
 * each tile (calm, not always-visible, per Design System §6/§8). Clicking it
 * swaps the tile to an inline two-step confirm ("Delete this photo?
 * [Delete] [Cancel]") so a single accidental click can't remove media. On
 * confirm, `deleteMedia` removes the DB row (RLS-gated) then the B2 object;
 * the tile disappears without a full reload.
 *
 * UI (design-system §6 — "Media previews"):
 *  - A responsive grid of square thumbnails below the Memory's text content.
 *  - Images render inline; videos show a poster frame with a play affordance.
 *  - A loading skeleton per tile while URLs are being fetched.
 *  - A calm error tile (with a retry) if a URL request fails.
 *  - Clicking a thumbnail opens a simple lightbox/modal ({@link MediaLightbox}).
 *
 * Empty state: when the Memory has no media rows and `canAdd` is true, the
 * "Add photos/videos" control renders alone so an authorized member can add
 * the first photo. When `canAdd` is false and there's no media, the component
 * renders `null` (Task 1 contract — the Memory detail page already shows the
 * text content, so an empty gallery is simply absent).
 */
export default function MediaGallery({
  memoryId,
  spaceId,
  canAdd,
  canEdit,
}: MediaGalleryProps) {
  const [rows, setRows] = useState<Media[]>([]);
  const [tiles, setTiles] = useState<Record<string, TileState>>({});
  const [isLoadingRows, setIsLoadingRows] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // --- Add-media state ---
  // Files selected via the "Add photos/videos" control, tracked through the
  // upload lifecycle so the user sees per-file status (same pattern as
  // CreateMemoryPage).
  const [pendingUploads, setPendingUploads] = useState<SelectedMediaFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Delete state ---
  // The media id of the tile currently in the inline confirm state. Only one
  // tile can be confirming at a time.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  // The media id of a tile whose delete is in flight (shows a spinner state).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // A transient per-tile delete error (shown on the tile, then reverts).
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);

  // Media ids whose presigned-URL request is currently in flight. Kept in a
  // ref (not state) so updating it never re-renders, and so the resolution
  // effect can read the latest set on every run without re-subscribing.
  const inFlight = useRef<Set<string>>(new Set());

  // --- Fetch media rows ---

  useEffect(() => {
    if (!memoryId) {
      // React Router guarantees :memoryId on this route; this guard only
      // satisfies the type system and must not setState synchronously.
      return;
    }

    let cancelled = false;

    async function fetchMedia(id: string) {
      setIsLoadingRows(true);
      setLoadError(undefined);

      try {
        const { data, error } = await supabase
          .from("media")
          .select("*")
          .eq("memory_id", id)
          // Oldest first — a natural left-to-right, top-to-bottom reading
          // order that matches the order the media was added to the Memory.
          .order("created_at", { ascending: true });

        if (cancelled) return;

        if (error) {
          setLoadError("We couldn't load the media for this Memory.");
          return;
        }

        const fetched = (data ?? []) as Media[];

        // Drop rows whose `type` is neither image nor video (defensive against
        // malformed/future types — see asMediaType). They are not displayed.
        const typed = fetched.filter((m) => asMediaType(m.type) !== null);

        setRows(typed);
        // Reset per-tile state for the new row set. Every visible row starts
        // in `loading` until its presigned URL resolves.
        const nextTiles: Record<string, TileState> = {};
        for (const m of typed) {
          nextTiles[m.id] = { status: "loading" };
        }
        setTiles(nextTiles);
        inFlight.current = new Set();
      } catch {
        if (cancelled) return;
        setLoadError("We couldn't load the media for this Memory.");
      } finally {
        if (cancelled) setIsLoadingRows(false);
      }
    }

    void fetchMedia(memoryId);

    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  // --- Resolve presigned URLs ---
  //
  // Depends on `rows` (stable per Memory), NOT on `tiles`. Each row is fetched
  // at most once: the `inFlight` ref guards against duplicate requests across
  // re-runs, and a retry simply clears the row's tile back to `loading` and
  // removes its id from `inFlight` so the next run picks it up.

  const resolveTile = useCallback(async (media: Media) => {
    if (inFlight.current.has(media.id)) return;
    inFlight.current.add(media.id);

    const result = await getMediaDownloadUrl(media.url);

    // The request may outlive the gallery (e.g. a navigation away). We still
    // write the result; if the row is gone from `tiles` the update is a no-op
    // because we only set when the current tile is still `loading`.
    setTiles((prev) => {
      const current = prev[media.id];
      if (!current || current.status !== "loading") {
        return prev;
      }
      return {
        ...prev,
        [media.id]: result.ok
          ? { status: "ready", url: result.url }
          : { status: "error" },
      };
    });

    inFlight.current.delete(media.id);
  }, []);

  useEffect(() => {
    if (rows.length === 0) return;
    for (const media of rows) {
      const tile = tiles[media.id];
      if (tile?.status === "loading") {
        void resolveTile(media);
      }
    }
    // `tiles` is intentionally read here (to decide what to fetch) but omitted
    // from the deps so a status update doesn't re-trigger fetches. `rows` is
    // the stable trigger; `resolveTile` is stable (no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, resolveTile]);

  // --- Derived display list ---

  const items = useMemo<GalleryItem[]>(() => {
    return rows
      .map((media) => {
        const type = asMediaType(media.type);
        if (!type) return null;
        const tile = tiles[media.id] ?? { status: "loading" };
        return { media, type, tile };
      })
      .filter((item): item is GalleryItem => item !== null);
  }, [rows, tiles]);

  // The lightbox only shows items that resolved successfully, in the same
  // order as the grid. Mapping a grid index to a lightbox index keeps the
  // two in sync even when some tiles failed to load.
  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      items
        .map((item) =>
          item.tile.status === "ready"
            ? {
                id: item.media.id,
                type: item.type,
                url: item.tile.url,
              }
            : null,
        )
        .filter((item): item is LightboxItem => item !== null),
    [items],
  );

  const gridIndexToLightboxIndex = useMemo(() => {
    const map: number[] = [];
    items.forEach((item, gridIndex) => {
      if (item.tile.status === "ready") {
        map.push(gridIndex);
      }
    });
    return map;
  }, [items]);

  const openLightbox = useCallback(
    (gridIndex: number) => {
      const lightboxIdx = gridIndexToLightboxIndex.indexOf(gridIndex);
      if (lightboxIdx >= 0) {
        setLightboxIndex(lightboxIdx);
      }
    },
    [gridIndexToLightboxIndex],
  );

  const retryTile = useCallback((mediaId: string) => {
    setTiles((prev) =>
      prev[mediaId]?.status === "error"
        ? { ...prev, [mediaId]: { status: "loading" } }
        : prev,
    );
    // Allow the resolution effect to re-fetch this row.
    inFlight.current.delete(mediaId);
  }, []);

  // --- Add media handlers ---

  const updateUploadStatus = useCallback(
    (id: string, status: SelectedMediaFile["status"], error?: string) => {
      setPendingUploads((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status, error } : f)),
      );
    },
    [],
  );

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const newFiles: SelectedMediaFile[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const mediaType = classifyMediaType(file);

        if (mediaType === null) {
          newFiles.push({
            id: crypto.randomUUID(),
            file,
            name: file.name,
            size: file.size,
            mediaType: null,
            status: "failed",
            error: "Not an image or video file.",
          });
          continue;
        }

        if (mediaType === "video" && file.size > MAX_VIDEO_SIZE_BYTES) {
          newFiles.push({
            id: crypto.randomUUID(),
            file,
            name: file.name,
            size: file.size,
            mediaType: "video",
            status: "failed",
            error: "Videos must be under 100MB.",
          });
          continue;
        }

        newFiles.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          mediaType,
          status: "pending",
        });
      }

      setPendingUploads((prev) => [...prev, ...newFiles]);
      // Clear the input so selecting the same file again still fires onChange.
      event.target.value = "";
    },
    [],
  );

  // Upload each pending file. Runs whenever there are files in `pending`
  // status — this mirrors the CreateMemoryPage pattern where uploads start
  // after selection, but here they start immediately (no form submit to wait
  // for, since the Memory already exists).
  useEffect(() => {
    const pending = pendingUploads.filter((f) => f.status === "pending");
    if (pending.length === 0) return;

    let cancelled = false;

    async function runUploads(files: SelectedMediaFile[]) {
      for (const item of files) {
        if (cancelled) return;
        if (item.mediaType === null) continue;

        const result = await uploadMediaItem({
          file: item.file,
          mediaType: item.mediaType,
          spaceId,
          memoryId,
          onStatus: (status) => updateUploadStatus(item.id, status),
        });

        if (cancelled) return;

        if (result.ok) {
          updateUploadStatus(item.id, "done");
          // Append the new media row and seed its tile as `loading` so the
          // URL-resolution effect picks it up — no full reload.
          setRows((prev) => [...prev, result.media]);
          setTiles((prev) => ({ ...prev, [result.media.id]: { status: "loading" } }));
        } else {
          updateUploadStatus(item.id, "failed", result.error);
        }
      }
    }

    void runUploads(pending);
    return () => {
      cancelled = true;
    };
  }, [pendingUploads, spaceId, memoryId, updateUploadStatus]);

  const handleRetryUpload = useCallback((id: string) => {
    setPendingUploads((prev) =>
      prev.map((f) =>
        f.id === id && f.status === "failed" && f.mediaType !== null
          ? { ...f, status: "pending" as const, error: undefined }
          : f,
      ),
    );
  }, []);

  const handleRemoveUpload = useCallback((id: string) => {
    setPendingUploads((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // --- Delete handlers ---

  const handleConfirmDelete = useCallback(async (media: Media) => {
    setDeletingId(media.id);
    setDeleteErrorId(null);

    const result = await deleteMedia(media);

    setDeletingId(null);

    if (result.ok) {
      // Remove the row and its tile — no full reload. If it was the last item,
      // `items.length === 0` and the gallery falls back to the empty state.
      setRows((prev) => prev.filter((r) => r.id !== media.id));
      setTiles((prev) => {
        const next = { ...prev };
        delete next[media.id];
        return next;
      });
      setConfirmingDeleteId(null);
    } else {
      // Show a calm error on the tile and revert to the normal state.
      setDeleteErrorId(media.id);
      setConfirmingDeleteId(null);
    }
  }, []);

  // --- Render ---

  // While the rows are loading, show a skeleton grid so the layout doesn't
  // pop in. This is the only "loading" branch that renders a grid at all.
  if (isLoadingRows) {
    return (
      <section className="mt-8" aria-label="Media">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="aspect-square animate-pulse rounded-lg bg-canvas-soft"
            />
          ))}
        </ul>
      </section>
    );
  }

  // A row-fetch failure is a calm, honest message — the Memory text still
  // rendered above, so the page is never blank.
  if (loadError) {
    return (
      <section className="mt-8" aria-label="Media">
        <div className="rounded-xl border border-white/5 bg-canvas-soft p-4 text-center">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      </section>
    );
  }

  const hasItems = items.length > 0;

  // Empty Memory with no media rows. If the user can add, render the add
  // control alone so they can add the first photo. Otherwise render nothing
  // (Task 1 contract — the Memory detail page already shows the text content).
  if (!hasItems && !canAdd) {
    return null;
  }

  return (
    <section className="mt-8" aria-label="Media">
      {/* Add photos/videos control (any Space member). */}
      {canAdd && (
        <div className="mb-4">
          <label
            htmlFor="gallery-media-files"
            className={[
              "flex cursor-pointer items-center justify-center rounded-lg",
              "border border-dashed border-white/15 px-4 py-6",
              "text-sm text-ink-muted transition-colors duration-200",
              "hover:border-white/25 hover:text-ink",
              "focus-within:ring-2 focus-within:ring-accent-500/60 focus-within:border-accent-500",
            ].join(" ")}
          >
            <input
              id="gallery-media-files"
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="sr-only"
              onChange={handleFileSelect}
            />
            <span>Tap to add photos or videos</span>
          </label>
          <p className="mt-1.5 text-sm text-ink-muted">
            Videos must be under 100MB.
          </p>
        </div>
      )}

      {/* Per-file upload status list (same pattern as CreateMemoryPage). */}
      {pendingUploads.length > 0 && (
        <ul className="mb-4 space-y-2">
          {pendingUploads.map((file) => {
            const isFailed = file.status === "failed";
            return (
              <li
                key={file.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-canvas-soft px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{file.name}</p>
                  <p
                    className={`text-xs ${STATUS_LABELS[file.status].className}`}
                  >
                    {STATUS_LABELS[file.status].text}
                  </p>
                  {file.error && (
                    <p className="mt-0.5 text-xs text-error">{file.error}</p>
                  )}
                </div>
                {isFailed && (
                  <div className="flex shrink-0 items-center gap-3">
                    {file.mediaType !== null && (
                      <button
                        type="button"
                        onClick={() => handleRetryUpload(file.id)}
                        className="rounded-md text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveUpload(file.id)}
                      className="rounded-md text-xs font-medium text-ink-muted transition-colors duration-200 hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasItems && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item, gridIndex) => (
            <li key={item.media.id}>
              <MediaTile
                item={item}
                canEdit={canEdit}
                isConfirming={confirmingDeleteId === item.media.id}
                isDeleting={deletingId === item.media.id}
                hasDeleteError={deleteErrorId === item.media.id}
                onOpen={() => openLightbox(gridIndex)}
                onRetry={() => retryTile(item.media.id)}
                onRequestDelete={() => {
                  setDeleteErrorId(null);
                  setConfirmingDeleteId(item.media.id);
                }}
                onCancelDelete={() => setConfirmingDeleteId(null)}
                onConfirmDelete={() => void handleConfirmDelete(item.media)}
              />
            </li>
          ))}
        </ul>
      )}

      <MediaLightbox
        items={lightboxItems}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onNavigate={setLightboxIndex}
      />
    </section>
  );
}

// ----------------------------------------------------------------------------
// MediaTile
// ----------------------------------------------------------------------------

type MediaTileProps = {
  item: GalleryItem;
  canEdit: boolean;
  isConfirming: boolean;
  isDeleting: boolean;
  hasDeleteError: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

/**
 * A single thumbnail tile. Renders a loading skeleton, a calm error state
 * with a retry control, or the media itself (image inline, video poster with
 * a play affordance). The tile is a button so it is keyboard-focusable and
 * announced as a control; its accessible name reflects the media kind.
 *
 * When `canEdit` is true, a trash icon appears on hover/focus (calm, not
 * always-visible, per Design System §6/§8). Clicking it swaps the tile to an
 * inline two-step confirm overlay so a single accidental click can't remove
 * media. A transient delete error is shown on the tile and reverts to the
 * normal state.
 */
function MediaTile({
  item,
  canEdit,
  isConfirming,
  isDeleting,
  hasDeleteError,
  onOpen,
  onRetry,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: MediaTileProps) {
  const { tile } = item;

  if (tile.status === "loading") {
    return (
      <div
        className="aspect-square w-full animate-pulse rounded-lg bg-canvas-soft"
        aria-hidden="true"
      />
    );
  }

  if (tile.status === "error") {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-white/5 bg-canvas-soft p-3 text-center">
        <p className="text-xs text-ink-muted">Couldn't load</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md text-xs font-medium text-accent-400 transition-colors duration-200 hover:text-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
        >
          Retry
        </button>
      </div>
    );
  }

  const isVideo = item.type === "video";

  return (
    <div className="group relative aspect-square w-full overflow-hidden rounded-lg border border-white/5 bg-canvas-soft transition-colors duration-200 hover:border-white/15 focus-within:border-white/15">
      {/* The thumbnail itself — clicking opens the lightbox. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={isVideo ? "Open video" : "Open image"}
        className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
      >
        {isVideo ? (
          <video
            src={tile.url}
            // `metadata` loads the first frame for the poster without buffering
            // the whole file; preload keeps the tile light.
            preload="metadata"
            muted
            // The tile video is non-interactive (no controls) — it only shows a
            // poster frame. pointer-events-none lets the button handle clicks.
            className="pointer-events-none h-full w-full object-cover"
            tabIndex={-1}
            aria-hidden="true"
          />
        ) : (
          <img
            src={tile.url}
            alt=""
            loading="lazy"
            className="pointer-events-none h-full w-full select-none object-cover"
          />
        )}

        {isVideo && (
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 transition-colors duration-200 group-hover:bg-black/20"
            aria-hidden="true"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white">
              <PlayIcon />
            </span>
          </span>
        )}
      </button>

      {/* Delete affordance — appears on hover/focus (calm, per Design System
          §6/§8). Only rendered when canEdit (creator OR owner). */}
      {canEdit && !isConfirming && !hasDeleteError && (
        <button
          type="button"
          onClick={onRequestDelete}
          aria-label="Delete this media"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-200 hover:bg-black/70 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 group-hover:opacity-100"
        >
          <TrashIcon />
        </button>
      )}

      {/* Inline two-step confirm overlay — a deliberate second action prevents
          accidental deletion (lighter than a full-screen ConfirmDialog). */}
      {isConfirming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-3 text-center">
          <p className="text-sm font-medium text-white">
            Delete this {isVideo ? "video" : "photo"}?
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={isDeleting}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white/80 transition-colors duration-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-50"
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
        </div>
      )}

      {/* Transient delete error — shown on the tile, reverts to normal state. */}
      {hasDeleteError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 text-center">
          <p className="text-xs text-white">Couldn't delete. Try again.</p>
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-md text-xs font-medium text-white/80 transition-colors duration-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
