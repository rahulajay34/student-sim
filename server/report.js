// Report v2 — grades against the session's rubricSnapshot (anchor-quoted),
// adds key moments, benchmark comparisons, and practice drills.
// Falls back to the legacy 6-criterion rubric for pre-v2 sessions.
//
// Contract decisions:
//   - Model: MiniMax-M3 (MINIMAX_MODEL override) via ./ollama.js chat().
//   - Parallel fan-out: Call A (rubric + 5-phase phaseBreakdown) and Call B
//     (strengths/improvements/keyMoments + overall.headline) run via Promise.all;
//     Call C (drills) runs after A because it needs A's weakest criteria.
//   - Adaptive thinking ONLY when session.transcript.length > 20 (else disabled).
//   - Per-call retry: attempt 1 as configured (60s); attempt 2 thinking-disabled (60s).
//   - If Call A fails entirely → neutral fallback report (fallback:true,
//     regenerable:true). If only B or C fails → assemble what succeeded, mark
//     report.partial = true and leave that section to minimal defaults.
//   - Exported needsRegeneration(report): true when report.fallback === true.
//   - Exported reportPromptForInspection(session): the Call A prompt text.
//   - Test seam: _setChatForTests(fn) swaps the chat() implementation.
import { chat as realChat, DETERMINISTIC_SAMPLING, extractJson } from "./ollama.js";
import { BENCHMARKS, STRUCTURE } from "./grounding.js";

// ─── Test seam ───────────────────────────────────────────────────────────────
// generateReport calls through this indirection so tests can inject a stub
// without touching the network. Defaults to the real ollama chat().
let _chat = realChat;
export function _setChatForTests(fn) {
  _chat = typeof fn === "function" ? fn : realChat;
}

export const LEGACY_RUBRIC = [
  { key: "rapport", label: "Rapport & Opening", weight: 15 },
  { key: "discovery", label: "Needs Discovery", weight: 20 },
  { key: "objections", label: "Objection Handling", weight: 25 },
  { key: "knowledge", label: "Product Knowledge & Accuracy", weight: 15 },
  { key: "closing", label: "Closing & Next Steps", weight: 15 },
  { key: "communication", label: "Communication & Empathy", weight: 10 },
];

const LEVEL_LABELS = { 1: "Poor", 2: "Developing", 3: "Competent", 4: "Proficient", 5: "Excellent" };
const PHASE_NAMES_V2 = ["Opening", "Discovery", "Presentation", "Objections & Negotiation", "Close"];

const bandFor = (pct) => (pct >= 75 ? "Excellent" : pct >= 50 ? "Good" : "Needs Work");

function transcriptText(transcript) {
  return (transcript || [])
    .map((m, i) => {
      const who = m.role === "counsellor" ? "COUNSELLOR" : "STUDENT";
      // Strip old inline [emotion:X] artifacts embedded in m.text by pre-split
      // sessions (modern sessions carry emotion in m.emotion). Keeps these tags
      // out of both the rendered transcript and the LLM grading prompt.
      const cleanText = m.text ? m.text.replace(/\[emotion:[^\]]*\]/gi, "").replace(/\s+/g, " ").trim() : "";
      let line = `[turn ${i}] ${who}: ${cleanText}`;
      // Append delivery metrics for counsellor entries when present.
      if (m.role === "counsellor" && m.deliveryMetrics) {
        const dm = m.deliveryMetrics;
        const parts = [];
        if (dm.tone !== undefined) parts.push(`tone=${dm.tone}`);
        if (Number.isFinite(dm.wpm)) parts.push(`${Math.round(dm.wpm)}wpm`);
        // Classic-sidecar shape (old sessions):
        if (Number.isFinite(dm.pauseRatio)) parts.push(`pauses=${dm.pauseRatio}`);
        // Realtime S2S shape (new /observe sessions): pauses/energyVar/durationMs.
        if (Number.isFinite(dm.pauses)) parts.push(`pauses=${dm.pauses}`);
        if (Number.isFinite(dm.energyVar)) parts.push(`energyVar=${dm.energyVar.toFixed(2)}`);
        if (Number.isFinite(dm.durationMs)) parts.push(`durationMs=${dm.durationMs}`);
        if (parts.length > 0) line += ` [delivery: ${parts.join(", ")}]`;
      }
      // Append non-neutral student emotion when present.
      if (m.role === "student" && m.emotion && m.emotion !== "neutral") {
        line += ` [student emotion: ${m.emotion}]`;
      }
      return line;
    })
    .join("\n");
}

