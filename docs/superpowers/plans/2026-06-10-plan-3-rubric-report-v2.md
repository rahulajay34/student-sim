# Plan 3: Rubric Templates + Engine/Report v2 (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. NO-GIT RULE: no git commands; Verify steps replace commits.

**Goal:** Admin-configurable rubric templates seeded with the real-call-anchored "Grounded v2" (8 criteria), a 5-phase machine matching real call structure with non-strict milestone tracking, archetype/objection-grounded student simulation, and Report v2 (anchor-quoted grading, key moments, benchmark comparisons, practice drills).

**Architecture:** New `rubric-templates.json` collection + CRUD; sessions snapshot the template (`rubricSnapshot`) like personas/courses. `server/grounding.js` loads the five seed artifacts once and feeds: archetype texture into the student prompt, real objection repertoires into roleplay, benchmarks into reports. `report.js` grades against the snapshot's anchors, renormalizing weights when `voice_delivery` is unscoreable (text sessions). Client: Rubrics admin page, assignment picker, 5-step PhaseStepper, ReportDetail v2 sections.

**Tech stack:** unchanged (Express + JSON store, React UI kit). All seed artifacts already exist in `server/data/seed/`.

**Key context facts (verified):**
- `report.js` currently: 6-criterion `RUBRIC` const, `(score/5)*weight` math, band ≥75/≥50, `generateReport(session, {counsellorName})`, try/catch → `fallbackReport`.
- `phases.js`: 4 phases, `advancePhase(session, role, msg)` + `initPhaseCounters()`, keyword+count heuristics.
- `prompt.js`: `buildSystemPrompt(persona, scenario, currentPhase, satisfactionScore, course)` with `booking` threaded.
- Session flow handler: advancePhase(counsellor) → scoreMessage → push → getStudentReply(session) → advancePhase(student) → persist.
- Seed: `rubric-anchors.json` 8 criteria (rapport10 discovery15 presentation15 objections20 knowledge15 closing10 communication10 voice_delivery5); `conversation-structure.json` 5 phases (Opening10 Discovery25 Presentation30 Objections&Negotiation15 Close20) + markers + paymentAskNorms{78,87,65}; `archetypes.json` 9 records; `objections.json` 14 categories with phrasings/counter-moves; `benchmarks.json` text block (+ prosody pending audio batch).
- Personas seeded: categories `studying`, `recent_graduate` (label "Recent Graduate (Not Working)"), `working_same_field`, `working_different_field`, `career_gap` — confirm exact category keys by reading `server/data/personas.json` before mapping.
- `PhaseStepper.jsx` hardcodes 4 STEPS; `ReportDetail.jsx` renders hero/rubric/phases/strengths/scoreArc/transcript; smoke asserts "report has 6 rubric criteria" and "4 phase breakdowns" (both must change).

---

## Data shapes (CONTRACT addendum)

```
RubricTemplate { id, name, description, criteria: [{key, label, weight, anchors: {"1".."5": string}}],
                 isDefault: boolean, createdAt, updatedAt }            // weights sum to 100 (±1e-6)
Assignment    += rubricTemplateId: string|null                          // null ⇒ default template at session start
Session       += rubricSnapshot: {templateId, name, criteria}|null      // snapshotted at start
Session       += milestones: { discoveryDone, presentationDone, paymentAsked: bool, objectionsRaised: number }
Report        += keyMoments: [{turn, type: "best"|"miss", note}],
                 drills: [{title, focusCriterion, objectionCategory, instruction}],
                 benchmarks: {sessionMinutes, medianPaidMinutes, paymentAskSeen, paymentAskNormPct}
Report.rubric   items unchanged in shape; length = snapshot criteria count (voice_delivery omitted in text sessions, weights renormalized)
Report.phaseBreakdown = 5 entries (Opening, Discovery, Presentation, Objections & Negotiation, Close)
```

