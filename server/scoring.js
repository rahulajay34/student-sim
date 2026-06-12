// Scores each counsellor message -10..+10 in the context of the recent
// conversation; the result drives the live satisfaction meter. Calibrated
// against the mined real-call corpus: 0 is the expected default for an ordinary
// turn, and absence of a checklist item (next step / benefit / ack phrase) is
// NEVER a fault — that rigid checklist was the old scorer's failure mode. Pure
// backchannels (ok / hmm / haan / ji / theek hai / achha...) skip the LLM
// entirely. All leniency knobs load fail-soft from data/scoring-config.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chat, extractJson, DETERMINISTIC_SAMPLING } from "./ollama.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
const CONFIG_PATH = join(DATA_DIR, "scoring-config.json");
const OBJECTIONS_PATH = join(DATA_DIR, "seed", "objections.json");

// ---------------------------------------------------------------------------
// Objection categories (for addressedObjection detection). Loaded once,
// fail-soft, from the mined seed/objections.json — its `categories[].key`/
// `label` pairs are the valid values the scorer may return for
// `addressedObjection`, plus the literal "other" which is always allowed.
// ---------------------------------------------------------------------------
const FALLBACK_OBJECTION_CATEGORIES = [
  { key: "fee", label: "Fee / Affordability" },
  { key: "emi_affordability", label: "EMI / Monthly Affordability" },
  { key: "parents_family", label: "Parents / Family Approval" },
  { key: "time_commitment", label: "Time Commitment / Schedule" },
  { key: "competing_priorities", label: "Competing Priorities / Need Time to Decide" },
  { key: "trust_legitimacy", label: "Trust / Legitimacy" },
  { key: "job_guarantee_placement", label: "Job Guarantee / Placement Assurance" },
  { key: "course_fit_relevance", label: "Course Fit / Relevance" },
  { key: "language_english", label: "Language / English Comfort" },
  { key: "tech_access", label: "Tech Access / Devices & Tools" },
  { key: "other", label: "Other / Miscellaneous" },
];

let _objectionCats = null;
function objectionCategories() {
  if (_objectionCats) return _objectionCats;
  let cats = null;
  try {
    const raw = JSON.parse(readFileSync(OBJECTIONS_PATH, "utf-8"));
    if (Array.isArray(raw?.categories)) {
      cats = raw.categories
        .filter((c) => c && typeof c.key === "string" && c.key)
        .map((c) => ({ key: c.key, label: typeof c.label === "string" && c.label ? c.label : c.key }));
    }
  } catch {
    cats = null; // missing or malformed -> built-in fallback list
  }
  if (!cats || !cats.length) cats = FALLBACK_OBJECTION_CATEGORIES;
  // Guarantee "other" is always a valid category.
  if (!cats.some((c) => c.key === "other")) cats = [...cats, { key: "other", label: "Other / Miscellaneous" }];
  _objectionCats = cats;
  return _objectionCats;
}

// Set of valid keys for coercing the scorer's addressedObjection back to null
// if it hallucinates a category not in the list.
function objectionKeySet() {
  return new Set(objectionCategories().map((c) => c.key));
}

// DETERMINISTIC_SAMPLING is provided by ollama.js (agreed contract). Guard so a
// not-yet-merged ollama.js can't crash scoring — a missing named export imports
// as undefined, and chat() simply uses model defaults.
const SCORING_SAMPLING = DETERMINISTIC_SAMPLING || { temperature: 0.2 };

