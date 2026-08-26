import { supabase } from "./supabase";
import { asMediaType, type Media } from "../types/media";

/**
 * Media helpers (feature-specs §3, database §7).
 *
 * The `media` table stores the durable Backblaze B2 object key in `url` /
 * `storage_path` — never a presigned URL. Short-lived presigned GET URLs are
 * requested on demand from the `media-storage` Edge Function, which re-derives
 * the `space_id` from the key's first path segment and re-runs the same RLS
 * membership check used for uploads (see `supabase/functions/media-storage` →
 * `handleDownloadUrl`). This keeps read access gated by Space membership, so a
 * user who can see a Memory can also view its media, and a non-member cannot.
 *
 * This module is the single home for the three media operations:
 *  - **Download** — `getMediaDownloadUrl` (presigned GET).
 *  - **Upload**   — `uploadMediaItem` (classify → compress → presigned PUT →
 *    insert row). Extracted from `CreateMemoryPage.uploadOneFile` so both the
 *    create flow and the Memory Detail gallery share one pipeline.
 *  - **Delete**   — `deleteMedia` (DB row first, then B2 object).
 */

// ============================================================================
// Session-scoped presigned-URL cache (B2 egress reduction)
// ============================================================================
//
// Presigned GET URLs are short-lived by design (security: feature-specs §3,
// backend-implementation §11 — RLS membership is re-checked when the Edge
// Function signs each URL). Within a single browser session, however, the
// same media object is often requested repeatedly: scrolling away from a
// thumbnail and back unmounts/remounts the card (re-running the resolution
// effect), a re-render re-enters the effect, or the same photo appears on
// both the Spaces Dashboard and the Space timeline. Each redundant call to
// `request-download-url` does not download bytes itself, but it re-signs a
// URL whose resolution the browser then re-fetches at full resolution — and
// on a back-to-back re-resolve the browser cache may have already evicted
// the prior response, triggering a second full-resolution B2 download.
//
// This cache holds the last-resolved presigned URL for each durable object
// key for the remainder of the page/session lifetime, so a repeat request
// within the same session reuses the URL instead of re-invoking the Edge
// Function. The entry is dropped once its known expiry passes, so a stale
// URL is never handed out (B2 returns 403 on an expired signature, which
// would surface as a broken thumbnail).
//
// SCOPE LIMIT (be explicit): this only helps within a single browser
// session. A full page reload or a new visit always needs fresh presigned
// URLs — they are short-lived by design for security. That is expected and
// out of scope to change (the brief flags it explicitly). The cache is
// in-memory (module-level), so it dies with the document.
//
// This is NOT a fix for bytes-per-fetch (the thumbnail still pulls a
// full-resolution image for a ~64px square); that requires the deferred
// media web optimizer (thumbnail generation at upload time). It only
// eliminates redundant fetches within a session. The optimizer is
// increasingly urgent given real egress costs are now being hit.
// ----------------------------------------------------------------------------

/**
 * Conservative fallback lifetime used when a presigned URL's true expiry
 * cannot be parsed from its query string. The real download TTL is 1 hour
 * (see `DOWNLOAD_URL_TTL_SECONDS` in the Edge Function); if parsing fails we
 * assume the shorter of the two known TTLs (the upload TTL, 15 min) so a
 * cached entry is never trusted past the worst-case real expiry.
 */
const DOWNLOAD_URL_TTL_FALLBACK_SECONDS = 15 * 60;

/**
 * One cached presigned-URL entry: the URL plus the epoch milliseconds at
 * which its signature expires and it must no longer be reused.
 */
interface CachedDownloadUrl {
  url: string;
  /** Epoch ms after which the presigned signature is invalid (must re-sign). */
  expiresAt: number;
}

/**
 * The session-scoped cache, keyed by the durable B2 object key
 * (`media.url` / `storage_path`). Module-level so it survives component
 * unmount/remount and is shared across every caller of
 * `getMediaDownloadUrl` (MemoryThumbnail on both pages, MediaGallery).
 * Cleared only by a full page reload (document lifetime).
 */
const downloadUrlCache = new Map<string, CachedDownloadUrl>();

/**
 * Promises for in-flight `request-download-url` calls, keyed by object key.
 * De-duplicates concurrent requests for the same key (e.g. two thumbnail
 * components mounting for the same media at once) so the Edge Function is
 * invoked once, not twice — the second caller awaits the first's promise.
 * Entries are created on send and deleted on settle.
 */
const downloadUrlInFlight = new Map<string, Promise<DownloadUrlResult>>();

/**
 * Parses a presigned URL's true expiry as epoch milliseconds.
 *
 * AWS S3 / B2 presigned URLs carry the signing start time as
 * `X-Amz-Date` (ISO 8601 basic, e.g. `20260723T133000Z`) and the validity
 * window as `X-Amz-Expires` (seconds). The signature is valid from
 * `X-Amz-Date` for `X-Amz-Expires` seconds. Returns `null` if either param
 * is missing or unparseable — the caller then falls back to the conservative
 * {@link DOWNLOAD_URL_TTL_FALLBACK_SECONDS} so a cached entry is never
 * trusted longer than the worst-case real TTL.
 */
