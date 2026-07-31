#!/usr/bin/env node
/**
 * SPEC B.0 — Baseline Capture Script
 * Run this locally to capture all baseline metrics before optimizations.
 *
 * Usage:
 *   node scripts/capture-baselines.mjs
 *   # or from repo root:
 *   node app/avero/scripts/capture-baselines.mjs
 *
 * Outputs: baseline-report.md in project root
 */

import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// ----------------------------------------------------------------------------
// Project root detection — works from ANY working directory
// ----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up from this script's location to find the app/avero directory
// (the one containing package.json + vite.config.ts)
function findProjectRoot(startDir) {
  let current = startDir;
  while (current !== dirname(current)) { // stop at filesystem root
    if (existsSync(resolve(current, "package.json")) &&
        existsSync(resolve(current, "vite.config.ts"))) {
      return current;
    }
    current = dirname(current);
  }
  // Fallback: assume standard layout (script is at app/avero/scripts/...)
  return resolve(__dirname, "..", "..");
}

const PROJECT_ROOT = findProjectRoot(__dirname);
const REPORT_PATH = resolve(PROJECT_ROOT, "..", "baseline-report.md"); // repo root

// Load .env from the project root (app/avero/.env)
config({ path: resolve(PROJECT_ROOT, ".env") });

function run(cmd, cwd = PROJECT_ROOT) {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

function section(title) {
  return `\n## ${title}\n`;
}

function codeBlock(lang, content) {
  return `\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
}

// ----------------------------------------------------------------------------
// Real Space ID and Memory ID (provided by user)
// ----------------------------------------------------------------------------
const REAL_SPACE_ID = "5f91c881-82e0-4849-9c6e-9b67e5d23505";
const REAL_MEMORY_ID = "607e7578-98e1-4504-b9e0-c07228e4e20b";

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log("📊 Capturing SPEC B.0 baselines...\n");
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Report will be written to: ${REPORT_PATH}\n`);

  let report = "# SPEC B.0 Baseline Report\n";
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `Space ID used: ${REAL_SPACE_ID}\n`;
  report += `Memory ID used: ${REAL_MEMORY_ID}\n`;

  // 1. Lighthouse CI (requires lighthouse-ci installed globally or via npx)
  report += section("1. Lighthouse CI Audit");
  console.log("Running Lighthouse on key pages...");
  const lhPages = [
    `http://localhost:5173/spaces/${REAL_SPACE_ID}`, // SpaceDetailPage
    `http://localhost:5173/spaces/${REAL_SPACE_ID}/memories/${REAL_MEMORY_ID}`, // MemoryDetailPage
    `http://localhost:5173/spaces/${REAL_SPACE_ID}/stats`, // SpaceStatsPage
  ];
  for (const url of lhPages) {
    report += `### ${url}\n`;
    const result = run(`npx lighthouse "${url}" --output=json --quiet --chrome-flags="--headless"`);
    report += codeBlock("json", result.slice(0, 5000)); // Truncate for readability
  }

  // 2. Bundle Size Analysis
  report += section("2. Bundle Size Analysis");
  console.log("Building for bundle analysis...");
  run("npm run build");
  const distPath = resolve(PROJECT_ROOT, "dist");
  if (existsSync(distPath)) {
    const files = run(`find ${distPath} -name "*.js" -o -name "*.css" | head -20`);
    report += codeBlock("bash", files);
    const sizes = run(`du -sh ${distPath}/* | sort -hr`);
    report += codeBlock("bash", sizes);
  }

  // 3. Vite Bundle Analyzer (requires rollup-plugin-visualizer configured)
  report += section("3. Bundle Visualizer");
  console.log("Generating bundle visualizer...");
  run("npm run build:analyze 2>&1 | tail -20");

  // 4. Network Metrics (manual - user must record HAR in DevTools)
  report += section("4. Network Metrics (Manual)");
  report += "Record HAR files in Chrome DevTools for:\n";
  report += `- Cold load SpaceDetailPage with 50+ memories (${lhPages[0]})\n`;
  report += `- MemoryDetailPage with 10+ media items (${lhPages[1]})\n`;
  report += `- SpaceStatsPage (${lhPages[2]})\n`;
  report += "\nPaste key metrics here manually.\n";

  // 5. Database Query Baselines (requires Supabase CLI + pg_stat_statements)
  report += section("5. Database Query Baselines");
  console.log("Querying Supabase for query stats...");
  const dbQueries = run(`supabase db shell -c "
    SELECT query, calls, total_exec_time, mean_exec_time, rows
    FROM pg_stat_statements
    WHERE query LIKE '%memories%' OR query LIKE '%media%' OR query LIKE '%reactions%'
    ORDER BY total_exec_time DESC
    LIMIT 20;
  "`);
  report += codeBlock("sql", dbQueries);

  // Write report
  writeFileSync(REPORT_PATH, report);
  console.log(`\n✅ Baseline report written to: ${REPORT_PATH}`);
  console.log("📝 Fill in manual sections (HAR metrics, Lighthouse if CI failed) then share results.");
}

main().catch(console.error);