New endpoints: `GET/POST /api/rubric-templates`, `PUT/DELETE /api/rubric-templates/:id` (DELETE blocked for `isDefault`). `POST /assignments` accepts `rubricTemplateId?`. Client: `api.getRubricTemplates() / createRubricTemplate / updateRubricTemplate / deleteRubricTemplate`. Route `/admin/rubrics`.

---

### Task 1: RubricTemplate seed + collection + CRUD

**Files:** Create `scripts/seed-rubric-template.mjs`; modify `server/store.js`, `server/index.js`.

- [ ] **Step 1: `scripts/seed-rubric-template.mjs`** — deterministic seed builder:

```js
#!/usr/bin/env node
// Build server/data/rubric-templates.json from the mined anchors (idempotent).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const anchors = JSON.parse(readFileSync(join(root, 'server/data/seed/rubric-anchors.json'), 'utf8'));
const template = {
  id: 'rt-grounded-v2',
  name: 'Grounded v2 (Real-Call Anchored)',
  description: 'Default rubric mined from 216 real counselling calls: 8 criteria with behaviour-anchored levels quoting real call moments. Voice Delivery is scored only in voice sessions.',
  criteria: anchors.criteria,
  isDefault: true,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};
writeFileSync(join(root, 'server/data/rubric-templates.json'), JSON.stringify([template], null, 2));
console.log(`seeded rubric-templates.json: ${template.criteria.length} criteria, weights sum ${template.criteria.reduce((n, c) => n + c.weight, 0)}`);
```

Run it: expect `seeded rubric-templates.json: 8 criteria, weights sum 100`.

- [ ] **Step 2: `store.js`** — add `"rubric-templates.json"` to RUNTIME_FILES (comment already explains seeded-vs-empty).

- [ ] **Step 3: `index.js` CRUD** (after the Courses block). Shared validator inside index.js:

```js
function validateRubricCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length < 3) return "criteria must be an array of at least 3";
  const keys = new Set();
  let sum = 0;
  for (const c of criteria) {
    if (!c || typeof c.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(c.key)) return `bad criterion key: ${c?.key}`;
    if (typeof c.label !== "string" || !c.label) return `criterion ${c.key}: label required`;
    if (typeof c.weight !== "number" || c.weight <= 0) return `criterion ${c.key}: weight must be positive`;
    for (const lvl of ["1", "2", "3", "4", "5"]) {
      if (typeof c.anchors?.[lvl] !== "string" || !c.anchors[lvl]) return `criterion ${c.key}: anchor ${lvl} required`;
    }
    if (keys.has(c.key)) return `duplicate criterion key: ${c.key}`;
    keys.add(c.key);
    sum += c.weight;
  }
  if (Math.abs(sum - 100) > 1e-6) return `weights sum to ${sum}, must be 100`;
  return null;
}
```

Routes: GET all; POST `{name, description, criteria}` (validate name + criteria; `isDefault: false`); PUT (same validation on present fields; ignore isDefault changes); DELETE → 400 `{error: "Cannot delete the default template"}` if `isDefault`, else remove. Mirror personas' style.

- [ ] **Step 4: assignments POST** — accept `rubricTemplateId` (optional). If provided, must exist (400 otherwise). Store `rubricTemplateId: rubricTemplateId || null`.

- [ ] **Step 5: sessions/start** — resolve template: assignment's `rubricTemplateId` → else body `rubricTemplateId` (practice) → else the `isDefault` one → else null. Snapshot: `rubricSnapshot = tpl ? { templateId: tpl.id, name: tpl.name, criteria: tpl.criteria } : null`. Add to session object together with `milestones: initMilestones()` (from phases.js, Task 2).

- [ ] **Step 6: Verify** — server up: GET /api/rubric-templates → 1 seeded; POST bad weights → 400 with "weights sum" message; POST valid clone → 200; DELETE clone → ok; DELETE rt-grounded-v2 → 400. Kill server.

---

### Task 2: Phase machine v2 (5 phases, non-strict milestones)

