// Counsellor cue engine — real-time coaching cards surfaced during a live session.
//
// Two exported functions:
//   instantCue(params)  — synchronous, NO LLM call; built from seed data + milestones.
//   llmCue(session)     — async, ONE deterministic LLM call over recent transcript context.
//
// Both return the same shape:
//   { source: 'corpus'|'llm', headline: string, points: string[], example: string|null }
//
// The integration agent wires these into the POST /sessions/:id/message response
// and the SSE done event payload (additive field: cue).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chat, extractJson, DETERMINISTIC_SAMPLING, REASONING_OPTIONS } from "./ollama.js";

// JSON schema for the cue — drives structured output in Claude.
// Fields match what the validation code at line ~365-377 checks.
const CUE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    points: { type: "array", items: { type: "string" } },
    example: { type: "string" },
  },
  required: ["headline", "points", "example"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Seed data (loaded once — same pattern as grounding.js)
// ---------------------------------------------------------------------------
const SEED = join(dirname(fileURLToPath(import.meta.url)), "data", "seed");
const load = (f) => JSON.parse(readFileSync(join(SEED, f), "utf8"));

const OBJECTIONS_DATA = load("objections.json").categories;
const STRUCTURE_DATA = load("conversation-structure.json");

// Keyed map for fast objection lookup
const OBJECTION_BY_KEY = Object.fromEntries(OBJECTIONS_DATA.map((o) => [o.key, o]));

// Phase names mirror phases.js (no import to avoid circular dep risk)
const PHASE_NAMES = {
  1: "Opening",
  2: "Discovery",
  3: "Presentation",
  4: "Objections & Negotiation",
  5: "Close",
};

// Human-readable objection labels — mirror objections.js CATEGORY_LABELS (kept
// local to avoid widening the import surface; objections.js does not export it).
const OBJECTION_LABELS = {
  fee: "fee / affordability",
  emi_affordability: "EMI / monthly payments",
  parents_family: "parental / family approval",
  time_commitment: "time commitment / schedule",
  competing_priorities: "competing priorities / needing time",
  trust_legitimacy: "trust / legitimacy",
  job_guarantee_placement: "placement / job guarantee",
  course_fit_relevance: "course fit / relevance",
  language_english: "language / English comfort",
  tech_access: "tech access / devices",
  other: "general concern",
};
const objectionLabel = (cat) => OBJECTION_LABELS[cat] || cat;

// Build the lead "what just happened" point from the counsellor's last scoring
// adjustment + reason, so the cue reacts to a good/bad move and QUOTES the score
// reason in the cue text itself (not just the separate scoreReason payload field).
function lastMoveLead(lastCounsellorAdjustment, lastCounsellorScoreReason) {
  const reason = typeof lastCounsellorScoreReason === "string"
    ? lastCounsellorScoreReason.trim()
    : "";
  if (typeof lastCounsellorAdjustment !== "number" || !reason) return null;
  if (lastCounsellorAdjustment < 0) {
    return `That last move cost you (${lastCounsellorAdjustment}): ${reason} — recover before pushing on.`;
  }
  if (lastCounsellorAdjustment > 0) {
    return `Good move (+${lastCounsellorAdjustment}): ${reason} — keep that thread going.`;
  }
  return `Last move was neutral: ${reason}`;
}

// Surface the still-open concerns from the live objection state, so the cue
// reminds the counsellor what is unresolved (not just the just-raised one).
function openObjectionPoint(objectionState) {
  const open = (objectionState || []).filter((o) => o && o.status === "open");
  if (open.length === 0) return null;
  const labels = open.map((o) => objectionLabel(o.category));
  return `Still open: ${labels.join(", ")} — resolve before closing.`;
}

// ---------------------------------------------------------------------------
// Phase-based fallback cues (used when no objection category is detected)
// ---------------------------------------------------------------------------
// Built from conversation-structure.json markers and paymentAskNorms.
const PHASE_FALLBACK_CUES = {
  1: {
    headline: "Warm opening — set the agenda",
    points: [
      "Check audio / camera first, greet by name",
      "Introduce yourself with social proof (e.g. '6,000+ students counselled')",
      "Congratulate on shortlisting, confirm programme applied for",
      "Set the agenda: programme, curriculum, fees, faculty — today's call covers all of it",
    ],
    example: "Great to meet you! I'm a Senior Academic Counsellor here. Congratulations on being shortlisted from 41,000+ applicants — today I'll walk you through the programme, fees, and placement, so you have everything you need.",
  },
  2: {
    headline: "Ask one good discovery question",
    points: [
      "Ask for a brief background (current work / study, graduation)",
      "Probe why they applied and what outcome they want",
      "Ask whether parents / family are aware of the programme",
      "Let the student talk — listen for goals you can link to the curriculum",
    ],
    example: "Tell me a bit about yourself — what are you currently doing and what made you apply for the Business Analytics programme?",
  },
  3: {
    headline: "Tie the curriculum to this student",
    points: [
      "Walk modules verbally, not just via brochure",
      "Map at least one module to the student's own domain or job",
      "Quote placement stats (94% placed, 5,000+ hiring partners, 21-day median)",
      "Give the selectivity proof: 41,000 applied, ~3,800 shortlisted, 200 seats",
    ],
    example: "Given you're in [their field], the SQL + Power BI module directly maps to the kind of dashboards your team produces — that's the real-world impact here.",
  },
  4: {
    headline: "Address the specific concern, then check back",
    points: [
      "Name the objection back so the student feels heard",
      "Answer with one concrete fact or number, not a general reassurance",
      "Avoid pressure tactics — they reliably escalate in this phase",
      "Check back: 'Does that answer your concern about X?'",
    ],
    example: "I hear you on the fee — let me break it down: only ₹4,000 is needed today to block the seat, the rest can go on a 9-month EMI at roughly ₹7,000/month. Does that change the picture?",
  },
  5: {
    headline: "Low-pressure next step",
    points: [
      "Frame the ₹4,000 seat-block as the only commitment today",
      "Walk the student through their own dashboard for payment — no external links",
      "If not ready: schedule a concrete follow-up call with a named time",
      "Avoid last-day / seats-running-out pressure on a hesitant student",
    ],
    example: "The only thing needed today is ₹4,000 to secure your seat — the rest goes to EMI with the finance team. Want me to walk you through the dashboard right now?",
  },
};

// ---------------------------------------------------------------------------
// Milestone gap cues — appended as extra points when milestones are behind
// ---------------------------------------------------------------------------
function milestoneGapPoints(session) {
  const m = session.milestones || {};
  const phase = session.currentPhase || 1;
  const gaps = [];

  if (!m.discoveryDone && phase >= 3) {
    gaps.push("Discovery gap: ask one situation question — 'What does your current role actually involve?'");
  }
  if (!m.presentationDone && phase >= 4) {
    gaps.push("Presentation gap: give a 30-second curriculum highlight before pushing to close");
  }
  if (m.objectionsRaised >= 3 && phase === 4) {
    gaps.push(`${m.objectionsRaised} objections raised — pick the biggest one and answer it fully before moving on`);
  }
  if (m.objectionsRaised >= 2 && !m.discoveryDone) {
    gaps.push("Low discovery + high objections: reopen with a question — 'Help me understand what's making this difficult'");
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// instantCue — synchronous, corpus-driven, always returns a cue
// ---------------------------------------------------------------------------

/**
 * instantCue({ session, lastStudentText, objectionCategory, lastCounsellorAdjustment,
 *             lastCounsellorScoreReason, objectionState })
 *
 * @param {object} session           - live session object (currentPhase, milestones, etc.)
 * @param {string} lastStudentText   - the most recent student turn text (without emotion tag)
 * @param {string|null} objectionCategory - detected objection key (matches objections.json key)
 * @param {number|null} lastCounsellorAdjustment - the counsellor's last scoring delta (−10..+10)
 * @param {string|null} lastCounsellorScoreReason - the reason for that delta; quoted into the cue
 * @param {Array} objectionState     - live objection lifecycle entries ({category,status,…})
 *
 * @returns {{ source: 'corpus', headline: string, points: string[], example: string|null }}
 */
export function instantCue({
  session,
  lastStudentText = "",
  objectionCategory = null,
  lastCounsellorAdjustment = null,
  lastCounsellorScoreReason = null,
  objectionState = null,
}) {
  const phase = session.currentPhase || 1;
  const phaseName = PHASE_NAMES[phase] || "Unknown";
  const gaps = milestoneGapPoints(session);
  // Cue v2 context: lead with the last move's outcome (quotes the score reason),
  // and remind of still-open concerns. These are prepended/appended around the
  // corpus/phase points below, then the whole list is capped at 4.
  const lead = lastMoveLead(lastCounsellorAdjustment, lastCounsellorScoreReason);
  // Prefer the live lifecycle state; fall back to the just-raised single category.
  const openPoint = openObjectionPoint(
    objectionState && objectionState.length
      ? objectionState
      : (objectionCategory ? [{ category: objectionCategory, status: "open" }] : null),
  );

  // --- Objection-specific cue ---
  if (objectionCategory && OBJECTION_BY_KEY[objectionCategory]) {
    const obj = OBJECTION_BY_KEY[objectionCategory];

    // Pick the top 3 counter-moves that worked (corpus-grounded)
    const topMoves = obj.counterMovesThatWorked.slice(0, 3);

    // Pick one move-that-failed as a negative example to avoid
    const failNote = obj.movesThatFailed[0]
      ? `Avoid: ${obj.movesThatFailed[0]}`
      : null;

    // Find a phrasing close to what the student said (simple substring match on keywords)
    const studentLower = lastStudentText.toLowerCase();
    const matchedPhrasing = obj.phrasings.find((p) =>
      p.toLowerCase().split(/\s+/).slice(0, 4).some((word) => word.length > 4 && studentLower.includes(word.replace(/[^a-z]/gi, "")))
    ) || obj.phrasings[0];

    // Phase context hint from conversation-structure markers
    const phaseMarkers = STRUCTURE_DATA.phases.find((p) => p.name === phaseName);
    const phaseHint = phaseMarkers
      ? `Phase ${phase} (${phaseName}): focus on ${phaseMarkers.markers[0]}`
      : null;

    // Lead with the last-move outcome (quotes the score reason), then the
    // corpus counter-moves, then the open-objection reminder + milestone gaps.
    const points = [
      ...(lead ? [lead] : []),
      ...topMoves,
      ...(failNote ? [failNote] : []),
      ...(openPoint ? [openPoint] : []),
      ...gaps,
    ].slice(0, 4); // cap at 4

    // Build an example line from the best counter-move, referencing a real phrasing
    const example = topMoves[0]
      ? `Example: "${topMoves[0].split(":")[0].trim()}" — try: "${matchedPhrasing}"`
      : null;

    return {
      source: "corpus",
      headline: `Handle: ${obj.label}`,
      points,
      example: phaseHint ? `${phaseHint}. ${example || ""}`.trim() : example,
    };
  }

  // --- Phase-based fallback cue ---
  const base = PHASE_FALLBACK_CUES[phase] || PHASE_FALLBACK_CUES[4];

  // Lead with the last-move outcome (quotes the score reason), then the phase
  // points, the open-objection reminder, and milestone gaps (keeping total ≤ 4).
  // Reserve room for the surrounding context lines so phase points don't crowd
  // them out, but always keep at least 1 phase point.
  const reserved = (lead ? 1 : 0) + (openPoint ? 1 : 0) + gaps.length;
  const points = [
    ...(lead ? [lead] : []),
    ...base.points.slice(0, Math.max(1, 4 - reserved)),
    ...(openPoint ? [openPoint] : []),
    ...gaps,
  ].slice(0, 4);

  return {
    source: "corpus",
    headline: base.headline,
    points,
    example: base.example,
  };
}

// ---------------------------------------------------------------------------
// LLM cue prompt — exported const so the integration agent can inspect it
// ---------------------------------------------------------------------------
export const LLM_CUE_PROMPT_TEMPLATE = `You are a real-time coaching assistant for a counselling trainer platform.
A counsellor is in a LIVE mock session with a simulated prospective student.
Your job: give ONE specific coaching card the counsellor can act on RIGHT NOW.

Session context:
- Current phase: {{phase}} ({{phaseName}})
- Live satisfaction score: {{score}}/100
- Milestones: discoveryDone={{discoveryDone}}, presentationDone={{presentationDone}}, paymentAsked={{paymentAsked}}, objectionsRaised={{objectionsRaised}}
- Open objections to resolve: {{openObjections}}

Last 8 transcript turns (most recent last):
{{transcript}}

Return ONLY valid JSON — no prose, no code fences:
{
  "headline": "<8 words or fewer — the single most important coaching action>",
  "points": ["<specific action referencing what the student said>", "<second action>", "<optional third>"],
  "example": "<one sentence the counsellor could say next — Hinglish OK>"
}

Rules:
- points must reference what the student ACTUALLY said (quote briefly if helpful)
- example must sound natural and conversational, not like a script read-out
- Never suggest pressure tactics, fake urgency, or threats
- If the objection was already answered but repeated verbatim, note that the student is looping and suggest a reframe or a direct check-back question`;

// ---------------------------------------------------------------------------
// llmCue — async, one deterministic LLM call
// ---------------------------------------------------------------------------

/**
 * llmCue(session)
 *
 * @param {object} session  - live session object with full transcript, milestones, etc.
 *
 * @returns {Promise<{ source: 'llm', headline: string, points: string[], example: string|null } | null>}
 *   Returns null on any error (caller falls back to instantCue).
 */
export async function llmCue(session) {
  try {
    const phase = session.currentPhase || 1;
    const phaseName = PHASE_NAMES[phase] || "Unknown";
    const m = session.milestones || {};
    const score = session.satisfactionScore ?? 50;
    const transcript = session.transcript || [];

    // Last 8 turns, formatted as role: text
    const recentTurns = transcript.slice(-8);
    const transcriptBlock = recentTurns
      .map((t) => `${t.role === "student" ? "Student" : "Counsellor"}: ${t.text}`)
      .join("\n");

    // Identify open (unresolved) objection categories from recent student turns
    const recentStudentTexts = recentTurns
      .filter((t) => t.role === "student")
      .map((t) => t.text.toLowerCase());

    const openObjections = OBJECTIONS_DATA
      .filter((obj) =>
        recentStudentTexts.some((txt) =>
          obj.phrasings.some((p) =>
            p.toLowerCase().split(/\s+/).slice(0, 5).some(
              (word) => word.length > 4 && txt.includes(word.replace(/[^a-z]/gi, ""))
            )
          )
        )
      )
      .map((o) => o.label)
      .join(", ") || "none detected";

    // Fill prompt template
    const prompt = LLM_CUE_PROMPT_TEMPLATE
      .replace("{{phase}}", phase)
      .replace("{{phaseName}}", phaseName)
      .replace("{{score}}", score)
      .replace("{{discoveryDone}}", m.discoveryDone ? "yes" : "no")
      .replace("{{presentationDone}}", m.presentationDone ? "yes" : "no")
      .replace("{{paymentAsked}}", m.paymentAsked ? "yes" : "no")
      .replace("{{objectionsRaised}}", m.objectionsRaised ?? 0)
      .replace("{{openObjections}}", openObjections)
      .replace("{{transcript}}", transcriptBlock || "(no turns yet)");

    const raw = await chat(
      [{ role: "user", content: prompt }],
      { ...DETERMINISTIC_SAMPLING, ...REASONING_OPTIONS, timeoutMs: 30_000, jsonSchema: CUE_SCHEMA,
        usage: { feature: "cue", sessionId: session.id || null, counsellorId: session.counsellorId || null, personaLabel: session.personaSnapshot?.label || null } },
    );

    const parsed = extractJson(raw);

    // Validate and sanitise the parsed result
    const headline = typeof parsed.headline === "string" && parsed.headline.trim()
      ? parsed.headline.trim()
      : null;
    if (!headline) return null;

    const points = Array.isArray(parsed.points)
      ? parsed.points.filter((p) => typeof p === "string" && p.trim()).slice(0, 3)
      : [];
    if (points.length === 0) return null;

    const example = typeof parsed.example === "string" && parsed.example.trim()
      ? parsed.example.trim()
      : null;

    return { source: "llm", headline, points, example };
  } catch (_err) {
    // Any error (timeout, parse failure, network) → return null so caller uses instantCue
    return null;
  }
}