function parsePresignedExpiry(url: string): number | null {
  try {
    const parsed = new URL(url);
    const amzDate = parsed.searchParams.get("X-Amz-Date");
    const amzExpires = parsed.searchParams.get("X-Amz-Expires");
    if (!amzDate || !amzExpires) return null;
    // X-Amz-Date is ISO 8601 basic: YYYYMMDDTHHMMSSZ. Convert to the
    // extended form the Date constructor accepts before parsing.
    const year = amzDate.slice(0, 4);
    const month = amzDate.slice(4, 6);
    const day = amzDate.slice(6, 8);
    const hour = amzDate.slice(9, 11);
    const minute = amzDate.slice(11, 13);
    const second = amzDate.slice(13, 15);
    if (
      amzDate.length < 15 ||
      amzDate.charAt(8) !== "T" ||
      !year || !month || !day || !hour || !minute || !second
    ) {
      return null;
    }
    const startMs = Date.parse(
      `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
    );
    if (Number.isNaN(startMs)) return null;
    const expiresSeconds = Number(amzExpires);
    if (!Number.isFinite(expiresSeconds)) return null;
    return startMs + expiresSeconds * 1000;
  } catch {
    return null;
  }
}

/**
 * Returns a non-expired cached presigned URL for the given object key, or
 * `undefined` if there is no usable cached entry. Expired entries are
 * evicted as a side effect (so the cache cannot grow unbounded over a long
 * session).
 */
function getCachedDownloadUrl(fileKey: string): string | undefined {
  const cached = downloadUrlCache.get(fileKey);
  if (!cached) return undefined;
  if (Date.now() >= cached.expiresAt) {
    // Stale — drop it so it isn't reused and so the map stays bounded.
    downloadUrlCache.delete(fileKey);
    return undefined;
  }
  return cached.url;
}

// ============================================================================
// Download
// ============================================================================

/** The Edge Function action that returns a short-lived presigned GET URL. */
const ACTION_DOWNLOAD = "request-download-url" as const;

/** Shape of a successful `request-download-url` response body. */
interface DownloadUrlResponse {
  download_url: string;
}

/** Calm, honest fallback message (auth-design §7 voice). */
const GENERIC_DOWNLOAD_ERROR = "We couldn't load this media. Please try again.";

/**
 * Result of {@link getMediaDownloadUrl}. `ok` carries the presigned URL; `error`
 * carries a user-facing message when the request failed. The function never
 * throws — callers can use a plain `if`/`else` without a try/catch.
 */
export type DownloadUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Requests a short-lived presigned GET URL for a single media object from the
 * `media-storage` Edge Function, with a session-scoped cache and in-flight
 * de-duplication.
 *
 * Mirrors the upload invoke pattern in `uploadMediaItem`
 * (`supabase.functions.invoke("media-storage", { body })`), just with the
 * `request-download-url` action and a `file_key` payload instead of an upload
 * request. The Edge Function re-derives the `space_id` from the key and
 * re-authorizes Space membership via the caller's JWT context, so no
 * `space_id` is needed here.
 *
 * **Session cache (B2 egress reduction):** if a non-expired presigned URL for
 * this `fileKey` is already cached for the current session, it is returned
 * without an Edge Function round trip. This avoids redundant re-signing when
 * the same media is re-resolved (e.g. a thumbnail card unmounts and remounts
 * on scroll-away/scroll-back, or the same photo shows on the dashboard and
 * the timeline). The cached entry is dropped once its true expiry passes
 * (parsed from the URL's `X-Amz-Date`/`X-Amz-Expires`), so a stale URL is
 * never handed out. This only helps within a single browser session; a full
 * page reload always needs fresh presigned URLs (short-lived by design for
 * security — out of scope to change).
 *
 * **In-flight de-duplication:** concurrent calls for the same `fileKey` share
 * a single Edge Function round trip, so two thumbnail components mounting the
 * same media at once don't sign twice.
 *
 * @param fileKey the durable B2 object key (the `media.url` / `storage_path`
 *   value). Must be non-empty and shaped `{space_id}/{memory_id}/{filename}`.
 * @returns the presigned URL on success, or a calm error message on failure.
 */
export async function getMediaDownloadUrl(
  fileKey: string,
): Promise<DownloadUrlResult> {
  if (!fileKey || fileKey.trim().length === 0) {
    return { ok: false, error: GENERIC_DOWNLOAD_ERROR };
  }

  // 1) Session cache hit — reuse without a round trip. Expired entries are
  //    evicted inside getCachedDownloadUrl.
  const cached = getCachedDownloadUrl(fileKey);
  if (cached) {
    return { ok: true, url: cached };
  }

  // 2) In-flight de-duplication — if a request for this key is already in
  //    flight, await its result rather than firing a second one. The entry is
  //    created on send and deleted on settle, so a later (non-concurrent)
  //    re-call goes through the cache path instead.
  const existing = downloadUrlInFlight.get(fileKey);
  if (existing) {
    return existing;
  }

  // 3) Fresh fetch. The promise is memoized for the duration of the round trip
  //    so concurrent callers de-dupe against step 2.
  const request = (async (): Promise<DownloadUrlResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("media-storage", {
        body: {
          action: ACTION_DOWNLOAD,
          file_key: fileKey,
        },
      });

      const response = data as DownloadUrlResponse | null;

      if (error || !response?.download_url) {
        return { ok: false, error: GENERIC_DOWNLOAD_ERROR };
      }

      const url = response.download_url;

      // Write-through into the session cache. Parse the true expiry from the
      // presigned URL's X-Amz-Date + X-Amz-Expires so we reuse it for its full
      // validity window; fall back to a conservative lifetime if parsing
      // fails so a cached entry is never trusted past the worst-case TTL.
      const expiresAt = parsePresignedExpiry(url);
      downloadUrlCache.set(fileKey, {
        url,
        expiresAt:
          expiresAt ?? Date.now() + DOWNLOAD_URL_TTL_FALLBACK_SECONDS * 1000,
      });

      return { ok: true, url };
    } catch {
      // Network failures and unexpected thrown errors resolve to the same calm,
      // honest message (auth-design §7). The caller never sees a raw exception.
      return { ok: false, error: GENERIC_DOWNLOAD_ERROR };
    } finally {
      // Always clear the in-flight slot so a failed/aborted request can be
      // retried (the cache path won't have a hit, and a new request can fire).
      downloadUrlInFlight.delete(fileKey);
    }
  })();

  downloadUrlInFlight.set(fileKey, request);
  return request;
}

// ============================================================================
// Upload (shared pipeline — feature-specs §3)
// ============================================================================
//
// The upload pipeline lives here so both `CreateMemoryPage` (create flow) and
// `MediaGallery` (add-to-existing-Memory flow) share exactly one implementation:
// classify → compress (images only) → request presigned PUT → upload to B2 →
// insert `media` row → generate thumbnail (fire-and-forget). Extracting it
// avoids ~80 lines of duplication and guarantees the two flows can never drift.

/**
 * Maximum size for a single video upload (feature-specs §3).
 *
 * Videos are uploaded as-is (no client-side compression), so this ceiling
 * protects both the user's bandwidth and the presigned-URL upload window.
 * Images have no size limit — they are compressed before upload.
 */
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Maximum edge length (width or height) for an uploaded image. Larger images
 * are scaled down via canvas before upload to keep storage and bandwidth
 * reasonable while preserving enough resolution for the gallery and lightbox.
 */
export const MAX_IMAGE_EDGE_PX = 2000;

/** Calm, honest fallback message for a failed upload (auth-design §7 voice). */
export const GENERIC_UPLOAD_ERROR = "Couldn't upload this file. Try again.";

/**
 * File extensions recognized as images, used as a fallback when the browser
 * does not report a reliable MIME type for a selected file (feature-specs §3).
 *
 * Some OS/browser combinations leave `file.type` as an empty string for files
 * chosen through the native picker. When that happens, the extension is the
 * only available signal, so these lists mirror the `accept` attribute's intent.
 */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "heic"] as const;

/**
 * File extensions recognized as videos, the extension-based counterpart to
 * {@link IMAGE_EXTENSIONS}.
 */
const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "avi"] as const;

/**
 * Classifies a selected file as an image, a video, or neither.
 *
 * The MIME type (`file.type`) is the primary signal — when the browser reports
 * `image/*` or `video/*` the file is classified immediately. When `file.type`
 * is empty or unrecognized (which happens on some OS/browser combinations for
 * files picked through the native chooser), the file's extension is used as a
 * secondary signal. A file is only rejected when neither the MIME type nor the
 * extension matches a known image or video format.
 */
export function classifyMediaType(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";

  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < file.name.length - 1) {
    const ext = file.name.slice(dotIndex + 1).toLowerCase();
    if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
    if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  }

  return null;
}

/**
 * Loads an image element from a `File` via an object URL, revoking the URL once
 * the image has decoded (or failed). Used by the upload pipeline to draw the
 * image onto a canvas for compression.
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image."));
    };
    img.src = objectUrl;
  });
}

/**
 * Wraps `HTMLCanvasElement.toBlob` in a promise so it can be `await`ed during
 * image compression.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * A file the user has selected for attachment to a Memory, along with its
 * upload lifecycle state.
 *
 * `id` is generated with `crypto.randomUUID()` so each entry can be keyed
 * stably in the list. `file`, `name`, and `size` are immutable after creation —
 * only `status` and `error` change as the file moves through validation and
 * upload.
 *
 * `mediaType` is `null` for files that are neither image nor video; such files
 * are always marked `failed` at selection time and never uploaded.
 */
export type SelectedMediaFile = {
  id: string;
  file: File;
  name: string;
  size: number;
  mediaType: "image" | "video" | null;
  status: "pending" | "compressing" | "uploading" | "done" | "failed";
  error?: string;
};

/**
 * Display text and color for each file status, keyed by the status value.
 * Using a `Record` (rather than a switch) lets TypeScript enforce
 * exhaustiveness — adding a new status without a label is a compile error.
 */
export const STATUS_LABELS: Record<
  SelectedMediaFile["status"],
  { text: string; className: string }
> = {
  pending: { text: "Waiting", className: "text-ink-muted" },
  compressing: { text: "Compressing…", className: "text-accent-400" },
  uploading: { text: "Uploading…", className: "text-accent-400" },
  done: { text: "Done", className: "text-accent-400" },
  failed: { text: "Failed", className: "text-error" },
};

/** The Edge Function action that returns a presigned PUT URL. */
const ACTION_UPLOAD = "request-upload-url" as const;

/** Shape of a successful `request-upload-url` response body. */
interface UploadUrlResponse {
  upload_url: string;
  file_key: string;
}

/** The Edge Function action that generates a server-side image thumbnail. */
const ACTION_GENERATE_THUMBNAIL = "generate-thumbnail" as const;

/**
 * Maximum long edge (width or height) for a client-extracted video poster
 * thumbnail. Matches the server-side thumbnail size (see the `media-thumbnail`
 * Edge Function) — 400px gives ~6.25x the 64px display, crisp on 2x/3x retina.
 */
const THUMBNAIL_MAX_EDGE_PX = 400;

/**
 * WebP encoding quality for client-extracted video posters. Matches the
 * server-side thumbnail quality (see the `media-thumbnail` Edge Function).
 */
const THUMBNAIL_WEBP_QUALITY = 0.78;

/**
 * Intermediate status transitions the upload pipeline reports via
 * {@link UploadMediaItemParams.onStatus}. The caller observes these to update
 * a per-file status list; the final outcome (`done` / `failed`) is communicated
 * by the {@link UploadResult} return value.
 */
export type UploadStatus = "compressing" | "uploading";

/** Parameters for {@link uploadMediaItem}. */
export type UploadMediaItemParams = {
  /** The raw file to upload. */
  file: File;
  /** The classified media kind — the caller must classify via
   *  {@link classifyMediaType} before calling (null files are never uploaded). */
  mediaType: "image" | "video";
  /** The Space the Memory belongs to (becomes the first path segment of the
   *  B2 object key and is re-checked by the Edge Function). */
  spaceId: string;
  /** The Memory to attach the media row to. */
  memoryId: string;
  /** Optional callback for intermediate status transitions. The final outcome
   *  is returned via {@link UploadResult}, not via this callback. */
  onStatus?: (status: UploadStatus) => void;
};

/**
 * Result of {@link uploadMediaItem}. `ok` carries the inserted `media` row;
 * `error` carries a user-facing message when the upload failed. The function
 * never throws — callers can use a plain `if`/`else` without a try/catch.
 */
export type UploadResult =
  | { ok: true; media: Media }
  | { ok: false; error: string };

/**
 * Uploads a single file and inserts its `media` row.
 *
 * This is the shared upload pipeline extracted from `CreateMemoryPage.uploadOneFile`:
 *  1. **Compress** (images only) — scale down to {@link MAX_IMAGE_EDGE_PX} and
 *     re-encode as JPEG quality 0.8. Videos are uploaded as-is.
 *  2. **Request** a presigned PUT URL from the `media-storage` Edge Function
 *     (`request-upload-url`), which re-checks Space membership via the caller's
 *     JWT.
 *  3. **Upload** the (possibly compressed) blob to B2 via the presigned URL.
 *  4. **Insert** a `media` row storing the durable B2 object key (not the
 *     expiring presigned URL) in `url` / `storage_path`.
 *
 * If any step fails the function returns `{ ok: false, error }` — no partial
 * `media` row is created (a failed DB insert after a successful B2 PUT leaves
 * an orphaned B2 object, which is non-fatal and matches the original behavior).
 *
 * @returns the inserted `media` row on success, or a calm error message.
 */
/**
 * Yields to the main thread to prevent blocking during CPU-intensive work.
 * Uses scheduler.yield() when available (modern browsers), falls back to setTimeout.
 */
function yieldToMainThread(): Promise<void> {
  // Type-safe check for scheduler.yield() API
  const win = window as Window & { scheduler?: { yield?: () => Promise<void> } };
  if ("scheduler" in window && win.scheduler?.yield) {
    return win.scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function uploadMediaItem(
  params: UploadMediaItemParams,
): Promise<UploadResult> {
  const { file, mediaType, spaceId, memoryId, onStatus } = params;

  try {
    let uploadBlob: Blob;
    let uploadContentType: string;

    if (mediaType === "image") {
      onStatus?.("compressing");
      const img = await loadImageFromFile(file);
      // Yield after image decode to let the main thread breathe
      await yieldToMainThread();

      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > MAX_IMAGE_EDGE_PX || height > MAX_IMAGE_EDGE_PX) {
        const scale = MAX_IMAGE_EDGE_PX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable.");
      ctx.drawImage(img, 0, 0, width, height);
      // Yield after drawImage (synchronous, CPU-intensive) to prevent blocking
      await yieldToMainThread();

      const blob = await canvasToBlob(canvas, "image/jpeg", 0.8);
      if (!blob) throw new Error("Image compression failed.");
      uploadBlob = blob;
      uploadContentType = "image/jpeg";
    } else {
      uploadBlob = file;
      uploadContentType = file.type || "video/mp4";
    }

    onStatus?.("uploading");

    const { data, error } = await supabase.functions.invoke("media-storage", {
      body: {
        action: ACTION_UPLOAD,
        space_id: spaceId,
        memory_id: memoryId,
        filename: file.name,
        content_type: uploadContentType,
      },
    });

    const responseData = data as UploadUrlResponse | null;

    if (error || !responseData?.upload_url || !responseData?.file_key) {
      throw new Error("Upload URL request failed.");
    }

    const putResponse = await fetch(responseData.upload_url, {
      method: "PUT",
      headers: { "Content-Type": uploadContentType },
      body: uploadBlob,
    });

    if (!putResponse.ok) {
      throw new Error("Upload PUT failed.");
    }

    const { data: mediaData, error: mediaError } = await supabase
      .from("media")
      .insert({
        memory_id: memoryId,
        // url holds the durable B2 object key, not an expiring presigned URL.
        url: responseData.file_key,
        storage_path: responseData.file_key,
        type: mediaType,
      })
      .select()
      .single();

    if (mediaError || !mediaData) {
      throw new Error("Media row insert failed.");
    }

    const media = mediaData as Media;

    // Generate a thumbnail variant (fire-and-forget, failure non-fatal).
    // The original media is already uploaded and the row exists — thumbnail
    // generation is a background optimization. If it fails, thumbnail_path
    // stays NULL and the client falls back to the original at display time.
    // The returned `media` object has thumbnail_path: null; the thumbnail
    // appears on the next page load (or when the row is refetched).
    if (mediaType === "image") {
      // Images: the server generates the thumbnail via the `media-thumbnail`
      // Edge Function (jSquash WASM pipeline). The function fetches the
      // original from B2, resizes/encodes, uploads the thumbnail, and calls
      // set_media_thumbnail RPC itself.
      void generateImageThumbnail(
        responseData.file_key,
        media.id,
        uploadContentType,
      );
    } else {
      // Videos: the client extracts a poster frame (server-side extraction is
      // not feasible in Deno — ffmpeg.wasm is too heavy). The poster is
      // uploaded to B2 and registered via set_media_thumbnail RPC.
      void generateVideoPosterThumbnail(file, spaceId, memoryId, media.id);
    }

    return { ok: true, media };
  } catch {
    // Network failures, compression errors, and unexpected thrown errors all
    // resolve to the same calm, honest message (auth-design §7). The caller
    // never sees a raw exception.
    return { ok: false, error: GENERIC_UPLOAD_ERROR };
  }
}

// ============================================================================
// Thumbnail generation (media web optimizer — plans/media-web-optimizer.md)
// ============================================================================
//
// After a media row is inserted, a small thumbnail variant is generated so
// thumbnail displays (timeline cards, dashboard cards) pull a ~15-40KB WebP
// instead of a full-resolution original. This is a background optimization —
// failure is non-fatal: the original media is already uploaded, and if the
// thumbnail can't be generated the thumbnail_path stays NULL and the client
// falls back to the original (no regression for old or failed media).
//
// IMAGES: the server generates the thumbnail. The client invokes the
// `media-thumbnail` Edge Function, which fetches the original from B2, decodes
// it via jSquash WASM (JPEG/PNG/WebP), resizes to 400px max edge (Lanczos3),
// encodes as WebP (quality 78), uploads the thumbnail to B2, and calls
// set_media_thumbnail RPC to register it. The client's only job is to invoke
// the function — all processing is server-side.
//
// VIDEOS: the client extracts a poster frame. Server-side video poster
// extraction is not feasible in a Deno Edge Function (ffmpeg.wasm is ~25-30MB,
// too heavy for Edge Function limits). Instead, the client loads the video
// into a <video> element, seeks to ~1 second, draws the frame to a canvas
// (resized to 400px max edge), exports as WebP, uploads to B2 via the existing
// media-storage presigned PUT flow, and calls set_media_thumbnail RPC. This
// achieves the actual goal: zero video bytes are downloaded at display time —
// the thumbnail component renders an <img> with the poster, not a <video>.

/**
 * Invokes the `media-thumbnail` Edge Function to generate a server-side
 * thumbnail for an uploaded image. The function fetches the original from B2,
 * decodes/resizes/encodes it via jSquash WASM, uploads the thumbnail to B2,
 * and calls `set_media_thumbnail` RPC to register it.
 *
 * Fire-and-forget from the upload pipeline's perspective: any failure is
 * caught silently — the original media is already uploaded and the media row
 * exists. The thumbnail_path stays NULL and the client falls back to the
 * original.
 */
async function generateImageThumbnail(
  fileKey: string,
  mediaId: string,
  contentType: string,
): Promise<void> {
  try {
    await supabase.functions.invoke("media-thumbnail", {
      body: {
        action: ACTION_GENERATE_THUMBNAIL,
        file_key: fileKey,
        media_id: mediaId,
        content_type: contentType,
      },
    });
  } catch {
    // Non-fatal — the upload already succeeded. thumbnail_path stays NULL.
  }
}

/**
 * Extracts a poster frame from a video file by loading it into a `<video>`
 * element, seeking to ~1 second, and drawing the frame to a canvas resized to
 * thumbnail dimensions. The canvas is exported as a WebP blob.
 *
 * Returns `null` if extraction fails for any reason (decode error, canvas
 * unavailable, etc.) — the caller treats this as non-fatal.
 */
function extractVideoPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
    };

    video.onloadedmetadata = () => {
      // Seek to ~1 second, or 10% of duration for very short clips.
      const seekTime = Math.min(1, (video.duration || 10) * 0.1);
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      if (!srcW || !srcH) {
        cleanup();
        resolve(null);
        return;
      }
      // Resize to thumbnail dimensions (400px max long edge).
      let width = srcW;
      let height = srcH;
      if (width > THUMBNAIL_MAX_EDGE_PX || height > THUMBNAIL_MAX_EDGE_PX) {
        const scale = THUMBNAIL_MAX_EDGE_PX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          resolve(blob);
        },
        "image/webp",
        THUMBNAIL_WEBP_QUALITY,
      );
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = objectUrl;
  });
}