**Files:** Rewrite `server/phases.js`; modify `client/src/pages/shared/PhaseStepper.jsx`; touch `server/index.js` (message handler unchanged in flow — verify only).

- [ ] **Step 1: rewrite `server/phases.js`:**

```js
// Phase machine v2 — five phases mirroring real call structure (see
// server/data/seed/conversation-structure.json). Advancement is heuristic
// (message counts + corpus-derived markers) and NON-STRICT: milestones are
// tracked independently of the linear pointer, because real objections erupt
// in any phase.

export const PHASE_NAMES = {
  1: "Opening",
  2: "Discovery",
  3: "Presentation",
  4: "Objections & Negotiation",
  5: "Close",
};

const DISCOVERY_RE = /(background|introduce yourself|tell me about|working|studying|graduat|experience|current(ly)? (role|job|doing)|why (do you|are you)|goal|looking for)/i;
const PRESENTATION_RE = /(curriculum|module|fee structure|programme fee|program fee|duration|faculty|placement|certificate|campus immersion|emi|₹|rupees|\b\d{2},?\d{3}\b)/i;
const OBJECTION_RE = /(can't afford|cannot afford|too (much|expensive|costly)|think about it|talk to (my )?(parents|father|mother|family|wife|husband)|not sure|but |concern|worried|doubt|scam|genuine|refund|guarantee|time (issue|problem)|busy|exam|upsc|later|next (month|batch))/i;
const PAYMENT_ASK_RE = /(block (your|the) seat|seat block|booking (fee|amount)|pay (the )?(₹|rs|rupees )?\d|secure (your|the) (seat|slot)|payment link|complete (the|your) (payment|admission)|today only|offer (ends|valid))/i;

export function initPhaseCounters() {
  return { phase1Msgs: 0, phase2CounsellorMsgs: 0, phase3CounsellorMsgs: 0, phase4Exchanges: 0 };
}

export function initMilestones() {
  return { discoveryDone: false, presentationDone: false, paymentAsked: false, objectionsRaised: 0 };
}

export function advancePhase(session, role, msg) {
  const c = session.phaseCounters || (session.phaseCounters = initPhaseCounters());
  const m = session.milestones || (session.milestones = initMilestones());
  const text = msg || "";

  // Milestones are tracked regardless of the current phase.
  if (role === "counsellor" && DISCOVERY_RE.test(text)) m.discoveryDone = true;
  if (role === "counsellor" && PRESENTATION_RE.test(text)) m.presentationDone = true;
  if (role === "counsellor" && PAYMENT_ASK_RE.test(text)) m.paymentAsked = true;
  if (role === "student" && OBJECTION_RE.test(text)) m.objectionsRaised += 1;

  switch (session.currentPhase) {
    case 1: // Opening -> Discovery: after greetings settle (2+ exchanges) or discovery probing starts
      c.phase1Msgs += 1;
      if (c.phase1Msgs >= 4 || (role === "counsellor" && DISCOVERY_RE.test(text))) session.currentPhase = 2;
      break;
    case 2: // Discovery -> Presentation: counsellor starts presenting programme specifics
      if (role === "counsellor") {
        c.phase2CounsellorMsgs += 1;
        if (PRESENTATION_RE.test(text) || c.phase2CounsellorMsgs >= 5) session.currentPhase = 3;
      }
      break;
    case 3: // Presentation -> Objections: student pushes back, or presentation has run long
      if (role === "counsellor") c.phase3CounsellorMsgs += 1;
      if ((role === "student" && OBJECTION_RE.test(text)) || c.phase3CounsellorMsgs >= 6) session.currentPhase = 4;
      break;
    case 4: // Objections -> Close: counsellor asks for the seat-block payment
      c.phase4Exchanges += 1;
      if (m.paymentAsked || c.phase4Exchanges >= 8) session.currentPhase = 5;
      break;
    default: // 5: Close — terminal
      break;
  }
}
```

