# Spec — Route B2 Media Access Through Cloudflare Worker for Free Egress (Bandwidth Alliance)

## Overview

Currently, all presigned download URLs point directly at B2's raw S3 endpoint (`s3.eu-central-003.backblazeb2.com`), meaning every media view/download is billed as standard B2 egress. Since the frontend is already on Cloudflare Pages (same Cloudflare account), routing media delivery through a Cloudflare Worker makes B2→Cloudflare transfer genuinely free via the Backblaze/Cloudflare Bandwidth Alliance, and Cloudflare→end-user is also free.

**Reference:** Backblaze's official pattern — "Deliver Private Backblaze B2 Content Through Cloudflare CDN" and the `backblaze-b2-samples/cloudflare-b2` GitHub repo.

---

## Architecture

```
┌─────────────┐     request-download-url      ┌──────────────────┐
│   Frontend  │ ─────────────────────────────▶ │ media-storage    │
│  (React)    │ ◀───────────────────────────── │ Edge Function    │
└─────────────┘   { download_url:              └──────────────────┘
                   "https://avero-media-proxy.workers.dev/
                    {file_key}" }
        │
        │ GET https://avero-media-proxy.workers.dev/{file_key}
        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Worker                          │
│  (avero-media-proxy.workers.dev)                            │
│  - Authenticates to B2 using READ-ONLY application key      │
│  - Proxies GET request to B2 S3 endpoint                    │
│  - Streams response back to client                          │
│  - Handles Range requests for video seeking                 │
└─────────────────────────────────────────────────────────────┘
        │
        │ GET (signed by Worker's read-only credentials)
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backblaze B2                             │
│  (s3.eu-central-003.backblazeb2.com)                        │
│  - Private bucket: avero-media                              │
│  - B2→Cloudflare: FREE (Bandwidth Alliance)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Cloudflare Worker (`avero-media-proxy`)

**Location:** New project at `cloudflare-worker/`

**Files:**
- `wrangler.toml` — Worker configuration
- `src/index.ts` — Worker implementation
- `package.json` — Dependencies
- `tsconfig.json` — TypeScript config

**Worker Secrets (set via `wrangler secret put`):**
- `B2_KEY_ID` — Read-only application key ID
- `B2_APPLICATION_KEY` — Read-only application key secret
- `B2_BUCKET_NAME` — `avero-media`
- `B2_ENDPOINT` — `https://s3.eu-central-003.backblazeb2.com`

**Behavior:**
- Handles `GET` requests only
- Path format: `/{file_key}` where file_key is `{space_id}/{memory_id}/{uuid}.{ext}` or `avatars/{user_id}/avatar.webp`
- Authenticates to B2 using AWS Signature V4 (via `@aws-sdk/client-s3` or manual signing)
- Proxies request to B2, streams response
- Preserves `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`
- Supports `Range` headers for video seeking
- Sets `Cache-Control: public, max-age=31536000, immutable` (1 year) for immutable content
- Returns 404 if object not found, 403 if auth fails

**No request validation needed:** The Worker trusts that only the `media-storage` Edge Function generates valid Worker URLs, and that function already performed RLS membership checks. The file_key is not secret — it's returned by RPCs to authorized users.

### 2. B2 Read-Only Application Key

**Created in Backblaze B2 Dashboard:**
- Name: `avero-cloudflare-worker-read-only`
- Bucket: `avero-media`
- Type: **Read Only**
- File name prefix: `` (empty = full bucket read)
- Duration: No expiration

**Credentials stored as Cloudflare Worker secrets** (not in code).

### 3. Updated `media-storage` Edge Function

**File:** `supabase/functions/media-storage/index.ts`

**Changes:**

#### `handleDownloadUrl` (lines 538-594)
```typescript
// OLD: Generate presigned GET URL to B2 endpoint
const downloadUrl = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });

// NEW: Construct Worker URL
const workerDomain = Deno.env.get("MEDIA_WORKER_DOMAIN"); // e.g., "https://avero-media-proxy.workers.dev"
const downloadUrl = `${workerDomain}/${file_key}`;
return jsonResponse(200, { download_url: downloadUrl });
```

#### `handleAvatarDownloadUrl` (lines 600-640)
```typescript
// Same change: construct Worker URL for avatar keys
const workerDomain = Deno.env.get("MEDIA_WORKER_DOMAIN");
const downloadUrl = `${workerDomain}/${fileKey}`;
return jsonResponse(200, { download_url: downloadUrl });
```

**Unchanged (still direct to B2):**
- `handleUploadUrl` — presigned PUT to B2
- `handleAvatarUploadUrl` — presigned PUT to B2
- `handleDeleteUrl` — direct B2 delete

**New Edge Function Secret:**
- `MEDIA_WORKER_DOMAIN` — `https://avero-media-proxy.workers.dev`