// Voice delivery is only gradable when delivery metrics exist on the transcript.
function sessionHasVoiceMetrics(session) {
  return (session.transcript || []).some((m) => m.deliveryMetrics);
}

// Criteria actually graded for this session (drop voice_delivery for text sessions).
export function effectiveCriteria(session) {
  const snap = session.rubricSnapshot;
  if (!snap?.criteria?.length) return { criteria: LEGACY_RUBRIC.map((c) => ({ ...c, anchors: null })), legacy: true };
  let criteria = snap.criteria;
  if (!sessionHasVoiceMetrics(session)) criteria = criteria.filter((c) => c.key !== "voice_delivery");
  return { criteria, legacy: false };
}

// ─── Shared prompt scaffolding ───────────────────────────────────────────────
function courseHeader(session) {
  const c = session.courseSnapshot;
  return c
    ? `A counsellor was selling "${c.name}" (${c.institute} x Masai School) to a simulated prospective student.`
    : `A counsellor was selling the "Executive Certification Programme in Business Analytics and AI" (IIM Ranchi x Masai) to a simulated prospective student.`;
}

function metaHeader(session) {
  return `STUDENT PERSONA: ${session.personaSnapshot?.label || "student"}
SCENARIO: ${session.scenarioSnapshot?.title || "n/a"} (difficulty: ${session.scenarioSnapshot?.difficulty || "n/a"})
FINAL STUDENT SATISFACTION: ${session.satisfactionScore}/100`;
}

// ─── Call A prompt: rubric grading + 5-phase breakdown ───────────────────────
function buildRubricPrompt(session, criteria) {
  const c = session.courseSnapshot;
  const courseFacts = c ? `
COURSE FACTS (ground truth — penalize the counsellor under "knowledge" for contradicting these):
- Fee: ${c.feeTotal ? `₹${c.feeTotal}` : "not published"}; seat-block: ${c.feeBooking ? `₹${c.feeBooking}` : "₹4,000"}; ${c.feeNote}
- Duration: ${c.duration}; Format: ${c.format}
- Curriculum: ${(c.curriculum || []).join("; ")}
` : "";

  const rubricLines = criteria.map((r) => {
    const anchorText = r.anchors
      ? ` Anchors: 1=${r.anchors["1"]} | 3=${r.anchors["3"]} | 5=${r.anchors["5"]}`
      : "";
    return `- ${r.key} (${r.label}, weight ${r.weight}%).${anchorText}`;
  }).join("\n");

  const m = session.milestones || {};
  const milestoneLines = `MILESTONE COVERAGE (tracked automatically): discovery done: ${!!m.discoveryDone}; presentation done: ${!!m.presentationDone}; payment asked: ${!!m.paymentAsked}; objections raised by student: ${m.objectionsRaised ?? "n/a"}. Real benchmark: the payment ask lands ~${STRUCTURE.paymentAskNorms?.typicalAtPct ?? 78}% into the call and appears in ${STRUCTURE.paymentAskNorms?.presentInPaidPct ?? 87}% of converting calls.`;

  return `You are a senior sales-training coach evaluating a mock counselling call. ${courseHeader(session)}

${metaHeader(session)}
${courseFacts}
${milestoneLines}

FULL TRANSCRIPT (turns are numbered):
${transcriptText(session.transcript)}

Evaluate the COUNSELLOR (not the student) on these rubric criteria, each scored 1-5. The anchors describe what each level sounds like — quote the anchor behaviour you observed:
${rubricLines}

Return ONLY a JSON object with this exact shape:
{
  "rubric": [ { "key": "<criterion key>", "score": 1-5, "justification": "one sentence grounded in the transcript, referencing the matched anchor behaviour" } ],
  "phaseBreakdown": [ { "phase": 1-5, "summary": "...", "didWell": "...", "toImprove": "..." } ],   // exactly 5, named phases: ${PHASE_NAMES_V2.join(", ")}
  "outcome": "Converted" | "Not Converted",
  "outcomeDetail": "one sentence on whether the student agreed to pay ${c?.feeBooking ? `₹${c.feeBooking}` : "the seat-block fee"} and why"
}
Score honestly and specifically. Do not output anything except the JSON object.`;
}

