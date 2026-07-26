// ============================================================================
// Diagnostic: what is actually happening with the B2 delete call?
// ----------------------------------------------------------------------------
// Runs three independent checks against the live Supabase project:
//   1. Lists recent media rows (service_role bypasses RLS) so we can see the
//      ACTUAL stored object keys (url / storage_path / thumbnail_path) and
//      confirm the key shape the delete path would pass to the Edge Function.
//   2. Fetches the deployed media-storage Edge Function logs via the
//      Management API so we can see whether delete requests are arriving and
//      what the function is doing with them (success, 400 "Invalid action",
//      502 B2 failure, etc.).
//   3. Fetches the deployed function body via the Management API so we can
//      confirm whether the deployed code actually contains the
//      `request-delete-url` / handleDeleteUrl handler (i.e. whether the local
//      code was ever deployed).
//
// This script is READ-ONLY. It does not delete anything.
// ============================================================================

const SUPABASE_URL = "https://lvsgaqykefkvsbnkglpg.supabase.co";
const PROJECT_REF = "lvsgaqykefkvsbnkglpg";
// service_role key — bypasses RLS for the diagnostic SELECT only.
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2c2dhcXlrZWZrdnNibmtnbHBnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA2ODI3NSwiZXhwIjoyMDk4NjQ0Mjc1fQ.TFpj64hYLb2rMT22W0Z_JTh3JAzlVKqYtOZnas3aCB8";

// Personal access token for the Management API. The Supabase CLI stores it
// in the OS credential store, which we can't read portably here. Instead we
// rely on the CLI's own `--output json` for api-keys (already used above) and
// fetch the function body/logs through the same service_role-authorized
// endpoints where possible. For the Management API we need a PAT; if absent,
// we fall back to inferring deployment state from the function list + DB.
const MANAGEMENT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";

function header() {
  console.log("\n" + "=".repeat(78));
  console.log(arguments[0]);
  console.log("=".repeat(78));
}

