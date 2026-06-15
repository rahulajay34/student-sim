// Report v2 — grades against the session's rubricSnapshot (anchor-quoted),
// adds key moments, benchmark comparisons, and practice drills.
// Falls back to the legacy 6-criterion rubric for pre-v2 sessions.
//
// Contract decisions:
//   - Model: Claude Sonnet 4.6 via ./llm.js (./ollama.js shim).
//   - Parallel fan-out: ALL independent LLM calls dispatch concurrently via a
//     single Promise.allSettled — Call A (rubric + 5-phase phaseBreakdown),
//     Call B (strengths/improvements/keyMoments + overall.headline), Call C
//     (drills) and Call D (persona-addressed). Call C is decoupled from A: its
//     prompt takes only the criterion keys+labels and picks the weakest itself,
//     so it no longer waits on A's graded scores.
//   - All calls use mode:"reasoning" for report quality.
//   - Per-call retry: attempt 1 (60s); attempt 2 (60s). Both reasoning mode.
//   - If Call A fails entirely → neutral fallback report (fallback:true,
//     regenerable:true). If only B, C or D fails → assemble what succeeded, mark
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

const LEVEL_LABELS = { 1: "Poor", 2: "Poor", 3: "Developing", 4: "Developing", 5: "Competent", 6: "Competent", 7: "Good", 8: "Good", 9: "Excellent", 10: "Excellent" };
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

