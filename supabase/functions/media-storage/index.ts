// ============================================================================
// Supabase Edge Function: media-storage
// ----------------------------------------------------------------------------
// Secure gatekeeper between the Avero frontend and a Backblaze B2 bucket
// (accessed via B2's S3-compatible API). Generates short-lived presigned URLs
// for uploading and downloading media objects.
//
// B2 credentials are stored as Edge Function secrets:
//   B2_KEY_ID          -> S3 access key id
//   B2_APPLICATION_KEY  -> S3 secret access key
//   B2_BUCKET_NAME      -> target bucket
//   B2_ENDPOINT         -> B2 S3-compatible endpoint (e.g. https://s3.us-west-004.backblazeb2.com)
//
// Supabase-provided env (available automatically to Edge Functions):
//   SUPABASE_URL, SUPABASE_ANON_KEY
//
// ----------------------------------------------------------------------------
// AUTHORIZATION APPROACH (documented per spec)
// ----------------------------------------------------------------------------
// This function uses the CALLER'S JWT CONTEXT to verify Space membership.
//
// A Supabase client is created with the caller's Authorization header, so
// every database query runs under that user's RLS policies. Membership is
// checked by selecting from `space_members` for (space_id, user_id); RLS only
// returns the row if the caller is actually a member.
//
// Why this approach (vs. a service role client with an explicit membership
// check):
//   1. Reuses the existing RLS policies — no duplicated authorization logic
//      that could drift from the database rules.
//   2. Avoids bringing the service role key (which bypasses RLS) into the
//      function, reducing the blast radius of a compromised function.
//   3. Aligns with the project's RLS-first philosophy
//      (docs/ai-context.md §10, docs/backend-implementation.md §11).
//
// Object key convention (B2, not Supabase Storage):
//   {space_id}/{memory_id}/{uuid}.{extension}
// The first path segment is always the space_id, which lets the download
// action re-derive and re-authorize the space from the key alone.
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
  DeleteObjectCommand,
  ListObjectVersionsCommand,
} from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Presigned PUT URL lifetime: 15 minutes. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Presigned GET URL lifetime: 1 hour. */
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

const ACTION_UPLOAD = "request-upload-url" as const;
const ACTION_DOWNLOAD = "request-download-url" as const;
const ACTION_DELETE = "request-delete-url" as const;
const ACTION_AVATAR_UPLOAD = "request-avatar-upload-url" as const;

/** Validates a lowercase-or-uppercase UUID v4 string. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Safe characters allowed in any single path segment of a file key. */
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

/** Maps common media MIME types to file extensions. */
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
};

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

interface UploadRequestBody {
  action: typeof ACTION_UPLOAD;
  space_id: string;
  memory_id: string;
  filename: string;
  content_type: string;
}

interface DownloadRequestBody {
  action: typeof ACTION_DOWNLOAD;
  file_key: string;
}

interface DeleteRequestBody {
  action: typeof ACTION_DELETE;
  file_key: string;
}

interface AvatarUploadRequestBody {
  action: typeof ACTION_AVATAR_UPLOAD;
  content_type: string;
}

type ActionRequest =
  | UploadRequestBody
  | DownloadRequestBody
  | DeleteRequestBody
  | AvatarUploadRequestBody;

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
    console.error(`[media-storage] ${status} ${message}: ${detail}`);
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
 * Derives a file extension from the filename (preferred) or the content type.
 * Falls back to "bin" when neither yields a usable extension. The extension is
 * cosmetic — it only makes object keys human-readable; the presigned PUT URL
 * separately pins the Content-Type header.
 */
function deriveExtension(
  filename: string | undefined,
  contentType: string | undefined,
): string {
  if (filename) {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex >= 0 && dotIndex < filename.length - 1) {
      const ext = filename.slice(dotIndex + 1).toLowerCase();
      if (/^[a-z0-9]+$/.test(ext)) return ext;
    }
  }
  if (contentType) {
    const mapped = MIME_TO_EXTENSION[contentType.toLowerCase()];
    if (mapped) return mapped;
  }
  return "bin";
}

/**
 * Parses and validates the space_id (first path segment) out of a file key.
 * Returns the space_id, or null if the key is malformed or contains path
 * traversal attempts. A valid key has the shape:
 *   {space_id}/{memory_id}/{filename}
 * where the first segment is a UUID and every segment uses safe characters.
 */
function parseSpaceIdFromKey(key: string): string | null {
  if (key.includes("..") || key.startsWith("/") || key.endsWith("/")) {
    return null;
  }
  const segments = key.split("/");
  // Expect at least: space_id / memory_id / filename
  if (segments.length < 3) return null;
  for (const segment of segments) {
    if (!SAFE_SEGMENT_RE.test(segment)) return null;
  }
  const spaceId = segments[0];
  return isUuid(spaceId) ? spaceId : null;
}

