# Creating the B2 Read-Only Application Key for Cloudflare Worker

This document describes the manual steps to create a dedicated **read-only** B2 application key for the Cloudflare Worker (`avero-media-proxy`). This follows the project's "least privilege" pattern.

## Steps (Backblaze B2 Dashboard)

1. **Log in** to the Backblaze B2 console: https://secure.backblaze.com/b2_buckets.htm

2. **Navigate** to **App Keys** in the left sidebar

3. **Click** "Add a New Application Key"

4. **Fill in the form:**
   - **Key Name:** `avero-cloudflare-worker-read-only`
   - **Allow access to Bucket(s):** Select `avero-media` (the bucket used by Avero)
   - **Type of Access:** **Read Only** ← **CRITICAL: Must be "Read Only", not "Read and Write"**
   - **File Name Prefix:** Leave **empty** (allows reading all objects in the bucket)
   - **Duration (seconds):** Leave **empty** (no expiration)
   - **Allowed Operations:** Should auto-populate with read-only operations (b2_download_file_by_id, b2_download_file_by_name, b2_list_file_names, b2_list_file_versions, s3_get, s3_head, s3_list)

5. **Click** "Create New Key"

6. **IMPORTANT:** Copy the **keyID** and **applicationKey** immediately — they are only shown once!

## Store as Cloudflare Worker Secrets

After creating the key, set the secrets on the Cloudflare Worker:

```bash
# From the cloudflare-worker directory
cd cloudflare-worker

# Set the read-only key ID
wrangler secret put B2_KEY_ID
# Paste the keyID when prompted

# Set the read-only application key
wrangler secret put B2_APPLICATION_KEY
# Paste the applicationKey when prompted

# Set the shared HMAC signing key (MUST match the media-storage Edge Function secret)
# Generate a secure random key: openssl rand -base64 32
wrangler secret put MEDIA_WORKER_TOKEN_KEY
# Paste the same key used in Supabase Edge Function MEDIA_WORKER_TOKEN_KEY
```

## Verify the Key is Read-Only

After deployment, verify the Worker uses the read-only key:

1. Check the Worker logs (`wrangler tail`) for any authentication errors
2. In the B2 dashboard, go to the key details and confirm "Type of Access" shows "Read Only"
3. Test that the Worker can serve media but cannot upload/delete (try a PUT request to the Worker - should fail or not be implemented)

## Key Details for Reference

| Property | Value |
|----------|-------|
| Key Name | `avero-cloudflare-worker-read-only` |
| Bucket | `avero-media` |
| Access Type | **Read Only** |
| File Prefix | (empty - full bucket read) |
| Expiration | None |
| Used By | Cloudflare Worker `avero-media-proxy` only |
| NOT Used By | `media-storage` Edge Function (keeps its full read/write key) |

## Security Notes

- This key **cannot** upload, delete, or modify any objects in B2
- It can only read (GET/HEAD) and list objects
- Even if compromised, the blast radius is limited to reading media files
- The `media-storage` Edge Function retains its own full-access key for uploads/deletes
- This follows the same least-privilege pattern used elsewhere in the project (e.g., RPC functions with explicit membership checks)