// Formats anchor text for a rubric criterion, handling both the new 1-10 key
// format ("1","4","7","9","10") and the legacy 1-5 format ("1"-"5"). Legacy
// anchors are remapped to 1-10 positions so they stay semantically correct.
function formatAnchors(anchors) {
  if (!anchors) return "";
  if (anchors["10"] || anchors["7"]) {
    // New 1-10 format
    const parts = [];
    if (anchors["1"]) parts.push(`1=${anchors["1"]}`);
    if (anchors["4"]) parts.push(`4=${anchors["4"]}`);
    if (anchors["7"]) parts.push(`7=${anchors["7"]}`);
    if (anchors["9"]) parts.push(`9=${anchors["9"]}`);
    if (anchors["10"]) parts.push(`10=${anchors["10"]}`);
    return parts.length ? ` Anchors (1-10 scale): ${parts.join(" | ")}` : "";
  }
  // Legacy 1-5 format — remap to 1-10 positions
  const parts = [];
  if (anchors["1"]) parts.push(`1=${anchors["1"]}`);
  if (anchors["2"]) parts.push(`4=${anchors["2"]}`);
  if (anchors["3"]) parts.push(`7=${anchors["3"]}`);
  if (anchors["4"]) parts.push(`9=${anchors["4"]}`);
  if (anchors["5"]) parts.push(`10=${anchors["5"]}`);
  return parts.length ? ` Anchors (1-10 scale): ${parts.join(" | ")}` : "";
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
// DECOUPLED from Call A: receives only the criterion keys+labels (NOT graded
// scores) and reads the transcript to pick the weakest areas itself, so it can
// run concurrently with A instead of waiting for A's rubric scores.
function buildDrillsPrompt(session, criteria) {
  const criterionLines = criteria
    .map((c) => `- ${c.key} (${c.label})`)
    .join("\n");

  return `You are a senior sales-training coach prescribing practice drills after a mock counselling call. ${courseHeader(session)}

${metaHeader(session)}

RUBRIC CRITERIA (judge the transcript yourself and target the counsellor's weakest areas):
${criterionLines}

FULL TRANSCRIPT (turns are numbered):
${transcriptText(session.transcript)}

Read the transcript, decide which criteria the counsellor handled WORST, and prescribe 2-3 targeted practice drills, each tied to one of those weakest criteria.

Return ONLY a JSON object with this exact shape:
{
  "drills": [ { "title": "...", "focusCriterion": "<one of the criterion keys above>", "objectionCategory": "<EXACTLY one of: fee|emi_affordability|parents_family|time_commitment|competing_priorities|trust_legitimacy|job_guarantee_placement|course_fit_relevance|language_english|tech_access|other>", "instruction": "one concrete practice instruction" } ]  // 2-3
}
Do not output anything except the JSON object.`;
}

// ─── Call D prompt: persona-addressed (issue 2) ──────────────────────────────
// Evaluates whether the counsellor surfaced this specific persona's concerns and
// related each one back to the course. Fed the persona snapshot + scenario
// (incl. pushiness/hesitancy) + course context + transcript.
function buildPersonaAddressedPrompt(session) {
  const p = session.personaSnapshot || {};
  const sc = session.scenarioSnapshot || {};
  const c = session.courseSnapshot;
  const personalitySrc = p.personality || p.traits || {};

  const personaLines = [
    `LABEL: ${p.label || "n/a"}`,
    `CATEGORY: ${p.category || "n/a"}`,
    p.coreAnxiety ? `CORE ANXIETY: ${p.coreAnxiety}` : null,
    p.description ? `DESCRIPTION: ${p.description}` : null,
  ].filter(Boolean).join("\n");

  const scenarioLines = [
    `TITLE: ${sc.title || "n/a"}`,
    `DIFFICULTY: ${sc.difficulty ?? "n/a"}`,
    `PUSHINESS (1-5): ${sc.pushiness ?? "n/a"}`,
    `HESITANCY (1-5): ${sc.hesitancy ?? "n/a"}`,
    sc.description ? `SCENARIO NOTE: ${sc.description}` : null,
  ].filter(Boolean).join("\n");

  const traitLines = `PERSONALITY (1-5): talkativeness=${personalitySrc.talkativeness ?? "n/a"}, humour=${personalitySrc.humour ?? "n/a"}, skepticism=${personalitySrc.skepticism ?? "n/a"}, formality=${personalitySrc.formality ?? "n/a"}`;

  const courseFacts = c ? `
COURSE CONTEXT (what the counsellor could have related concerns back to):
- Name: ${c.name}; Duration: ${c.duration}; Format: ${c.format}
- Fee: ${c.feeTotal ? `₹${c.feeTotal}` : "not published"}; seat-block: ${c.feeBooking ? `₹${c.feeBooking}` : "₹4,000"}
- Curriculum: ${(c.curriculum || []).join("; ")}
- USPs/outcomes: ${[...(c.usps || []), ...(c.outcomes || [])].join("; ") || "n/a"}
` : "";

  return `You are a senior sales-training coach assessing how well a counsellor surfaced and ADDRESSED this specific prospective student's personal concerns, and whether each concern was related back to the course's actual value. ${courseHeader(session)}

${metaHeader(session)}

STUDENT PERSONA:
${personaLines}
${traitLines}

SCENARIO:
${scenarioLines}
${courseFacts}
FULL TRANSCRIPT (turns are numbered):
${transcriptText(session.transcript)}

Identify the concrete concerns THIS persona/scenario would carry (their core anxiety, the scenario's tension, anything they actually voiced). For each, judge whether the counsellor addressed it AND tied it to the course. Cover 0-5 of the most important concerns (fewer is fine; empty if none surfaced).

Return ONLY a JSON object with this exact shape:
{
  "concerns": [ { "concern": "the student's specific concern", "addressed": "fully"|"partially"|"not_addressed", "howRelatedToCourse": "how the counsellor linked (or could have linked) it to the course", "evidence": "short transcript quote or turn reference", "comment": "one coaching note" } ],   // 0-5
  "summary": "2-3 sentence overall on how well persona-specific concerns were handled",
  "score": 1-10   // overall persona-concern handling, 1 worst 10 best
}
Do not output anything except the JSON object.`;
}

// ─── Integrity probe prompt: misselling detector (admin-only) ────────────────
// Runs only when session.integrityProbe exists. Judges whether the counsellor's
// answer to the assigned "trap" question was honest, evasive, over-promised, or
// an outright lie, grounded in the probe's groundTruth (the real Masai policy)
// and the course facts. The verdict is admin-only (stripped for counsellors at
// the edge layer) — never shown to the graded counsellor.
function buildIntegrityPrompt(session) {
  const probe = session.integrityProbe || {};
  const c = session.courseSnapshot;
  const courseFacts = c ? `
COURSE FACTS (ground truth for this specific programme):
- Name: ${c.name}; Institute: ${c.institute || "n/a"}; Duration: ${c.duration || "n/a"}; Format: ${c.format || "n/a"}
- Fee: ${c.feeTotal ? `₹${c.feeTotal}` : "not published"}; seat-block: ${c.feeBooking ? `₹${c.feeBooking}` : "₹4,000"}; ${c.feeNote || ""}
- Curriculum: ${(c.curriculum || []).join("; ") || "n/a"}
` : "";

  return `You are a compliance reviewer auditing a mock counselling call for MISSELLING. ${courseHeader(session)}

${metaHeader(session)}

The simulated student was instructed to naturally raise ONE specific "trap" question during the call. Your job: find where (and whether) the student raised it, then judge how HONESTLY the counsellor answered, grounded in the real policy below.

THE PROBE QUESTION the student was told to ask:
"${probe.question || "(none)"}"

GROUND TRUTH (the honest answer / what makes a reply a lie — this is real Masai policy):
${probe.groundTruth || "(none)"}
${courseFacts}
FULL TRANSCRIPT (turns are numbered):
${transcriptText(session.transcript)}

Decide:
1. raised — did the student actually raise this question or its substance at all? (true/false)
2. verdict — judge the COUNSELLOR's answer against the ground truth:
   - "honest"       — answered accurately / consistent with the ground truth (or fairly redirected without a false claim).
   - "evasive"      — dodged, deflected, or gave a non-answer without committing to a false claim.
   - "overpromised" — leaned beyond the truth / created a misleading impression without an outright false assurance.
   - "lied"         — made a clearly false assurance that contradicts the ground truth (the liability case).
   - "not_raised"   — the student never raised it, so the counsellor was not tested.
3. severity — 0 (none / not_raised), 1 (minor over-statement), 2 (clear over-promise), 3 (clear false assurance / liability).
4. evidenceQuote — the counsellor's exact words that justify the verdict (empty string if not_raised).
5. explanation — 1-2 lines, grounded in the ground truth, on why this verdict.

Return ONLY a JSON object with this exact shape:
{
  "raised": true|false,
  "verdict": "honest"|"evasive"|"overpromised"|"lied"|"not_raised",
  "severity": 0|1|2|3,
  "evidenceQuote": "counsellor's exact words, or \\"\\"",
  "explanation": "1-2 lines grounded in the ground truth"
}
Do not output anything except the JSON object.`;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

// ─── Integrity check enum + sanitizer ────────────────────────────────────────
const INTEGRITY_VERDICT_ENUM = new Set(["honest", "evasive", "overpromised", "lied", "not_raised"]);
function assembleIntegrityCheck(probe, raw) {
  const verdict = INTEGRITY_VERDICT_ENUM.has(raw?.verdict) ? raw.verdict : "not_raised";
  return {
    probeId: probe?.id ?? null,
    category: probe?.category ?? null,
    question: probe?.question ?? "",
    raised: raw?.raised === true,
    verdict,
    severity: clamp(raw?.severity ?? 0, 0, 3),
    evidenceQuote: typeof raw?.evidenceQuote === "string" ? raw.evidenceQuote : "",
    explanation: typeof raw?.explanation === "string" ? raw.explanation : "",
  };
}

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
// Each fan-out call uses mode:"reasoning", with a per-call timeout and effort
// that are env-tunable. Defaults chosen so long transcripts (e.g. 175-turn
// voice calls) still finish inside the edge function wall-clock cap: effort
// "low" keeps Call A (rubric grading) reliably fast — medium was observed
// exceeding 100s on long transcripts and falling back to a neutral report.
const CALL_TIMEOUT_MS = Number(process.env.REPORT_CALL_TIMEOUT_MS) || 90_000;
const REPORT_EFFORT = process.env.REPORT_EFFORT || "low";

// ─── JSON schemas for structured output ─────────────────────────────────────
// Call A: rubric grading + phase breakdown.
// Criterion keys and phaseBreakdown entries — shapes derived from assembleRubric
// and assembleNarrative assembly code. No min/max constraints (API restriction).
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

// Call B: strengths / improvements / keyMoments / headline.
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

// Call C: drills.
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

// Call D: persona-addressed.
const REPORT_D_SCHEMA = {
  type: "object",
  properties: {
    concerns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          concern: { type: "string" },
          addressed: { type: "string" },
          howRelatedToCourse: { type: "string" },
          evidence: { type: "string" },
          comment: { type: "string" },
        },
        required: ["concern", "addressed", "howRelatedToCourse", "evidence", "comment"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
    score: { type: "number" },
  },
  required: ["concerns", "summary", "score"],
  additionalProperties: false,
};

// Integrity probe: misselling detector (admin-only). Severity/verdict are
// clamped to the enum/range in assembleIntegrityCheck after the call.
const INTEGRITY_SCHEMA = {
  type: "object",
  properties: {
    raised: { type: "boolean" },
    verdict: { type: "string" },
    severity: { type: "number" },
    evidenceQuote: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["raised", "verdict", "severity", "evidenceQuote", "explanation"],
  additionalProperties: false,
};

// ─── Per-call runner with 2-attempt retry ────────────────────────────────────
// Attempt 1 and 2: both use mode:"reasoning", 60s timeout.
// Returns { ok:true, value } or { ok:false, error }.
async function runCall(label, prompt, jsonSchema) {
  const callOpts = {
    ...DETERMINISTIC_SAMPLING,
    mode: "reasoning",
    effort: REPORT_EFFORT,
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

// ─── Persona card (issue 9) ──────────────────────────────────────────────────
// Snapshot-only (no LLM): the persona identity + personality traits + scenario
// difficulty sliders, available instantly at /end. Exposed on the stub, the full
// report, and the fallback so ReportDetail can render it immediately.
const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function personaCard(session) {
  const p = session.personaSnapshot || {};
  const sc = session.scenarioSnapshot || {};
  const lead = session.leadCard || {};
  const traits = p.personality || p.traits || {};

  const name = lead.name || p.voiceName || p.name || "Student";

  return {
    name,
    label: p.label ?? null,
    category: p.category ?? null,
    coreAnxiety: p.coreAnxiety ?? null,
    traits: {
      talkativeness: numOrNull(traits.talkativeness),
      humour: numOrNull(traits.humour),
      skepticism: numOrNull(traits.skepticism),
      formality: numOrNull(traits.formality),
      quirks: Array.isArray(traits.quirks) ? traits.quirks : [],
    },
    scenario: {
      title: sc.title ?? null,
      difficulty: sc.difficulty ?? null,
      pushiness: numOrNull(sc.pushiness),
      hesitancy: numOrNull(sc.hesitancy),
    },
  };
}

// Default persona-addressed payload (D-failure / fallback).
const DEFAULT_PERSONA_ADDRESSED = () => ({ concerns: [], summary: "", score: 7 });

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
    score: 7,
    level: LEVEL_LABELS[7],   // "Good" — honest neutral placeholder
    justification: "Report generation failed — neutral placeholder.",
  }));

  // Neutral mid-band percent: score 7 / max 10 = 70%
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
    personaCard: personaCard(session),
    personaAddressed: DEFAULT_PERSONA_ADDRESSED(),
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
  const delayedTurns = (session.scoreHistory || []).filter((h) => h.responseDelayed).length;
  return {
    finalScore: typeof session.satisfactionScore === "number" ? session.satisfactionScore : null,
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
    benchmarks: buildBenchmarks(session, sessionMinutes),
    transcript: session.transcript,
    personaCard: personaCard(session),
    ...(delayedTurns > 0 ? { delayedTurns } : {}),
  };
}

// ─── Assemble the graded rubric + phase breakdown from Call A ─────────────────
function assembleRubric(session, rawA, criteria) {
  const byKey = new Map((rawA?.rubric || []).map((r) => [r.key, r]));
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 100;
  const rubric = criteria.map((c) => {
    const r = byKey.get(c.key) || {};
    const score = clamp(r.score ?? 7, 1, 10);
    return {
      key: c.key, label: c.label,
      weight: Math.round((c.weight / totalWeight) * 1000) / 10,   // renormalized (voice_delivery may be excluded)
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

// ─── Assemble the persona-addressed section from Call D (issue 2) ─────────────
const ADDRESSED_ENUM = new Set(["fully", "partially", "not_addressed"]);
function assemblePersonaAddressed(rawD) {
  if (!rawD || typeof rawD !== "object") return DEFAULT_PERSONA_ADDRESSED();
  const concerns = (Array.isArray(rawD.concerns) ? rawD.concerns : []).slice(0, 5).map((c) => ({
    concern: typeof c.concern === "string" ? c.concern : "",
    addressed: ADDRESSED_ENUM.has(c.addressed) ? c.addressed : "not_addressed",
    howRelatedToCourse: typeof c.howRelatedToCourse === "string" ? c.howRelatedToCourse : "",
    evidence: typeof c.evidence === "string" ? c.evidence : "",
    comment: typeof c.comment === "string" ? c.comment : "",
  }));
  return {
    concerns,
    summary: typeof rawD.summary === "string" ? rawD.summary : "",
    score: clamp(rawD.score ?? 7, 1, 10),
  };
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
 * Fully-parallel fan-out: Call A (rubric + phaseBreakdown), Call B (narrative +
 * headline), Call C (drills — decoupled, picks the weakest criteria itself) and
 * Call D (persona-addressed) all dispatch concurrently via a single
 * Promise.allSettled.
 *
 * All calls run in mode:"reasoning" with structured-output schemas. Each call
 * retries once; both attempts identical, 90s timeout each.
 *
 * If Call A fails entirely → neutral fallback report (fallback:true,
 * regenerable:true). If only B, C or D fails → assemble what succeeded and mark
 * report.partial = true (missing sections default to empty arrays / "" / the
 * neutral persona-addressed default).
 *
 * Assembled shape is identical to the prior monolithic report PLUS
 * overall.headline, personaCard and personaAddressed.
 */
export async function generateReport(session) {
  const { criteria } = effectiveCriteria(session);

  const rubricPrompt = buildRubricPrompt(session, criteria);
  const narrativePrompt = buildNarrativePrompt(session);
  const drillsPrompt = buildDrillsPrompt(session, criteria);   // decoupled from A
  const personaPrompt = buildPersonaAddressedPrompt(session);

  // Integrity probe (admin-only misselling detector) is an INDEPENDENT extra
  // call — only dispatched when this session carries an assigned probe. It
  // rides the same parallel allSettled fan-out so it is timeout-protected and
  // its failure is non-fatal (sets report.partial, never throws).
  const hasProbe = !!session.integrityProbe;
  const integrityPrompt = hasProbe ? buildIntegrityPrompt(session) : null;

  // All calls are independent → dispatch them together. runCall never rejects
  // (it returns {ok:false} on failure), so each settled result carries the
  // {ok,...} object in .value.
  const settled = await Promise.allSettled([
    runCall("Call A (rubric)", rubricPrompt, REPORT_A_SCHEMA),
    runCall("Call B (narrative)", narrativePrompt, REPORT_B_SCHEMA),
    runCall("Call C (drills)", drillsPrompt, REPORT_C_SCHEMA),
    runCall("Call D (persona)", personaPrompt, REPORT_D_SCHEMA),
    hasProbe
      ? runCall("Call E (integrity)", integrityPrompt, INTEGRITY_SCHEMA)
      : Promise.resolve({ ok: false, skipped: true }),
  ]);
  const unwrap = (s) => (s.status === "fulfilled" ? s.value : { ok: false, error: s.reason });
  const [resultA, resultB, resultC, resultD, resultE] = settled.map(unwrap);

  // Call A is the spine of the report. If it failed entirely → fallback.
  if (!resultA.ok) {
    console.error("[report] Call A failed entirely; returning neutral fallback.", resultA.error?.message);
    return buildFallbackReport(session);
  }

  const { rubric, percent, phaseBreakdown } = assembleRubric(session, resultA.value, criteria);

  let partial = false;
  const narrative = resultB.ok
    ? assembleNarrative(session, resultB.value)
    : (partial = true, assembleNarrative(session, null));
  const drills = resultC.ok
    ? assembleDrills(resultC.value)
    : (partial = true, []);
  const personaAddressed = resultD.ok
    ? assemblePersonaAddressed(resultD.value)
    : (partial = true, DEFAULT_PERSONA_ADDRESSED());

  // Integrity check: only when a probe was assigned. Failure (not the skipped
  // case) marks the report partial but is non-fatal; old sessions with no probe
  // leave report.integrityCheck undefined.
  let integrityCheck;
  if (hasProbe) {
    if (resultE.ok) {
      integrityCheck = assembleIntegrityCheck(session.integrityProbe, resultE.value);
    } else {
      partial = true;
    }
  }

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
    personaCard: personaCard(session),
    personaAddressed,
  };
  if (integrityCheck) report.integrityCheck = integrityCheck;
  if (partial) report.partial = true;
  return report;
}
