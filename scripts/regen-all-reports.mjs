// Regenerates every report in reports.json using the current report.js logic.
// Run: node scripts/regen-all-reports.mjs
// The server does NOT need to be running — writes directly to the JSON store.
// Skips reports whose session is missing or has fewer than 3 transcript turns.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport, stubReportSections } from "../server/report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "server", "data");
const ENV_PATH = join(__dirname, "..", ".env");

// ── Load .env (MINIMAX_API_KEY is read lazily inside ollama.js, so setting
//    process.env here — before any LLM call — is enough). ────────────────────
try {
  const lines = readFileSync(ENV_PATH, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  console.log("Loaded .env — MINIMAX_API_KEY set:", !!process.env.MINIMAX_API_KEY);
} catch {
  console.warn("No .env found — relying on existing environment variables.");
}

const MIN_TURNS = 3;

const REPORTS_PATH = join(DATA, "reports.json");
const SESSIONS_PATH = join(DATA, "sessions.json");

const reports = JSON.parse(readFileSync(REPORTS_PATH, "utf-8"));
const sessions = JSON.parse(readFileSync(SESSIONS_PATH, "utf-8"));
const sessionMap = new Map(sessions.map((s) => [s.id, s]));

const targets = reports.filter((r) => {
  const ses = sessionMap.get(r.sessionId);
  if (!ses) { console.log(`  SKIP ${r.id} — session not found`); return false; }
  if ((ses.transcript || []).length < MIN_TURNS) {
    console.log(`  SKIP ${r.id} — only ${ses.transcript.length} turns`);
    return false;
  }
  return true;
});

console.log(`\nRegenerating ${targets.length} / ${reports.length} reports (${reports.length - targets.length} skipped).\n`);

let done = 0;
let failed = 0;

for (const rep of targets) {
  const ses = sessionMap.get(rep.sessionId);
  const turns = ses.transcript.length;
  const n = done + failed + 1;
  process.stdout.write(`[${n}/${targets.length}] ${rep.id}  (${turns} turns) … `);

  try {
    const result = await generateReport(ses);

    const updated = {
      ...rep,
      // Stub sections first (scoreArc, benchmarks, transcript, finalScore).
      ...stubReportSections(ses),
      // Generated sections on top (rubric, phaseBreakdown, overall, etc.).
      ...result,
      status: "ready",
      generatedAt: new Date().toISOString(),
    };

    const idx = reports.findIndex((r) => r.id === rep.id);
    reports[idx] = updated;
    // Write after every report so a crash mid-run doesn't lose progress.
    writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2) + "\n");

    const pct = updated.overall?.percent ?? "?";
    const band = updated.overall?.band ?? "";
    const outcome = updated.overall?.outcome ?? "";
    console.log(`✓  ${pct}% ${band}  ${outcome}`);
    done++;
  } catch (err) {
    console.log(`✗  FAILED: ${err.message}`);
    failed++;
  }

  // Pause between calls to avoid rate limits.
  if (n < targets.length) await new Promise((r) => setTimeout(r, 500));
}

console.log(`\nDone. ${done} regenerated, ${failed} failed, ${reports.length - targets.length} skipped.\n`);
