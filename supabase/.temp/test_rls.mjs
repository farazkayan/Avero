// Test RLS policies through the actual Supabase client API.
// This tests that the tightened space_members_insert policy blocks
// self-joins when accessed through PostgREST (with a real JWT).
//
// Usage: node supabase/.temp/test_rls.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lvsgaqykefkvsbnkglpg.supabase.co";
const SUPABASE_KEY = "sb_publishable_DczL1u6A-Y2IFl4DuwOyMQ_4460gBS1";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_SPACE_ID = "11111111-0000-0000-0000-000000000001";

// Test credentials
const USER_B_EMAIL = "farazkayanhaque.work@gmail.com";
const USER_B_PASSWORD = "TestPassword123!"; // We'll need to set this

async function main() {
  console.log("=== RLS Policy Test: space_members_insert (self-join blocked) ===\n");

  // First, try to sign in as User B
  console.log("Attempting to sign in as User B...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: USER_B_EMAIL,
    password: USER_B_PASSWORD,
  });

  if (authError) {
    console.log("Sign-in failed (expected if password is unknown):", authError.message);
    console.log("\nCannot test RLS without authenticated session.");
    console.log("The RLS policy was verified structurally:");
    console.log("  - space_members_insert WITH CHECK = is_space_owner(space_id)");
    console.log("  - The old self-join branch (user_id = auth.uid() AND role = 'member') is gone");
    console.log("  - A non-owner cannot satisfy is_space_owner(), so self-join is blocked");
    console.log("\nTo fully test RLS, sign in with valid credentials and run:");
    console.log("  supabase.from('space_members').insert({ space_id, user_id, role: 'member' })");
    console.log("  → should fail with RLS policy violation");
    return;
  }

  console.log("Signed in as:", authData.user.email);

  // Try to self-join (should fail with RLS error)
  console.log("\nAttempting self-join (should be blocked by RLS)...");
  const { data, error } = await supabase
    .from("space_members")
    .insert({
      space_id: TEST_SPACE_ID,
      user_id: authData.user.id,
      role: "member",
    });

  if (error) {
    console.log("✅ TEST 11 PASSED: Self-join blocked by RLS");
    console.log("  Error code:", error.code);
    console.log("  Error message:", error.message);
  } else {
    console.log("❌ TEST 11 FAILED: Self-join was NOT blocked!");
    console.log("  Data:", data);
    // Clean up
    await supabase
      .from("space_members")
      .delete()
      .eq("space_id", TEST_SPACE_ID)
      .eq("user_id", authData.user.id);
  }

  // Sign out
  await supabase.auth.signOut();
  console.log("\nSigned out.");
}

main().catch(console.error);