/**
 * Uploads a video poster blob to B2 as a thumbnail by requesting a presigned
 * PUT URL from the `media-storage` Edge Function (reusing the existing upload
 * flow). Returns the durable B2 object key for the poster, or `null` if the
 * upload failed.
 *
 * The poster is stored as a separate B2 object with key
 * `{space_id}/{memory_id}/{uuid}.webp` — the same key shape as original media,
 * so the download/delete actions in `media-storage` can re-derive and
 * re-authorize the space from the key alone.
 */
async function uploadVideoPoster(
  posterBlob: Blob,
  spaceId: string,
  memoryId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("media-storage", {
      body: {
        action: ACTION_UPLOAD,
        space_id: spaceId,
        memory_id: memoryId,
        filename: "poster.webp",
        content_type: "image/webp",
      },
    });

    const responseData = data as UploadUrlResponse | null;
    if (error || !responseData?.upload_url || !responseData?.file_key) {
      return null;
    }

    const putResponse = await fetch(responseData.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: posterBlob,
    });

    if (!putResponse.ok) {
      return null;
    }

    return responseData.file_key;
  } catch {
    return null;
  }
}

/**
 * Generates a video poster thumbnail entirely client-side: extracts a frame
 * from the video, uploads it to B2, and registers it via `set_media_thumbnail`
 * RPC. Every step is non-fatal — if any step fails, the thumbnail_path stays
 * NULL and the client falls back to the original video at display time.
 */