// ---------------------------------------------------------------------------
// Built-in defaults (used verbatim if the config file is missing or corrupt).
// Keep these in sync with data/scoring-config.json — they are the fail-soft
// fallback so the scorer never depends on the file existing.
// ---------------------------------------------------------------------------
export const DEFAULT_SCORING_CONFIG = {
  neverPenalizeAbsence: true,
  backchannelWords: [
    "ok", "okay", "kk", "k", "hmm", "hm", "mhm", "mm", "uh", "uhuh",
    "haan", "han", "ha", "haa", "haanji", "ji", "jee", "hai", "hain",
    "acha", "accha", "achha", "theek", "thik",
    "right", "yes", "yeah", "yep", "yup", "sure", "fine", "alright",
    "great", "good", "correct", "perfect", "exactly", "got it", "cool",
    "samajh", "samjha", "samjhi", "bilkul", "sahi", "okk", "okkk",
    // Devanagari forms — the STT transcribes spoken Hindi acks in Devanagari,
    // and without these every "हाँ" went through a full LLM scoring call.
    "हाँ", "हां", "हान", "जी", "ठीक", "ठीक है", "अच्छा", "बिल्कुल", "सही", "ओके", "समझ",
  ],
  severityBands: [
    { range: "0", label: "Ordinary / expected", guidance: "The modal adjustment. An ordinary turn that does what a competent counsellor would do at this moment — plain explaining, a short factual answer, a normal discovery question, a routine acknowledgement — scores 0. Most turns score 0." },
    { range: "+1..+2 (early phases)", label: "Good rapport / discovery / presentation craft", guidance: "In Opening, Discovery and Presentation (phases 1-3) genuine craft earns a small positive — it must NOT sit frozen at 0. +1..+2 for: a warm rapport-building open, light agenda-setting, a genuine open discovery question that gets the student talking, active listening that builds on the student's own last answer, or a presentation point tied specifically to what THIS student said. Small but real — rapport and discovery quality should move the meter up through the early phases." },
    { range: "+2", label: "Concrete relevant answer", guidance: "The counsellor gives a concrete, correct, relevant answer to what the student JUST asked — a specific fee figure, the real refund window, the actual schedule, a straight yes/no with the reason. Answering the question they asked, with a real answer, is worth +2 — it is NOT an ordinary 0." },
    { range: "+3..+4", label: "Addresses a concern/objection", guidance: "The counsellor directly and substantively addresses a concern or objection the student has raised this call, using specifics — numbers, proof, policy detail, and/or genuine empathy (e.g. explains the real refund terms and what triggers a refund, breaks down the fee, gives concrete placement stats with eligibility mechanics). This is the workhorse positive band when the student is pushing back and the counsellor actually engages the substance." },
    { range: "+5..+7", label: "Outstanding move", guidance: "An outstanding objection-handling move: decomposes the fee into seat-block-now + EMI, offers to bring a parent onto the call, screen-shares live proof, or lands a concrete agreed next step right after handling the objection. The kind of move that visibly turns a resistant student around." },
    { range: "-1..-2 (early phases)", label: "Weak rapport / discovery / presentation craft", guidance: "In phases 1-3, small negatives for craft faults that are not yet outright bad: ignoring or talking past the answer the student just gave, monologuing a brochure dump with no link to the student, skipping discovery to hard-pitch, or asking a closed/leading question where an open one was called for. -1..-2 — enough to register the early-phase craft was off, without treating it as a serious fault." },
    { range: "-1..-3", label: "Clearly weak", guidance: "Vague where specifics were called for, ignores what the student just said, a rambling info-dump, talks over a question the student actually asked." },
    { range: "-4..-6", label: "Notably bad", guidance: "Pressure tactics on a hesitant student, dismissing or belittling a stated concern, fake urgency on a trust objection." },
    { range: "+8..+10 / -7..-10", label: "Rare extremes", guidance: "Reserve for genuine extremes only: a textbook close of a difficult call (+8..+10), or lying / aggressive bullying / browbeating an uncomfortable student (-7..-10)." },
  ],
  phaseExpectations: {
    1: "Opening. An ordinary greeting is 0, but genuine craft earns a small positive (+1..+2): a warm rapport-building open, a clear audibility/camera check, congratulating the student, and light agenda-setting. Hard-pitching this early is weak (-1..-2).",
    2: "Discovery. This is where the student ANSWERS the counsellor's questions. An ordinary probe is 0, but genuine craft earns a small positive (+1..+2): a real open question that gets the student talking, and active listening that builds on the student's last answer. Letting the student talk is good. Lecturing, brochure-dumping, or ignoring the student's answer instead of probing is weak (-1..-2).",
    3: "Presentation. The counsellor is explaining the programme while the student mostly LISTENS and gives short acknowledgements. Plain, clear explaining is fine (0); a point tied specifically to what THIS student said earns a small positive (+1..+2). Weak (-1..-2): 100+ word brochure dumps with no link to the student.",
    4: "Objections & Negotiation. Where the student's questions and pushback concentrate (fees, parents, time, scholarships, placement, EMI). Good now: address the SPECIFIC objection with concrete information and empathy, then check back. Dismissing, brushing off, or pressuring a hesitant student is a serious fault.",
    5: "Close. Good now: a clear, LOW-pressure next step — the seat-blocking amount framed honestly, a payment walkthrough, or a follow-up if the student isn't ready. Pressure tactics on a still-hesitant student (last day, decide right now, seats running out as a club) are a serious fault.",
  },
  counterMoves: {
    reward: [
      "Decomposing the fee: a small seat-block amount now, the balance moved to EMI / a finance team — instead of quoting the full figure as a wall.",
      "Quoting a concrete EMI tenure and monthly figure rather than a vague 'EMI is available'.",
      "Inviting a parent onto the call to discuss fees and approval, instead of arguing alone with the student.",
      "Answering the recordings-count-for-attendance / can-I-catch-up worry with the real policy.",
      "Offering live screen-share / dashboard proof of curriculum, placement data, or the payment flow.",
    ],
    penalize: [
      "Fake urgency or invented deadlines ('today is the last day') used to pressure rather than inform.",
      "Scarcity pressure ('only 70 seats left') aimed at a trust or affordability objection.",
      "Ignoring or talking past the specific objection the student just raised.",
    ],
  },
  recentTurnsWindow: 6,
  guidelines: [
    "Positive bands are REAL, not reserved for heroics. +2 = a concrete, correct, relevant answer to what the student just asked. +3..+4 = directly and substantively addressing a concern/objection the student raised (specifics, numbers, proof, empathy). +5..+7 = an outstanding move (decompose the fee, offer a parent call, concrete next step after handling an objection). Good counselling must move the meter UP, otherwise persistence never pays off.",
    "Early phases (1-3) must NOT freeze the meter at 0. Rapport, discovery and presentation craft earn a small positive (+1..+2): rapport-building opens, agenda-setting, genuine open discovery questions, active listening that builds on the student's last answer, and presentation points tied to what THIS student said. Early-phase craft faults — ignoring the student's answer, monologuing a brochure dump, skipping discovery to hard-pitch — earn a small negative (-1..-2). Still bounded by 'never penalize ABSENCE'.",
    "addressedObjection: when scoring, decide whether this turn gave a substantive, specific response to a concern the student has ALREADY raised this call (visible in the last-6-turns context). If so, set addressedObjection to the matching objection CATEGORY KEY (from seed/objections.json) or 'other'; otherwise null. A pure backchannel always returns addressedObjection:null.",
    "addressedObjection key-matching: the scoring prompt is fed the session's currently-OPEN objection keys and the scorer is told to return one of THOSE exact keys when the turn answers an open concern, so the session resolves the same concern it is tracking (a free-pick key often mismatched the regex-assigned key and made resolveObjection a no-op). resolveObjection also falls back to a sibling/related open concern when no exact key matches. This open-objections list is supplied per turn at runtime, not edited in this config.",
  ],
};

