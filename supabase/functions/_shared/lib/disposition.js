// _shared/lib/disposition.js — ported from server/disposition.js.
// CHANGES: replaced ./objections.js import path; no other changes.

import { openObjections, addressedObjections } from "./objections.js";

function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

export function computePersuadability(session) {
  const id = session?.id || session?.sessionId || "";
  const seed = hashUnit(id);
  const { skepticism, hesitancy } = resolveTraits(session);

  const traitAvg = (skepticism + hesitancy) / 2;
  const traitTerm = clamp01(1 - (traitAvg - 1) / 4);

  const blended = 0.55 * seed + 0.45 * traitTerm;
  return clamp01(blended);
}

const MOMENTUM_WINDOW = 6;

function recentMomentum(session) {
  const history = Array.isArray(session?.scoreHistory) ? session.scoreHistory : [];
  const recent = history.slice(-MOMENTUM_WINDOW);
  if (!recent.length) return 0;
  let sum = 0;
  let weight = 0;
  recent.forEach((h, i) => {
    const adj = typeof h?.adjustment === "number" ? h.adjustment : 0;
    const w = i + 1;
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

function addressedRatio(state) {
  const arr = Array.isArray(state) ? state : [];
  if (!arr.length) return 0;
  const addressed = addressedObjections(arr).length;
  return addressed / arr.length;
}

function readinessSignal(session) {
  const state = session?.objectionState;
  const arr = Array.isArray(state) ? state : [];
  const open = openObjections(arr);

  const mom = recentMomentum(session);
  const good = goodTurnCount(session);
  const bad = badTurnCount(session);
  const ratio = addressedRatio(arr);
  const persuadability = computePersuadability(session);

  const momTerm = clamp01(0.5 + mom / 8);
  const turnTerm = clamp01((good - bad) / 4 * 0.5 + 0.0 + (good >= 1 ? 0.1 : 0));
  const objTerm = arr.length === 0
    ? 0.15
    : (open.length === 0 ? 0.9 : ratio * 0.7);

  const base = 0.30 * momTerm + 0.25 * turnTerm + 0.30 * objTerm;
  const signal = clamp01(base + (persuadability - 0.5) * 0.30 + 0.15 * objTerm);
  return { signal, open, raisedCount: arr.length, ratio, mom, good, bad, persuadability };
}

function stageFromSignal(signal, open, raisedCount) {
  if (signal >= 0.7 && open.length === 0 && raisedCount > 0) return "ready";
  if (signal >= 0.5) return "warming";
  if (signal >= 0.3) return "listening";
  return "guarded";
}

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

  if (mom > 1.2) {
    sentences.push("The last few things the counsellor said genuinely landed, and you can feel yourself warming up.");
  } else if (mom < -1.2) {
    sentences.push("The last stretch of this call has left you more uneasy than before, not less.");
  } else if (good >= 1) {
    sentences.push("A couple of the counsellor's answers have helped, though you are still weighing it.");
  } else {
    sentences.push("So far nothing has really tipped you one way or the other; you are still feeling this out.");
  }

  if (addressed.length) {
    const a = addressed[addressed.length - 1];
    sentences.push(`The counsellor did ease your worry about ${categoryPhrase(a.category)}, so that one is genuinely off your mind now.`);
  }

  if (open.length) {
    const o = open[open.length - 1];
    sentences.push(`Nobody has fully settled ${categoryPhrase(o.category)} yet, so it still feels unsettled and you would want it addressed before you commit — though you are open to hearing about other things in the meantime rather than blocking on it.`);
  }

  if (stage === "ready") {
    sentences.push("Honestly you now feel ready. If the counsellor asks you to book your seat or pay, you agree naturally, with maybe one quick practical question, rather than inventing a new reason to stall.");
  } else if (stage === "warming") {
    sentences.push("You are clearly softening, but not over the line yet; let the counsellor keep earning it before you say yes.");
  } else if (stage === "listening") {
    sentences.push("You are listening properly and giving the counsellor a fair hearing, but you are nowhere near deciding.");
  } else {
    sentences.push("You stay guarded and a little skeptical; this would take real, specific reassurance before you move at all.");
  }

  return sentences.slice(0, 4).join(" ");
}

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

export function renderDispositionSection(disposition) {
  const d = disposition && typeof disposition === "object" ? disposition : computeDisposition(null);
  const narrative = d.narrative || "";
  if (!narrative) return "";
  return `WHERE YOU ARE EMOTIONALLY RIGHT NOW (this is your real inner state — let it drive how willing you are; do NOT mention any of this meta-commentary out loud):
${narrative}`;
}

export function stageToLegacyHint(stage) {
  if (stage === "ready") return "ready";
  if (stage === "warming") return "warming";
  return "resistant";
}