async function generateVideoPosterThumbnail(
  file: File,
  spaceId: string,
  memoryId: string,
  mediaId: string,
): Promise<void> {
  try {
    const poster = await extractVideoPoster(file);
    if (!poster) return;

    const thumbnailKey = await uploadVideoPoster(poster, spaceId, memoryId);
    if (!thumbnailKey) return;

    await supabase.rpc("set_media_thumbnail", {
      p_media_id: mediaId,
      p_thumbnail_path: thumbnailKey,
    });
  } catch {
    // Non-fatal — the upload already succeeded. thumbnail_path stays NULL.
  }
}

// ============================================================================
// Delete (feature-specs §3, backend-implementation §13.4)
// ============================================================================
//
// Deleting media removes the `media` row and all associated B2 objects (the
// original media file and, if one exists, the thumbnail variant). The
// ordering is **DB first, then B2**: the row delete is RLS-gated
// (`media_delete` = creator OR Space owner), so it is the real authorization
// gate. If any B2 delete fails the orphan is non-fatal — the row is already
// gone, so the gallery updates immediately; a future cleanup pass can sweep
// orphans. If the DB delete fails we do NOT touch B2, so no orphan is created.

/** The Edge Function action that deletes a B2 object. */
const ACTION_DELETE = "request-delete-url" as const;