### 4. Updated B2 CORS Configuration

**File:** `app/avero/cors.json`

Add rule for Worker domain (or `*` for downloads since Worker makes server-to-server requests):
```json
{
  "corsRuleName": "s3DownloadFromWorker",
  "allowedOrigins": ["https://avero-media-proxy.workers.dev"],
  "allowedOperations": ["s3_get", "s3_head"],
  "allowedHeaders": ["authorization", "range"],
  "maxAgeSeconds": 3600
}
```
Note: The Worker→B2 request is server-to-server (no browser CORS), but browser→Worker needs proper CORS headers from the Worker response.

---

## Security Analysis: Worker Request Validation

**Conclusion: The Worker does NOT need its own request validation.**

**Reasoning:**
1. The `media-storage` Edge Function is the **only** code that generates Worker URLs
2. It only generates URLs **after successful RLS membership verification** (Space membership for media, self-only for avatars)
3. The file_key is not secret — it's stored in the database and returned by RPCs (`get_timeline_thumbnails`, `get_space_list_thumbnails`) to authorized users
4. Even if someone guesses a file_key, they'd need to know the Worker domain
5. Adding signature validation would add complexity without real security benefit
6. The authorization boundary remains the `media-storage` Edge Function's RLS checks

This matches the Backblaze reference pattern where the Worker simply proxies authenticated requests.

---

## Testing Checklist

### Functional Tests (on Cloudflare Pages Preview Deployment)

| Feature | Test | Expected |
|---------|------|----------|
| Timeline thumbnails | Load Space timeline | Thumbnails load via Worker URL |
| Memory detail gallery | Open Memory with photos/videos | Gallery loads via Worker URL |
| Avatars | View profile/avatar in app shell | Avatar loads via Worker URL |
| Media Download | Click download on media | Download works via Worker URL |
| Upload photo/video | Create Memory, add media | Upload direct to B2 (unchanged) |
| Upload avatar | Settings → change avatar | Upload direct to B2 (unchanged) |

### Access Control Tests

| Scenario | Test | Expected |
|----------|------|----------|
| Non-member Space media | Copy Worker URL from member, open in non-member browser | 403/404 (RLS blocked URL generation) |
| Non-member avatar | Copy avatar Worker URL, open in another user's browser | 403 (self-only check in media-storage) |
| Expired Worker URL | N/A — Worker URLs don't expire | N/A (authorization at generation time) |

### Verification

- [ ] Confirm Worker uses **read-only** B2 application key (not the full-access key)
- [ ] Confirm uploads still go direct to B2 (check Network tab: PUT to `s3.eu-central-003.backblazeb2.com`)
- [ ] Confirm downloads go via Worker (check Network tab: GET to `avero-media-proxy.workers.dev`)
- [ ] Check B2 billing dashboard: egress should drop to near-zero for media views

---

## Deployment Order

1. **Create B2 read-only application key** in Backblaze dashboard
2. **Create Cloudflare Worker project** locally
3. **Deploy Worker** to `avero-media-proxy.workers.dev` (preview first)
4. **Set Worker secrets** (`B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT`)
5. **Update B2 CORS** with Worker domain
6. **Add `MEDIA_WORKER_DOMAIN` secret** to Supabase Edge Functions
7. **Deploy updated `media-storage` Edge Function**
8. **Test on Cloudflare Pages preview deployment** (feature branch push)
9. **Verify all test cases pass**
10. **Merge to main** (production deployment)

---

## Rollback Plan

If issues arise:
1. Revert `media-storage` Edge Function to generate presigned B2 URLs
2. Remove `MEDIA_WORKER_DOMAIN` secret
3. Worker can remain deployed (harmless) or be deleted

---

## Files to Create/Modify

### New Files
- `cloudflare-worker/wrangler.toml`
- `cloudflare-worker/src/index.ts`
- `cloudflare-worker/package.json`
- `cloudflare-worker/tsconfig.json`

### Modified Files
- `supabase/functions/media-storage/index.ts` — `handleDownloadUrl`, `handleAvatarDownloadUrl`
- `app/avero/cors.json` — Add Worker download rule

### New Secrets
- Cloudflare Worker: `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT`
- Supabase Edge Function: `MEDIA_WORKER_DOMAIN`

---

## B2 Application Key Used by Worker

**Key Name:** `avero-cloudflare-worker-read-only`
**Type:** Read Only
**Bucket:** `avero-media`
**Scope:** Full bucket read access (no prefix restriction)
**Purpose:** Cloudflare Worker media proxy only
**NOT used by:** `media-storage` Edge Function (which keeps its full read/write key)

This follows the project's "least privilege" pattern (e.g., RPC functions use explicit membership checks rather than broad access).