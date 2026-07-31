#!/usr/bin/env node
/**
 * SPEC B.1 Migration Verification — Run AFTER `supabase db push --linked`
 * Confirms thumbnail_grid_path and thumbnail_detail_path exist on REMOTE database.
 *
 * Usage:
 *   npx supabase db push --linked
 *   node app/avero/scripts/verify-migration.mjs
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// Load .env from app/avero directory
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up two levels from scripts/ to reach app/avero/
const PROJECT_ROOT = resolve(__dirname, "..", "..");
import { config } from "dotenv";
config({ path: resolve(PROJECT_ROOT, ".env") });

// Use VITE_-prefixed vars (what the .env actually has)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // This one is not VITE_ prefixed

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
  console.error("   SUPABASE_URL:", SUPABASE_URL ? "✓" : "✗");
  console.error("   SUPABASE_SERVICE_ROLE_KEY:", SERVICE_ROLE_KEY ? "✓" : "✗");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function verify() {
  console.log("🔍 Verifying migration on remote database...\n");

  const { data, error } = await supabase.rpc("exec_sql", {
    sql: `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'media'
        AND column_name IN ('thumbnail_grid_path', 'thumbnail_detail_path')
      ORDER BY column_name;
    `,
  });

  if (error) {
    console.error("❌ Query failed:", error.message);
    process.exit(1);
  }

  const expected = ["thumbnail_grid_path", "thumbnail_detail_path"];
  const found = (data || []).map((r) => r.column_name);
  const missing = expected.filter((c) => !found.includes(c));

  console.log("Columns found:");
  for (const row of data || []) {
    console.log(`  ✅ ${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
  }

  if (missing.length > 0) {
    console.log(`\n❌ MISSING COLUMNS: ${missing.join(", ")}`);
    console.log("Migration did NOT land on remote. Check `npx supabase db push --linked` output.");
    process.exit(1);
  }

  console.log("\n✅ VERIFICATION PASSED: Both columns exist on remote database.");
  console.log("Proceed to updating thumbnail consumers (B.1.5).");
}

verify();
