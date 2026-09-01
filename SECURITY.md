# Avero Security Notes

This document lists the manual security operations that must be performed
outside the repository. Items are grouped by severity and by the audit finding
they remediate (see the audit report for context).

**Do not assume any item in this file has been completed.** Each item is a
human/operator action that requires access to the Supabase dashboard, the
Backblaze B2 dashboard, or git history rewriting tools.

---

## CRITICAL — Rotate the leaked Supabase service-role key (audit C-1)

The migration `supabase/migrations/20260729100000_space_stats_achievements.sql`
§12 hardcoded a Supabase service-role secret (`sb_secret_…`) in a `cron.schedule`
body. The historical migration is preserved (per project rule: never edit
historical migrations), so the secret remains in git history.

Migration `supabase/migrations/20260901100000_in_db_stats_recompute.sql`
eliminates the cron→HTTP→secret dependency by moving the recompute logic into
a plpgsql SECURITY DEFINER function. The new cron calls the plpgsql function
directly — no HTTP, no secret. The Edge Function is preserved for ad-hoc
backfills.

Even so, the leaked secret must be rotated because it grants full service
role access to anyone with the historical git history.

### Procedure

1. **Supabase dashboard** → Project Settings → API → Rotate the **service role**
   secret. Copy the new secret somewhere secure (1Password / Vault). The old
   secret becomes invalid immediately.
2. **Confirm no live references**: the recompute-space-stats Edge Function
   still uses `SUPABASE_SERVICE_ROLE_KEY` for ad-hoc invocations; that env
   var is now the rotated secret. No other code or migration in this repo
   references the service-role secret.
3. **Rewrite git history** to remove the old secret from all branches and
   tags:
   ```sh
   # Using git-filter-repo (preferred; install via pipx or pip)
   git filter-repo --path supabase/migrations/20260729100000_space_stats_achievements.sql \
                   --replace-text 'sb_secret_[A-Za-z0-9_-]+=<REDACTED>'
   ```
   Or with BFG:
   ```sh
   bfg --replace-text /path/to/replacements.txt
   # where replacements.txt contains: sb_secret_[A-Za-z0-9_-]+==>REDACTED
   ```
   Then `git reflog expire --expire=now --all && git gc --prune=now --aggressive`.
4. **Force-push** rewritten branches and require all collaborators to re-clone
   (their local clones still contain the leaked secret).
5. **Rotate any secrets that were committed alongside the leaked key in the
   same file** — the new migration unschedules the HTTP path but does not
   itself contain a secret.

### Why this is manual

Rotating a Supabase service-role key requires the Supabase dashboard, which
is not accessible from this repository. Rewriting git history requires
operator-controlled `git filter-repo` / BFG and a coordinated force-push.
Neither can be performed by automated tooling in a code-only environment.

---

## CRITICAL — Rotate the LocationIQ and Barikoi API keys (audit C-2)

`app/avero/.env` contains two paid third-party geocoding keys (LocationIQ
`pk.…` and Barikoi `bkoi_…`). The file is correctly listed in
`app/avero/.gitignore` and is **not** in git history.

**However**, the contents of this file were read into development tooling
during the audit. The keys must be considered exposed regardless of
whether they appeared in any committed source.

### Procedure

1. **LocationIQ** dashboard → Account → Regenerate API key. Copy the new key.
2. **Barikoi** dashboard → Account → Regenerate API key. Copy the new key.
3. Replace the values in `app/avero/.env` locally. **Do not commit the file.**
4. Confirm `app/avero/.gitignore` continues to exclude `.env` (it does — line 14).
5. If the keys were ever shared with collaborators or CI, rotate there too.

### Why this is manual

Rotating third-party API keys requires access to each provider's dashboard.
The repository cannot do this.

---

## HIGH — Apply the recompute migration (audit C-1 follow-up)

After rotating the service-role key (above), apply the new in-DB recompute
migration:

```sh
supabase db push
```

This creates the `recompute_space_stats(space_id uuid)` and
`drain_stats_recompute_queue()` plpgsql functions and reschedules the cron
to call the in-DB function. The HTTP path is no longer used by the cron.

### Verification

```sql
-- The new function exists and is callable by the postgres role.
SELECT pg_proc.proname
  FROM pg_proc
 WHERE pg_proc.proname IN ('recompute_space_stats', 'drain_stats_recompute_queue');
-- Should return two rows.

-- The cron job is scheduled.
SELECT jobname FROM cron.job WHERE jobname = 'recompute-space-stats-job';
-- Should return one row.

-- The old HTTP-bearing job body is gone (the secret should not appear
-- anywhere in the cron.job.command column).
SELECT command FROM cron.job WHERE jobname = 'recompute-space-stats-job';
-- Should contain 'drain_stats_recompute_queue', not 'sb_secret_' or 'net.http_post'.
```

---

## HIGH — Apply the anon EXECUTE revoke (audit H-1)

```sh
supabase db push
```

This applies `supabase/migrations/20260901110000_revoke_anon_thumbnail_rpc_execute.sql`,
which revokes `EXECUTE … FROM anon` on the four thumbnail RPCs.

### Verification

```sql
-- No anon grants on the thumbnail RPCs.
SELECT grantee, routine_name
  FROM information_schema.routine_privileges
 WHERE routine_name IN (
     'get_space_mosaic_thumbnails',
     'get_memory_mosaic_thumbnails',
     'get_timeline_thumbnails',
     'get_space_list_thumbnails'
 );
-- Should NOT include 'anon' rows.

-- Authenticated is still granted (the app needs this).
SELECT grantee, routine_name
  FROM information_schema.routine_privileges
 WHERE grantee = 'authenticated'
   AND routine_name LIKE '%_thumbnails';
-- Should return at least the four rows.
```