// ---- fail-soft config loader / saver ----
let _cache = null;

function coerceConfig(raw) {
  const d = DEFAULT_SCORING_CONFIG;
  if (!raw || typeof raw !== "object") return { ...d };
  // phaseExpectations may arrive with string keys ("1".."5") from JSON; keep as-is.
  // Spread raw first so keys this allowlist doesn't know about survive an admin
  // save round-trip (PUT /api/config/scoring writes the coerced object back).
  return {
    ...raw,
    neverPenalizeAbsence: typeof raw.neverPenalizeAbsence === "boolean" ? raw.neverPenalizeAbsence : d.neverPenalizeAbsence,
    backchannelWords: Array.isArray(raw.backchannelWords) && raw.backchannelWords.length ? raw.backchannelWords : d.backchannelWords,
    severityBands: Array.isArray(raw.severityBands) && raw.severityBands.length ? raw.severityBands : d.severityBands,
    phaseExpectations: raw.phaseExpectations && typeof raw.phaseExpectations === "object" ? raw.phaseExpectations : d.phaseExpectations,
    counterMoves: raw.counterMoves && typeof raw.counterMoves === "object" ? {
      ...raw.counterMoves,
      reward: Array.isArray(raw.counterMoves.reward) ? raw.counterMoves.reward : d.counterMoves.reward,
      penalize: Array.isArray(raw.counterMoves.penalize) ? raw.counterMoves.penalize : d.counterMoves.penalize,
    } : d.counterMoves,
    recentTurnsWindow: Number.isFinite(raw.recentTurnsWindow) && raw.recentTurnsWindow > 0 ? raw.recentTurnsWindow : d.recentTurnsWindow,
    guidelines: Array.isArray(raw.guidelines) ? raw.guidelines : d.guidelines,
  };
}

