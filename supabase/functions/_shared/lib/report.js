// _shared/lib/report.js — ported from server/report.js.
// CHANGES:
//   - Import paths updated to local lib modules.
//   - chat/extractJson/DETERMINISTIC_SAMPLING imported from ./llm.js.
//   - getEnv from ../env.js for REPORT_CALL_TIMEOUT_MS / REPORT_EFFORT knobs.

import { chat as realChat, DETERMINISTIC_SAMPLING, extractJson } from "./llm.js";
import { getEnv } from "../env.js";
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

// ─── Transcript transliteration (Call G) ─────────────────────────────────────
// Some STT turns land in a non-Latin script: genuine Hindi captured in
// Devanagari, or Arabic/other-script fragments that are really STT noise. The
// generated report should read in ONE script. We detect only turns carrying a
// non-Latin LETTER (romanized Hinglish is already Latin and left untouched),
// send just those turns to a single cheap fast-mode call, and store the Latin
// rendering as turn.latinText next to the untouched original turn.text.
// English-only transcripts trigger NO extra call (zero added cost).
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;
export function hasNonLatinScript(text) {
  return typeof text === "string" && NON_LATIN_LETTER.test(text);
}

function cleanForTranslit(text) {
  return text ? text.replace(/\[emotion:[^\]]*\]/gi, "").replace(/\s+/g, " ").trim() : "";
}

