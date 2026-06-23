// supabase/functions/report-worker/index.ts
//
// POST { report_id }  Authorization: Bearer <service-role-key>
//
// Flow:
//   1. Validate the caller bears the SUPABASE_SERVICE_ROLE_KEY.
//   2. RPC claim_report(p_report)  → null ⇒ 200 { skipped: true }
//   3. Load the report row and its session (store.fromRow gives legacy shapes).
//   4. Load app_config for prompt/scoring overrides (fail-soft).
//   5. generateReport(session) from _shared/lib/report.js
//   6. RPC commit_report(p_report, p_token, p_patch) mapping the assembled report.
//   7. commit_report false ⇒ 200 { skipped: true }  (lease raced)
//   8. 200 { status }
//
// Error handling:
//   - Validation errors ⇒ 4xx immediately.
//   - generateReport throws ⇒ log + 500, do NOT clear the lease
//     (it expires; the sweeper re-kicks).
//   - commit_report call error ⇒ log + 500.
//
// Authored as plain JavaScript syntax (no TS-only syntax) per project convention.

import { getEnv } from "../_shared/env.js";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.js";
import { getById } from "../_shared/store.js";
import { generateReport } from "../_shared/lib/report.js";

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Service-key guard
// ---------------------------------------------------------------------------

function validateServiceKey(req) {
  // Accept either the dedicated WORKER_SHARED_SECRET (used by the pg_cron
  // sweeper via Vault and by the api fn's /end kick) or the platform-injected
  // service role key (defense-in-depth / transitional).
  const shared = getEnv("WORKER_SHARED_SECRET");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!shared && !serviceKey) {
    console.error("[report-worker] neither WORKER_SHARED_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set");
    return false;
  }
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (!m) return false;
  return (!!shared && m[1] === shared) || (!!serviceKey && m[1] === serviceKey);
}

// ---------------------------------------------------------------------------
// Patch builder — maps the assembled report object to the commit_report
// p_patch contract (snake_case jsonb keys).
//
// Patch contract keys (from 0004_rpcs.sql commit_report):
//   status, partial, overall_percent, overall_band, overall_outcome,
//   final_score, generated_at, overall, rubric, phase_breakdown,
//   strengths, improvements, key_moments, drills, benchmarks, score_arc,
//   persona_addressed, persona_card, integrity_check
// ---------------------------------------------------------------------------