// ─── Call B prompt: strengths / improvements / keyMoments / headline ──────────
// Focused: no rubric anchors, no course facts dump — just the transcript and the
// narrative coaching asks.
function buildNarrativePrompt(session) {
  return `You are a senior sales-training coach writing the narrative section of a coaching report for a mock counselling call. ${courseHeader(session)}

${metaHeader(session)}

FULL TRANSCRIPT (turns are numbered):
${transcriptText(session.transcript)}

Write the coaching narrative for the COUNSELLOR (not the student).

Return ONLY a JSON object with this exact shape:
{
  "headline": "ONE punchy sentence beginning 'Next session, focus on ' naming the single most important thing to improve",
  "strengths": [ { "point": "...", "quote": "short counsellor quote" } ],                            // 2-3
  "improvements": [ { "point": "...", "quote": "short quote", "suggestion": "concrete advice" } ],   // 2-3
  "keyMoments": [ { "turn": <number from transcript>, "type": "best"|"miss", "note": "what happened and why it mattered" } ]  // 2-4
}
Be specific and ground every point in the transcript. Do not output anything except the JSON object.`;
}

// ─── Call C prompt: drills ───────────────────────────────────────────────────
// Focused: receives only criteria keys+labels+scores (NOT full anchor text) so
// it can target the weakest areas.
function buildDrillsPrompt(session, gradedRubric) {
  const sorted = [...gradedRubric].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, 3);
  const scoreLines = gradedRubric
    .map((r) => `- ${r.key} (${r.label}): scored ${r.score}/5`)
    .join("\n");
  const weakestKeys = weakest.map((r) => r.key).join(", ") || "(none)";

  return `You are a senior sales-training coach prescribing practice drills after a mock counselling call. ${courseHeader(session)}

${metaHeader(session)}

RUBRIC SCORES (1-5, already graded — target the weakest):
${scoreLines}

The weakest criteria are: ${weakestKeys}.

FULL TRANSCRIPT (turns are numbered):
${transcriptText(session.transcript)}

Prescribe 2-3 targeted practice drills, each tied to one of the weakest criteria.

Return ONLY a JSON object with this exact shape:
{
  "drills": [ { "title": "...", "focusCriterion": "<one of the weakest criterion keys>", "objectionCategory": "<EXACTLY one of: fee|emi_affordability|parents_family|time_commitment|competing_priorities|trust_legitimacy|job_guarantee_placement|course_fit_relevance|language_english|tech_access|other>", "instruction": "one concrete practice instruction" } ]  // 2-3
}
Do not output anything except the JSON object.`;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

const OBJECTION_ENUM = new Set([
  "fee", "emi_affordability", "parents_family", "time_commitment",
  "competing_priorities", "trust_legitimacy", "job_guarantee_placement",
  "course_fit_relevance", "language_english", "tech_access", "other",
]);

function sanitizeObjectionCategory(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "other";
  const tokens = raw.toLowerCase().split("|").map((t) => t.trim().replace(/[\s/‐-―-]+/g, "_")).filter(Boolean);
  for (const tok of tokens) {
    if (OBJECTION_ENUM.has(tok)) return tok;
  }
  return "other";
}

// ─── LLM call options ───────────────────────────────────────────────────────
// Each fan-out call gets a focused prompt with a 60s timeout. Adaptive thinking
// is enabled ONLY for longer transcripts (> 20 turns); otherwise disabled to
// keep latency low. Attempt 2 always runs thinking-disabled (see runCall).
const CALL_TIMEOUT_MS = 60_000;

function thinkingForSession(session) {
  return (session.transcript || []).length > 20
    ? { type: "adaptive" }
    : { type: "disabled" };
}

// ─── Per-call runner with 2-attempt retry ────────────────────────────────────
// Attempt 1: configured thinking, 60s. Attempt 2: thinking disabled, 60s.
// Returns { ok:true, value } or { ok:false, error }.
async function runCall(label, prompt, thinking) {
  const attempts = [
    { ...DETERMINISTIC_SAMPLING, timeoutMs: CALL_TIMEOUT_MS, thinking },
    { ...DETERMINISTIC_SAMPLING, timeoutMs: CALL_TIMEOUT_MS, thinking: { type: "disabled" } },
  ];
  let lastError;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const text = await _chat([{ role: "user", content: prompt }], attempts[i]);
      return { ok: true, value: extractJson(text) };
    } catch (err) {
      lastError = err;
      console.warn(`[report] ${label} attempt ${i + 1}/${attempts.length} failed: ${err.message}`);
    }
  }
  return { ok: false, error: lastError };
}

