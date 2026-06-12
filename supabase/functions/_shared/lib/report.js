// _shared/lib/report.js — ported from server/report.js.
// CHANGES:
//   - Import paths updated to local lib modules.
//   - chat/extractJson/DETERMINISTIC_SAMPLING imported from ./llm.js.
//   - No process.env usage — no change needed.

import { chat as realChat, DETERMINISTIC_SAMPLING, extractJson } from "./llm.js";
import { BENCHMARKS, STRUCTURE } from "./grounding.js";

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

const LEVEL_LABELS = { 1: "Poor", 2: "Poor", 3: "Developing", 4: "Developing", 5: "Competent", 6: "Competent", 7: "Good", 8: "Good", 9: "Excellent", 10: "Excellent" };
const PHASE_NAMES_V2 = ["Opening", "Discovery", "Presentation", "Objections & Negotiation", "Close"];

const bandFor = (pct) => (pct >= 75 ? "Excellent" : pct >= 50 ? "Good" : "Needs Work");

function transcriptText(transcript) {
  return (transcript || [])
    .map((m, i) => {
      const who = m.role === "counsellor" ? "COUNSELLOR" : "STUDENT";
      const cleanText = m.text ? m.text.replace(/\[emotion:[^\]]*\]/gi, "").replace(/\s+/g, " ").trim() : "";
      let line = `[turn ${i}] ${who}: ${cleanText}`;
      if (m.role === "counsellor" && m.deliveryMetrics) {
        const dm = m.deliveryMetrics;
        const parts = [];
        if (dm.tone !== undefined) parts.push(`tone=${dm.tone}`);
        if (Number.isFinite(dm.wpm)) parts.push(`${Math.round(dm.wpm)}wpm`);
        if (Number.isFinite(dm.pauseRatio)) parts.push(`pauses=${dm.pauseRatio}`);
        if (Number.isFinite(dm.pauses)) parts.push(`pauses=${dm.pauses}`);
        if (Number.isFinite(dm.energyVar)) parts.push(`energyVar=${dm.energyVar.toFixed(2)}`);
        if (Number.isFinite(dm.durationMs)) parts.push(`durationMs=${dm.durationMs}`);
        if (parts.length > 0) line += ` [delivery: ${parts.join(", ")}]`;
      }
      if (m.role === "student" && m.emotion && m.emotion !== "neutral") {
        line += ` [student emotion: ${m.emotion}]`;
      }
      return line;
    })
    .join("\n");
}

function sessionHasVoiceMetrics(session) {
  return (session.transcript || []).some((m) => m.deliveryMetrics);
}

export function effectiveCriteria(session) {
  const snap = session.rubricSnapshot;
  if (!snap?.criteria?.length) return { criteria: LEGACY_RUBRIC.map((c) => ({ ...c, anchors: null })), legacy: true };
  let criteria = snap.criteria;
  if (!sessionHasVoiceMetrics(session)) criteria = criteria.filter((c) => c.key !== "voice_delivery");
  return { criteria, legacy: false };
}

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

function formatAnchors(anchors) {
  if (!anchors) return "";
  if (anchors["10"] || anchors["7"]) {
    const parts = [];
    if (anchors["1"]) parts.push(`1=${anchors["1"]}`);
    if (anchors["4"]) parts.push(`4=${anchors["4"]}`);
    if (anchors["7"]) parts.push(`7=${anchors["7"]}`);
    if (anchors["9"]) parts.push(`9=${anchors["9"]}`);
    if (anchors["10"]) parts.push(`10=${anchors["10"]}`);
    return parts.length ? ` Anchors (1-10 scale): ${parts.join(" | ")}` : "";
  }
  const parts = [];
  if (anchors["1"]) parts.push(`1=${anchors["1"]}`);
  if (anchors["2"]) parts.push(`4=${anchors["2"]}`);
  if (anchors["3"]) parts.push(`7=${anchors["3"]}`);
  if (anchors["4"]) parts.push(`9=${anchors["4"]}`);
  if (anchors["5"]) parts.push(`10=${anchors["5"]}`);
  return parts.length ? ` Anchors (1-10 scale): ${parts.join(" | ")}` : "";
}