- [ ] **Step 2: `PhaseStepper.jsx`** — STEPS becomes the 5 names above (short labels: Opening, Discovery, Presentation, Objections, Close). Keep the render logic; it derives from STEPS length.

- [ ] **Step 3: prompt.js phase instructions** — `PHASE_INSTRUCTIONS` currently has 4 entries; rewrite to 5 keyed by the new model (1 Opening: greetings/audibility texture, be reachable; 2 Discovery: answer background questions per persona, volunteer goals if asked well; 3 Presentation: listen, ask course-fit questions, react to fee reveal per your financial reality; 4 Objections & Negotiation: raise YOUR objections (see repertoire) naturally, escalate if pressured, soften if genuinely addressed — keep existing `booking` threading; 5 Close: decide based on satisfaction score band — ≥70 agree to pay booking to block seat, 50-69 wavering/maybe-later, <50 decline politely or firmly per persona). Adapt the existing wording style; keep `${booking}` usages.

- [ ] **Step 4: Verify** — `node --check server/phases.js server/prompt.js`; quick probe:
`node -e "import('./server/phases.js').then(m => { const s = { currentPhase: 1, phaseCounters: m.initPhaseCounters(), milestones: m.initMilestones() }; m.advancePhase(s,'counsellor','Hi, am I audible?'); m.advancePhase(s,'student','Yes sir'); m.advancePhase(s,'counsellor','Could you tell me about your background?'); console.log('phase', s.currentPhase, 'discovery', s.milestones.discoveryDone); })"` → `phase 2 discovery true`.

---

### Task 3: Grounding module (archetypes + objections into the simulation)

**Files:** Create `server/grounding.js`; modify `server/prompt.js`, `server/scoring.js`.

- [ ] **Step 1: `server/grounding.js`:**

```js
// Loads the mined seed artifacts once and exposes grounding helpers for the
// student simulation and report engine. All files ship in server/data/seed/.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = join(dirname(fileURLToPath(import.meta.url)), "data", "seed");
const load = (f) => JSON.parse(readFileSync(join(SEED, f), "utf8"));

export const ARCHETYPES = load("archetypes.json").archetypes;
export const OBJECTIONS = load("objections.json").categories;
export const BENCHMARKS = load("benchmarks.json");
export const STRUCTURE = load("conversation-structure.json");

// Persona categories (see server/data/personas.json) -> closest mined archetype.
const CATEGORY_TO_ARCHETYPE = {
  studying: "credential_stacking_campus_achiever",
  recent_graduate: "reel_struck_parent_gated_fresher",
  working_same_field: "in_role_ai_upskiller",
  working_different_field: "automation_scared_switcher",
  career_gap: "career_break_returner",
};

export function archetypeForPersona(personaSnapshot) {
  const key = CATEGORY_TO_ARCHETYPE[personaSnapshot?.category];
  return ARCHETYPES.find((a) => a.key === key) || null;
}

// Compact objection repertoire for the student prompt: the categories this
// archetype plausibly raises, with real phrasings to imitate.
export function objectionRepertoire(archetype, difficulty = "medium") {
  const count = difficulty === "hard" ? 4 : difficulty === "easy" ? 2 : 3;
  const preferred = {
    credential_stacking_campus_achiever: ["fee", "parents_family", "time_commitment", "course_fit_relevance"],
    reel_struck_parent_gated_fresher: ["parents_family", "fee", "trust_legitimacy", "job_guarantee_placement"],
    in_role_ai_upskiller: ["course_fit_relevance", "time_commitment", "fee", "emi_affordability"],
    automation_scared_switcher: ["course_fit_relevance", "job_guarantee_placement", "fee", "trust_legitimacy"],
    career_break_returner: ["fee", "competing_priorities", "course_fit_relevance", "trust_legitimacy"],
  };
  const keys = (archetype && preferred[archetype.key]) || ["fee", "parents_family", "course_fit_relevance", "trust_legitimacy"];
  return keys.slice(0, count)
    .map((k) => OBJECTIONS.find((o) => o.key === k))
    .filter(Boolean)
    .map((o) => ({ key: o.key, label: o.label, phrasings: o.phrasings.slice(0, 2) }));
}
```

