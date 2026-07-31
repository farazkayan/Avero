// ============================================================================
// Supabase Edge Function: media-thumbnail
// ----------------------------------------------------------------------------
// Server-side thumbnail generation for uploaded images ("media web optimizer"
// — see plans/media-web-optimizer.md).
//
// When a photo is uploaded, the client calls this function to generate a small
// WebP thumbnail variant (400px max long edge, quality 78) stored as a separate
// B2 object. Thumbnail displays (timeline cards, dashboard cards) then pull
// this small file instead of the full-resolution original.
//
// IMAGE PROCESSING (Deno / WASM):
//   This runs on the Deno runtime. The go-to Node image library (sharp) uses
//   native libvips bindings and does NOT work in Deno. Instead, this function
//   uses jSquash — pure WebAssembly image codecs (no native bindings):
//     - @jsquash/jpeg, @jsquash/png, @jsquash/webp — decode the original
//     - @jsquash/resize — Lanczos3 downscale to 400px max edge
//     - @jsquash/webp — encode the thumbnail as WebP (quality 78)
//
//   WebP was chosen over AVIF because AVIF's WASM encoder is too slow (risks
//   Edge Function CPU timeouts). WebP is fast, has 97% browser support, and
//   produces files 25-35% smaller than equivalent-quality JPEG.
//
// VIDEOS:
//   This function does NOT process videos. Server-side video poster frame
//   extraction is not feasible in a Deno Edge Function (ffmpeg.wasm is ~25-30MB,
//   too heavy for Edge Function limits). Video poster frames are extracted
//   client-side at upload time instead (see lib/media.ts → extractVideoPoster).
//   If this function receives a video content type, it returns { skipped: true }.
//
// FAILURE ISOLATION (critical design principle):
//   This function is called AFTER the upload is complete and the media row
//   exists. If thumbnail generation fails for any reason (WASM error, B2 fetch
//   failure, encoding failure), the original media is untouched and the media
//   row's thumbnail_path stays NULL. The client catches the failure silently
//   — the upload is already "done" from the user's perspective. The thumbnail
//   can be regenerated later. This matches the existing "Upload failure must
//   not create partial state" principle, applied to the derived asset.
//
// AUTHORIZATION (same pattern as media-storage):
//   This function uses the CALLER'S JWT CONTEXT to verify Space membership.
//   A Supabase client is created with the caller's Authorization header, so
//   every database query runs under that user's RLS policies. The space_id is
//   re-derived from the file_key's first path segment and membership is
//   checked via space_members (RLS only returns the row if the caller is a
//   member).
//
// B2 credentials (same secrets as media-storage):
//   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT
//
// Object key convention (thumbnail):
//   {space_id}/{memory_id}/{uuid}_thumb.webp
//   The first path segment is always the space_id (same as the original),
//   so the download/delete actions in media-storage can re-derive and
//   re-authorize the space from the thumbnail key alone.
// ============================================================================

import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "npm:@aws-sdk/client-s3@3.723.0";

// jSquash WASM image codecs — pure WASM, no native bindings, Deno-compatible.
import { decode as decodeJpeg } from "npm:@jsquash/jpeg@1.6.0";
import { decode as decodePng } from "npm:@jsquash/png@3.1.1";
import { decode as decodeWebp } from "npm:@jsquash/webp@1.5.0";
import { encode as encodeWebp } from "npm:@jsquash/webp@1.5.0";
import resize from "npm:@jsquash/resize@2.1.1";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** The action this function handles. */
const ACTION_GENERATE = "generate-thumbnail" as const;

/**
 * Maximum long edge (width or height) for the generated thumbnail.
 *
 * 400px gives ~6.25x the 64px display size — crisp on 2x/3x retina displays
 * with headroom for minor thumbnail size increases. A 400px WebP at quality 78
 * is typically 15-40KB — a 10-50x reduction from a 2000px JPEG original.
 */
const THUMBNAIL_MAX_EDGE_PX = 400;

/** WebP encoding quality (0-100). 78 is visually indistinguishable from the
 *  original at thumbnail size while producing small files. */
const THUMBNAIL_WEBP_QUALITY = 78;

/** Validates a lowercase-or-uppercase UUID v4 string. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Safe characters allowed in any single path segment of a file key. */
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

/** Image MIME types this function can decode and thumbnail. */
const THUMBNAILABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ----------------------------------------------------------------------------
// Request / response shapes
// ----------------------------------------------------------------------------