/** Calm, honest fallback message for a failed delete (auth-design §7 voice). */
const GENERIC_DELETE_ERROR = "We couldn't delete this media. Please try again.";

/**
 * Result of {@link deleteMedia}. On success `ok` is `true`; if any B2 object
 * could not be deleted (but the DB row was), `b2Orphaned` is `true` — the
 * gallery can still remove the tile because the row is gone. On failure `error`
 * carries a user-facing message and the row is untouched.
 */
export type DeleteResult =
  | { ok: true; b2Orphaned?: true }
  | { ok: false; error: string };

/**
 * Deletes a single media item: the `media` row first (RLS-gated), then all
 * associated B2 objects (the original media file and, if one exists, the
 * thumbnail variant).
 *
 * **Step A — DB row:** `supabase.from("media").delete().eq("id", media.id)`.
 * The `media_delete` RLS policy (creator OR Space owner) is the real gate. If
 * this fails (RLS denied or error) the function returns `{ ok: false, error }`
 * and does NOT attempt any B2 delete — no orphan is created.
 *
 * **Step B — B2 objects:** invokes `request-delete-url` for the original
 * object key (`media.storage_path` or `media.url`) and, if `media.thumbnail_path`
 * is non-null, for the thumbnail object key. The Edge Function re-derives the
 * `space_id` from each key and re-checks Space membership. If any delete fails
 * the orphan is non-fatal — the row is already gone, so the gallery updates;
 * the function returns `{ ok: true, b2Orphaned: true }`.
 *
 * The function never throws — callers can use a plain `if`/`else` without a
 * try/catch, matching the {@link getMediaDownloadUrl} pattern.
 *
 * @param media the `media` row to delete. Uses `media.id` for the DB delete,
 *   `media.storage_path` (falling back to `media.url`) for the original B2
 *   delete, and `media.thumbnail_path` (if non-null) for the thumbnail B2 delete.
 * @returns `{ ok: true }` (optionally with `b2Orphaned`) or `{ ok: false, error }`.
 */