// Loads the scoring config, falling back to built-in defaults on any failure.
// Cached; pass {fresh:true} to bypass the cache (the PUT endpoint does this).
export function loadScoringConfig({ fresh = false } = {}) {
  if (_cache && !fresh) return _cache;
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    raw = null; // missing or malformed -> built-in defaults
  }
  _cache = coerceConfig(raw);
  return _cache;
}

// Persists a (validated) config to disk and refreshes the cache. Returns the
// coerced config actually stored.
export function saveScoringConfig(next) {
  const coerced = coerceConfig(next);
  writeFileSync(CONFIG_PATH, JSON.stringify(coerced, null, 2) + "\n");
  _cache = coerced;
  return coerced;
}

// ---- deterministic backchannel short-circuit ----
// 1-4 words, every word from the configured ack set -> conversational glue, 0.
export function isBackchannel(text, config = loadScoringConfig()) {
  // Unicode-aware tokenizer: Scribe STT transcribes spoken Hindi acks in
  // Devanagari (हाँ / जी / ठीक है), which a Latin-only [a-z'] tokenizer drops.
  // \p{M} keeps combining marks (ँ ् ी) inside a token; multi-word config
  // entries ("theek hai", "ठीक है") are split so each token matches alone.
  const TOKEN_RE = /[\p{L}\p{M}']+/gu;
  const tokens = (s) => String(s).toLowerCase().match(TOKEN_RE) || [];
  const set = new Set((config.backchannelWords || []).flatMap(tokens).filter(Boolean));
  const ws = tokens(text || "");
  return ws.length > 0 && ws.length <= 4 && ws.every((w) => set.has(w));
}

// ---- prompt composition ----
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 3).trimEnd() + "..." : String(s));

function phaseKey(phase, config) {
  const pe = config.phaseExpectations || {};
  const k = String(phase);
  return pe[k] != null ? k : pe[phase] != null ? phase : "1";
}

function contextSection(recentTurns) {
  if (!recentTurns?.length) return "(call just started — no prior turns)";
  return recentTurns
    .map((t) => `${t.role === "counsellor" ? "COUNSELLOR" : "STUDENT"}: ${trunc(t.text, 280)}`)
    .join("\n");
}

function severitySection(config) {
  return (config.severityBands || [])
    .map((b) => `${b.range} = ${b.label}: ${b.guidance}`)
    .join("\n");
}

function objectionCategorySection() {
  return objectionCategories()
    .map((c) => `  - ${c.key} (${c.label})`)
    .join("\n");
}

// The concerns currently OPEN in this session's objectionState. Passed through
// so the scorer resolves the SAME category key the session is tracking — without
// this the LLM picks a key from its own read of the transcript, which often
// mismatches detectObjectionCategory()'s key and makes resolveObjection() a
// no-op (the addressed-objection loop never closes). Returns "" when none open.
function openObjectionSection(openObjections) {
  const list = (openObjections || [])
    .map((o) => (typeof o === "string" ? { key: o } : o))
    .filter((o) => o && typeof o.key === "string" && o.key);
  if (!list.length) return "";
  const labelByKey = new Map(objectionCategories().map((c) => [c.key, c.label]));
  const lines = list
    .map((o) => `  - ${o.key}${labelByKey.has(o.key) ? ` (${labelByKey.get(o.key)})` : ""}`)
    .join("\n");
  return `
CONCERNS THIS STUDENT HAS ALREADY RAISED AND ARE STILL OPEN (use one of THESE exact keys for addressedObjection when this turn answers one of them — they are what the session is tracking):
${lines}
`;
}

function counterMoveSection(config) {
  const cm = config.counterMoves || {};
  const lines = [];
  if (cm.reward?.length) lines.push("Counter-moves that worked in real converting calls (reward these):\n" + cm.reward.map((s) => `  - ${s}`).join("\n"));
  if (cm.penalize?.length) lines.push("Moves that failed in real calls (penalize these):\n" + cm.penalize.map((s) => `  - ${s}`).join("\n"));
  return lines.length ? "\n" + lines.join("\n") + "\n" : "";
}