- [ ] **Step 2: `prompt.js`** — `buildSystemPrompt` gains an archetype block. After the persona section insert (only when an archetype matches):

```js
  const archetype = archetypeForPersona(persona);
  const repertoire = objectionRepertoire(archetype, scenario?.difficulty);
  const archetypeBlock = archetype ? `
WHO YOU REALLY ARE (mined from real calls with students like you — embody this):
- Background: ${archetype.background}
- Goals: ${archetype.goals}
- Core anxiety: ${archetype.coreAnxiety}
- Decision dynamics: ${archetype.decisionDynamics}
- How you talk: ${archetype.languageTexture}
- Questions you naturally ask: ${archetype.typicalQuestions.slice(0, 4).join(" | ")}

OBJECTIONS YOU GENUINELY HOLD (raise them naturally at realistic moments, in your own words — these are real phrasings from students like you):
${repertoire.map((r) => `- ${r.label}: e.g. ${r.phrasings.map((p) => `"${p}"`).join(" / ")}`).join("\n")}
Do not dump all objections at once; surface them as the conversation makes them relevant. A good counsellor answer defuses an objection; a pushy or vague answer escalates it.` : "";
```

(import from `./grounding.js`; interpolate `${archetypeBlock}` after the persona/behaviour section, before the scenario section).

- [ ] **Step 3: `scoring.js`** — extend the scoring prompt rubric with one grounded line: after the existing criteria bullets add:
`- Counter-moves that worked in real converting calls (reward these): decomposing the fee (seat-block today, balance later/EMI), quoting concrete EMI tenures, getting the parent on the call, recordings-count-for-attendance answer, live screen-share proof. Penalize: fake urgency/deadlines, scarcity pressure on trust objections, ignoring the stated objection.`

- [ ] **Step 4: Verify** — `node --check` all three; probe: `node -e "import('./server/grounding.js').then(m => { const a = m.archetypeForPersona({category:'working_same_field'}); console.log(a.name); console.log(m.objectionRepertoire(a,'hard').map(r=>r.key).join(',')); })"` → `The In-Role AI Upskiller` + 4 keys. Also verify persona category keys match `server/data/personas.json` (READ it; if keys differ, fix CATEGORY_TO_ARCHETYPE accordingly and note it).

---

### Task 4: Report v2

**Files:** Rewrite `server/report.js`; modify `server/index.js` (/sessions/:id/end passes nothing new — generateReport reads the session; verify only).

- [ ] **Step 1: rewrite `server/report.js`** with this structure (full file):

```js
// Report v2 — grades against the session's rubricSnapshot (anchor-quoted),
// adds key moments, benchmark comparisons, and practice drills.
// Falls back to the legacy 6-criterion rubric for pre-v2 sessions.
import { chat } from "./ollama.js";
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
    .map((m, i) => `[turn ${i}] ${m.role === "counsellor" ? "COUNSELLOR" : "STUDENT"}: ${m.text}`)
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
  "drills": [ { "title": "...", "focusCriterion": "<weakest criterion key>", "objectionCategory": "<e.g. fee|parents_family|...>", "instruction": "one concrete practice instruction" } ],  // 2-3
  "outcome": "Converted" | "Not Converted",
  "outcomeDetail": "one sentence on whether the student agreed to pay ${c?.feeBooking ? `₹${c.feeBooking}` : "the seat-block fee"} and why"
}
Score honestly and specifically. Do not output anything except the JSON object.`;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON in report response");
  return JSON.parse(text.slice(start, end + 1));
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