function buildTransliterationPrompt(items) {
  const lines = items.map((t) => `[${t.i}] (${t.role}) ${t.text}`).join("\n");
  return `You normalise mock sales-call transcript turns into the LATIN (Roman) alphabet so the whole transcript reads in one script. Each turn below was captured by speech-to-text and contains non-Latin characters.

RULES:
- TRANSLITERATE genuine speech into the Latin alphabet, preserving the ORIGINAL words and language — do NOT translate the meaning into English. E.g. Hindi "मुझे फीस के बारे में बताइए" → "mujhe fees ke baare mein bataiye".
- Keep any English / already-Latin words exactly as they are.
- Some turns are speech-to-text NOISE: gibberish, or a stray foreign-script fragment that makes no sense in an Indian admissions call. If a turn is unintelligible, output exactly "[unclear audio]" for it (best effort first — only fall back to this when it truly cannot be read).
- Output exactly one entry per input turn, keyed by the same index. No commentary.

TURNS:
${lines}

Return ONLY a JSON object: { "turns": [ { "i": <index>, "latin": "<latin-script text, or [unclear audio]>" } ] }`;
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

// ─── New Report Section prompt: 8-parameter strict re-scoring (additive) ──────
// An INDEPENDENT extra call that re-grades the COUNSELLOR on 8 parameters, each
// 0-5, with a one-line per-parameter summary specific to THIS call. Additive —
// does not touch any existing scoring/metric logic. Failure is non-fatal
// (report.partial; report.newReport left undefined).
const NEW_REPORT_PARAMS = [
  { key: "rapport_opening", label: "Rapport & Opening" },
  { key: "needs_discovery", label: "Needs Discovery" },
  { key: "programme_presentation", label: "Programme Presentation" },
  { key: "objection_handling", label: "Objection Handling" },
  { key: "product_knowledge", label: "Product Knowledge & Accuracy" },
  { key: "closing_payment_ask", label: "Closing & Payment Ask" },
  { key: "communication_empathy", label: "Communication & Empathy" },
  { key: "personalised_experience", label: "Personalised Experience" },
];

const NEW_REPORT_ANCHORS = `1. rapport_opening (Rapport & Opening)
   0 no greeting/rapport; abrupt; doesn't confirm who they're speaking to · 1 bare robotic greeting, no warmth ·
   2 greets+introduces self but generic, no agenda · 3 warm greeting+intro+basic agenda/audibility check, inconsistent ·
   4 warm personalised open (uses name), checks audibility/sets agenda, minor gaps · 5 excellent personalised warm opening, clear agenda, learner at ease Getting the learner's name wrong, or a slightly scripted open, is a minor deduction, NOT an automatic drop below 3 if a real greeting + framing happened.
2. needs_discovery (Needs Discovery)
   0 no discovery; pitches immediately · 1 one/two generic questions, ignores answers · 2 some questions but pitches before understanding ·
   3 discovers background/goal but misses constraints (time/fee/family) · 4 uncovers background, goal & most constraints and tailors, minor gaps ·
   5 thorough discovery (background, goal, constraints, motivation) that clearly shapes the pitch
3. programme_presentation (Programme Presentation)
   0 no real presentation / wrong / confusing · 1 vague mention, no structure · 2 lists features but generic brochure-dump ·
   3 clear on curriculum/format/fees but partly generic/missing pieces · 4 structured, clear, mostly relevant, tied to learner, minor gaps ·
   5 crisp, structured, fully relevant, tailored to the learner's goal
4. objection_handling (Objection Handling)
   0 ignored/dismissed the concern · 1 acknowledged but barely addressed (no details) · 2 answered with no specifics (vague reassurance) ·
   3 answered partially but reasonably, some specifics, not fully resolved · 4 resolved most concerns with concrete specifics + empathy, minor gaps ·
   5 fully resolved each concern with specific facts/data/proof + workable alternatives; confident, no pressure
5. product_knowledge (Product Knowledge & Accuracy) — score the BREADTH and CONFIDENCE of command of the programme (curriculum, format, placement process, fee/EMI structure), NOT numeric perfection.
  5 = complete, confident command across the programme.
  4 = strong command; at most a minor slip.
  3 = solid overall command with a few gaps OR a single wrong/inconsistent figure (a fee number, a date) — a lone numeric error is a MINOR deduction, not a 1-2, if command was otherwise good.
  2 = clearly shaky: several gaps, repeated self-contradiction, or vague on basics.
  1 = could not answer basics / mostly wrong.
  0 = no product knowledge shown.
  CAP at 2 ONLY for outright misselling — a false guarantee (guaranteed job/placement, fake refund, "we will get you a company"). A wrong fee figure alone is NOT misselling.
6. closing_payment_ask (Closing & Payment Ask)
   0 no close/next step · 1 vague "let me know", no ask · 2 mentions a next step but unclear/weak, no concrete ask ·
   3 asks for seat-block/next step but tentative/mistimed · 4 clear low-pressure ask, secures follow-up/near-decision, minor gaps ·
   5 confident, well-timed, low-pressure close securing a concrete decision or firm next step
7. communication_empathy (Communication & Empathy)
   0 confusing/rude/dismissive, talks over learner · 1 hard to follow, monologues, little empathy · 2 understandable but mechanical, limited empathy ·
   3 clear and polite, some empathy, occasional rambling/missed cues · 4 clear, structured, empathetic, responds well, minor lapses ·
   5 excellent: clear, warm, well-paced, genuinely empathetic and responsive throughout Fast pace, some monologuing, or filler words are minor; only score <=2 when poor communication genuinely obstructed the learner or empathy was clearly absent/dismissive.
8. personalised_experience (Personalised Experience)
   0 fully generic script, ignores who the learner is · 1 token nod but pitch is generic · 2 slight tailoring, mostly one-size-fits-all ·
   3 some genuine tailoring to background/goal, inconsistent · 4 pitch clearly mapped to this learner's background/goals, minor generic parts ·
   5 deeply personalised — every key point tied to this learner's profile, goals and constraints`;

const NEW_REPORT_SYSTEM = `You are an experienced Masai mock-counselling grader. Score the COUNSELLOR on eight categories using the exact 0-5 anchors provided. Calibrate to how Masai's EXPERT HUMAN graders score — they are fair, not harsh: a competent counsellor typically averages about 3.3-3.6 out of 5 per category. Use the full 0-5 range, write one short call-specific sentence per category explaining the score, and return ONLY a JSON object.`;

const NEW_REPORT_SCALE = `Score EACH category 0-5, matching expert human graders (who score a typical competent call around 3.3-3.6 per category, ~65-75% overall). Anchor to this:
  5 = done well and consistently throughout (ALLOWED — not reserved for the superhuman).
  4 = done well, clearly above adequate.
  3 = handled competently / adequately. THIS IS THE DEFAULT for a normal call. Minor flaws — a mispronounced name, some monologuing, a fast pace, small wording slips — do NOT pull a category below 3 if the substance was handled.
  2 = clearly below par on this category (a real gap), not merely imperfect.
  1 = barely attempted or mostly wrong.
  0 = absent / not attempted at all.
Do NOT cluster scores at 2. Reserve 0-2 for genuine weakness or absence. Your scores should land close to a human grader's, NOT systematically lower — if you find yourself giving mostly 2s, you are being too harsh; competent-but-flawed execution is a 3.`;

const NEW_REPORT_CALIBRATION = `CALIBRATION — three real calls graded by Masai's expert human graders. Match this strictness. Notice that competent execution scores 3-4, a 5 is given for a genuinely strong dimension, and only real failures get 1-2; graders do NOT cluster at 2.

EXAMPLE A — a strong call (human total 80%):
  rapport_opening 5, needs_discovery 3, programme_presentation 4, objection_handling 4, product_knowledge 4, closing_payment_ask 4, communication_empathy 4, personalised_experience 4
  Grader note: "Overall good performance; well aware of the student's needs and effectively explained the course benefits and value proposition." (A solid call is mostly 4s, with a 5 for excellent rapport and a 3 where discovery was lighter — not a wall of 2s.)

EXAMPLE B — an average call (human total 60%):
  rapport_opening 3, needs_discovery 3, programme_presentation 3, objection_handling 3, product_knowledge 3, closing_payment_ask 4, communication_empathy 3, personalised_experience 2
  Grader note: "Good product knowledge; needs to connect the programme to the student's persona better; couldn't fully convince on doubts; good intro but needs to connect better." (A merely-okay call with real gaps still scores mostly 3s.)

EXAMPLE C — a weak call (human total 45%):
  rapport_opening 2, needs_discovery 3, programme_presentation 2, objection_handling 3, product_knowledge 1, closing_payment_ask 2, communication_empathy 3, personalised_experience 2
  Grader note: "Didn't understand the persona; weak rapport; started selling immediately; shaky course knowledge (unsure on dates/EMI/placement); pushing the lead rather than understanding." (Genuine weakness earns 1-2 on the failed dimensions — but competent ones, like discovery and communication here, still get a 3.)

EXAMPLE D — a REAL flawed-but-competent call. Human total 65%. Read the excerpt, then the human scores, and note how forgiving the human grader is of name slips, a fee slip, and rambling:

  COUNSELLOR: Hi Tamil, how are you doing?            [wrong name]
  STUDENT: I'm doing well... how do we get started?
  COUNSELLOR: My name is David, I'll guide you through this course... first, tell me about yourself.
  STUDENT: I just finished my B.Com in finance, not working right now.
  COUNSELLOR: ...tell me about your parents as well, Samuel.        [wrong name again]
  COUNSELLOR: got it, Anil. Any other requests?                     [wrong name again]
  COUNSELLOR: You'll get certification from the institute, professors from IIT plus industry experts, and we have placement opportunities. Any doubts so far?
  STUDENT: What's the total fee?
  COUNSELLOR: 22,000 plus GST; EMI or one-time. A refundable 4,000 seat amount is adjusted into the fee.  [a fee figure that doesn't match the real programme fee]
  COUNSELLOR: Classes Wednesday and Saturday; budget 8-10 hours a week; recordings are available during the course but not after, for privacy reasons.
  COUNSELLOR: We have end-to-end placement assistance — you need 65% attendance and 70% marks to qualify.
  STUDENT: So placement support is solid if I meet that?
  COUNSELLOR: Yes, we make your resume, optimise LinkedIn, train you for interviews, and we will get you a company.

  HUMAN SCORES: rapport_opening 4, needs_discovery 3, programme_presentation 4, objection_handling 3, product_knowledge 3, closing_payment_ask 3, communication_empathy 4, personalised_experience 2  (= 65%)
  Why: despite repeatedly getting the name wrong, a stray non-English line, a likely-wrong fee number, and a loose "we will get you a company" claim, the counsellor DID greet warmly, run discovery, present structure/projects/schedule/placement criteria clearly, and communicate understandably — so rapport, presentation and communication are 4s, product_knowledge stays a 3 (the fee slip is minor, not a 1-2), and only personalisation (generic to the learner) drops to 2. A competent-but-flawed call is mostly 3-4.`;

function buildNewReportPrompt(session) {
  const p = session.personaSnapshot || {};
  const lead = session.leadCard || null;

  const callContext = `CALL CONTEXT: This is a Masai admissions counselling call. The counsellor is selling an admissions programme: a small seat-block (~₹4,000) blocks the seat, with EMI options for the rest of the fee. Placement support is ASSISTANCE, not a guaranteed job. The credential is a certificate, NOT a degree. Grade ONLY the counsellor.`;

  const learnerLines = [
    `THE LEARNER FOR THIS CALL:`,
    `NAME: ${p.name || lead?.name || "(unnamed)"}`,
    `LABEL: ${p.label || "n/a"}`,
    p.coreAnxiety ? `CORE ANXIETY: ${p.coreAnxiety}` : null,
    lead ? `LEAD CARD: ${[lead.name, lead.gender, lead.summary, lead.note].filter(Boolean).join(" · ")}` : null,
  ].filter(Boolean).join("\n");

  const schemaLine = `Output schema: { "parameters": [ {"key": "<one of: ${NEW_REPORT_PARAMS.map((x) => x.key).join(", ")}>", "score": <int 0-5>, "summary": "<one sentence specific to this call>"} ] } — exactly 8 entries, one per key.`;

  const user = `${callContext}

${NEW_REPORT_SCALE}

THE 8 PARAMETERS WITH THEIR EXACT 0-5 ANCHORS:
${NEW_REPORT_ANCHORS}

${NEW_REPORT_CALIBRATION}

THIS CALL — learner persona:
${learnerLines}

Now read the full transcript and score each category 0-5 with a one-line, call-specific summary.
=== TRANSCRIPT START ===
${transcriptText(session.transcript)}
=== TRANSCRIPT END ===
${schemaLine}`;

  return { system: NEW_REPORT_SYSTEM, user };
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

// Per-call timeout + effort, env-tunable (REPORT_CALL_TIMEOUT_MS / REPORT_EFFORT).
// Defaults sized so long transcripts (e.g. a 175-turn voice call) still finish
// inside the edge function wall-clock cap: effort "low" keeps Call A (rubric
// grading) reliably ~35s — "medium" was observed exceeding 100s on long
// transcripts and falling back to a neutral placeholder report.
const CALL_TIMEOUT_MS = Number(getEnv("REPORT_CALL_TIMEOUT_MS")) || 90_000;
const REPORT_EFFORT = getEnv("REPORT_EFFORT") || "low";

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

// New Report Section: 8-parameter strict re-scoring (additive, admin-only).
const NEW_REPORT_SCHEMA = {
  type: "object",
  properties: {
    parameters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          score: { type: "number" },
          summary: { type: "string" },
        },
        required: ["key", "score", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["parameters"],
  additionalProperties: false,
};

// Call G: transcript transliteration (non-Latin turns → Latin script).
const TRANSLIT_SCHEMA = {
  type: "object",
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "number" },
          latin: { type: "string" },
        },
        required: ["i", "latin"],
        additionalProperties: false,
      },
    },
  },
  required: ["turns"],
  additionalProperties: false,
};

