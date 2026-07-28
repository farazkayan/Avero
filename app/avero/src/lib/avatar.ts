// ============================================================================
// Avero Avatar Upload
// ----------------------------------------------------------------------------
// Client-side avatar upload pipeline:
//  1. Validate file (image/*, ≤ 2 MB)
//  2. (Phase C) User drags to reposition a fixed square crop frame (pan-only)
//  3. Resize to 256×256 square (crop applied) and encode as WebP (quality 0.85)
//  4. Request presigned PUT URL from media-storage Edge Function (action: request-avatar-upload-url)
//  5. PUT the WebP blob to B2 via the presigned URL
//  6. Update profiles.avatar_url with the durable object key (avatars/{user_id}/avatar.webp)
//  7. Return the new avatar_url for immediate UI update
//
// Failure handling: non-destructive — if any step fails, the existing avatar_url
// is preserved and a calm error message is returned.
// ============================================================================

import { supabase } from "./supabase";

// ============================================================================
// Session-scoped presigned-URL cache (avatar load-time parity with thumbnails)
// ============================================================================
//
// `getAvatarDownloadUrl` previously re-invoked the `media-storage` Edge Function
// on every Avatar mount/render with no caching and no in-flight de-duplication.
// Because the Avatar component is mounted in the app shell (every authenticated
// page), every navigation / re-render paid a full Edge Function round trip plus
// a re-signed URL the browser then re-fetched — a consistent, noticeable
// slowdown versus Memory thumbnails, which reuse a session-cached presigned
// URL after the first resolve (see `lib/media.ts`).
//
// This mirrors the exact, proven pattern in `lib/media.ts`:
//  - a module-level `Map<fileKey, { url, expiresAt }>` cache that survives
//    component unmount/remount for the document lifetime,
//  - the real TTL parsed from the URL's `X-Amz-Date` / `X-Amz-Expires` params
//    (with a conservative fallback so a cached entry is never trusted past the
//    worst-case real expiry),
//  - an in-flight `Map<fileKey, Promise>` so concurrent callers for the same
//    avatar key share a single Edge Function round trip.
//
// SCOPE LIMIT: this only helps within a single browser session. A full page
// reload or a new visit always needs a fresh presigned URL — they are
// short-lived by design for security. The cache is in-memory (module-level),
// so it dies with the document.
//
// On avatar upload/delete the cache entry for the user's key is invalidated
// via `invalidateAvatarDownloadUrlCache` so a freshly uploaded avatar is never
// served from a stale URL (the object key is stable: `avatars/{user_id}/avatar.webp`,
// so the same key is reused across uploads — the cached URL would point at the
// previous object version's signature, which B2 may or may not serve).
// ----------------------------------------------------------------------------

/**
 * Conservative fallback lifetime used when a presigned URL's true expiry cannot
 * be parsed from its query string. The real download TTL is 1 hour (see
 * `DOWNLOAD_URL_TTL_SECONDS` in the Edge Function); if parsing fails we assume
 * the shorter of the two known TTLs (the upload TTL, 15 min) so a cached entry
 * is never trusted past the worst-case real expiry. Mirrors `lib/media.ts`.
 */
const AVATAR_DOWNLOAD_URL_TTL_FALLBACK_SECONDS = 15 * 60;

/** One cached presigned-URL entry: the URL plus the epoch ms at which its
 *  signature expires and it must no longer be reused. */
interface CachedAvatarDownloadUrl {
  url: string;
  /** Epoch ms after which the presigned signature is invalid (must re-sign). */
  expiresAt: number;
}

/**
 * The session-scoped cache, keyed by the durable B2 object key
 * (`profiles.avatar_url`). Module-level so it survives component
 * unmount/remount and is shared across every caller of
 * `getAvatarDownloadUrl`. Cleared only by a full page reload (document
 * lifetime). Mirrors `downloadUrlCache` in `lib/media.ts`.
 */
const avatarDownloadUrlCache = new Map<string, CachedAvatarDownloadUrl>();

/**
 * Promises for in-flight `request-download-url` calls, keyed by object key.
 * De-duplicates concurrent requests for the same key (e.g. two Avatar
 * components mounting at once) so the Edge Function is invoked once, not
 * twice — the second caller awaits the first's promise. Entries are created
 * on send and deleted on settle. Mirrors `downloadUrlInFlight` in `lib/media.ts`.
 */
const avatarDownloadUrlInFlight = new Map<
  string,
  Promise<AvatarDownloadResult>
>();