export async function deleteMedia(media: Media): Promise<DeleteResult> {
  // Step A — delete the DB row (RLS-gated by media_delete).
  const { error: dbError } = await supabase
    .from("media")
    .delete()
    .eq("id", media.id);

  if (dbError) {
    return { ok: false, error: GENERIC_DELETE_ERROR };
  }

  // Step B — delete the B2 objects (original + thumbnail, if one exists).
  // Non-fatal if any fails — the row is already gone, so the gallery updates
  // immediately; orphaned B2 objects can be swept by a future cleanup pass.
  const fileKey = media.storage_path || media.url;
  const thumbnailKey = media.thumbnail_path;

  let b2Orphaned = false;

  // Delete the original B2 object.
  try {
    const { error: fnError } = await supabase.functions.invoke("media-storage", {
      body: {
        action: ACTION_DELETE,
        file_key: fileKey,
      },
    });
    if (fnError) {
      // The row is already gone, so the gallery can still update — but a
      // silent swallow here is exactly how the previous "B2 objects never
      // deleted" bug went undiagnosed for weeks. Surface the error to the
      // console (with the object key) so a future regression is visible.
      console.error(
        `[deleteMedia] B2 delete failed for original key "${fileKey}":`,
        fnError,
      );
      b2Orphaned = true;
    }
  } catch (err) {
    // Network failures and unexpected thrown errors: the row is already gone,
    // so the gallery can still update. The B2 orphan is non-fatal — but log
    // it so it is diagnosable rather than completely silent.
    console.error(
      `[deleteMedia] B2 delete threw for original key "${fileKey}":`,
      err,
    );
    b2Orphaned = true;
  }

  // Delete the thumbnail B2 object (if one exists).
  if (thumbnailKey) {
    try {
      const { error: fnError } = await supabase.functions.invoke(
        "media-storage",
        {
          body: {
            action: ACTION_DELETE,
            file_key: thumbnailKey,
          },
        },
      );
      if (fnError) {
        console.error(
          `[deleteMedia] B2 delete failed for thumbnail key "${thumbnailKey}":`,
          fnError,
        );
        b2Orphaned = true;
      }
    } catch (err) {
      console.error(
        `[deleteMedia] B2 delete threw for thumbnail key "${thumbnailKey}":`,
        err,
      );
      b2Orphaned = true;
    }
  }

  return b2Orphaned ? { ok: true, b2Orphaned: true } : { ok: true };
}

// ============================================================================
// Timeline thumbnails batch (feature-specs §3 — card photo thumbnail)
// ============================================================================
//
// The Space timeline card redesign shows a small (~64px) photo thumbnail on
// each Memory card. To avoid fetching every photo of every Memory, only the
// first 1–2 media rows per Memory (ordered by created_at ASC — oldest first,
// matching the gallery's reading order) are loaded, batched across the whole
// timeline in a single round trip.
//
// A flat `select(...).in("memory_id", ids)` (the mechanism
// fetchMemoryReactionsBatch uses) cannot express a per-group LIMIT — it would
// return ALL media for all the requested Memories. So this helper calls a
// read-only RPC (`get_timeline_thumbnails`) that uses ROW_NUMBER() OVER
// (PARTITION BY memory_id) to return at most 2 rows per Memory. This honors
// the *spirit* of the reactions batch (one round trip, client-side grouping
// into a per-Memory map, calm failure, page-owned state) while using the only
// mechanism that can express the per-group limit. See the migration
// 20260723110000_get_timeline_thumbnails_rpc.sql for the security reasoning
// (SECURITY INVOKER so media_select RLS filters exactly as a plain select).
//
// The RPC returns durable B2 object keys (media.url / storage_path), NOT
// presigned URLs. The per-thumbnail presigned GET URL is resolved client-side
// by the thumbnail component via getMediaDownloadUrl (mirrors MediaGallery),
// so a timeline of N cards resolves at most 2N short-lived URLs rather than
// fetching full-resolution photos up front.
//
// NOTE (flagged follow-up, out of scope): the thumbnail still requests a
// full-resolution presigned GET URL for a ~64px square. The proper fix is a
// thumbnail/small-size image variant generated at upload time (the "media web
// optimizer" TODO). The per-group LIMIT (1–2 rows) is the only bandwidth
// mitigation available without the optimizer.