// Builds the exact scoring prompt. Exported (via scoringPromptForInspection)
// for the /api/sessions/:id/prompt transparency endpoint.
function buildScoringPrompt({ message, recentTurns = [], phase = 1, turnType, courseName, openObjections = [] } = {}, config = loadScoringConfig()) {
  const pk = phaseKey(phase, config);
  const phaseText = config.phaseExpectations[pk] || config.phaseExpectations["1"];
  const tt = turnType ? ` (${turnType})` : "";
  const absenceRule = config.neverPenalizeAbsence
    ? `- NEVER penalize absence. A turn that merely lacks a next step, a benefit mention, or an acknowledgement phrase is NOT at fault for that. Judge what the counsellor DID against what a good counsellor would do at this exact moment of this phase.`
    : `- Judge what the counsellor DID against what a good counsellor would do at this exact moment of this phase.`;

  return `You are scoring ONE counsellor turn in a live sales-counselling call for ${courseName || "the IIM Ranchi × Masai analytics programme"}. Most turns are ordinary and score 0.

CONVERSATION SO FAR (oldest first):
${contextSection(recentTurns)}

CALL PHASE ${pk} of 5 — ${phaseText}

COUNSELLOR'S TURN TO SCORE${tt}: ${trunc(message, 600)}

Adjustment scale (integer, -10 to +10) — 0 is the modal value, but the positive bands are REAL and you MUST use them when earned:
${severitySection(config)}

Hard rules:
${absenceRule}
- 0 is for genuinely ordinary turns. But do NOT default a turn to 0 when the counsellor actually answered the student's question or worked their objection — reward it (+2 for a concrete relevant answer, +3..+4 for substantively addressing a raised concern with specifics/empathy, +5..+7 for an outstanding move). Persistence and addressing concerns MUST move the meter up.
- Plain explaining in the Presentation phase and short factual answers when nothing was asked are 0, not negative.
- Backchannels and routine acknowledgements are neutral (0).
${counterMoveSection(config)}
CALIBRATION ANCHOR (from a real call): the student said "I'm not comfortable paying yet; I still need clarity on the refund policy if the program doesn't lead to a job." The counsellor answered "this 4000 rupees that you will be paying is fully refundable within 7 days if you change your mind, and regarding [placement]...". That is a concrete, correct, relevant answer to the refund concern the student raised — score it +2..+3 (it directly addresses the refund/affordability objection). It is NOT a 0. Use this as your benchmark for what the positive bands look like.

OBJECTION DETECTION — also report whether this turn addressed an objection. "Addressed" means: the counsellor gave a substantive, specific response to a concern the student has raised THIS call (it appears in the CONVERSATION SO FAR above). A dismissal, a brush-off, fake urgency, or merely restating policy without engaging the substance does NOT count as addressed. Valid objection categories (use the KEY, lowercase, exactly):
${objectionCategorySection()}
If the turn substantively addressed a raised concern, set addressedObjection to the matching category key (or "other" if it fits none). Otherwise set it to null.
${openObjectionSection(openObjections)}When this turn answers one of the OPEN concerns listed just above, you MUST return that concern's exact key (not a different but related key) — that is the key the session is tracking and your answer is what closes it.

Return ONLY a JSON object: {"adjustment": <integer -10..10>, "reason": "<one short sentence>", "addressedObjection": <category key string or null>}`;
}

// Public accessor for the transparency endpoint: returns the exact prompt text.
export function scoringPromptForInspection(opts = {}) {
  return buildScoringPrompt(opts, loadScoringConfig());
}

// ---------------------------------------------------------------------------
// Message breakdown scoring — for info-heavy counsellor turns (> INFO_HEAVY_WORDS).
// Breaks the message into distinct information pieces, rates each 1-5 on
// usefulness, and returns a ranked list the client can display as feedback.
// This runs concurrently with the regular scorer and is purely additive — it
// does NOT affect the adjustment value.
// ---------------------------------------------------------------------------
const INFO_HEAVY_WORDS = 40;

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function buildBreakdownPrompt({ message, recentTurns = [], phase = 1, courseName } = {}) {
  const ctx = recentTurns.length
    ? recentTurns.map((t) => `${t.role === "counsellor" ? "COUNSELLOR" : "STUDENT"}: ${trunc(t.text, 200)}`).join("\n")
    : "(call just started)";
  return `A counsellor on a sales-training call has delivered a long message containing multiple pieces of information. Break it into its distinct informational units and rate each one.

CONTEXT (recent turns):
${ctx}

COUNSELLOR'S MESSAGE:
${trunc(message, 1000)}

Break the message into at most 6 distinct information pieces. For each piece, rate its usefulness to the student at this stage of the call (Phase ${phase} of 5 for ${courseName || "an analytics programme"}):

Rating scale:
1 = Not useful (irrelevant, filler, or confusing)
2 = Weak (vague or only partially relevant)
3 = Neutral (basic expected info, neither helps nor hurts)
4 = Useful (clear and relevant, addresses what the student needs)
5 = Excellent (specific, directly addresses a concern or question)

Return ONLY a JSON object:
{"pieces": [{"text": "<short summary of this piece, max 15 words>", "rating": <1-5>, "reason": "<one short phrase>"}]}`;
}

