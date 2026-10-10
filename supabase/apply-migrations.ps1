# Apply pending Avero Supabase migrations to the linked remote project.
# Requires SUPABASE_ACCESS_TOKEN to be set in the current PowerShell session.
# See: https://supabase.com/dashboard/account/tokens

$ErrorActionPreference = "Stop"
$supabaseDir = "H:\Work\AVERO DEV\Avero\supabase"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Error "SUPABASE_ACCESS_TOKEN env var is not set. Generate one at the Supabase dashboard, then re-run."
    exit 1
}

Set-Location -LiteralPath $supabaseDir

Write-Host "==> Re-linking Supabase CLI to project lvsgaqykefkvsbnkglpg..." -ForegroundColor Cyan
npx supabase link --project-ref lvsgaqykefkvsbnkglpg
if ($LASTEXITCODE -ne 0) { Write-Error "supabase link failed (exit $LASTEXITCODE)."; exit $LASTEXITCODE }

Write-Host ""
Write-Host "==> Listing remote migrations (to confirm what is already applied)..." -ForegroundColor Cyan
npx supabase migration list --linked
if ($LASTEXITCODE -ne 0) { Write-Error "supabase migration list failed (exit $LASTEXITCODE)."; exit $LASTEXITCODE }

Write-Host ""
Write-Host "==> PENDING migrations to apply:" -ForegroundColor Cyan
Write-Host "    - 20260901100000_in_db_stats_recompute.sql" -ForegroundColor Yellow
Write-Host "    - 20260901110000_revoke_anon_thumbnail_rpc_execute.sql" -ForegroundColor Yellow
Write-Host "    - 20260901213000_fix_space_delete_cascade_fk.sql" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "Apply these to REMOTE (production) Supabase project lvsgaqykefkvsbnkglpg? Type 'yes' to continue"
if ($confirm -ne "yes") {
    Write-Host "Aborted by user." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "==> Pushing migrations to remote..." -ForegroundColor Cyan
npx supabase db push --linked --include-all
$pushExit = $LASTEXITCODE

if ($pushExit -eq 0) {
    Write-Host ""
    Write-Host "==> SUCCESS: Migrations applied. Verifying..." -ForegroundColor Green
    npx supabase migration list --linked
} else {
    Write-Error "supabase db push failed (exit $pushExit). Remote database may be in a partial state. Check the Supabase dashboard and migration log."
    exit $pushExit
}

Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "==> Done. SUPABASE_ACCESS_TOKEN cleared from this shell." -ForegroundColor Green
Write-Host "Token remains valid until its expiration. Revoke at: https://supabase.com/dashboard/account/tokens"