/**
 * Fetches the first 1–2 media rows per Memory in a **single** RPC round trip
 * and groups them into a per-Memory map, keyed by `memoryId`.
 *
 * This is the thumbnail counterpart to {@link fetchMemoryReactionsBatch},
 * used by the Space timeline so a list of N Memories doesn't trigger N round
 * trips (the N+1 problem) and doesn't fetch every photo of every Memory. One
 * `rpc("get_timeline_thumbnails", { p_memory_ids })` call returns at most 2
 * rows per Memory (oldest first); the rows are grouped client-side into the
 * result map.
 *
 * Every requested `memoryId` is present in the result with an array (possibly
 * empty), even Memories with no media — so the timeline can render every card
 * without a separate "no media" branch (a Memory with no media maps to `[]`,
 * which the card renders as "no thumbnail, no placeholder, no broken-image
 * icon"). An empty `memoryIds` array returns `{}` without a round trip
 * (defensive; the timeline only renders thumbnails when there are Memories).
 *
 * Rows whose `type` is neither image nor video are dropped (defensive against
 * malformed/future types — see {@link asMediaType}), matching how
 * `MediaGallery` drops rows whose `type` isn't image/video.
 *
 * RLS (`media_select` = Space member, via the parent memory's space) auto-
 * filters the rows because the RPC is SECURITY INVOKER, so a non-member
 * receives nothing and every Memory maps to an empty array — the same calm
 * "not found or no access" path as reactions.
 *
 * @throws the underlying Supabase error if the RPC fails. Callers handle this
 *   gracefully (the timeline treats a batch failure as a calm load error and
 *   still renders the cards, just without thumbnails).
 */
export async function fetchTimelineThumbnailsBatch(
  memoryIds: string[],
): Promise<Record<string, Media[]>> {
  // Seed every requested Memory with an empty array so the result is total:
  // a Memory with no media (or one not yet returned by RLS) still has a
  // well-formed entry the timeline can render without a special-case branch.
  const map: Record<string, Media[]> = {};
  for (const id of memoryIds) {
    map[id] = [];
  }

  if (memoryIds.length === 0) {
    // No Memories to fetch for — skip the round trip entirely.
    return map;
  }

  const { data, error } = await supabase.rpc("get_timeline_thumbnails", {
    p_memory_ids: memoryIds,
  });

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as Media[]) {
    // Drop rows whose type is neither image nor video (defensive, mirrors
    // MediaGallery). They are not displayed as thumbnails.
    if (asMediaType(row.type) === null) {
      continue;
    }
    // The RPC only returns rows for requested memory_ids, but guard so a stray
    // row can't crash the build if the contract ever changes.
    const bucket = map[row.memory_id];
    if (bucket) {
      bucket.push(row);
    }
  }

  return map;
}

// ============================================================================
// Space list thumbnails batch (Space card redesign — card photo preview)
// ============================================================================
//
// The "Your Spaces" dashboard redesign shows a small (~64px) photo preview on
// each Space card so Spaces feel alive on the list, mirroring the Memory card
// thumbnail on the Space timeline. To avoid fetching every photo of every
// Space, only the first 1–2 media rows of the MOST RECENT Memory of each Space
// are loaded, batched across all of a user's Spaces in a single round trip.
//
// This is the Space-list counterpart to {@link fetchTimelineThumbnailsBatch}.
// The same per-group-LIMIT constraint applies (a flat `.in("space_id", ids)`
// cannot express "most recent Memory per Space, then first 1–2 media rows of
// it"), so this helper calls a read-only RPC
// (`get_space_list_thumbnails`) that:
//   1. ROW_NUMBER() PARTITION BY space_id ORDER BY memory_date DESC,
//      created_at DESC → rn = 1 (the most recent Memory per Space, mirroring
//      the timeline's ordering), then
//   2. joins `media` and ROW_NUMBER() PARTITION BY space_id ORDER BY
//      media.created_at ASC → mrn <= 2 (the first 1–2 media rows of that one
//      Memory, oldest-first — matches the gallery's reading order).
//
// The RPC returns rows tagged with `space_id` (NOT `memory_id` — the grouping
// key is the Space, since the dashboard groups by Space), so this helper
// groups client-side into a per-Space map. It honors the same spirit as the
// timeline batch (one round trip, client-side grouping, calm failure,
// page-owned state) while using the only mechanism that can express the
// per-group limit.
//
// The RPC returns durable B2 object keys (media.url / storage_path), NOT
// presigned URLs. The per-thumbnail presigned GET URL is resolved client-side
// by the thumbnail component via getMediaDownloadUrl (mirrors MediaGallery /
// the timeline thumbnail), so a list of N Spaces resolves at most 2N
// short-lived URLs rather than fetching full-resolution photos up front.
//
// NOTE (flagged follow-up, out of scope): the thumbnail still requests a
// full-resolution presigned GET URL for a ~64px square. The proper fix is a
// thumbnail/small-size image variant generated at upload time (the "media web
// optimizer" TODO). The per-Space LIMIT (1–2 rows of one Memory) is the only
// bandwidth mitigation available without the optimizer.

/**
 * Row shape returned by the `get_space_list_thumbnails` RPC — a {@link Media}
 * row plus the `space_id` it was fetched for (the grouping key for the
 * dashboard). The RPC tags every media row with its Space so the client can
 * group by Space without a second lookup.
 */
type SpaceListThumbnailRow = Media & { space_id: string };

/**
 * Fetches the first 1–2 media rows of the most recent Memory per Space in a
 * **single** RPC round trip and groups them into a per-Space map, keyed by
 * `spaceId`.
 *
 * This is the Space-list counterpart to {@link fetchTimelineThumbnailsBatch},
 * used by the Spaces Dashboard so a list of N Spaces doesn't trigger N round
 * trips (the N+1 problem) and doesn't fetch every photo of every Space. One
 * `rpc("get_space_list_thumbnails", { p_space_ids })` call returns at most 2
 * rows per Space (the first 1–2 media rows of that Space's most recent
 * Memory, oldest first); the rows are grouped client-side into the result
 * map.
 *
 * Every requested `spaceId` is present in the result with an array (possibly
 * empty), even Spaces with no Memories or no media — so the dashboard can
 * render every card without a separate "no media" branch (a Space with no
 * media maps to `[]`, which the card renders as "no thumbnail, no
 * placeholder, no broken-image icon"). An empty `spaceIds` array returns
 * `{}` without a round trip (defensive; the dashboard only fetches
 * thumbnails when there are Spaces).
 *
 * Rows whose `type` is neither image nor video are dropped (defensive against
 * malformed/future types — see {@link asMediaType}), matching how
 * `MediaGallery` and {@link fetchTimelineThumbnailsBatch} drop rows whose
 * `type` isn't image/video.
 *
 * RLS (`memories_select` + `media_select`, both via the parent memory's
 * space) auto-filters the rows because the RPC is SECURITY INVOKER, so a
 * non-member receives nothing and every Space maps to an empty array — the
 * same calm "not found or no access" path as the timeline thumbnails.
 *
 * @throws the underlying Supabase error if the RPC fails. Callers handle this
 *   gracefully (the dashboard treats a batch failure as a calm load error and
 *   still renders the cards, just without thumbnails).
 */
