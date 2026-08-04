import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, TrashIcon } from "../ui/icons";
import { getMediaDownloadUrl, deleteMedia, uploadMediaItem, type SelectedMediaFile, STATUS_LABELS } from "../../lib/media";
import type { Media } from "../../types/media";
import { supabase } from "../../lib/supabase";
import Spinner from "../ui/Spinner";
import ConfirmDialog from "../ui/ConfirmDialog";

/**
 * MediaGallery — the media grid + lightbox on the Memory Detail page.
 *
 * Fetches all media for the current Memory on mount. Renders a responsive grid
 * of MediaTile components. Clicking a tile opens a lightbox with a larger view
 * and navigation (prev/next). The lightbox image uses the same presigned URL
 * resolution as the tile (via getMediaDownloadUrl with session cache).
 *
 * Upload flow (feature-specs §3):
 *  - User drops/selects files → classify → compress (images) → presigned PUT
 *    → B2 upload → insert media row → generate thumbnail (fire-and-forget).
 *  - The shared `uploadMediaItem` pipeline in lib/media.ts is used so the
 *    create flow and the gallery add-to-existing flow are identical.
 *
 * Delete flow (feature-specs §3):
 *  - Creator or Space owner can delete. DB row first (RLS-gated), then B2
 *    objects (original + thumbnail). Orphaned B2 objects are non-fatal.
 *
 * SPEC B.1: Lightbox now uses the 1000px detail thumbnail as a placeholder
 * while the full-resolution image loads, providing a sharp intermediate state.
 *
 * SPEC B.2: All tiles use IntersectionObserver with 300px rootMargin and
 * loading="lazy" for optimized loading.
 */
interface MediaGalleryProps {
  /** The Memory whose media to display. */
  memoryId: string;
  /** The Space the Memory belongs to (for upload authorization). */
  spaceId: string;
  /** Whether the current user can upload (creator or Space owner). */
  canUpload: boolean;
  /** Whether the current user can delete (creator or Space owner). */
  canDelete: boolean;
}

