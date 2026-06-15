// Dynamic convincement — the disposition module (contract C1).
//
// REPLACES the old hardcoded threshold model. Instead of a fixed "AGREEMENT
// THRESHOLD: 70" plus five static score-band strings exposed to the student, the
// student's willingness now EMERGES from evidence:
//   - score MOMENTUM over the last ~6 scoreHistory entries (trajectory, not level)
//   - the fraction of raised objections the counsellor actually addressed
//   - how many genuinely good counsellor turns (adjustment >= +2) have landed
//   - a hidden, per-session PERSUADABILITY roll, deterministic from the session id
//     blended with persona traits (skepticism, hesitancy) so the SAME persona
//     varies between sessions but is stable within one session.
//
// computeDisposition(session) -> { stage, narrative, persuadability }
//   stage         "guarded" | "listening" | "warming" | "ready" (emergent)
//   narrative     2-4 second-person sentences, NO numbers, NO mention of
//                 score/threshold — describes how the student feels and what
//                 would move them.
//   persuadability 0.0-1.0  (hidden; never shown to the student)
//
// renderDispositionSection(disposition) -> the prompt block that replaces both
//   buildScoreSection and buildConvincementSection in prompt.js. It exposes NO
//   numbers to the student.
//
// Pure + deterministic: no Date.now / Math.random anywhere. The same session
// object always produces the same disposition.

import { openObjections, addressedObjections } from "./objections.js";

// ---------------------------------------------------------------------------
// Persuadability — deterministic per session.
// ---------------------------------------------------------------------------

// FNV-1a 32-bit hash of a string -> unsigned 32-bit int. Deterministic, no deps.
function fnv1a(str) {
  let h = 0x811c9dc5; // FNV offset basis
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps it in 32-bit range).
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force unsigned
}

// Map a session id to a stable 0..1 value.
function hashUnit(id) {
  return fnv1a(id) / 0xffffffff;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function clamp15(v, dflt = 3) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(5, Math.max(1, n));
}

// Resolve the persona traits that move persuadability. skepticism lives on the
// persona's personality; hesitancy is a per-mock scenario slider (1-5, neutral 3).
// Both fall soft to neutral (3) for old sessions that lack the fields.
function resolveTraits(session) {
  const persona = session?.personaSnapshot || {};
  const personality = (persona.personality && typeof persona.personality === "object")
    ? persona.personality
    : {};
  const scenario = session?.scenarioSnapshot || {};
  const skepticism = clamp15(personality.skepticism, 3);
  const hesitancy = clamp15(scenario.hesitancy, 3);
  return { skepticism, hesitancy };
}

// Deterministic per-session persuadability in 0..1.
//   - Base is the FNV-1a hash of the session id (so identical personas vary
//     between sessions but are stable within one).
//   - High skepticism / high hesitancy pull persuadability DOWN; low pull it UP.
// The hash supplies the variance; the traits supply the bias. Blended so neither
// fully dominates (≈55% hash, ≈45% traits).
export function computePersuadability(session) {
  const id = session?.id || session?.sessionId || "";
  const seed = hashUnit(id); // 0..1, deterministic
  const { skepticism, hesitancy } = resolveTraits(session);

  // Trait term: map skepticism+hesitancy (each 1..5, neutral 3) to a 0..1 where
  // higher trait => harder to persuade => lower term. Average the two, invert.
  const traitAvg = (skepticism + hesitancy) / 2; // 1..5
  const traitTerm = clamp01(1 - (traitAvg - 1) / 4); // 5->0, 3->0.5, 1->1

  const blended = 0.55 * seed + 0.45 * traitTerm;
  return clamp01(blended);
}

// ---------------------------------------------------------------------------
// Evidence extraction — momentum + objection ledger + good-turn count.
// ---------------------------------------------------------------------------

const MOMENTUM_WINDOW = 6;

// Net momentum over the last ~6 scoreHistory adjustments. Positive = the call is
// trending up, negative = trending down. Recent turns weighted slightly heavier.
function recentMomentum(session) {
  const history = Array.isArray(session?.scoreHistory) ? session.scoreHistory : [];
  const recent = history.slice(-MOMENTUM_WINDOW);
  if (!recent.length) return 0;
  let sum = 0;
  let weight = 0;
  recent.forEach((h, i) => {
    const adj = typeof h?.adjustment === "number" ? h.adjustment : 0;
    const w = i + 1; // 1..n, later turns heavier
    sum += adj * w;
    weight += w;
  });
  return weight ? sum / weight : 0;
}