function buildRubricPrompt(session, criteria) {
  const c = session.courseSnapshot;
  const courseFacts = c ? `
COURSE FACTS (ground truth — penalize the counsellor under "knowledge" for contradicting these):
- Fee: ${c.feeTotal ? `₹${c.feeTotal}` : "not published"}; seat-block: ${c.feeBooking ? `₹${c.feeBooking}` : "₹4,000"}; ${c.feeNote}
- Duration: ${c.duration}; Format: ${c.format}
- Curriculum: ${(c.curriculum || []).join("; ")}
` : "";

  const rubricLines = criteria.map((r) => {
    const anchorText = formatAnchors(r.anchors);
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

Evaluate the COUNSELLOR (not the student) on these rubric criteria, each scored 1-10.

SCORING PHILOSOPHY — this is the most important instruction, read it first:
Every criterion starts at 6/10. This is the baseline for a typical Indian counsellor doing a normal job on a real call.
From that 6, add or subtract based on what actually happened:

  +1  One clear positive element above the baseline (asked a follow-up question, gave a concrete figure, validated the student's situation).
  +2  A noticeably stronger element (multiple good moments in the criterion, or one genuinely impressive move).
  +3  Outstanding — the kind of thing that visibly turns the call around. Rare.
  +4  Exceptional. Reserve for moments that would be cited as a model in training. Very rare.

  -1  One identifiable fault — a small gap, a vague answer where a specific was called for, a single missed beat.
  -2  A clear and notable weakness — e.g. skipped discovery entirely OR gave a generic pitch with no student-specific link OR deflected an objection without engaging it.
  -3  Multiple compounding faults in the same criterion — the counsellor consistently failed this dimension across the call.
  -4  Significant harm or failure — coercion, false facts, dismissing the student, talking past a concern repeatedly.
  -5  Catastrophic failure. Reserve for the very worst behaviour: lying, bullying, inventing deadlines to pressure a hesitant student.

CALIBRATION EXAMPLES:
- Mispronounces the student's name once but otherwise holds a polite, professional opener → -1 → score 5.
- Mispronounces the name MULTIPLE times and never corrects, jumps straight to pitch, no personal connection at all → -2 → score 4.
- Asks 2-3 standard checklist questions (background, goals, current situation) but doesn't probe the "why" → -1 → score 5.
- Makes a plain, timely payment ask even if it's not elegantly framed → 0 to +1 → score 6-7.
- A converted call where the student agreed to pay GENERALLY suggests the counsellor did enough — scores should reflect that.
- Being polite, clear, and patient throughout (even without being warm) is +0 → 6.

Do NOT penalize a counsellor for being generic or script-like — that is the Indian counselling baseline, not a fault. Only penalise it when it actively ignores what the student just said.

The anchors below describe behaviour at specific levels for reference — quote whichever level best matches what you observed:

${rubricLines}

Return ONLY a JSON object with this exact shape:
{
  "rubric": [ { "key": "<criterion key>", "score": 1-10, "justification": "one sentence grounded in the transcript, referencing the matched anchor behaviour" } ],
  "phaseBreakdown": [ { "phase": 1-5, "summary": "...", "didWell": "...", "toImprove": "..." } ],   // exactly 5, named phases: ${PHASE_NAMES_V2.join(", ")}
  "outcome": "Converted" | "Not Converted",
  "outcomeDetail": "one sentence on whether the student agreed to pay ${c?.feeBooking ? `₹${c.feeBooking}` : "the seat-block fee"} and why"
}
Score honestly and specifically. Do not output anything except the JSON object.`;
}

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

function buildDrillsPrompt(session, gradedRubric) {
  const sorted = [...gradedRubric].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, 3);
  const scoreLines = gradedRubric
    .map((r) => `- ${r.key} (${r.label}): scored ${r.score}/10`)
    .join("\n");
  const weakestKeys = weakest.map((r) => r.key).join(", ") || "(none)";

  return `You are a senior sales-training coach prescribing practice drills after a mock counselling call. ${courseHeader(session)}

${metaHeader(session)}

RUBRIC SCORES (1-10, already graded — target the weakest):
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

// 100s per attempt: Call A (rubric, reasoning mode + large schema) was observed
// hovering around 60s in production — 60s caused spurious fallback reports.
const CALL_TIMEOUT_MS = 100_000;

const REPORT_A_SCHEMA = {
  type: "object",
  properties: {
    rubric: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          score: { type: "number" },
          justification: { type: "string" },
        },
        required: ["key", "score", "justification"],
        additionalProperties: false,
      },
    },
    phaseBreakdown: {
      type: "array",
      items: {
        type: "object",
        properties: {
          phase: { type: "number" },
          summary: { type: "string" },
          didWell: { type: "string" },
          toImprove: { type: "string" },
        },
        required: ["phase", "summary", "didWell", "toImprove"],
        additionalProperties: false,
      },
    },
    outcome: { type: "string" },
    outcomeDetail: { type: "string" },
  },
  required: ["rubric", "phaseBreakdown", "outcome", "outcomeDetail"],
  additionalProperties: false,
};

const REPORT_B_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          quote: { type: "string" },
        },
        required: ["point", "quote"],
        additionalProperties: false,
      },
    },
    improvements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          quote: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["point", "quote", "suggestion"],
        additionalProperties: false,
      },
    },
    keyMoments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          turn: { type: "number" },
          type: { type: "string" },
          note: { type: "string" },
        },
        required: ["turn", "type", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "strengths", "improvements", "keyMoments"],
  additionalProperties: false,
};