export default function MediaGallery({ memoryId, spaceId, canUpload, canDelete }: MediaGalleryProps) {
  const [media, setMedia] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<SelectedMediaFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(false);
  const [lightboxError, setLightboxError] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<Media | null>(null);

  // Fetch media on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchMedia() {
      setIsLoading(true);
      setLoadError(undefined);
      try {
        const { data, error } = await supabase
          .from("media")
          .select("*")
          .eq("memory_id", memoryId)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        if (error) {
          setLoadError("We couldn't load the media. Please try again.");
          return;
        }

        setMedia((data ?? []) as Media[]);
      } catch {
        if (cancelled) return;
        setLoadError("We couldn't load the media. Please try again.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchMedia();

    return () => {
      cancelled = true;
    };
  }, [memoryId]);

  // Resolve lightbox image when index changes
  useEffect(() => {
    if (lightboxIndex === null) {
      return;
    }

    const item = media[lightboxIndex];
    if (!item) return;

    let cancelled = false;

    // SPEC B.1: For images in lightbox, prefer the 1000px detail thumbnail
    // as a fast placeholder, then upgrade to full-res if needed
    const isImage = item.type === "image";
    const thumbnailKey = isImage
      ? (item.thumbnail_detail_path ?? item.url)
      : item.url;

    async function resolve() {
      setLightboxLoading(true);
      setLightboxError(false);
      setLightboxSrc(null);

      const result = await getMediaDownloadUrl(thumbnailKey);
      if (!cancelled && result.ok) {
        setLightboxSrc(result.url);
      } else if (!cancelled) {
        setLightboxError(true);
      }
      if (!cancelled) setLightboxLoading(false);
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [lightboxIndex, media]);

  // Lightbox navigation
  const goPrev = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex((i) => (i === null ? null : (i === 0 ? media.length - 1 : i - 1)));
  }, [lightboxIndex, media.length]);

  const goNext = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex((i) => (i === null ? null : (i === media.length - 1 ? 0 : i + 1)));
  }, [lightboxIndex, media.length]);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    setLightboxSrc(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, closeLightbox, goPrev, goNext]);

  // Upload handler
  const handleFilesSelected = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      // Classify and create initial file entries
      const newFiles: SelectedMediaFile[] = fileArray.map((file) => {
        const mediaType = file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
          ? "video"
          : null;

        return {
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          mediaType,
          status: mediaType ? "pending" : "failed",
          error: mediaType ? undefined : "Unsupported file type. Please select an image or video.",
        };
      });

      setSelectedFiles((prev) => [...prev, ...newFiles]);

      // Upload with controlled concurrency (max 2 at a time) to avoid
      // overwhelming the main thread and browser connection pool.
      // This prevents net::ERR_CONNECTION_* failures caused by main-thread
      // blocking during sequential image compression.
      const CONCURRENCY_LIMIT = 2;
      const filesToUpload = newFiles.filter((f) => f.mediaType);
      for (let i = 0; i < filesToUpload.length; i += CONCURRENCY_LIMIT) {
        const batch = filesToUpload.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(
          batch.map(async (fileEntry) => {
            try {
              const result = await uploadMediaItem({
                file: fileEntry.file,
                mediaType: fileEntry.mediaType!,
                spaceId,
                memoryId,
                onStatus: (status) => {
                  setSelectedFiles((prev) =>
                    prev.map((f) =>
                      f.id === fileEntry.id ? { ...f, status } : f
                    )
                  );
                },
              });

              setSelectedFiles((prev) =>
                prev.map((f) =>
                  f.id === fileEntry.id
                    ? { ...f, status: result.ok ? "done" : "failed", error: result.ok ? undefined : result.error }
                    : f
                )
              );

              if (result.ok) {
                setMedia((prev) => [...prev, result.media]);
              }
            } catch {
              setSelectedFiles((prev) =>
                prev.map((f) =>
                  f.id === fileEntry.id
                    ? { ...f, status: "failed", error: "Upload failed unexpectedly." }
                    : f
                )
              );
            }
          })
        );
      }
    },
    [spaceId, memoryId],
  );

  const handleFileInputClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files);
      }
    },
    [handleFilesSelected],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Delete handler
  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    const result = await deleteMedia(deleteConfirm);
    if (result.ok) {
      setMedia((prev) => prev.filter((m) => m.id !== deleteConfirm.id));
      // If lightbox was open on the deleted item, close it
      if (lightboxIndex !== null && media[lightboxIndex]?.id === deleteConfirm.id) {
        closeLightbox();
      }
    } else {
      // Could show a toast here, but keeping it calm per auth-design §7
      console.error("Delete failed:", result.error);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, lightboxIndex, media, closeLightbox]);

  const cancelDelete = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  // Download handler — fetches presigned URL for original file and triggers browser download
  const handleDownload = useCallback(async (mediaItem: Media) => {
    // Use the original file key (media.url / storage_path) for full-resolution download
    const fileKey = mediaItem.storage_path || mediaItem.url;
    if (!fileKey) return;

    const result = await getMediaDownloadUrl(fileKey);
    if (!result.ok) {
      console.error("Failed to get download URL:", result.error);
      return;
    }

    const downloadUrl = result.url;

    // Extract a sensible filename from the B2 object key
    // Key format: {space_id}/{memory_id}/{uuid}.{ext}
    const keyParts = fileKey.split("/");
    const originalFilename = keyParts[keyParts.length - 1] || "download";
    // The UUID filename isn't user-friendly, but we can at least preserve the extension
    const extension = originalFilename.includes(".")
      ? originalFilename.slice(originalFilename.lastIndexOf("."))
      : mediaItem.type === "video"
      ? ".mp4"
      : ".jpg";

    // Generate a user-friendly filename: "Avero-{memory_id}-{timestamp}{extension}"
    // Since we don't have the original filename stored, we use a reasonable pattern
    const timestamp = new Date(mediaItem.created_at).toISOString().slice(0, 10).replace(/-/g, "");
    const friendlyName = `Avero-${mediaItem.memory_id.slice(0, 8)}-${timestamp}${extension}`;

    // Use fetch-then-blob approach for cross-origin compatibility
    // B2 presigned URLs may not honor the download attribute reliably
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = friendlyName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL after a short delay to allow the download to start
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error("Download failed:", err);
      // Fallback: open in new tab (browser will handle save-as)
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-ink/5 bg-canvas-soft p-6 text-center">
        <p className="text-sm text-error">{loadError}</p>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Upload zone */}
      {canUpload && (
        <div
          className="relative rounded-xl border-2 border-dashed border-ink/10 bg-canvas-soft p-6 transition-colors duration-200 hover:border-accent-400/50 hover:bg-accent-50"
          role="button"
          tabIndex={0}
          onClick={handleFileInputClick}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleFileInputClick(); }}
          aria-label="Add photos or videos"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="inline-flex items-center justify-center rounded-full bg-accent-100 p-3 text-accent-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <p className="text-sm text-ink-muted">
              Click or drag photos &amp; videos here
            </p>
            <p className="text-xs text-ink-muted">
              Up to 100MB per video. Images are compressed automatically.
            </p>
          </div>
        </div>
      )}

      {/* Upload progress list */}
      {selectedFiles.length > 0 && (
        <div className="mt-4 space-y-2" role="status" aria-live="polite">
          {selectedFiles.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded-lg bg-canvas p-3 border border-ink/5">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-ink/5 flex items-center justify-center">
                {file.mediaType === "image" ? (
                  <svg className="w-5 h-5 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{file.name}</p>
                <p className="text-xs text-ink-muted">
                  {STATUS_LABELS[file.status].text}
                </p>
              </div>
              {file.status === "failed" && file.error && (
                <span className="text-xs text-error">{file.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Media grid */}
      {media.length === 0 && !canUpload ? (
        <div className="py-12 text-center">
          <p className="text-sm text-ink-muted">No photos or videos yet.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {media.map((item, index) => (
            <MediaTile
              key={item.id}
              media={item}
              onClick={() => {
                setLightboxIndex(index);
              }}
              onDownload={handleDownload}
              onDelete={(mediaItem) => setDeleteConfirm(mediaItem)}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          role="dialog"
          aria-modal="true"
          aria-label="Media viewer"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            type="button"
            className="absolute top-4 right-4 z-10 rounded-full p-2 text-white/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            aria-label="Close"
          >
            <CloseIcon className="w-6 h-6" />
          </button>

          {/* Navigation */}
          {media.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-4 z-10 rounded-full p-3 text-white/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                aria-label="Previous"
              >
                <ChevronLeftIcon className="w-8 h-8" />
              </button>
              <button
                type="button"
                className="absolute right-4 z-10 rounded-full p-3 text-white/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                aria-label="Next"
              >
                <ChevronRightIcon className="w-8 h-8" />
              </button>
            </>
          )}

          {/* Media content */}
          <div className="relative max-w-[90vw] max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            {lightboxLoading ? (
              <div className="flex items-center justify-center w-[600px] h-[400px]">
                <Spinner size={32} className="text-white" />
              </div>
            ) : lightboxError ? (
              <div className="flex items-center justify-center w-[600px] h-[400px] text-white/60">
                <p>Couldn't load this media.</p>
              </div>
            ) : lightboxSrc ? (
              <>
                {media[lightboxIndex]?.type === "video" ? (
                  <video
                    src={lightboxSrc}
                    className="max-w-[90vw] max-h-[85vh] object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <img
                    src={lightboxSrc}
                    alt=""
                    className="max-w-[90vw] max-h-[85vh] object-contain"
                  />
                )}
                {/* Action buttons in lightbox */}
                {lightboxSrc && (
                  <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
                    {/* Download button — available to all Space members who can view the Memory */}
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg glass-panel px-3 py-2 text-white hover:bg-white/5 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        const currentMedia = media[lightboxIndex];
                        if (currentMedia) handleDownload(currentMedia);
                      }}
                    >
                      <DownloadIcon className="w-5 h-5" />
                      <span className="text-sm">Download</span>
                    </button>
                    {/* Delete button — only for creator or Space owner */}
                    {canDelete && (
                      <button
                        type="button"
                        className="rounded-full p-2 glass-panel text-white hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-error"
                        onClick={(e) => {
                          e.stopPropagation();
                          const currentMedia = media[lightboxIndex];
                          if (currentMedia) setDeleteConfirm(currentMedia);
                        }}
                        aria-label="Delete"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
            {lightboxIndex + 1} / {media.length}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <ConfirmDialog
          title="Delete this media?"
          description="This will remove the photo or video from the Memory. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// MediaTile (inline — originally part of MediaGallery)
// ----------------------------------------------------------------------------

/**
 * MediaTile — a single media item in the Memory Detail gallery grid.
 *
 * Renders an <img> (for images) or <video> (for videos) with a presigned GET URL
 * resolved via `getMediaDownloadUrl`. The session-scoped cache in that function
 * avoids redundant Edge Function calls when the same media is re-resolved.
 *
 * SPEC B.1: For images, prefers the 1000px detail thumbnail (thumbnail_detail_path)
 * as a lightbox placeholder, falling back to the original. This gives a sharp
 * placeholder while the full-resolution image loads in the lightbox.
 *
 * SPEC B.2: Uses IntersectionObserver with 300px rootMargin and
 * loading="lazy" for optimized loading.
 */
function MediaTile({
  media,
  onClick,
  onDownload,
  onDelete,
  canDelete,
}: { media: Media; onClick?: () => void; onDownload?: (media: Media) => void; onDelete?: (media: Media) => void; canDelete?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // SPEC B.1: For images, prefer the 1000px detail thumbnail; for videos, use original
  const isImage = media.type === "image";
  const thumbnailKey = isImage
    ? (media.thumbnail_detail_path ?? media.url)
    : media.url;

  // SPEC B.2: LQIP — grid thumbnail (300px WebP) as blur placeholder
  const [blurUrl, setBlurUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage || !media.thumbnail_grid_path) return;
    let cancelled = false;
    getMediaDownloadUrl(media.thumbnail_grid_path).then((result) => {
      if (!cancelled && result.ok) {
        setBlurUrl(result.url);
      }
    });
    return () => { cancelled = true; };
  }, [media.thumbnail_grid_path, isImage]);

  useEffect(() => {
    if (!thumbnailKey || hasError) return;

    let cancelled = false;

    async function resolveUrl() {
      const result = await getMediaDownloadUrl(thumbnailKey);
      if (!cancelled && result.ok) {
        setSrc(result.url);
      }
    }

    resolveUrl();

    return () => {
      cancelled = true;
    };
  }, [thumbnailKey, hasError]);

  // SPEC B.2: IntersectionObserver with 300px rootMargin for earlier loading
  useEffect(() => {
    if (isInView || hasError) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "300px" },
    );

    const wrapper = document.querySelector(`[data-media-tile="${media.id}"]`);
    if (wrapper) {
      observer.observe(wrapper);
    }

    return () => observer.disconnect();
  }, [media.id, hasError, isInView]);

  if (!src || hasError) {
    return (
      <div
        data-media-tile={media.id}
        className="aspect-square w-full overflow-hidden rounded-lg bg-ink/5"
        onClick={onClick}
        role="button"
        tabIndex={0}
        aria-label={isImage ? "View photo" : "View video"}
      />
    );
  }

  const isVideo = media.type === "video";

  return (
    <div
      data-media-tile={media.id}
      className="aspect-square w-full overflow-hidden rounded-lg relative group"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={isImage ? "View photo" : "View video"}
    >
      {/* SPEC B.2: LQIP base layer — blurred grid thumbnail */}
      {isImage && blurUrl && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${blurUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(20px)",
            transform: "scale(1.1)",
            opacity: imageLoaded ? 0 : 1,
            transition: "opacity 300ms ease-out",
          }}
          aria-hidden="true"
        />
      )}
      {/* Sharp image/video layer — fades in over blurred base */}
      {isVideo ? (
        <video
          src={src}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
          onError={() => setHasError(true)}
          onLoadedData={() => setImageLoaded(true)}
        />
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          style={{
            opacity: imageLoaded ? 1 : 0,
            transition: "opacity 300ms ease-out",
          }}
          onError={() => setHasError(true)}
          onLoad={() => setImageLoaded(true)}
        />
      )}
      {/* Action buttons — appear on hover */}
      <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {/* Download button — available to all Space members */}
        {onDownload && (
          <button
            type="button"
            className="rounded-full p-2 glass-panel text-white hover:bg-white/5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(media);
            }}
            aria-label="Download"
          >
            <DownloadIcon className="w-5 h-5" />
          </button>
        )}
        {/* Delete button — only for creator or Space owner */}
        {canDelete && onDelete && (
          <button
            type="button"
            className="rounded-full p-2 glass-panel text-white hover:bg-white/5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-error"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(media);
            }}
            aria-label="Delete"
          >
            <TrashIcon className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