function goodTurnCount(session) {
  const history = Array.isArray(session?.scoreHistory) ? session.scoreHistory : [];
  return history.filter((h) => (h?.adjustment ?? 0) >= 2).length;
}

function badTurnCount(session) {
  const history = Array.isArray(session?.scoreHistory) ? session.scoreHistory : [];
  return history.filter((h) => (h?.adjustment ?? 0) <= -2).length;
}

// Fraction of raised objections that have been addressed (0..1). 0 raised -> 0.
function addressedRatio(state) {
  const arr = Array.isArray(state) ? state : [];
  if (!arr.length) return 0;
  const addressed = addressedObjections(arr).length;
  return addressed / arr.length;
}

// ---------------------------------------------------------------------------
// Stage — EMERGENT from combined evidence (NOT a fixed score-cutoff table).
// ---------------------------------------------------------------------------

// We compute a continuous readiness signal in 0..1 from the evidence and the
// hidden persuadability, then bucket it into the four stages. Crucially the
// inputs are TRAJECTORY (momentum), the objection ledger, and good-turn count —
// the absolute score level is NOT consulted. Persuadability shifts how readily
// the same evidence converts to readiness.
function readinessSignal(session) {
  const state = session?.objectionState;
  const arr = Array.isArray(state) ? state : [];
  const open = openObjections(arr);

  const mom = recentMomentum(session);            // ~ -10..+10, usually small
  const good = goodTurnCount(session);            // count
  const bad = badTurnCount(session);              // count
  const ratio = addressedRatio(arr);              // 0..1
  const persuadability = computePersuadability(session);

  // Momentum term: squash to 0..1 around 0 (negative momentum < 0.5).
  const momTerm = clamp01(0.5 + mom / 8);

  // Good-turn term: each genuinely good move adds, capped. Bad moves subtract.
  const turnTerm = clamp01((good - bad) / 4 * 0.5 + 0.0 + (good >= 1 ? 0.1 : 0));

  // Objection term: how much of what they raised has been answered. A student
  // with NO open objections left who has raised some is much closer to yes.
  const objTerm = arr.length === 0
    ? 0.15 // nothing raised yet — neutral-low, the call is young
    : (open.length === 0 ? 0.9 : ratio * 0.7);

  // Weighted blend. Trajectory + objections dominate; persuadability tilts.
  const base = 0.30 * momTerm + 0.25 * turnTerm + 0.30 * objTerm;
  // Persuadability nudges the whole thing up or down by up to ±0.15.
  const signal = clamp01(base + (persuadability - 0.5) * 0.30 + 0.15 * objTerm);
  return { signal, open, raisedCount: arr.length, ratio, mom, good, bad, persuadability };
}

function stageFromSignal(signal, open, raisedCount) {
  // "ready" demands a high signal AND no concern left dangling AND that at least
  // one concern was actually raised and answered — open.length === 0 is also true
  // when NOTHING was ever raised, and a real student doesn't agree to pay in the
  // opening minutes just because the counsellor sounded pleasant (a high
  // persuadability roll made that reachable in phase 1 with zero objections).
  if (signal >= 0.7 && open.length === 0 && raisedCount > 0) return "ready";
  if (signal >= 0.5) return "warming";
  if (signal >= 0.3) return "listening";
  return "guarded";
}

// ---------------------------------------------------------------------------
// Narrative — second person, NO numbers, NO score/threshold mentions.
// ---------------------------------------------------------------------------

function categoryPhrase(category) {
  const map = {
    fee: "the fees",
    emi_affordability: "paying it monthly",
    parents_family: "talking it over at home",
    time_commitment: "fitting the classes around your schedule",
    competing_priorities: "whether now is even the right time",
    trust_legitimacy: "whether this is genuine",
    job_guarantee_placement: "whether it actually leads to a job",
    course_fit_relevance: "whether this really fits someone like you",
    language_english: "managing the English",
    tech_access: "the laptop and tools you'd need",
    other: "the thing still nagging you",
  };
  return map[category] || "the thing still nagging you";
}