// ─── Neutral fallback builder ────────────────────────────────────────────────
// Builds a full rubric-v2-shaped report with neutral mid-band scores.
// Uses effectiveCriteria(session) so voice_delivery is excluded/included correctly.
export function buildFallbackReport(session) {
  const { criteria } = effectiveCriteria(session);
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 100;

  const rubric = criteria.map((c) => ({
    key: c.key,
    label: c.label,
    weight: Math.round((c.weight / totalWeight) * 1000) / 10,
    score: 3,
    level: LEVEL_LABELS[3],   // "Competent" — honest neutral placeholder
    justification: "Report generation failed — neutral placeholder.",
  }));

  // Neutral mid-band percent: score 3 / max 5 = 60%
  const percent = Math.round(rubric.reduce((sum, r) => sum + (3 / 5) * r.weight, 0));

  const phaseBreakdown = PHASE_NAMES_V2.map((name, i) => ({
    phase: i + 1,
    name,
    summary: "Report generation failed — neutral placeholder.",
    didWell: "",
    toImprove: "",
  }));

  const sessionMinutes = session.startedAt
    ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000 * 10) / 10
    : null;

  return {
    overall: {
      percent,
      band: bandFor(percent),
      outcome: "Not Converted",
      outcomeDetail: "Report generation failed — neutral placeholder.",
      headline: "",
    },
    rubric,
    phaseBreakdown,
    strengths: [],
    improvements: [],
    keyMoments: [],
    drills: [],
    benchmarks: buildBenchmarks(session, sessionMinutes),
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
    fallback: true,
    regenerable: true,
  };
}

function buildBenchmarks(session, sessionMinutes) {
  return {
    sessionMinutes,
    medianPaidMinutes: BENCHMARKS.text?.paidVsUnpaid?.durationMedianPaid ?? null,
    paymentAskSeen: !!session.milestones?.paymentAsked,
    paymentAskNormPct: STRUCTURE.paymentAskNorms?.presentInPaidPct ?? null,
  };
}

// ─── Public: instantly-available stub sections (C4) ──────────────────────────
/**
 * stubReportSections(session)
 * Returns the report data that can be computed WITHOUT any LLM call: the live
 * final score, the score arc, the benchmark comparisons, and the transcript.
 * /end persists these immediately (status:"generating") so ReportDetail can
 * render the hero/arc/benchmarks/transcript at once while the LLM sections fill.
 */
export function stubReportSections(session) {
  const sessionMinutes = session.startedAt
    ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000 * 10) / 10
    : null;
  return {
    finalScore: typeof session.satisfactionScore === "number" ? session.satisfactionScore : null,
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
    benchmarks: buildBenchmarks(session, sessionMinutes),
    transcript: session.transcript,
  };
}

// ─── Assemble the graded rubric + phase breakdown from Call A ─────────────────
function assembleRubric(session, rawA, criteria) {
  const byKey = new Map((rawA?.rubric || []).map((r) => [r.key, r]));
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 100;
  const rubric = criteria.map((c) => {
    const r = byKey.get(c.key) || {};
    const score = clamp(r.score ?? 3, 1, 5);
    return {
      key: c.key, label: c.label,
      weight: Math.round((c.weight / totalWeight) * 1000) / 10,   // renormalized (voice_delivery may be excluded)
      score, level: LEVEL_LABELS[score],
      justification: typeof r.justification === "string" ? r.justification : "(not graded by the model — defaulted to Competent)",
    };
  });
  const percent = Math.round(rubric.reduce((sum, r) => sum + (r.score / 5) * r.weight, 0));

  const phaseBreakdown = PHASE_NAMES_V2.map((name, i) => {
    const p = (rawA?.phaseBreakdown || []).find((x) => Number(x.phase) === i + 1) || {};
    return { phase: i + 1, name, summary: p.summary || "", didWell: p.didWell || "", toImprove: p.toImprove || "" };
  });

  return { rubric, percent, phaseBreakdown };
}