// ----------------------------------------------------------------------------
// Supabase auth + membership
// ----------------------------------------------------------------------------

type AuthResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; status: number; error: string };

/**
 * Authenticates the caller using their JWT (Authorization: Bearer <token>).
 * Returns a Supabase client scoped to that user so subsequent queries run under
 * the caller's RLS policies.
 */
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

/**
 * Returns true if the user is a member of the given space.
 *
 * Runs against `space_members` using the caller's JWT-scoped client, so RLS
 * only returns a row when the caller is genuinely a member. A thrown error
 * indicates a database/RLS problem and should surface as a 500.
 */
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
// B2 / S3 client
// ----------------------------------------------------------------------------

/**
 * Error raised when an Edge Function secret is missing or malformed.
 *
 * Surfaced to the caller as HTTP 500 (server misconfiguration) rather than a
 * silent default or a 502 (which implies an upstream B2 failure). Silent
 * wrong guesses (e.g. an incorrect region) are worse than a loud failure
 * here, because they would route S3 requests to the wrong B2 region.
 */
class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Extracts the B2 region from the endpoint hostname.
 * B2 endpoint hostnames follow `s3.<region>.backblazeb2.com`.
 *
 * Throws a ConfigurationError if the region cannot be confidently parsed
 * from the endpoint. We deliberately do NOT fall back to a guessed region
 * (such as "us-west-004"): a wrong guess would silently misroute S3
 * requests, which is worse than a loud, explicit failure.
 */
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
    // fall through to the explicit error below
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

/** Builds an S3Client configured for B2's S3-compatible API. */
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
    // Path-style addressing is recommended for B2's custom endpoints.
    forcePathStyle: true,
  });
}

/**
 * Permanently deletes an object from a versioned B2 bucket.
 *
 * On a versioning-enabled bucket, a plain `DeleteObject` (no VersionId) only
 * inserts a "delete marker" that hides the current version — it does NOT
 * remove any existing versions, so the object "still appears present" and the
 * B2 web UI shows a `*` (versioned) indicator on the folder. To permanently
 * remove the object we must:
 *   1. List every version AND every delete marker for the key
 *      (`ListObjectVersions`, paginated via `IsTruncated` /
 *      `NextVersionIdMarker`).
 *   2. Issue a `DeleteObject` for EACH version id (including delete markers),
 *      which permanently expunges that specific version.
 *
 * If the key has never existed, the version list is empty and this is a safe
 * no-op (B2 treats DeleteObject on a non-existent key as success/idempotent).
 *
 * Returns the total number of versions deleted (0 = key was absent).
 */
async function deleteObjectPermanently(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<number> {
  let deletedCount = 0;
  let nextVersionIdMarker: string | undefined;

  do {
    const listRes = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        KeyMarker: undefined,
        VersionIdMarker: nextVersionIdMarker,
      }),
    );

    // Collect every version id for this exact key. ListObjectVersions returns
    // versions for ALL keys sharing the prefix, so we must filter by Key ===
    // our target key to avoid deleting unrelated objects.
    const versions = (listRes.Versions ?? []).filter(
      (v: { Key?: string; VersionId?: string }) => v.Key === key,
    );
    const deleteMarkers = (listRes.DeleteMarkers ?? []).filter(
      (v: { Key?: string; VersionId?: string }) => v.Key === key,
    );

    for (const v of versions) {
      if (v.VersionId) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
            VersionId: v.VersionId,
          }),
        );
        deletedCount++;
      }
    }
    for (const v of deleteMarkers) {
      if (v.VersionId) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
            VersionId: v.VersionId,
          }),
        );
        deletedCount++;
      }
    }

    nextVersionIdMarker = listRes.IsTruncated
      ? listRes.NextVersionIdMarker
      : undefined;
  } while (nextVersionIdMarker);

  return deletedCount;
}

// ----------------------------------------------------------------------------
// Action handlers
// ----------------------------------------------------------------------------