/**
 * Parses a presigned URL's true expiry as epoch milliseconds.
 *
 * AWS S3 / B2 presigned URLs carry the signing start time as `X-Amz-Date`
 * (ISO 8601 basic, e.g. `20260723T133000Z`) and the validity window as
 * `X-Amz-Expires` (seconds). The signature is valid from `X-Amz-Date` for
 * `X-Amz-Expires` seconds. Returns `null` if either param is missing or
 * unparseable — the caller then falls back to the conservative
 * {@link AVATAR_DOWNLOAD_URL_TTL_FALLBACK_SECONDS} so a cached entry is never
 * trusted longer than the worst-case real TTL. Mirrors `parsePresignedExpiry`
 * in `lib/media.ts`.
 */
function parseAvatarPresignedExpiry(url: string): number | null {
  try {
    const parsed = new URL(url);
    const amzDate = parsed.searchParams.get("X-Amz-Date");
    const amzExpires = parsed.searchParams.get("X-Amz-Expires");
    if (!amzDate || !amzExpires) return null;
    // X-Amz-Date is ISO 8601 basic: YYYYMMDDTHHMMSSZ. Convert to the extended
    // form the Date constructor accepts before parsing.
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
 * `undefined` if there is no usable cached entry. Expired entries are evicted
 * as a side effect (so the cache cannot grow unbounded over a long session).
 */
function getCachedAvatarDownloadUrl(fileKey: string): string | undefined {
  const cached = avatarDownloadUrlCache.get(fileKey);
  if (!cached) return undefined;
  if (Date.now() >= cached.expiresAt) {
    // Stale — drop it so it isn't reused and so the map stays bounded.
    avatarDownloadUrlCache.delete(fileKey);
    return undefined;
  }
  return cached.url;
}

/**
 * Drops any cached presigned URL for the given object key.
 *
 * Called after a successful avatar upload or delete so a subsequent
 * `getAvatarDownloadUrl` for the same (stable) key re-signs a fresh URL
 * instead of reusing a stale one. The avatar object key is
 * `avatars/{user_id}/avatar.webp` — it does not change across uploads, so
 * without invalidation the cache would keep handing out the previous
 * signature until its TTL elapsed.
 */
export function invalidateAvatarDownloadUrlCache(fileKey: string): void {
  avatarDownloadUrlCache.delete(fileKey);
}

/** Maximum file size for avatar uploads (2 MB). */
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

/** Target square dimension for avatar (covers 2×/3× retina for 64–128 px display). */
const AVATAR_SIZE = 256;

/** WebP encoding quality (0–1). */
const AVATAR_WEBP_QUALITY = 0.85;

/** Edge Function action for avatar upload URL. */
const ACTION_AVATAR_UPLOAD = "request-avatar-upload-url" as const;

/** Shape of a successful avatar upload URL response. */
interface AvatarUploadUrlResponse {
  upload_url: string;
  file_key: string;
}

/** Result of uploadAvatar. */
export type AvatarUploadResult =
  | { ok: true; avatarUrl: string }
  | { ok: false; error: string };

/**
 * Validates an avatar file before processing.
 * @returns null if valid, otherwise a user-facing error message.
 */
function validateAvatarFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Please choose an image file.";
  }
  if (file.size > MAX_AVATAR_SIZE) {
    return "File must be 2 MB or smaller.";
  }
  return null;
}

/**
 * Loads a File as an HTMLImageElement.
 *
 * The object URL is intentionally NOT revoked here: the returned image element
 * is reused by the crop dialog (which renders `<img src={image.src}>`) and by
 * the resize step. Revoking prematurely would blank the crop preview because
 * `image.src` would point to a dead blob URL. Callers should revoke the URL
 * via `revokeAvatarImage(img)` once the image is no longer needed.
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image."));
    };
    img.src = url;
  });
}

/**
 * Revokes the object URL backing a loaded avatar image, if any.
 * Safe to call on images whose `src` is not a blob URL (no-op in that case).
 */
export function revokeAvatarImage(img: HTMLImageElement | null): void {
  if (!img) return;
  if (img.src.startsWith("blob:")) {
    URL.revokeObjectURL(img.src);
  }
}

/**
 * Resizes and crops an image to a 256×256 square, then encodes as WebP.
 *
 * The crop is a square window onto the source image. By default it is a
 * center-crop; passing a `cropOffset` (Phase C) shifts the window so the user
 * can drag the subject into frame before finalizing. The offset is expressed in
 * source pixels relative to the centered position, clamped so the window never
 * leaves the image bounds.
 *
 * @param img        Loaded source image.
 * @param cropOffset Optional {x, y} pan offset in source pixels (0,0 = center).
 */