// ─── Assemble the narrative section from Call B ──────────────────────────────
function assembleNarrative(session, rawB) {
  const transcriptLen = (session.transcript || []).length;
  return {
    headline: typeof rawB?.headline === "string" ? rawB.headline : "",
    strengths: (rawB?.strengths || []).slice(0, 3),
    improvements: (rawB?.improvements || []).slice(0, 3),
    keyMoments: (rawB?.keyMoments || []).slice(0, 4).map((k) => ({
      turn: clamp(k.turn ?? 0, 0, Math.max(0, transcriptLen - 1)),
      type: k.type === "best" ? "best" : "miss",
      note: typeof k.note === "string" ? k.note : "",
    })),
  };
}

// ─── Assemble the drills section from Call C ─────────────────────────────────
function assembleDrills(rawC) {
  return (rawC?.drills || []).slice(0, 3).map((d) => ({
    title: typeof d.title === "string" ? d.title : "Practice drill",
    focusCriterion: typeof d.focusCriterion === "string" ? d.focusCriterion : "",
    objectionCategory: sanitizeObjectionCategory(d.objectionCategory),
    instruction: typeof d.instruction === "string" ? d.instruction : "",
  }));
}

// ─── Public: report prompt for inspection endpoint ───────────────────────────
/**
 * reportPromptForInspection(session)
 * Returns the Call A (rubric + phase) prompt text that generateReport() sends.
 * Used by GET /api/sessions/:id/prompt.
 */
export function reportPromptForInspection(session) {
  const { criteria } = effectiveCriteria(session);
  return buildRubricPrompt(session, criteria);
}

// ─── Public: does this report need regeneration? ─────────────────────────────
/**
 * needsRegeneration(report)
 * Returns true when report is a neutral fallback that should be regenerated.
 * Used by the /end endpoint to skip the idempotent short-circuit when a
 * fallback:true report already exists for the session.
 */
export function needsRegeneration(report) {
  return report?.fallback === true;
}

// ─── Public: generate (or fallback) ──────────────────────────────────────────
/**
 * generateReport(session, {counsellorName?})
 *
 * Parallel fan-out:
 *   - Call A (rubric + phaseBreakdown) and Call B (narrative + headline) run
 *     concurrently via Promise.all.
 *   - Call C (drills) runs after A because it needs A's weakest criteria scores.
 *
 * Adaptive thinking only when transcript.length > 20. Each call retries once
 * (attempt 2 thinking-disabled), both with a 60s timeout.
 *
 * If Call A fails entirely → neutral fallback report (fallback:true,
 * regenerable:true). If only B or C fails → assemble what succeeded and mark
 * report.partial = true (missing sections default to empty arrays / "").
 *
 * Assembled shape is identical to the prior monolithic report PLUS
 * overall.headline.
 */
export async function generateReport(session) {
  const { criteria } = effectiveCriteria(session);
  const thinking = thinkingForSession(session);

  const rubricPrompt = buildRubricPrompt(session, criteria);
  const narrativePrompt = buildNarrativePrompt(session);

  // A and B are independent → run in parallel.
  const [resultA, resultB] = await Promise.all([
    runCall("Call A (rubric)", rubricPrompt, thinking),
    runCall("Call B (narrative)", narrativePrompt, thinking),
  ]);

  // Call A is the spine of the report. If it failed entirely → fallback.
  if (!resultA.ok) {
    console.error("[report] Call A failed entirely; returning neutral fallback.", resultA.error?.message);
    return buildFallbackReport(session);
  }

  const { rubric, percent, phaseBreakdown } = assembleRubric(session, resultA.value, criteria);

  // Call C depends on A's graded rubric (weakest criteria), so it runs after A.
  const resultC = await runCall("Call C (drills)", buildDrillsPrompt(session, rubric), thinking);

  let partial = false;
  const narrative = resultB.ok
    ? assembleNarrative(session, resultB.value)
    : (partial = true, assembleNarrative(session, null));
  const drills = resultC.ok
    ? assembleDrills(resultC.value)
    : (partial = true, []);

  const sessionMinutes = session.startedAt
    ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000 * 10) / 10
    : null;

  const report = {
    overall: {
      percent, band: bandFor(percent),
      outcome: resultA.value.outcome === "Converted" ? "Converted" : "Not Converted",
      outcomeDetail: typeof resultA.value.outcomeDetail === "string" ? resultA.value.outcomeDetail : "",
      headline: narrative.headline,
    },
    rubric, phaseBreakdown,
    strengths: narrative.strengths,
    improvements: narrative.improvements,
    keyMoments: narrative.keyMoments,
    drills,
    benchmarks: buildBenchmarks(session, sessionMinutes),
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
  };
  if (partial) report.partial = true;
  return report;
}