async function scoreBreakdown({ message, recentTurns = [], phase = 1, courseName } = {}) {
  if (wordCount(message) < INFO_HEAVY_WORDS) return null;
  try {
    const prompt = buildBreakdownPrompt({ message, recentTurns, phase, courseName });
    const raw = await chat([{ role: "user", content: prompt }], { ...SCORING_SAMPLING, timeoutMs: 12000 });
    const result = extractJson(raw);
    if (!Array.isArray(result?.pieces) || !result.pieces.length) return null;
    return result.pieces
      .slice(0, 6)
      .filter((p) => p && typeof p.text === "string")
      .map((p) => ({
        text: String(p.text).trim(),
        rating: Math.max(1, Math.min(5, Math.round(Number(p.rating)) || 3)),
        reason: String(p.reason || "").trim(),
      }));
  } catch (err) {
    console.warn("[scoring] breakdown failed:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// scoreMessage — new signature:
//   scoreMessage(message, { recentTurns, phase, turnType, courseName })
// Backward-compatible shim for the old positional call from index.js:
//   scoreMessage(message, lastStudentMessage, courseName)
// ---------------------------------------------------------------------------
function normalizeOpts(opts, legacyCourseName) {
  // New shape: second arg is an options object (no `role` field, since a turn
  // object would have one). Old shape: second arg is the last student message
  // string (or null/undefined), third arg is courseName.
  if (opts && typeof opts === "object" && !Array.isArray(opts)) {
    return {
      recentTurns: opts.recentTurns || [],
      phase: opts.phase ?? 1,
      turnType: opts.turnType,
      courseName: opts.courseName,
      openObjections: Array.isArray(opts.openObjections) ? opts.openObjections : [],
    };
  }
  // Legacy: opts is the last student message (string|null), build a 1-turn window.
  const lastStudent = opts;
  return {
    recentTurns: lastStudent ? [{ role: "student", text: String(lastStudent) }] : [],
    phase: 1,
    turnType: undefined,
    courseName: legacyCourseName,
    openObjections: [],
  };
}

export async function scoreMessage(message, opts, legacyCourseName, chatOpts = {}) {
  const config = loadScoringConfig();

  if (isBackchannel(message, config)) {
    return { adjustment: 0, reason: "Backchannel acknowledgement", addressedObjection: null };
  }

  const norm = normalizeOpts(opts, legacyCourseName);
  const prompt = buildScoringPrompt({ message, ...norm }, config);

  // Run breakdown concurrently for info-heavy messages (no-op for short ones).
  const breakdownPromise = scoreBreakdown({
    message, recentTurns: norm.recentTurns, phase: norm.phase, courseName: norm.courseName,
  });

  try {
    // chatOpts may carry a timeoutMs so a raced caller (e.g. /observe's 15s
    // Promise.race) can abort the in-flight LLM fetch instead of leaving it dangling.
    const [raw, breakdown] = await Promise.all([
      chat([{ role: "user", content: prompt }], { ...SCORING_SAMPLING, ...chatOpts }),
      breakdownPromise,
    ]);
    const result = extractJson(raw);
    const adjustment = Math.max(-10, Math.min(10, Math.round(Number(result.adjustment)) || 0));
    return {
      adjustment,
      reason: result.reason || "",
      addressedObjection: coerceAddressedObjection(result.addressedObjection),
      ...(breakdown ? { breakdown } : {}),
    };
  } catch (err) {
    console.error("Scoring error:", err.message);
    return { adjustment: 0, reason: "scoring unavailable", addressedObjection: null };
  }
}

// Coerces the scorer's addressedObjection back to a valid category key or null.
// Anything that isn't a known key (incl. "null"/"none"/empty/hallucinated) -> null.
function coerceAddressedObjection(value) {
  if (value == null) return null;
  const key = String(value).trim().toLowerCase();
  if (!key || key === "null" || key === "none") return null;
  return objectionKeySet().has(key) ? key : null;
}