async function handleUploadUrl(
  body: unknown,
  user: User,
  supabase: SupabaseClient,
): Promise<Response> {
  const { space_id, memory_id, filename, content_type } =
    (body ?? {}) as Partial<UploadRequestBody>;

  // Field validation
  if (!isUuid(space_id)) {
    return jsonError(400, "Missing or invalid 'space_id' (expected a UUID).");
  }
  if (!isUuid(memory_id)) {
    return jsonError(
      400,
      "Missing or invalid 'memory_id' (expected a UUID).",
    );
  }
  if (!isNonEmptyString(filename)) {
    return jsonError(400, "Missing 'filename'.");
  }
  if (!isNonEmptyString(content_type)) {
    return jsonError(400, "Missing 'content_type'.");
  }

  // Membership check (RLS-enforced via the caller's JWT context)
  try {
    const member = await isSpaceMember(supabase, space_id, user.id);
    if (!member) {
      return jsonError(403, "You are not a member of this space.");
    }
  } catch (err) {
    return jsonError(500, "Failed to verify space membership.", err);
  }

  // Build the object key: {space_id}/{memory_id}/{uuid}.{ext}
  const extension = deriveExtension(filename, content_type);
  const objectKey = `${space_id}/${memory_id}/${crypto.randomUUID()}.${extension}`;

  // Generate the presigned PUT URL (15 min expiry)
  try {
    const client = createS3Client();
    const bucket = getBucketName();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: content_type,
    });
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
    return jsonResponse(200, { upload_url: uploadUrl, file_key: objectKey });
  } catch (err) {
    // A ConfigurationError is a server misconfiguration (e.g. malformed
    // B2_ENDPOINT), not an upstream B2 failure — surface it as 500 with the
    // specific message so it is diagnosable rather than masked as a 502.
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(502, "Failed to generate upload URL.", err);
  }
}

async function handleDownloadUrl(
  body: unknown,
  user: User,
  supabase: SupabaseClient,
): Promise<Response> {
  const { file_key } = (body ?? {}) as Partial<DownloadRequestBody>;

  if (!isNonEmptyString(file_key)) {
    return jsonError(400, "Missing 'file_key'.");
  }

  // Check if this is an avatar key: avatars/{user_id}/avatar.webp
  if (file_key.startsWith("avatars/")) {
    return await handleAvatarDownloadUrl(file_key, user);
  }

  // Re-derive and validate the space_id from the key's first path segment
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

  // Generate the presigned GET URL (1 hour expiry)
  try {
    const client = createS3Client();
    const bucket = getBucketName();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: file_key,
    });
    const downloadUrl = await getSignedUrl(client, command, {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
    return jsonResponse(200, { download_url: downloadUrl });
  } catch (err) {
    // A ConfigurationError is a server misconfiguration (e.g. malformed
    // B2_ENDPOINT), not an upstream B2 failure — surface it as 500 with the
    // specific message so it is diagnosable rather than masked as a 502.
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(502, "Failed to generate download URL.", err);
  }
}

// ----------------------------------------------------------------------------
// Avatar download handler (fail-closed validation)
// ----------------------------------------------------------------------------