async function runCall(label, prompt, jsonSchema, system, overrides) {
  const callOpts = {
    ...DETERMINISTIC_SAMPLING,
    mode: "reasoning",
    // effort medium: high-effort report calls exceeded the edge function
    // wall-clock cap (A+B then C at ~90s each). Medium fits with margin and
    // adaptive thinking still engages on hard grading.
    effort: REPORT_EFFORT,
    timeoutMs: CALL_TIMEOUT_MS,
    maxRetries: 0,
    jsonSchema,
    ...overrides,
  };
  const messages = system
    ? [{ role: "system", content: system }, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];
  const attempts = [callOpts, callOpts];
  let lastError;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const text = await _chat(messages, attempts[i]);
      return { ok: true, value: extractJson(text) };
    } catch (err) {
      lastError = err;
      console.warn(`[report] ${label} attempt ${i + 1}/${attempts.length} failed: ${err.message}`);
    }
  }
  return { ok: false, error: lastError };
}

// ─── Persona card (issue 9) ──────────────────────────────────────────────────
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

const DEFAULT_PERSONA_ADDRESSED = () => ({ concerns: [], summary: "", score: 7 });

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

// ─── Per-parameter calibration offsets (CHANGE 3 v3) ────────────────────────
// CALIB is the measured (human - claude) per-parameter offset for this
// model+prompt, refit as more human-graded calls accumulate. Add the offset to
// the raw model score to land on the calibrated score reported to the user.
const CALIB = {
  rapport_opening: 1.0,
  needs_discovery: 0.5,
  programme_presentation: 0.6,
  objection_handling: 0.9,
  product_knowledge: 1.2,
  closing_payment_ask: 0.8,
  communication_empathy: 1.2,
  personalised_experience: 0.8,
};
const clamp5 = (x) => Math.max(0, Math.min(5, x));

