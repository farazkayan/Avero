#!/usr/bin/env node
/**
 * SPEC B.1 Migration Verification — Run AFTER `supabase db push --linked`
 * Confirms thumbnail_grid_path and thumbnail_detail_path exist on REMOTE database.
 *
 * Usage:
 *   supabase db push --linked
 *   node scripts/verify-migration.mjs
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
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
    console.log("Migration did NOT land on remote. Check `supabase db push --linked` output.");
    process.exit(1);
  }

  console.log("\n✅ VERIFICATION PASSED: Both columns exist on remote database.");
  console.log("Proceed to updating thumbnail consumers (B.1.5).");
}

verify();