const REPORT_C_SCHEMA = {
  type: "object",
  properties: {
    drills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          focusCriterion: { type: "string" },
          objectionCategory: { type: "string" },
          instruction: { type: "string" },
        },
        required: ["title", "focusCriterion", "objectionCategory", "instruction"],
        additionalProperties: false,
      },
    },
  },
  required: ["drills"],
  additionalProperties: false,
};

async function runCall(label, prompt, jsonSchema) {
  const callOpts = {
    ...DETERMINISTIC_SAMPLING,
    mode: "reasoning",
    // effort medium: high-effort report calls exceeded the edge function
    // wall-clock cap (A+B then C at ~90s each). Medium fits with margin and
    // adaptive thinking still engages on hard grading.
    effort: "medium",
    timeoutMs: CALL_TIMEOUT_MS,
    maxRetries: 0,
    jsonSchema,
  };
  const attempts = [callOpts, callOpts];
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

export function buildFallbackReport(session) {
  const { criteria } = effectiveCriteria(session);
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 100;

  const rubric = criteria.map((c) => ({
    key: c.key,
    label: c.label,
    weight: Math.round((c.weight / totalWeight) * 1000) / 10,
    score: 7,
    level: LEVEL_LABELS[7],
    justification: "Report generation failed — neutral placeholder.",
  }));

  const percent = Math.round(rubric.reduce((sum, r) => sum + (7 / 10) * r.weight, 0));

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

export function stubReportSections(session) {
  const sessionMinutes = session.startedAt
    ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000 * 10) / 10
    : null;
  const delayedTurns = (session.scoreHistory || []).filter((h) => h.responseDelayed).length;
  return {
    finalScore: typeof session.satisfactionScore === "number" ? session.satisfactionScore : null,
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
    benchmarks: buildBenchmarks(session, sessionMinutes),
    transcript: session.transcript,
    ...(delayedTurns > 0 ? { delayedTurns } : {}),
  };
}

function assembleRubric(session, rawA, criteria) {
  const byKey = new Map((rawA?.rubric || []).map((r) => [r.key, r]));
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 100;
  const rubric = criteria.map((c) => {
    const r = byKey.get(c.key) || {};
    const score = clamp(r.score ?? 7, 1, 10);
    return {
      key: c.key, label: c.label,
      weight: Math.round((c.weight / totalWeight) * 1000) / 10,
      score, level: LEVEL_LABELS[score],
      justification: typeof r.justification === "string" ? r.justification : "(not graded by the model — defaulted to Competent)",
    };
  });
  const percent = Math.round(rubric.reduce((sum, r) => sum + (r.score / 10) * r.weight, 0));

  const phaseBreakdown = PHASE_NAMES_V2.map((name, i) => {
    const p = (rawA?.phaseBreakdown || []).find((x) => Number(x.phase) === i + 1) || {};
    return { phase: i + 1, name, summary: p.summary || "", didWell: p.didWell || "", toImprove: p.toImprove || "" };
  });

  return { rubric, percent, phaseBreakdown };
}

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

function assembleDrills(rawC) {
  return (rawC?.drills || []).slice(0, 3).map((d) => ({
    title: typeof d.title === "string" ? d.title : "Practice drill",
    focusCriterion: typeof d.focusCriterion === "string" ? d.focusCriterion : "",
    objectionCategory: sanitizeObjectionCategory(d.objectionCategory),
    instruction: typeof d.instruction === "string" ? d.instruction : "",
  }));
}

export function reportPromptForInspection(session) {
  const { criteria } = effectiveCriteria(session);
  return buildRubricPrompt(session, criteria);
}

export function needsRegeneration(report) {
  return report?.fallback === true;
}

export async function generateReport(session) {
  const { criteria } = effectiveCriteria(session);

  const rubricPrompt = buildRubricPrompt(session, criteria);
  const narrativePrompt = buildNarrativePrompt(session);

  const [resultA, resultB] = await Promise.all([
    runCall("Call A (rubric)", rubricPrompt, REPORT_A_SCHEMA),
    runCall("Call B (narrative)", narrativePrompt, REPORT_B_SCHEMA),
  ]);

  if (!resultA.ok) {
    console.error("[report] Call A failed entirely; returning neutral fallback.", resultA.error?.message);
    return buildFallbackReport(session);
  }

  const { rubric, percent, phaseBreakdown } = assembleRubric(session, resultA.value, criteria);

  const resultC = await runCall("Call C (drills)", buildDrillsPrompt(session, rubric), REPORT_C_SCHEMA);

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