function fallbackReport(criteria) {
  return {
    rubric: criteria.map((r) => ({ key: r.key, score: 3, justification: "Automatic neutral score — report generation failed; retry from the session page." })),
    phaseBreakdown: PHASE_NAMES_V2.map((name, i) => ({ phase: i + 1, name, summary: "Unavailable", didWell: "", toImprove: "" })),
    strengths: [], improvements: [], keyMoments: [], drills: [],
    outcome: "Not Converted", outcomeDetail: "Report generation failed; outcome unknown.",
  };
}

export async function generateReport(session, { counsellorName = "" } = {}) {
  const { criteria } = effectiveCriteria(session);
  let raw;
  try {
    const text = await chat([{ role: "user", content: buildPrompt(session, criteria) }]);
    raw = extractJson(text);
  } catch (err) {
    console.error("report generation failed:", err.message);
    raw = fallbackReport(criteria);
  }

  const byKey = new Map((raw.rubric || []).map((r) => [r.key, r]));
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 100;
  const rubric = criteria.map((c) => {
    const r = byKey.get(c.key) || {};
    const score = clamp(r.score ?? 3, 1, 5);
    return {
      key: c.key, label: c.label,
      weight: Math.round((c.weight / totalWeight) * 1000) / 10,   // renormalized (voice_delivery may be excluded)
      score, level: LEVEL_LABELS[score],
      justification: typeof r.justification === "string" ? r.justification : "",
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
      objectionCategory: typeof d.objectionCategory === "string" ? d.objectionCategory : "",
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
```

NOTE for implementer: the current report.js computes `scoreArc` and merges `generated` in index.js — READ both files first; keep the index.js merge contract (`...generated` spread into the stored report) working. If the legacy file exported `RUBRIC` used elsewhere, grep for imports and keep `LEGACY_RUBRIC` aliased as needed.

- [ ] **Step 2: Verify** — `node --check server/report.js`; grep that nothing else imports the old `RUBRIC` symbol; start server; run ONE full practice session via curl (start with practice mode + a personaId + courseId; send 2 messages; end) and assert the report JSON has: 7 rubric items (text session — voice_delivery dropped), weights summing ≈100 (`node` check), `phaseBreakdown.length === 5`, `keyMoments`, `drills`, `benchmarks.medianPaidMinutes === 25.1`. Kill server.

---

### Task 5: Client v2 (Rubrics page, pickers, report sections, 5-phase stepper)

**Files:** Modify `client/src/lib/api.js`, `client/src/main.jsx`, `client/src/layouts/AdminLayout.jsx`, `client/src/ui/Sidebar.jsx` (icon), `client/src/pages/admin/AssignmentCreate.jsx`, `client/src/pages/shared/ReportDetail.jsx`, `client/src/pages/shared/PhaseStepper.jsx` (done in Task 2 if not yet). Create `client/src/pages/admin/Rubrics.jsx`.

- [ ] **Step 1: api.js** — add `getRubricTemplates: () => req("/rubric-templates")`, `createRubricTemplate/updateRubricTemplate/deleteRubricTemplate` following the existing pattern.

- [ ] **Step 2: `Rubrics.jsx`** — mirror Personas.jsx skeleton. Cards: template name, default Badge (brand "Default") when isDefault, description (line-clamp-3), `${criteria.length} criteria` + weight-sum chip (success "100" / danger otherwise), criteria preview (first 4 keys as slate Badges). Actions: Edit, Duplicate (POST copy named "<name> (copy)"), Delete (hidden for default). Modal editor: name, description Inputs; criteria editor = vertical list of collapsible rows, each with key (Input, locked when editing existing), label (Input), weight (number Input), and 5 anchor Textareas (labelled "1 — Poor" … "5 — Excellent", rows=2); "Add criterion" button appends an empty row; remove button per row; live footer showing `Σ weights = N` tinted success/danger. Save validates client-side (weights sum 100, all anchors non-empty) before POST/PUT; surface server 400 messages in the form error slot.

- [ ] **Step 3: routes/nav** — `/admin/rubrics` route + import in main.jsx; AdminLayout NAV item `{ to: "/admin/rubrics", label: "Rubrics", icon: "rubrics" }` after Courses; add a "rubrics" icon path (clipboard-check style SVG) to Sidebar.jsx ICONS following the existing icon conventions; add "Rubrics" to `titleFor()`.

- [ ] **Step 4: AssignmentCreate** — load `api.getRubricTemplates()`; add Select "Rubric" (options `t.name`, default-select the `isDefault` template) in the Scenario step (or its own step 5, following the existing numbered-section pattern); include `rubricTemplateId` in the payload.

- [ ] **Step 5: ReportDetail v2** — add, between the Strengths/Improvements section and the Score Arc section:
  - **Key moments**: vertical list; each row = turn Badge (`Turn N`), type icon/Badge (success "Highlight" / danger "Missed"), note text. Clicking a row scrolls to/flashes the transcript entry if trivially wirable (TranscriptView renders turns in order — give transcript entries `id={"turn-" + idx}` and use `document.getElementById(...).scrollIntoView()`); otherwise plain list (no over-engineering).
  - **Benchmarks vs real calls** (render only when `report.benchmarks` exists): 3 StatCards — "Call length" (`sessionMinutes min` + hint `converting calls median: ${medianPaidMinutes} min`), "Payment ask made" (Yes/No + hint `present in ${paymentAskNormPct}% of converting calls`), "Outcome" (existing outcome).
  - **Practice drills**: cards with title, focusCriterion + objectionCategory Badges, instruction text.
  All three sections must null-safe skip for legacy reports (field absent → section hidden).

- [ ] **Step 6: Verify** — `cd client && npm run lint && npm run build` pass.

---

### Task 6: Docs + smoke v3 + end-to-end

**Files:** `CONTRACT.md`, `CLAUDE.md`, `scripts/smoke-api.mjs`.

- [ ] **Step 1: CONTRACT.md** — add RubricTemplate shape + endpoints + api methods + `/admin/rubrics` route + Session.rubricSnapshot/milestones + Report v2 fields (keyMoments/drills/benchmarks; rubric length note; 5-phase breakdown). Update the §2 "Rubric criteria (fixed)" paragraph: now template-driven, seeded default = Grounded v2 (8 criteria listed with weights); legacy 6-criterion list kept for old reports.

- [ ] **Step 2: CLAUDE.md** — report.js/phases.js bullets updated (template-driven rubric, 5-phase non-strict machine, grounding.js).

- [ ] **Step 3: smoke-api.mjs** — add RUBRIC TEMPLATES block (list has seeded default; POST bad weights → 400; POST valid → 200; DELETE default → 400; DELETE created → ok). Assignment POST passes `rubricTemplateId` of the default. Update report assertions: `report has 7 rubric criteria (text session)` (`r.data.rubric.length === 7`), `rubric weights renormalized to ~100` (sum within 0.5), `report has 5 phase breakdowns`, `report has keyMoments + drills + benchmarks`. Keep legacy-compat: GET an OLD report (pre-v2, 6 criteria) still 200s.

- [ ] **Step 4: Full e2e** — server up → `node scripts/smoke-api.mjs` all green → kill. Then lint/build client.

---

## Self-review notes

- Spec §6 coverage: templates+CRUD+default seed (T1), 5-phase non-strict + milestones (T2), archetype/objection grounding incl. difficulty-scaled repertoire (T3), report v2 with anchors/key moments/benchmarks/drills + voice_delivery renormalization (T4), admin UI + pickers + report rendering (T5), docs/smoke (T6).
- Pending Phase 4 hooks honoured: `sessionHasVoiceMetrics` keys off `transcript[].deliveryMetrics` (written by the voice sidecar phase later); until then every session is a text session → 7 graded criteria.
- Legacy compat: sessions without rubricSnapshot → LEGACY_RUBRIC; old reports render unchanged (new ReportDetail sections null-safe).
- Type consistency: criteria key regex matches seeded keys; report weight renormalization rounds to 0.1; smoke asserts sum tolerance accordingly.
