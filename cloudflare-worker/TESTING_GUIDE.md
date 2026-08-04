# Testing Guide: Cloudflare Worker Media Proxy

This guide covers testing the Cloudflare Worker media proxy implementation on a Cloudflare Pages preview deployment.

## Prerequisites

1. **B2 Read-Only Key Created** - Follow `cloudflare-worker/CREATE_B2_READONLY_KEY.md`
2. **Worker Deployed** - Deploy the Worker to `avero-media-proxy.workers.dev`
3. **Worker Secrets Set** - `B2_KEY_ID`, `B2_APPLICATION_KEY` via `wrangler secret put`
4. **Edge Function Secret Added** - `MEDIA_WORKER_DOMAIN=https://avero-media-proxy.workers.dev` in Supabase
5. **Edge Function Deployed** - Updated `media-storage` function deployed

## Deployment Steps

### 1. Deploy Cloudflare Worker

```bash
cd cloudflare-worker
npm install
# Set secrets (one-time, after key creation)
wrangler secret put B2_KEY_ID
wrangler secret put B2_APPLICATION_KEY
# Deploy
npm run deploy
# Verify: https://avero-media-proxy.workers.dev/{some_valid_file_key}
```

### 2. Add Edge Function Secret

In Supabase Dashboard → Edge Functions → `media-storage` → Settings → Secrets:
- Add `MEDIA_WORKER_DOMAIN` = `https://avero-media-proxy.workers.dev`

### 3. Deploy Updated Edge Function

```bash
supabase functions deploy media-storage
```

### 4. Create Preview Deployment

Push to a feature branch (not main):
```bash
git checkout -b feat/b2-cloudflare-worker
git add .
git commit -m "feat: Route B2 media through Cloudflare Worker for free egress"
git push origin feat/b2-cloudflare-worker
```
This triggers a Cloudflare Pages preview deployment at `https://<hash>.avero.pages.dev`

## Test Checklist

### Functional Tests (on Preview Deployment)

| # | Feature | Test Steps | Expected |
|---|---------|------------|----------|
| 1 | Timeline thumbnails | Open a Space with Memories containing photos | Thumbnails load, Network tab shows GET to `avero-media-proxy.workers.dev` |
| 2 | Memory detail gallery | Open a Memory, click a photo to open gallery | Full-size images load via Worker |
| 3 | Video playback | Open a Memory with video | Video plays, seeking works (Range requests) |
| 4 | Avatars | Navigate through app (avatar in header, profile page) | Avatars load via Worker |
| 5 | Media Download | Click download button on a media item | File downloads via Worker URL |

### Upload Tests (Verify Unchanged)

| # | Feature | Test Steps | Expected |
|---|---------|------------|----------|
| 6 | Upload photo | Create Memory, add photo | Upload PUT goes to `s3.eu-central-003.backblazeb2.com` (direct) |
| 7 | Upload video | Create Memory, add video | Upload PUT goes direct to B2 |
| 8 | Upload avatar | Settings → Change avatar | Upload PUT goes direct to B2 |

### Access Control Tests

| # | Scenario | Test Steps | Expected |
|---|----------|------------|----------|
| 9 | Non-member Space media | 1. As member, copy a Worker media URL<br>2. Open in incognito/non-member browser | 403/404 (URL generation blocked by RLS) |
| 10 | Non-member avatar | 1. Copy avatar Worker URL<br>2. Open in another user's browser | 403 (self-only check in media-storage) |
| 11 | Direct Worker access | Try `https://avero-media-proxy.workers.dev/invalid/key` | 400/404 (validation in Worker) |

### Verification Commands

```bash
# Check Worker logs
wrangler tail avero-media-proxy

# Verify Worker uses read-only key (check B2 dashboard → App Keys → last used)
# Should show only GET/HEAD operations, no PUT/DELETE

# Check Network tab in browser DevTools:
# - Downloads: GET https://avero-media-proxy.workers.dev/{file_key}
# - Uploads: PUT https://s3.eu-central-003.backblazeb2.com/...
```

## Rollback (if needed)

```bash
# 1. Revert media-storage to presigned URLs
git revert <commit-hash>
supabase functions deploy media-storage

# 2. Remove MEDIA_WORKER_DOMAIN secret from Supabase

# 3. Worker can stay deployed (harmless) or delete:
wrangler delete avero-media-proxy
```

## Success Criteria

- [ ] All media views/downloads route through `avero-media-proxy.workers.dev`
- [ ] All uploads still go direct to B2 S3 endpoint
- [ ] Non-members cannot access media via Worker URLs
- [ ] Video seeking (Range requests) works
- [ ] B2 egress billing drops for media views (check after 24h)
- [ ] No console errors in browser DevTools