async function resizeAndEncodeAvatar(
  img: HTMLImageElement,
  cropOffset: { x: number; y: number } = { x: 0, y: 0 },
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  // Square crop window sized to the shorter source side.
  const size = Math.min(img.naturalWidth, img.naturalHeight);
  // Centered top-left of the window, then apply + clamp the user's pan offset
  // so the window stays fully inside the source image.
  const baseX = (img.naturalWidth - size) / 2;
  const baseY = (img.naturalHeight - size) / 2;
  const sx = Math.max(0, Math.min(img.naturalWidth - size, baseX + cropOffset.x));
  const sy = Math.max(0, Math.min(img.naturalHeight - size, baseY + cropOffset.y));

  ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("WebP encoding failed."));
      },
      "image/webp",
      AVATAR_WEBP_QUALITY,
    );
  });
}

/**
 * Loads a File as an HTMLImageElement. Exported (Phase C) so the crop dialog
 * can load the image once, let the user reposition, and hand the same element
 * (plus the chosen offset) back to the upload pipeline — no double decode.
 */
export async function loadAvatarImage(file: File): Promise<HTMLImageElement> {
  return loadImageFromFile(file);
}

/**
 * Uploads a user avatar.
 *
 * @param file       The image file selected by the user.
 * @param cropOffset Optional {x, y} pan offset in source pixels (Phase C).
 *                   Defaults to a center-crop. The AvatarCropDialog computes
 *                   this from the user's drag and passes it through.
 * @returns The new avatar object key on success, or a calm error message.
 */
export async function uploadAvatar(
  file: File,
  cropOffset?: { x: number; y: number },
): Promise<AvatarUploadResult> {
  // 1. Validate
  const validationError = validateAvatarFile(file);
  if (validationError) return { ok: false, error: validationError };

  try {
    // 2. Resize & encode to WebP (with the user's crop offset, if any)
    const img = await loadImageFromFile(file);
    const webpBlob = await resizeAndEncodeAvatar(img, cropOffset);
    // The image's blob URL is no longer needed after encoding.
    revokeAvatarImage(img);

    // 3. Request presigned PUT URL from Edge Function
    const { data, error } = await supabase.functions.invoke("media-storage", {
      body: {
        action: ACTION_AVATAR_UPLOAD,
        content_type: "image/webp",
      },
    });

    const responseData = data as AvatarUploadUrlResponse | null;

    if (error || !responseData?.upload_url || !responseData?.file_key) {
      console.error("[avatar] Upload URL request failed:", error ?? data);
      return { ok: false, error: "Could not prepare upload. Please try again." };
    }

    const { upload_url, file_key } = responseData;

    // 4. PUT the WebP blob to B2
    const putResponse = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: webpBlob,
    });

    if (!putResponse.ok) {
      console.error("[avatar] B2 PUT failed:", putResponse.status);
      return { ok: false, error: "Upload failed. Please try again." };
    }

    // 5. Update profiles.avatar_url with the durable object key
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: file_key })
      .eq("id", (await supabase.auth.getUser()).data.user?.id);

    if (updateError) {
      console.error("[avatar] Profile update failed:", updateError);
      // Non-destructive: the B2 object exists but profile wasn't updated.
      // User can retry; the next successful upload will overwrite the same key.
      return { ok: false, error: "Upload succeeded but profile update failed. Please try again." };
    }

    // 6. Invalidate any cached presigned URL for this (stable) key so the
    //    freshly uploaded avatar is fetched with a fresh signature, then
    //    return the new avatar key for immediate UI update. The avatar object
    //    key is `avatars/{user_id}/avatar.webp` — it does not change across
    //    uploads, so without invalidation the session cache would keep handing
    //    out the previous object's signature until its TTL elapsed.
    invalidateAvatarDownloadUrlCache(file_key);
    return { ok: true, avatarUrl: file_key };
  } catch (err) {
    console.error("[avatar] Unexpected error:", err);
    return { ok: false, error: "An unexpected error occurred. Please try again." };
  }
}

/**
 * Deletes the current user's avatar.
 * Calls the Edge Function to delete the B2 object, then clears profiles.avatar_url.
 */
export async function deleteAvatar(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };

    const fileKey = `avatars/${user.id}/avatar.webp`;

    // Delete from B2 via Edge Function
    const { error } = await supabase.functions.invoke("media-storage", {
      body: {
        action: "request-delete-url",
        file_key: fileKey,
      },
    });

    if (error) {
      console.error("[avatar] Delete URL request failed:", error);
      return { ok: false, error: "Could not prepare deletion. Please try again." };
    }

    // Clear avatar_url from profile
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", user.id);

    if (updateError) {
      console.error("[avatar] Profile clear failed:", updateError);
      return { ok: false, error: "Deletion succeeded but profile update failed. Please try again." };
    }

    // Invalidate the cached presigned URL for the deleted key so a stale
    // signature is never handed out if the user re-uploads to the same key.
    invalidateAvatarDownloadUrlCache(fileKey);
    return { ok: true };
  } catch (err) {
    console.error("[avatar] Unexpected delete error:", err);
    return { ok: false, error: "An unexpected error occurred. Please try again." };
  }
}