function buildCommitPatch(report, reportRow) {
  const overall = report.overall || {};

  // status: fallback when report.fallback===true, else ready
  const status = report.fallback === true ? "fallback" : "ready";

  const patch = {
    status,
    generated_at: new Date().toISOString(),
    overall: overall,
    rubric: report.rubric || [],
    phase_breakdown: report.phaseBreakdown || [],
    strengths: report.strengths || [],
    improvements: report.improvements || [],
    key_moments: report.keyMoments || [],
    drills: report.drills || [],
    benchmarks: report.benchmarks || {},
    score_arc: report.scoreArc || [],
    // Issue 2 + 9 — persona-addressed evaluation and snapshot persona card.
    // snake_case keys match the 0008 migration columns + store.js mapping.
    persona_addressed: report.personaAddressed || { concerns: [], summary: "", score: 7 },
    persona_card: report.personaCard || null,
  };

  // Promoted hot columns
  if (overall.percent != null) {
    patch.overall_percent = overall.percent;
  }
  if (overall.band) {
    patch.overall_band = overall.band;
  }
  if (overall.outcome) {
    patch.overall_outcome = overall.outcome;
  }

  // final_score from the report row's persisted stub value (satisfactionScore at end time)
  // The stub persists finalScore; use it from the existing row when available
  const finalScore = reportRow.finalScore != null
    ? reportRow.finalScore
    : (typeof overall.finalScore === "number" ? overall.finalScore : null);
  if (finalScore != null) {
    patch.final_score = finalScore;
  }

  // Integrity check (admin-only misselling verdict) — only present when the
  // session carried an assigned probe. snake_case key matches the 0009 column.
  if (report.integrityCheck) {
    patch.integrity_check = report.integrityCheck;
  }

  // New Report Section (additive, admin-only). snake_case key matches the 0010
  // migration column. Only present when the additive scoring call succeeded.
  if (report.newReport) {
    patch.new_report = report.newReport;
  }

  // Transliterated transcript (Call G) — present only when the worker converted
  // one or more non-Latin turns to Latin script. Replaces the stub transcript so
  // the report reads in one script (each converted turn keeps its original text
  // plus a latinText field). Whitelisted in commit_report by migration 0011.
  if (Array.isArray(report.transcript) && report.transcript.length) {
    patch.transcript = report.transcript;
  }

  // partial flag
  if (report.partial === true) {
    patch.partial = true;
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handle(req) {
  // Only accept POST
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Service-key guard — this function is never user-facing
  if (!validateServiceKey(req)) {
    return json({ error: "Forbidden: service role key required" }, 403);
  }

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const reportId = body.report_id;
  if (!reportId || typeof reportId !== "string") {
    return json({ error: "Missing required field: report_id" }, 400);
  }

  const db = getSupabaseAdmin();

  // ----- Step 1: claim the report lease -----
  let token;
  try {
    const { data, error } = await db.rpc("claim_report", { p_report: reportId });
    if (error) throw error;
    token = data;
  } catch (err) {
    console.error("[report-worker] claim_report failed:", err.message);
    return json({ error: "claim_report RPC failed: " + err.message }, 500);
  }

  if (!token) {
    // Another worker owns the lease, or the report is already ready/fallback.
    return json({ skipped: true });
  }

  // ----- Step 2: load report row -----
  let reportRow;
  try {
    reportRow = await getById("reports", reportId);
  } catch (err) {
    console.error("[report-worker] failed to load report row:", err.message);
    return json({ error: "Failed to load report: " + err.message }, 500);
  }

  if (!reportRow) {
    console.error("[report-worker] report not found:", reportId);
    return json({ error: "Report not found" }, 404);
  }

  // ----- Step 3: load session -----
  const sessionId = reportRow.sessionId;
  if (!sessionId) {
    console.error("[report-worker] report has no sessionId:", reportId);
    return json({ error: "Report has no associated session" }, 500);
  }

  let session;
  try {
    session = await getById("sessions", sessionId);
  } catch (err) {
    console.error("[report-worker] failed to load session:", err.message);
    return json({ error: "Failed to load session: " + err.message }, 500);
  }

  if (!session) {
    console.error("[report-worker] session not found:", sessionId);
    return json({ error: "Session not found" }, 404);
  }

  // Merge stub data back onto session for report generation.
  // The stub already persisted transcript + scoreArc + finalScore;
  // the session row from the DB has the transcript, scoreHistory, milestones etc.
  // reportRow may also carry a stub transcript that was persisted at end time.
  // Use session.transcript when present (it is the authoritative copy on the session row).
  // Fall back to reportRow.transcript if session.transcript is empty (shouldn't happen).
  if (
    (!session.transcript || session.transcript.length === 0) &&
    reportRow.transcript && reportRow.transcript.length > 0
  ) {
    session.transcript = reportRow.transcript;
  }

  // ----- Step 4: run generateReport -----
  let assembled;
  try {
    assembled = await generateReport(session);
  } catch (err) {
    console.error("[report-worker] generateReport threw:", err.message);
    // Do NOT clear the lease — let it expire so the sweeper can re-kick.
    return json({ error: "Report generation failed: " + err.message }, 500);
  }

  // ----- Step 5: build commit patch and call commit_report -----
  const patch = buildCommitPatch(assembled, reportRow);

  let committed;
  try {
    const { data, error } = await db.rpc("commit_report", {
      p_report: reportId,
      p_token: token,
      p_patch: patch,
    });
    if (error) throw error;
    committed = data;
  } catch (err) {
    console.error("[report-worker] commit_report failed:", err.message);
    // Do NOT clear the lease — let it expire.
    return json({ error: "commit_report RPC failed: " + err.message }, 500);
  }

  if (!committed) {
    // CAS failed — lease was reclaimed by another worker while we were generating.
    return json({ skipped: true });
  }

  return json({ status: patch.status });
}

// ---------------------------------------------------------------------------
// Deno / Edge Function entry point
// ---------------------------------------------------------------------------

// @ts-ignore — Deno namespace is available in Edge Function runtime but not in TS lib
Deno.serve(handle);