interface GenerateThumbnailRequestBody {
  action: typeof ACTION_GENERATE;
  file_key: string;
  media_id: string;
  content_type: string;
}

type ActionRequest = GenerateThumbnailRequestBody;

interface ErrorResponse {
  error: string;
  details?: string;
}

// ----------------------------------------------------------------------------
// HTTP helpers
// ----------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Builds a JSON error response, logging the cause server-side. */
function jsonError(
  status: number,
  message: string,
  cause?: unknown,
): Response {
  if (cause !== undefined) {
    const detail =
      cause instanceof Error ? cause.message : typeof cause === "string"
        ? cause
        : JSON.stringify(cause);
    console.error(`[media-thumbnail] ${status} ${message}: ${detail}`);
  }
  const payload: ErrorResponse = { error: message };
  if (cause instanceof Error) payload.details = cause.message;
  else if (typeof cause === "string") payload.details = cause;
  return jsonResponse(status, payload);
}

// ----------------------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------------------

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parses and validates the space_id (first path segment) out of a file key.
 * Returns the space_id, or null if the key is malformed or contains path
 * traversal attempts. A valid key has the shape:
 *   {space_id}/{memory_id}/{filename}
 */
function parseSpaceIdFromKey(key: string): string | null {
  if (key.includes("..") || key.startsWith("/") || key.endsWith("/")) {
    return null;
  }
  const segments = key.split("/");
  if (segments.length < 3) return null;
  for (const segment of segments) {
    if (!SAFE_SEGMENT_RE.test(segment)) return null;
  }
  const spaceId = segments[0];
  return isUuid(spaceId) ? spaceId : null;
}

// ----------------------------------------------------------------------------
// Supabase auth + membership (mirrors media-storage)
// ----------------------------------------------------------------------------

type AuthResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; status: number; error: string };

async function authenticate(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "Missing or malformed Authorization header.",
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      status: 500,
      error: "Server is not configured for authentication.",
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      error: "Authentication failed. Please sign in again.",
    };
  }

  return { ok: true, user: data.user, supabase };
}

async function isSpaceMember(
  supabase: SupabaseClient,
  spaceId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("space_members")
    .select("id")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data !== null;
}

// ----------------------------------------------------------------------------
// B2 / S3 client (mirrors media-storage)
// ----------------------------------------------------------------------------

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function parseRegionFromEndpoint(endpoint: string): string {
  try {
    const normalized = endpoint.startsWith("http")
      ? endpoint
      : `https://${endpoint}`;
    const host = new URL(normalized).hostname;
    const match = host.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);
    if (match) return match[1];
    const parts = host.split(".");
    if (parts.length >= 2 && parts[0].toLowerCase() === "s3") {
      return parts[1];
    }
  } catch {
    // fall through
  }
  throw new ConfigurationError(
    "B2_ENDPOINT is malformed or region could not be determined - check the Edge Function secret.",
  );
}

function getBucketName(): string {
  const bucket = Deno.env.get("B2_BUCKET_NAME");
  if (!bucket) {
    throw new Error("B2_BUCKET_NAME secret is not configured.");
  }
  return bucket;
}