/**
 * Result of {@link getAvatarDownloadUrl}. `ok` carries the presigned URL; `error`
 * is set when the request failed. The function never throws — callers can use
 * a plain `if`/`else` without a try/catch. Mirrors `DownloadUrlResult` in
 * `lib/media.ts`.
 */
export type AvatarDownloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Calm, honest fallback message (auth-design §7 voice). */
const GENERIC_AVATAR_DOWNLOAD_ERROR =
  "We couldn't load your avatar. Please try again.";

/** The Edge Function action that returns a short-lived presigned GET URL. */
const ACTION_AVATAR_DOWNLOAD = "request-download-url" as const;

/** Shape of a successful `request-download-url` response body. */
interface AvatarDownloadUrlResponse {
  download_url: string;
}

/**
 * Requests a short-lived presigned GET URL for an avatar object from the
 * `media-storage` Edge Function, with a session-scoped cache and in-flight
 * de-duplication — the exact pattern proven by `getMediaDownloadUrl` in
 * `lib/media.ts`, which Memory thumbnails use to load fast.
 *
 * **Session cache:** if a non-expired presigned URL for this `fileKey` is
 * already cached for the current session, it is returned without an Edge
 * Function round trip. This is the fix for the avatar loading noticeably
 * slower than Memory thumbnails: the Avatar component is mounted in the app
 * shell on every authenticated page, so without a cache every navigation /
 * re-render paid a full Edge Function round trip + re-sign. The cached entry
 * is dropped once its true expiry passes (parsed from the URL's
 * `X-Amz-Date`/`X-Amz-Expires`), so a stale URL is never handed out. This
 * only helps within a single browser session; a full page reload always needs
 * a fresh presigned URL (short-lived by design for security).
 *
 * **In-flight de-duplication:** concurrent calls for the same `fileKey` share
 * a single Edge Function round trip.
 *
 * @param fileKey the durable B2 object key (`profiles.avatar_url`).
 * @returns the presigned URL on success, or a calm error on failure.
 */
export async function getAvatarDownloadUrl(
  fileKey: string,
): Promise<AvatarDownloadResult> {
  if (!fileKey || fileKey.trim().length === 0) {
    return { ok: false, error: GENERIC_AVATAR_DOWNLOAD_ERROR };
  }

  // 1) Session cache hit — reuse without a round trip. Expired entries are
  //    evicted inside getCachedAvatarDownloadUrl.
  const cached = getCachedAvatarDownloadUrl(fileKey);
  if (cached) {
    return { ok: true, url: cached };
  }

  // 2) In-flight de-duplication — if a request for this key is already in
  //    flight, await its result rather than firing a second one.
  const existing = avatarDownloadUrlInFlight.get(fileKey);
  if (existing) {
    return existing;
  }

  // 3) Fresh fetch. The promise is memoized for the duration of the round trip
  //    so concurrent callers de-dupe against step 2.
  const request = (async (): Promise<AvatarDownloadResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("media-storage", {
        body: {
          action: ACTION_AVATAR_DOWNLOAD,
          file_key: fileKey,
        },
      });

      const response = data as AvatarDownloadUrlResponse | null;

      if (error || !response?.download_url) {
        console.error("[avatar] Download URL request failed:", error ?? data);
        return { ok: false, error: GENERIC_AVATAR_DOWNLOAD_ERROR };
      }

      const url = response.download_url;

      // Write-through into the session cache. Parse the true expiry from the
      // presigned URL's X-Amz-Date + X-Amz-Expires so we reuse it for its full
      // validity window; fall back to a conservative lifetime if parsing
      // fails so a cached entry is never trusted past the worst-case TTL.
      const expiresAt = parseAvatarPresignedExpiry(url);
      avatarDownloadUrlCache.set(fileKey, {
        url,
        expiresAt:
          expiresAt ??
          Date.now() + AVATAR_DOWNLOAD_URL_TTL_FALLBACK_SECONDS * 1000,
      });

      return { ok: true, url };
    } catch (err) {
      console.error("[avatar] Unexpected download URL error:", err);
      return { ok: false, error: GENERIC_AVATAR_DOWNLOAD_ERROR };
    } finally {
      // Always clear the in-flight slot so a failed/aborted request can be
      // retried (the cache path won't have a hit, and a new request can fire).
      avatarDownloadUrlInFlight.delete(fileKey);
    }
  })();

  avatarDownloadUrlInFlight.set(fileKey, request);
  return request;
}