export async function fetchSpaceListThumbnailsBatch(
  spaceIds: string[],
): Promise<Record<string, Media[]>> {
  // Seed every requested Space with an empty array so the result is total:
  // a Space with no Memories / no media (or one not yet returned by RLS) still
  // has a well-formed entry the dashboard can render without a special-case
  // branch.
  const map: Record<string, Media[]> = {};
  for (const id of spaceIds) {
    map[id] = [];
  }

  if (spaceIds.length === 0) {
    // No Spaces to fetch for — skip the round trip entirely.
    return map;
  }

  const { data, error } = await supabase.rpc("get_space_list_thumbnails", {
    p_space_ids: spaceIds,
  });

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as SpaceListThumbnailRow[]) {
    // Drop rows whose type is neither image nor video (defensive, mirrors
    // MediaGallery + fetchTimelineThumbnailsBatch). They are not displayed as
    // thumbnails.
    if (asMediaType(row.type) === null) {
      continue;
    }
    // The RPC only returns rows for requested space_ids, but guard so a stray
    // row can't crash the build if the contract ever changes.
    const bucket = map[row.space_id];
    if (bucket) {
      bucket.push(row);
    }
  }

  return map;
}

// ============================================================================
// Mosaic thumbnails batch (MultiPhotoMosaic — Space Dashboard & Timeline)
// ============================================================================
//
// The MultiPhotoMosaic component needs up to 3 representative photos per Space
// (Dashboard) or per Memory (Timeline). To avoid N+1 fetches, we batch across
// all Spaces/Memories in a single RPC round trip.
//
// Two separate RPCs (matching the existing get_timeline_thumbnails /
// get_space_list_thumbnails pattern):
//   - get_space_mosaic_thumbnails: most recent photos across ALL memories in a Space
//   - get_memory_mosaic_thumbnails: most recent photos within a specific Memory
//
// Both use SECURITY INVOKER + is_space_member pattern (same as existing
// thumbnail RPCs). They return durable B2 object keys (thumbnail_grid_path
// preferred), NOT presigned URLs. The per-thumbnail presigned GET URL is
// resolved client-side by the component via getMediaDownloadUrl.

/**
 * Fetches up to 3 most recent photos across all Memories in each Space.
 * Used by Spaces Dashboard cards.
 *
 * @param spaceIds Array of Space IDs to fetch mosaics for
 * @returns Map of spaceId -> Media[] (up to 3 per Space, most recent first)
 */
export async function fetchSpaceMosaicThumbnailsBatch(
  spaceIds: string[],
): Promise<Record<string, Media[]>> {
  const map: Record<string, Media[]> = {};
  for (const id of spaceIds) {
    map[id] = [];
  }

  if (spaceIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase.rpc("get_space_mosaic_thumbnails", {
    p_space_ids: spaceIds,
  });

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as Media[]) {
    if (asMediaType(row.type) === null) {
      continue;
    }
    // The RPC returns rows with space_id for grouping
    const spaceId = (row as Media & { space_id: string }).space_id;
    const bucket = map[spaceId];
    if (bucket && bucket.length < 3) {
      bucket.push(row);
    }
  }

  return map;
}

/**
 * Fetches up to 3 most recent photos within each specific Memory.
 * Used by Space Detail Timeline Memory cards.
 *
 * @param memoryIds Array of Memory IDs to fetch mosaics for
 * @returns Map of memoryId -> Media[] (up to 3 per Memory, most recent first)
 */
export async function fetchMemoryMosaicThumbnailsBatch(
  memoryIds: string[],
): Promise<Record<string, Media[]>> {
  console.log('[fetchMemoryMosaicThumbnailsBatch] Called with memoryIds:', memoryIds, 'length:', memoryIds.length);
  const map: Record<string, Media[]> = {};
  for (const id of memoryIds) {
    map[id] = [];
  }
  console.log('[fetchMemoryMosaicThumbnailsBatch] Map after init:', Object.keys(map).length, 'keys:', Object.keys(map));

  if (memoryIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase.rpc("get_memory_mosaic_thumbnails", {
    p_memory_ids: memoryIds,
  });

  if (error) {
    throw error;
  }

  console.log('[fetchMemoryMosaicThumbnailsBatch] RPC returned:', data?.length ?? 0, 'rows');
  for (const row of (data ?? []) as Media[]) {
    console.log('[fetchMemoryMosaicThumbnailsBatch] Row:', row.memory_id, row.id, row.type, row.thumbnail_grid_path ? 'has_grid' : 'no_grid');
    if (asMediaType(row.type) === null) {
      continue;
    }
    const bucket = map[row.memory_id];
    if (bucket && bucket.length < 3) {
      bucket.push(row);
    } else if (!bucket) {
      console.log('[fetchMemoryMosaicThumbnailsBatch] WARNING: Row memory_id not in map:', row.memory_id);
    }
  }

  console.log('[fetchMemoryMosaicThumbnailsBatch] Before final map, map size:', Object.keys(map).length, 'keys:', Object.keys(map));
  console.log('[fetchMemoryMosaicThumbnailsBatch] Final map:', Object.fromEntries(
    Object.entries(map).map(([k, v]) => [k, v.length])
  ));

  return map;
}
