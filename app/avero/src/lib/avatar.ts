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
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
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

    // 6. Return the new avatar key for immediate UI update
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

    return { ok: true };
  } catch (err) {
    console.error("[avatar] Unexpected delete error:", err);
    return { ok: false, error: "An unexpected error occurred. Please try again." };
  }
}

/**
 * Generates a download URL for an avatar key.
 * Used by the Avatar component to display the avatar image.
 */
export async function getAvatarDownloadUrl(fileKey: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("media-storage", {
      body: {
        action: "request-download-url",
        file_key: fileKey,
      },
    });

    if (error || !data?.download_url) {
      console.error("[avatar] Download URL request failed:", error ?? data);
      return null;
    }

    return data.download_url;
  } catch (err) {
    console.error("[avatar] Unexpected download URL error:", err);
    return null;
  }
}