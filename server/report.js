// Report v2 — grades against the session's rubricSnapshot (anchor-quoted),
// adds key moments, benchmark comparisons, and practice drills.
// Falls back to the legacy 6-criterion rubric for pre-v2 sessions.
//
// Contract decisions:
//   - Single model: nemotron-3-nano:30b (OLLAMA_MODEL override) for all calls.
//   - Sampling: DETERMINISTIC_SAMPLING with timeoutMs:120000.
//   - Retry: 2 attempts on LLM call + JSON parse failure; on final failure a
//     neutral rubric-v2-shaped fallback report is returned with
//     {fallback:true, regenerable:true} so the caller can replace it later.
//   - Exported needsRegeneration(report): true when report.fallback === true.
//   - Exported reportPromptForInspection(session): the exact prompt text.
import { chat, DETERMINISTIC_SAMPLING, extractJson } from "./ollama.js";
import { BENCHMARKS, STRUCTURE } from "./grounding.js";

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
      let line = `[turn ${i}] ${who}: ${m.text}`;
      // Append delivery metrics for counsellor entries when present.
      if (m.role === "counsellor" && m.deliveryMetrics) {
        const dm = m.deliveryMetrics;
        const parts = [];
        if (dm.tone !== undefined) parts.push(`tone=${dm.tone}`);
        if (Number.isFinite(dm.wpm)) parts.push(`${Math.round(dm.wpm)}wpm`);
        if (Number.isFinite(dm.pauseRatio)) parts.push(`pauses=${dm.pauseRatio}`);
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

function buildPrompt(session, criteria) {
  const c = session.courseSnapshot;
  const courseLine = c
    ? `A counsellor was selling "${c.name}" (${c.institute} x Masai School) to a simulated prospective student.`
    : `A counsellor was selling the "Executive Certification Programme in Business Analytics and AI" (IIM Ranchi x Masai) to a simulated prospective student.`;
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

  return `You are a senior sales-training coach evaluating a mock counselling call. ${courseLine}

STUDENT PERSONA: ${session.personaSnapshot?.label || "student"}
SCENARIO: ${session.scenarioSnapshot?.title || "n/a"} (difficulty: ${session.scenarioSnapshot?.difficulty || "n/a"})
FINAL STUDENT SATISFACTION: ${session.satisfactionScore}/100 (agreement threshold is 70)
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
  "strengths": [ { "point": "...", "quote": "short counsellor quote" } ],                            // 2-3
  "improvements": [ { "point": "...", "quote": "short quote", "suggestion": "concrete advice" } ],   // 2-3
  "keyMoments": [ { "turn": <number from transcript>, "type": "best"|"miss", "note": "what happened and why it mattered" } ],  // 2-4
  "drills": [ { "title": "...", "focusCriterion": "<weakest criterion key>", "objectionCategory": "<EXACTLY one of: fee|emi_affordability|parents_family|time_commitment|competing_priorities|trust_legitimacy|job_guarantee_placement|course_fit_relevance|language_english|tech_access|other>", "instruction": "one concrete practice instruction" } ],  // 2-3
  "outcome": "Converted" | "Not Converted",
  "outcomeDetail": "one sentence on whether the student agreed to pay ${c?.feeBooking ? `₹${c.feeBooking}` : "the seat-block fee"} and why"
}
Score honestly and specifically. Do not output anything except the JSON object.`;
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
// Single model per contract (nemotron-3-nano:30b or OLLAMA_MODEL override).
// 120 second timeout for the longer report generation call.
// thinking:adaptive per the shared contract: report quality > latency, and
// the adaptive reasoning budget helps ground rubric justifications in specific
// transcript evidence. DETERMINISTIC_SAMPLING + timeoutMs are preserved.
const REPORT_OPTIONS = { ...DETERMINISTIC_SAMPLING, timeoutMs: 120_000, thinking: { type: "adaptive" } };

// ─── Retry helper ───────────────────────────────────────────────────────────
// Tries fn() up to maxAttempts times. Returns {ok:true, value} or {ok:false, error}.
async function retryLlmCall(fn, maxAttempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      lastError = err;
      console.warn(`[report] LLM attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }
  return { ok: false, error: lastError };
}

// ─── Neutral fallback builder ────────────────────────────────────────────────
// Builds a full rubric-v2-shaped report with neutral mid-band scores.
// Uses effectiveCriteria(session) so voice_delivery is excluded/included correctly.
function buildFallbackReport(session) {
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
    },
    rubric,
    phaseBreakdown,
    strengths: [],
    improvements: [],
    keyMoments: [],
    drills: [],
    benchmarks: {
      sessionMinutes,
      medianPaidMinutes: BENCHMARKS.text?.paidVsUnpaid?.durationMedianPaid ?? null,
      paymentAskSeen: !!session.milestones?.paymentAsked,
      paymentAskNormPct: STRUCTURE.paymentAskNorms?.presentInPaidPct ?? null,
    },
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
    fallback: true,
    regenerable: true,
  };
}

// ─── Assemble report from LLM-parsed raw object ──────────────────────────────
function assembleReport(session, raw, criteria) {
  const byKey = new Map((raw.rubric || []).map((r) => [r.key, r]));
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
    const p = (raw.phaseBreakdown || []).find((x) => Number(x.phase) === i + 1) || {};
    return { phase: i + 1, name, summary: p.summary || "", didWell: p.didWell || "", toImprove: p.toImprove || "" };
  });

  const sessionMinutes = session.startedAt
    ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000 * 10) / 10
    : null;

  return {
    overall: {
      percent, band: bandFor(percent),
      outcome: raw.outcome === "Converted" ? "Converted" : "Not Converted",
      outcomeDetail: typeof raw.outcomeDetail === "string" ? raw.outcomeDetail : "",
    },
    rubric, phaseBreakdown,
    strengths: (raw.strengths || []).slice(0, 3),
    improvements: (raw.improvements || []).slice(0, 3),
    keyMoments: (raw.keyMoments || []).slice(0, 4).map((k) => ({
      turn: clamp(k.turn ?? 0, 0, (session.transcript || []).length - 1),
      type: k.type === "best" ? "best" : "miss",
      note: typeof k.note === "string" ? k.note : "",
    })),
    drills: (raw.drills || []).slice(0, 3).map((d) => ({
      title: typeof d.title === "string" ? d.title : "Practice drill",
      focusCriterion: typeof d.focusCriterion === "string" ? d.focusCriterion : "",
      objectionCategory: sanitizeObjectionCategory(d.objectionCategory),
      instruction: typeof d.instruction === "string" ? d.instruction : "",
    })),
    benchmarks: {
      sessionMinutes,
      medianPaidMinutes: BENCHMARKS.text?.paidVsUnpaid?.durationMedianPaid ?? null,
      paymentAskSeen: !!session.milestones?.paymentAsked,
      paymentAskNormPct: STRUCTURE.paymentAskNorms?.presentInPaidPct ?? null,
    },
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
  };
}

// ─── Public: report prompt for inspection endpoint ───────────────────────────
/**
 * reportPromptForInspection(session)
 * Returns the exact prompt text that generateReport() would send to the LLM.
 * Used by GET /api/sessions/:id/prompt.
 */
export function reportPromptForInspection(session) {
  const { criteria } = effectiveCriteria(session);
  return buildPrompt(session, criteria);
}

// ─── Public: does this report need regeneration? ─────────────────────────────
/**
 * needsRegeneration(report)
 * Returns true when report is a neutral fallback that should be regenerated.
 * Used by the /end endpoint (Integration agent) to skip the idempotent short-
 * circuit when a fallback:true report already exists for the session.
 */
export function needsRegeneration(report) {
  return report?.fallback === true;
}

// ─── Public: generate (or fallback) ──────────────────────────────────────────
/**
 * generateReport(session, {counsellorName?})
 *
 * Attempts the LLM call up to 2 times (DETERMINISTIC_SAMPLING, 120 s timeout).
 * On final failure returns a neutral placeholder in the full rubric-v2 shape with
 * {fallback:true, regenerable:true} so ReportDetail v2 renders immediately and
 * the report can be regenerated later (see needsRegeneration).
 */
export async function generateReport(session, { counsellorName = "" } = {}) {
  const { criteria } = effectiveCriteria(session);
  const prompt = buildPrompt(session, criteria);

  const result = await retryLlmCall(async () => {
    const text = await chat(
      [{ role: "user", content: prompt }],
      REPORT_OPTIONS,
    );
    // extractJson strips markdown fences and throws on bad JSON
    return extractJson(text);
  }, 2);

  if (!result.ok) {
    console.error("[report] All LLM attempts failed; returning neutral fallback.", result.error?.message);
    return buildFallbackReport(session);
  }

  return assembleReport(session, result.value, criteria);
}
