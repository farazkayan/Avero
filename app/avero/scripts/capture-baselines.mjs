#!/usr/bin/env node
/**
 * SPEC B.0 — Baseline Capture Script
 * Run this locally to capture all baseline metrics before optimizations.
 *
 * Usage:
 *   node scripts/capture-baselines.mjs
 *
 * Outputs: baseline-report.md in project root
 */

import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(process.cwd(), "app/avero");
const REPORT_PATH = resolve(process.cwd(), "baseline-report.md");

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

async function main() {
  console.log("📊 Capturing SPEC B.0 baselines...\n");
  let report = "# SPEC B.0 Baseline Report\n";
  report += `Generated: ${new Date().toISOString()}\n`;

  // 1. Lighthouse CI (requires lighthouse-ci installed globally or via npx)
  report += section("1. Lighthouse CI Audit");
  console.log("Running Lighthouse on key pages...");
  const lhPages = [
    "http://localhost:5173/spaces/your-space-id", // SpaceDetailPage (replace with real space ID)
    "http://localhost:5173/spaces/your-space-id/memories/your-memory-id", // MemoryDetailPage
    "http://localhost:5173/spaces/your-space-id/stats", // SpaceStatsPage
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
  report += "- Cold load SpaceDetailPage with 50+ memories\n";
  report += "- MemoryDetailPage with 10+ media items\n";
  report += "- SpaceStatsPage\n";
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