function buildNarrative(session, ev) {
  const { signal, open, mom, good } = ev;
  const stage = stageFromSignal(signal, open, ev.raisedCount);
  const state = Array.isArray(session?.objectionState) ? session.objectionState : [];
  const addressed = addressedObjections(state);

  const sentences = [];

  // 1) How the call has gone for you so far (trajectory, in feeling not numbers).
  if (mom > 1.2) {
    sentences.push("The last few things the counsellor said genuinely landed, and you can feel yourself warming up.");
  } else if (mom < -1.2) {
    sentences.push("The last stretch of this call has left you more uneasy than before, not less.");
  } else if (good >= 1) {
    sentences.push("A couple of the counsellor's answers have helped, though you are still weighing it.");
  } else {
    sentences.push("So far nothing has really tipped you one way or the other; you are still feeling this out.");
  }

  // 2) What got resolved (an addressed concern, named in feeling).
  if (addressed.length) {
    const a = addressed[addressed.length - 1];
    sentences.push(`The counsellor did ease your worry about ${categoryPhrase(a.category)}, so that one is genuinely off your mind now.`);
  }

  // 3) What is still in the way (the strongest open concern).
  if (open.length) {
    const o = open[open.length - 1];
    const looped = (o.timesRaised ?? 1) >= 2
      ? " You have already raised this once, so do not keep circling back to it — if the counsellor has pivoted to a new point, follow them there and engage it instead of re-opening this."
      : "";
    sentences.push(`Nobody has fully settled ${categoryPhrase(o.category)} yet, so it still feels unsettled and you would want it addressed before you commit — though you are open to hearing about other things in the meantime rather than blocking on it.${looped}`);
  }

  // 4) Stage-specific closer — the crucial "ready" behavior preserved here.
  if (stage === "ready") {
    sentences.push("Honestly you now feel ready. If the counsellor asks you to book your seat or pay, you agree naturally, with maybe one quick practical question, rather than inventing a new reason to stall.");
  } else if (stage === "warming") {
    sentences.push("You are clearly softening, but not over the line yet; let the counsellor keep earning it before you say yes.");
  } else if (stage === "listening") {
    sentences.push("You are listening properly and giving the counsellor a fair hearing, but you are nowhere near deciding.");
  } else {
    sentences.push("You stay guarded and a little skeptical; this would take real, specific reassurance before you move at all.");
  }

  // Keep it to 2-4 sentences.
  return sentences.slice(0, 4).join(" ");
}

// ---------------------------------------------------------------------------
// Public API (contract C1).
// ---------------------------------------------------------------------------

export function computeDisposition(session) {
  if (!session || typeof session !== "object") {
    return {
      stage: "guarded",
      narrative: "You stay guarded and a little skeptical; this would take real, specific reassurance before you move at all.",
      persuadability: 0.5,
    };
  }
  const ev = readinessSignal(session);
  const stage = stageFromSignal(ev.signal, ev.open, ev.raisedCount);
  const narrative = buildNarrative(session, ev);
  return { stage, narrative, persuadability: ev.persuadability };
}

// The prompt block that REPLACES buildScoreSection + buildConvincementSection.
// Exposes NO numbers, no score, no threshold to the student — just the narrative
// of how they feel and what would move them.
export function renderDispositionSection(disposition) {
  const d = disposition && typeof disposition === "object" ? disposition : computeDisposition(null);
  const narrative = d.narrative || "";
  if (!narrative) return "";
  return `WHERE YOU ARE EMOTIONALLY RIGHT NOW (this is your real inner state — let it drive how willing you are; do NOT mention any of this meta-commentary out loud):
${narrative}`;
}

// Legacy compatibility: map the emergent stage to the old three-value hint string
// so existing imports of computeConvincementHint keep working. guarded/listening
// collapse to "resistant"; warming -> "warming"; ready -> "ready".
export function stageToLegacyHint(stage) {
  if (stage === "ready") return "ready";
  if (stage === "warming") return "warming";
  return "resistant"; // guarded | listening | anything else
}