// ─── Assemble the New Report Section from its scoring call ────────────────────
// 8 parameters in fixed order. Each carries rawScore (the clamped model score)
// and score (calibrated: rawScore + CALIB[key], clamped to 0-5, 1dp).
// total = sum(calibrated scores) / 40 * 100, rounded to 1 decimal.
function assembleNewReport(raw) {
  const byKey = new Map((Array.isArray(raw?.parameters) ? raw.parameters : []).map((p) => [p.key, p]));
  const parameters = NEW_REPORT_PARAMS.map(({ key, label }) => {
    const p = byKey.get(key) || {};
    const rawScore = clamp(p.score ?? 0, 0, 5);
    const score = Math.round(clamp5(rawScore + (CALIB[key] || 0)) * 10) / 10;
    return {
      key,
      label,
      score,
      rawScore,
      summary: typeof p.summary === "string" ? p.summary : "",
    };
  });
  const sum = parameters.reduce((n, p) => n + p.score, 0);
  const total = Math.round((sum / 40) * 100 * 10) / 10;
  return { total, parameters };
}

// ─── Assemble the transliterated transcript from Call G ──────────────────────
// Returns a COPY of the transcript with turn.latinText set on every non-Latin
// turn the model returned a Latin rendering for (original turn.text untouched).
// Returns null when nothing usable came back.
function applyTransliteration(transcript, raw) {
  const byIndex = new Map(
    (Array.isArray(raw?.turns) ? raw.turns : []).map((t) => [Number(t.i), t.latin]),
  );
  let changed = false;
  const out = (transcript || []).map((m, i) => {
    const latin = byIndex.get(i);
    if (typeof latin === "string" && latin.trim() && hasNonLatinScript(m.text)) {
      changed = true;
      return { ...m, latinText: latin.trim() };
    }
    return m;
  });
  return changed ? out : null;
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
  const drillsPrompt = buildDrillsPrompt(session, criteria);   // decoupled from A
  const personaPrompt = buildPersonaAddressedPrompt(session);

  // Integrity probe (admin-only misselling detector) is an INDEPENDENT extra
  // call — only dispatched when this session carries an assigned probe. It
  // rides the same parallel allSettled fan-out so it is timeout-protected and
  // its failure is non-fatal (sets report.partial, never throws).
  const hasProbe = !!session.integrityProbe;
  const integrityPrompt = hasProbe ? buildIntegrityPrompt(session) : null;

  // New Report Section: an INDEPENDENT 8-parameter strict re-scoring (additive).
  // Rides the same parallel fan-out; failure is non-fatal (report.partial,
  // report.newReport left undefined).
  const newReportPrompt = buildNewReportPrompt(session);

  // Transcript transliteration (Call G): find turns captured in a non-Latin
  // script (Devanagari/Arabic/…). Only those turns are sent — in ONE cheap
  // fast-mode call — so an English-only transcript adds no call at all.
  const translitItems = (session.transcript || [])
    .map((m, i) => ({ i, role: m.role === "counsellor" ? "COUNSELLOR" : "STUDENT", text: cleanForTranslit(m.text) }))
    .filter((t) => hasNonLatinScript(t.text));
  const needsTranslit = translitItems.length > 0;
  const translitPrompt = needsTranslit ? buildTransliterationPrompt(translitItems) : null;

  // Usage/cost meta attached to every report LLM call (recorded by the usage sink
  // in llm.js). All report fan-out calls share the "report" feature.
  const usageMeta = {
    feature: "report",
    sessionId: session.id || null,
    counsellorId: session.counsellorId || null,
    personaLabel: session.personaSnapshot?.label || null,
  };
  const um = (overrides) => ({ usage: usageMeta, ...overrides });

  // All calls are independent → dispatch them together via allSettled.
  const settled = await Promise.allSettled([
    runCall("Call A (rubric)", rubricPrompt, REPORT_A_SCHEMA, null, um()),
    runCall("Call B (narrative)", narrativePrompt, REPORT_B_SCHEMA, null, um()),
    runCall("Call C (drills)", drillsPrompt, REPORT_C_SCHEMA, null, um()),
    runCall("Call D (persona)", personaPrompt, REPORT_D_SCHEMA, null, um()),
    hasProbe
      ? runCall("Call E (integrity)", integrityPrompt, INTEGRITY_SCHEMA, null, um())
      : Promise.resolve({ ok: false, skipped: true }),
    runCall("Call F (new report)", newReportPrompt.user, NEW_REPORT_SCHEMA, newReportPrompt.system, um()),
    needsTranslit
      ? runCall("Call G (transliterate)", translitPrompt, TRANSLIT_SCHEMA, null, um({ mode: "fast" }))
      : Promise.resolve({ ok: false, skipped: true }),
  ]);
  const unwrap = (s) => (s.status === "fulfilled" ? s.value : { ok: false, error: s.reason });
  const [resultA, resultB, resultC, resultD, resultE, resultF, resultG] = settled.map(unwrap);

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

  // New Report Section (additive). Non-fatal: on failure mark partial and leave
  // report.newReport undefined.
  let newReport;
  if (resultF.ok) {
    newReport = assembleNewReport(resultF.value);
  } else {
    partial = true;
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
  if (newReport) report.newReport = newReport;

  // Transliterated transcript (Call G): replace the transcript with a copy that
  // carries turn.latinText on the converted turns (original turn.text kept for
  // the admin "show original" toggle). Non-fatal — on failure mark partial and
  // leave the stub transcript untouched.
  if (needsTranslit) {
    if (resultG.ok) {
      const enriched = applyTransliteration(session.transcript, resultG.value);
      if (enriched) report.transcript = enriched;
      else partial = true;
    } else {
      partial = true;
    }
  }

  if (partial) report.partial = true;
  return report;
}