async function handleAvatarDownloadUrl(
  fileKey: string,
  user: User,
): Promise<Response> {
  // Validate avatar key format: avatars/{user_id}/avatar.webp (exactly 3 segments)
  const segments = fileKey.split("/");
  if (segments.length !== 3) {
    return jsonError(400, "Malformed avatar key. Expected format: avatars/{user_id}/avatar.webp");
  }
  const [prefix, userId, filename] = segments;
  if (prefix !== "avatars" || filename !== "avatar.webp") {
    return jsonError(400, "Malformed avatar key. Expected format: avatars/{user_id}/avatar.webp");
  }
  // Validate user_id is a valid UUID
  if (!UUID_RE.test(userId)) {
    return jsonError(400, "Invalid user_id in avatar key.");
  }
  // Authorization: user can only access their own avatar
  if (userId !== user.id) {
    return jsonError(403, "You can only access your own avatar.");
  }

  // Generate the presigned GET URL (1 hour expiry)
  try {
    const client = createS3Client();
    const bucket = getBucketName();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(client, command, {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
    return jsonResponse(200, { download_url: downloadUrl });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(502, "Failed to generate avatar download URL.", err);
  }
}

// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Avatar delete handler
// ----------------------------------------------------------------------------

async function handleAvatarDeleteUrl(
  fileKey: string,
  user: User,
): Promise<Response> {
  // Validate avatar key format: avatars/{user_id}/avatar.webp
  const segments = fileKey.split("/");
  if (segments.length !== 3 || segments[0] !== "avatars" || segments[2] !== "avatar.webp") {
    return jsonError(400, "Malformed avatar key. Expected format: avatars/{user_id}/avatar.webp");
  }

  const userId = segments[1];
  if (!isUuid(userId)) {
    return jsonError(400, "Invalid user ID in avatar key.");
  }

  // Authorization: user can only delete their own avatar
  if (userId !== user.id) {
    return jsonError(403, "You can only delete your own avatar.");
  }

  // Permanently delete the B2 object (and all its versions). On a
  // versioning-enabled bucket a plain DeleteObject only inserts a hide
  // marker; deleteObjectPermanently lists every version + delete marker and
  // expunges each by VersionId.
  try {
    const client = createS3Client();
    const bucket = getBucketName();
    const deleted = await deleteObjectPermanently(client, bucket, fileKey);
    return jsonResponse(200, { deleted: true, versions_removed: deleted });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(502, "Failed to delete avatar.", err);
  }
}

async function handleDeleteUrl(
  body: unknown,
  user: User,
  supabase: SupabaseClient,
): Promise<Response> {
  const { file_key } = (body ?? {}) as Partial<DeleteRequestBody>;

  if (!isNonEmptyString(file_key)) {
    return jsonError(400, "Missing 'file_key'.");
  }

  // Check if this is an avatar key: avatars/{user_id}/avatar.webp
  if (file_key.startsWith("avatars/")) {
    return await handleAvatarDeleteUrl(file_key, user);
  }

  // Re-derive and validate the space_id from the key's first path segment.
  // Same guard as handleDownloadUrl — the key shape is the contract that
  // lets us re-authorize the space from the key alone.
  const spaceId = parseSpaceIdFromKey(file_key);
  if (!spaceId) {
    return jsonError(
      400,
      "Malformed 'file_key'. Expected format: {space_id}/{memory_id}/{filename}.",
    );
  }

  // Membership check (RLS-enforced via the caller's JWT context).
  //
  // The actual authorization gate for *who may delete* a media row is the
  // `media_delete` database RLS policy (creator OR Space owner), enforced
  // when the client deletes the `media` row. This Edge Function action only
  // removes the underlying B2 object, which is non-fatal orphan cleanup —
  // so a Space-member-level check here is sufficient and mirrors how
  // `request-download-url` checks membership while the real read gate is
  // the `media_select` RLS policy.
  try {
    const member = await isSpaceMember(supabase, spaceId, user.id);
    if (!member) {
      return jsonError(403, "You are not a member of this space.");
    }
  } catch (err) {
    return jsonError(500, "Failed to verify space membership.", err);
  }

  // Permanently delete the B2 object (and all its versions). On a
  // versioning-enabled bucket a plain DeleteObject only inserts a hide
  // marker, leaving the object "present" under a `*` (versioned) folder;
  // deleteObjectPermanently lists every version + delete marker and expunges
  // each by VersionId. A non-existent key yields an empty version list, so a
  // retry or a row that was already cleaned up is a safe no-op.
  try {
    const client = createS3Client();
    const bucket = getBucketName();
    const deleted = await deleteObjectPermanently(client, bucket, file_key);
    return jsonResponse(200, { deleted: true, versions_removed: deleted });
  } catch (err) {
    // A ConfigurationError is a server misconfiguration (e.g. malformed
    // B2_ENDPOINT), not an upstream B2 failure — surface it as 500 with the
    // specific message so it is diagnosable rather than masked as a 502.
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(502, "Failed to delete object.", err);
  }
}

// ----------------------------------------------------------------------------
// Avatar upload handler
// ----------------------------------------------------------------------------

async function handleAvatarUploadUrl(
  body: unknown,
  user: User,
  supabase: SupabaseClient,
): Promise<Response> {
  const { content_type } = (body ?? {}) as Partial<AvatarUploadRequestBody>;

  // Field validation
  if (!isNonEmptyString(content_type)) {
    return jsonError(400, "Missing 'content_type'.");
  }

  // Only allow image types for avatars
  if (!content_type.startsWith("image/")) {
    return jsonError(400, "Avatar must be an image.");
  }

  // Build the object key: avatars/{user_id}/avatar.webp
  // Fixed filename so re-uploads overwrite the previous avatar (no orphans)
  const objectKey = `avatars/${user.id}/avatar.webp`;

  // Generate the presigned PUT URL (15 min expiry)
  try {
    const client = createS3Client();
    const bucket = getBucketName();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: "image/webp", // Client converts to WebP before upload
    });
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
    return jsonResponse(200, { upload_url: uploadUrl, file_key: objectKey });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return jsonError(500, err.message, err);
    }
    return jsonError(502, "Failed to generate avatar upload URL.", err);
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
    // Parse JSON body
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
    if (action === ACTION_UPLOAD) {
      return await handleUploadUrl(body, user, supabase);
    }
    if (action === ACTION_DOWNLOAD) {
      return await handleDownloadUrl(body, user, supabase);
    }
    if (action === ACTION_DELETE) {
      return await handleDeleteUrl(body, user, supabase);
    }
    if (action === ACTION_AVATAR_UPLOAD) {
      return await handleAvatarUploadUrl(body, user, supabase);
    }

    return jsonError(
      400,
      `Invalid 'action'. Expected "${ACTION_UPLOAD}", "${ACTION_DOWNLOAD}", "${ACTION_DELETE}", or "${ACTION_AVATAR_UPLOAD}".`,
    );
  } catch (err) {
    // Catch-all so the function never returns a raw exception
    return jsonError(500, "An unexpected error occurred.", err);
  }
});
