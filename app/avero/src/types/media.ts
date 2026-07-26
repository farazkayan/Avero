/**
 * Shared types for the Media feature (feature-specs §3, database §7).
 *
 * Co-located in a single module so every screen that touches media — the
 * Memory detail gallery, the create flow, and any future management UI —
 * agrees on the shape of a media row. Only the fields used by the current
 * scope are declared; the file grows as later screens need more.
 */

/**
 * The kind of object a media row points at (feature-specs §3, database §7).
 *
 * Stored as a lowercase string in the database (`image` / `video`). The union
 * keeps the set exhaustive so a future addition is a deliberate type change,
 * not a silent string drift.
 */
export type MediaType = "image" | "video";

/**
 * A media row — a single photo or video attached to a Memory (database §7,
 * migration 20260703170100 §6).
 *
 * `url` and `storage_path` both hold the durable Backblaze B2 object key
 * (e.g. `{space_id}/{memory_id}/{uuid}.{ext}`), NOT a presigned URL. The
 * short-lived presigned GET URL is requested on demand from the
 * `media-storage` Edge Function (`request-download-url` action), which
 * re-derives the space_id from the key and re-runs the same RLS membership
 * check used for uploads. See `lib/media.ts` → `getMediaDownloadUrl`.
 *
 * `type` is the media kind (`image` / `video`); the gallery uses it to decide
 * whether to render an inline `<img>` or a poster + play affordance.
 */
export type Media = {
  id: string;
  memory_id: string;
  url: string;
  storage_path: string;
  /**
   * The durable B2 object key for the small WebP thumbnail variant, or `null`
   * when no thumbnail exists (plans/media-web-optimizer.md).
   *
   * `null` means either the media predates the thumbnail feature (no backfill
   * — existing uploads stay as-is) or thumbnail generation failed. In both
   * cases, thumbnail consumers fall back to the full-resolution original
   * (`url` / `storage_path`), so there is no regression for old media.
   *
   * When non-null, thumbnail displays (timeline cards, dashboard cards) should
   * request a presigned GET for this key instead of the original — it's a
   * small WebP (~15-40KB) rather than a full-resolution image. The Memory
   * Detail gallery/lightbox continues using the original regardless.
   */
  thumbnail_path: string | null;
  type: string;
  created_at: string;
};

/**
 * Narrows an arbitrary string to a known {@link MediaType}, or returns `null`
 * if it is neither `image` nor `video`.
 *
 * The `media.type` column is `text` (not an enum), so the database cannot
 * guarantee the value is one of the two known kinds. This helper keeps the
 * gallery defensive against future or malformed rows: an unknown type is
 * treated as "not displayable" rather than crashing the whole gallery.
 */
export function asMediaType(value: string): MediaType | null {
  if (value === "image" || value === "video") {
    return value;
  }
  return null;
}