async function main() {
  // ------------------------------------------------------------------
  // CHECK 1 — actual stored media keys in the DB
  // ------------------------------------------------------------------
  header("CHECK 1: recent media rows (actual stored B2 object keys)");
  const mediaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/media?select=id,memory_id,url,storage_path,thumbnail_path,type,created_at&order=created_at.desc&limit=10`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  const mediaRows = await mediaRes.json();
  if (!mediaRes.ok) {
    console.log("FAILED:", mediaRes.status, JSON.stringify(mediaRows));
  } else {
    console.log(`Found ${mediaRows.length} recent media rows:\n`);
    for (const r of mediaRows) {
      console.log(`  id            : ${r.id}`);
      console.log(`  memory_id     : ${r.memory_id}`);
      console.log(`  type          : ${r.type}`);
      console.log(`  url           : ${r.url}`);
      console.log(`  storage_path  : ${r.storage_path}`);
      console.log(`  thumbnail_path: ${r.thumbnail_path}`);
      console.log(`  created_at    : ${r.created_at}`);
      console.log(
        `  url===storage_path: ${r.url === r.storage_path}  | key shape ok: ${/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/.+$/.test(r.storage_path)}`,
      );
      console.log("");
    }
  }

  // ------------------------------------------------------------------
  // CHECK 2 — Edge Function logs (Management API)
  // ------------------------------------------------------------------
  header("CHECK 2: media-storage Edge Function logs (last 24h)");
  if (!MANAGEMENT_TOKEN) {
    console.log(
      "SKIPPED — no SUPABASE_ACCESS_TOKEN env var set for the Management API.",
    );
    console.log(
      "  (The CLI stores the PAT in the OS keychain, not an env var.)",
    );
  } else {
    try {
      const logsRes = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/media-storage/logs?limit=50`,
        { headers: { Authorization: `Bearer ${MANAGEMENT_TOKEN}` } },
      );
      const logs = await logsRes.json();
      if (!logsRes.ok) {
        console.log("FAILED:", logsRes.status, JSON.stringify(logs));
      } else {
        const items = logs ?? [];
        console.log(`Retrieved ${items.length} log entries.\n`);
        for (const e of items) {
          const ts = e.timestamp || e.created_at || "";
          const msg = e.metadata?.[0]?.message ?? e.message ?? JSON.stringify(e);
          console.log(`  ${ts}  ${String(msg).slice(0, 200)}`);
        }
      }
    } catch (err) {
      console.log("ERROR fetching logs:", err.message);
    }
  }

  // ------------------------------------------------------------------
  // CHECK 3 — deployed function body (Management API)
  // ------------------------------------------------------------------
  header("CHECK 3: deployed media-storage function body (does it have delete?)");
  if (!MANAGEMENT_TOKEN) {
    console.log(
      "SKIPPED — no SUPABASE_ACCESS_TOKEN env var set for the Management API.",
    );
  } else {
    try {
      const bodyRes = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/media-storage/body`,
        { headers: { Authorization: `Bearer ${MANAGEMENT_TOKEN}` } },
      );
      const bodyText = await bodyRes.text();
      if (!bodyRes.ok) {
        console.log("FAILED:", bodyRes.status, bodyText.slice(0, 300));
      } else {
        const hasDeleteAction = bodyText.includes("request-delete-url");
        const hasDeleteHandler = bodyText.includes("handleDeleteUrl");
        const hasDeleteObjectCommand = bodyText.includes("DeleteObjectCommand");
        console.log(`deployed body length: ${bodyText.length} chars`);
        console.log(`contains "request-delete-url"   : ${hasDeleteAction}`);
        console.log(`contains "handleDeleteUrl"      : ${hasDeleteHandler}`);
        console.log(`contains "DeleteObjectCommand"  : ${hasDeleteObjectCommand}`);
        console.log("");
        console.log(
          hasDeleteAction && hasDeleteHandler && hasDeleteObjectCommand
            ? "=> Deployed function HAS the delete handler."
            : "=> Deployed function is MISSING the delete handler (stale deploy).",
        );
      }
    } catch (err) {
      console.log("ERROR fetching body:", err.message);
    }
  }

  // ------------------------------------------------------------------
  // CHECK 4 — invoke the deployed function with request-delete-url against a
  //           sentinel key to see the EXACT response (without auth, so we
  //           expect a 401 — but a 400 "Invalid action" would prove the
  //           deployed code lacks the delete route).
  // ------------------------------------------------------------------
  header("CHECK 4: probe deployed function routing for request-delete-url");
  try {
    const probeRes = await fetch(
      `${SUPABASE_URL}/functions/v1/media-storage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request-delete-url",
          file_key: "00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/probe.txt",
        }),
      },
    );
    const probeText = await probeRes.text();
    console.log(`HTTP status: ${probeRes.status}`);
    console.log(`Response body: ${probeText.slice(0, 400)}`);
    console.log("");
    if (probeRes.status === 400) {
      const parsed = JSON.parse(probeText);
      if (parsed.error && parsed.error.includes("Invalid 'action'")) {
        console.log(
          "=> CONFIRMED: deployed function does NOT recognize request-delete-url.",
        );
        console.log(
          "   The local handleDeleteUrl code was NEVER DEPLOYED. Every delete",
        );
        console.log(
          "   request returns 400, which deleteMedia treats as fnError ->",
        );
        console.log(
          "   b2Orphaned=true, silently swallowed by the UI.",
        );
      }
    } else if (probeRes.status === 401) {
      console.log(
        "=> 401 (auth required) means the deployed function REACHED the",
      );
      console.log(
        "   action-routing code past JSON parse — so request-delete-url IS",
      );
      console.log(
        "   recognized by the deployed function. The delete handler exists.",
      );
      console.log(
        "   The B2 delete failure must be happening INSIDE handleDeleteUrl",
      );
      console.log(
        "   (membership check, S3 client config, or the DeleteObject call).",
      );
    }
  } catch (err) {
    console.log("ERROR probing function:", err.message);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