function createS3Client(): S3Client {
  const endpoint = Deno.env.get("B2_ENDPOINT");
  const keyId = Deno.env.get("B2_KEY_ID");
  const applicationKey = Deno.env.get("B2_APPLICATION_KEY");

  if (!endpoint || !keyId || !applicationKey) {
    throw new Error("B2 storage secrets are not fully configured.");
  }

  const normalizedEndpoint = endpoint.startsWith("http")
    ? endpoint
    : `https://${endpoint}`;

  return new S3Client({
    region: parseRegionFromEndpoint(endpoint),
    endpoint: normalizedEndpoint,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: applicationKey,
    },
    forcePathStyle: true,
    // AWS SDK v3.729.0+ (Dec 2024) defaults to always calculating and
    // attaching a CRC32 checksum to S3 requests. B2 (and other S3-compatible
    // providers) don't support this checksum flow the way AWS S3 does, so the
    // presigned URL's signature mismatches and B2 rejects the request with a
    // 403 that surfaces in the browser as a CORS error. Restoring the
    // pre-3.729.0 default (only calculate/validate checksums when explicitly
    // required by the operation) keeps B2 compatibility. See
    // docs/backend-implementation.md (storage/B2 section) for the full gotcha.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

// ----------------------------------------------------------------------------
// Thumbnail key derivation
// ----------------------------------------------------------------------------

/**
 * Derives the thumbnail object key from the original key.
 *
 * Given `{space_id}/{memory_id}/{uuid}.{ext}`, returns
 * `{space_id}/{memory_id}/{uuid}_thumb.webp`.
 *
 * The thumbnail lives in the same B2 "folder" as the original, so the
 * space_id is still the first segment (preserves the re-authorization pattern
 * in media-storage's download/delete actions). The extension is always .webp
 * regardless of the original format.
 */
function deriveThumbnailKey(originalKey: string): string {
  const lastSlash = originalKey.lastIndexOf("/");
  if (lastSlash < 0) return originalKey;
  const filename = originalKey.slice(lastSlash + 1);
  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${originalKey.slice(0, lastSlash + 1)}${stem}_thumb.webp`;
}

// ----------------------------------------------------------------------------
// Image processing (jSquash WASM pipeline)
// ----------------------------------------------------------------------------

/**
 * Decodes an image ArrayBuffer into ImageData using the appropriate jSquash
 * codec based on the content type.
 *
 * Supports JPEG, PNG, and WebP (the formats the upload pipeline produces or
 * that users commonly upload). Other formats (GIF, HEIC, AVIF) are not
 * supported for thumbnailing — the caller will get a clear error and the
 * thumbnail_path stays NULL (graceful fallback to the original).
 */
async function decodeImage(
  imageBuffer: ArrayBuffer,
  contentType: string,
): Promise<ImageData> {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return await decodeJpeg(imageBuffer);
  }
  if (normalizedType === "image/png") {
    return await decodePng(imageBuffer);
  }
  if (normalizedType === "image/webp") {
    return await decodeWebp(imageBuffer);
  }
  throw new Error(`Unsupported image type for thumbnailing: ${contentType}`);
}

/**
 * Calculates the target dimensions for the thumbnail, preserving aspect ratio.
 *
 * If the original is already smaller than THUMBNAIL_MAX_EDGE_PX on both
 * dimensions, the original dimensions are kept (no upscaling — upscaling
 * would waste bytes without improving quality).
 */
function calculateTargetDimensions(
  originalWidth: number,
  originalHeight: number,
): { width: number; height: number } {
  const maxDim = Math.max(originalWidth, originalHeight);
  if (maxDim <= THUMBNAIL_MAX_EDGE_PX) {
    return { width: originalWidth, height: originalHeight };
  }
  const scale = THUMBNAIL_MAX_EDGE_PX / maxDim;
  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

/**
 * The full image processing pipeline: decode → resize → encode to WebP.
 *
 * Returns the WebP thumbnail as a Uint8Array, ready to upload to B2.
 */
async function generateImageThumbnail(
  imageBuffer: ArrayBuffer,
  contentType: string,
): Promise<Uint8Array> {
  // 1. Decode the original image into ImageData (RGBA).
  const imageData = await decodeImage(imageBuffer, contentType);

  // 2. Calculate the target dimensions (preserving aspect ratio, no upscaling).
  const target = calculateTargetDimensions(imageData.width, imageData.height);

  // 3. Resize using Lanczos3 (high-quality downscale, same as Squoosh).
  const resized = await resize(imageData, {
    width: target.width,
    height: target.height,
    method: "lanczos3",
    fitMethod: "stretch",
    premultiply: true,
    linearRGB: true,
  });

  // 4. Encode as WebP at quality 78.
  const webpBuffer = await encodeWebp(resized, {
    quality: THUMBNAIL_WEBP_QUALITY,
  });

  return new Uint8Array(webpBuffer);
}

// ----------------------------------------------------------------------------
// Action handler
// ----------------------------------------------------------------------------

async function handleGenerateThumbnail(
  body: unknown,
  user: User,
  supabase: SupabaseClient,
): Promise<Response> {
  const { file_key, media_id, content_type } =
    (body ?? {}) as Partial<GenerateThumbnailRequestBody>;

  // Field validation
  if (!isNonEmptyString(file_key)) {
    return jsonError(400, "Missing 'file_key'.");
  }
  if (!isUuid(media_id)) {
    return jsonError(400, "Missing or invalid 'media_id' (expected a UUID).");
  }
  if (!isNonEmptyString(content_type)) {
    return jsonError(400, "Missing 'content_type'.");
  }

  // Re-derive and validate the space_id from the key's first path segment.
  const spaceId = parseSpaceIdFromKey(file_key);
  if (!spaceId) {
    return jsonError(
      400,
      "Malformed 'file_key'. Expected format: {space_id}/{memory_id}/{filename}.",
    );
  }

  // Membership check (RLS-enforced via the caller's JWT context)
  try {
    const member = await isSpaceMember(supabase, spaceId, user.id);
    if (!member) {
      return jsonError(403, "You are not a member of this space.");
    }
  } catch (err) {
    return jsonError(500, "Failed to verify space membership.", err);
  }

  // Videos are not processed here (see file header comment). Return a clean
  // "skipped" response so the client knows this was intentional, not an error.
  const normalizedType = content_type.toLowerCase();
  if (normalizedType.startsWith("video/")) {
    return jsonResponse(200, { skipped: true, reason: "video" });
  }

  // Only process supported image types. Unsupported image types (GIF, HEIC,
  // AVIF) return a clean "skipped" — the thumbnail_path stays NULL and the
  // client falls back to the original. This is non-fatal.
  if (!THUMBNAILABLE_IMAGE_TYPES.has(normalizedType)) {
    return jsonResponse(200, { skipped: true, reason: "unsupported_type" });
  }

  const client = createS3Client();
  const bucket = getBucketName();
  const thumbnailKey = deriveThumbnailKey(file_key);

  try {
    // 1. Fetch the original object from B2 (direct S3 GetObject, not presigned).
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: file_key });
    const getResponse = await client.send(getCommand);

    if (!getResponse.Body) {
      return jsonError(404, "Original media object not found in B2.");
    }

    // The S3 SDK returns a stream; convert it to an ArrayBuffer.
    const originalBuffer = await getResponse.Body.transformToByteArray();

    // 2. Generate the thumbnail via the jSquash WASM pipeline.
    const thumbnailBytes = await generateImageThumbnail(
      originalBuffer,
      content_type,
    );

    // 3. Upload the thumbnail to B2 (direct S3 PutObject, not presigned).
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: thumbnailKey,
      ContentType: "image/webp",
      Body: thumbnailBytes,
    });
    await client.send(putCommand);

    // 4. Update the media row's thumbnail_path via the SECURITY DEFINER RPC.
    //    This uses the caller's JWT-scoped client, so the RPC's is_space_member
    //    check runs against the caller's identity.
    const { error: rpcError } = await supabase.rpc("set_media_thumbnail", {
      p_media_id: media_id,
      p_thumbnail_path: thumbnailKey,
    });

    if (rpcError) {
      // The thumbnail was uploaded to B2 but the DB row wasn't updated. This
      // leaves an orphaned B2 object (non-fatal — it's a small WebP file that
      // a future cleanup pass can sweep). The media row's thumbnail_path stays
      // NULL, so the client falls back to the original. Log and return a
      // non-fatal error so the client knows the thumbnail wasn't registered.
      console.error(
        `[media-thumbnail] B2 upload succeeded but set_media_thumbnail RPC failed: ${rpcError.message}`,
      );
      return jsonError(500, "Thumbnail uploaded but could not be registered.", rpcError);
    }

    return jsonResponse(200, { thumbnail_key: thumbnailKey });
  } catch (err) {
    // Any failure (B2 fetch, WASM decode/resize/encode, B2 put) is caught
    // here. The original media is untouched and thumbnail_path stays NULL.
    // The client treats this as non-fatal — the upload already succeeded.
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(500, "Thumbnail generation failed.", err);
  }
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Request body must be valid JSON.");
    }

    // Authenticate the caller (JWT context)
    const authResult = await authenticate(req);
    if (!authResult.ok) {
      return jsonError(authResult.status, authResult.error);
    }
    const { user, supabase } = authResult;

    // Route by action
    const action = (body as Partial<ActionRequest> | null)?.action;
    if (action === ACTION_GENERATE) {
      return await handleGenerateThumbnail(body, user, supabase);
    }

    return jsonError(
      400,
      `Invalid 'action'. Expected "${ACTION_GENERATE}".`,
    );
  } catch (err) {
    // Catch-all so the function never returns a raw exception
    return jsonError(500, "An unexpected error occurred.", err);
  }
});
