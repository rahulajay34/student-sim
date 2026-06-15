// _shared/lib/objections.js — ported from server/objections.js.
// CHANGES: none (no fs/path/process.env deps). Byte-identical logic.

const RULES = [
  {
    key: "fee",
    re: /(can'?t afford|cannot afford|fee.{0,20}(too (much|high|expensive|costly))|too (much|expensive|costly|high).{0,20}fee|afford.{0,30}fee|fee.{0,30}afford|middle class.{0,30}(fee|spend|paying)|spending.{0,20}(here|on this).{0,10}difficult|fee.{0,20}problem|fee.{0,20}high|fee.{0,20}lot|pay.{0,20}later|4,?000.{0,20}(now|right now|immediately)|(price|fee|cost).{0,20}different|brochure.{0,20}(fee|price)|scholarship|discount.{0,15}fee|(tell|share|give|know|ask).{0,20}(the )?(exact |total |full )?fees?\b|fees?\b.{0,5}part|(what|whats|what'?s).{0,10}(is|are|s)?.{0,10}(the )?(exact |total |full )?fees?\b|(exact|total|full)\s+fees?\b|exact.{0,12}(amount|figure).{0,15}(fee|cost|pay|rupee|rs\b|inr|₹)|fees?\b.{0,10}(exact|exactly)|how much.{0,30}(cost|costs|costing)|fees?\b.{0,10}kitni|kitni.{0,10}fees?\b)/i,
  },
  {
    key: "emi_affordability",
    re: /\bemi\b|no.?cost.?emi|monthly.{0,20}(amount|instalment|installment|pay)|per month|instalment|installment.{0,20}(interest|without)|pay.{0,20}monthly|(two|three|four|five|six|seven|eight|nine|ten|2|3|4|5|6|7|8|9|10).{0,10}(months?|month).{0,20}(emi|pay|instalment)|interest.{0,20}(emi|loan)|(emi|monthly).{0,20}interest/i,
  },
  {
    key: "parents_family",
    re: /(talk|discuss|speak|check).{0,30}(father|dad|mother|mom|mum|parents|family|husband|wife|spouse|home)|father.{0,20}(not home|not here|away|busy)|(parents|family).{0,20}(agree|agreed|okay|permission|convince|discuss|check|decide|approval)|mom.{0,20}not home|run it through|discuss.{0,10}(internally|with)|husband.{0,20}not home|leverage.{0,20}(decision|own)|first year.{0,20}(decision|own)|can'?t decide.{0,20}own/i,
  },
  {
    key: "time_commitment",
    re: /(recorded?.{0,20}(attend|lecture|class|count)|live.{0,20}(miss|can'?t attend|not attend|schedule|timing|clash)|night shift|work.{0,15}(timing|schedule|hours)|office.{0,10}timing|too busy|exam.{0,20}(start|coming|from|clash|10th|conflict)|juggle.{0,10}job|weekend.{0,20}(class|timing|extend)|two.{0,10}(times|classes).{0,10}week|class.{0,20}(wednesday|saturday|sunday|weekday)|can'?t manage.{0,15}time|no time|time.{0,20}manage)/i,
  },
  {
    key: "competing_priorities",
    re: /(compare.{0,30}(option|place|other|alternative|decision)|inquired.{0,20}(places?|other)|need.{0,20}(time|day|two days|more time|little time).{0,30}(decide|think|finalize|compare|check)|(give me|can you give).{0,20}(day|days|more time|two|three).{0,20}day|(can you give|give me).{0,15}(two|three|more).{0,10}(day|days)|just exploring|won'?t be able.{0,20}(take|manage|right now)|batch.{0,20}(after|later|september|july)|internship.{0,20}clash|promotion.{0,20}focused|pcs exam|upsc.{0,20}(exam|prep)|government.{0,10}(job|exam|prep)|not desperate|summer internship|deadline.{0,20}(operational|fake|tactic)|same day.{0,20}(counselling|course))/i,
  },
  {
    key: "trust_legitimacy",
    re: /(scam|genuine|legit|fraud|fake|not heard.{0,20}(masai|school|institute)|association.{0,20}(bits|iim|campus)|masai.{0,15}(associated|autonomous|role|what is)|contribution.{0,20}(iim|bits|masai)|check.{0,20}review|verify|demo.{0,20}(class|facility|session)|certificate.{0,20}(value|nothing|fake)|how many.{0,20}placed|specific(ally)?.{0,20}not overall|payment.{0,20}(official|portal|where|safe)|is (this|it).{0,10}(a )?(scam|genuine|legit|real|fake|valid))/i,
  },
  {
    key: "job_guarantee_placement",
    re: /(placement.{0,20}(guarantee|assured|assurance|guaranteed|commitment|100%|promise|confirm|written)|guarantee.{0,20}(job|placement|placed)|job.{0,20}(guarantee|assured|assurance)|(just|only).{0,10}(assistance|support).{0,20}(not|or)|actual.{0,10}(placement|opportunity)|is (this|it).{0,10}(assistance|support|placement opportunity)|100%.{0,20}(placement|placed|get.{0,5}job)|eligibility.{0,20}(sit.{0,10}placement|placement)|(highest|average).{0,20}package|non.?tech.{0,20}(placed|background.{0,15}placement)|(placed|placement).{0,20}(non.?tech|background)|can you give.{0,20}figure.{0,20}(non.?tech|placed))/i,
  },
  {
    key: "course_fit_relevance",
    re: /(not.{0,10}technical?.{0,10}background|non.?tech.{0,20}(background|person)|how.{0,20}relate.{0,15}background|design.{0,15}(link|data|relate)|theoretical?.{0,10}(or|vs).{0,10}practical|practical.{0,15}project|already.{0,15}(creat|build|do|making).{0,20}(ai|agentic|project)|what.{0,15}(will i|i will|actually).{0,15}(learn|gain|get)|two.?.?half months.{0,20}enough|add value.{0,20}(resume|cv|switch)|confusion.{0,15}(between|course|program)|which.{0,15}(better|course|program|for me)|live.{0,20}(or|vs).{0,20}recorded)/i,
  },
  {
    key: "language_english",
    re: /(completely.{0,10}english|medium.{0,10}english|english.{0,10}medium|comfortable.{0,15}english|english.{0,15}comfortable|limited.{0,10}english|english.{0,10}hesitant)/i,
  },
  {
    key: "tech_access",
    re: /(tools?.{0,20}(purchase|subscription|free|given|provided|practice)|purchase.{0,20}(subscription|tools?)|chatgpt.{0,20}(limited|access|purchase)|log.{0,15}(into|in).{0,15}(dashboard|portal)|technical.{0,10}issue|camera.{0,15}(not|can'?t|issue|open|mandatory)|connected.{0,15}phone|phone.{0,15}connected|laptop.{0,20}(good|enough|ryzen|required|needed)|access.{0,20}(chatgpt|tools?|limited))/i,
  },
];

const OTHER_RE = /(can'?t afford|cannot afford|think about it|need.{0,10}time|too (much|expensive|costly)|worried|doubt|is (this|it).{0,5}(a )?(scam|genuine)|refund|money.?back|guarantee|no time|too busy|after.{0,10}exam|upsc|government.{0,5}job|next.{0,5}(month|batch)|can i join later|emi|loan|interest)/i;

export function detectObjectionCategory(studentText) {
  if (!studentText || typeof studentText !== "string") return null;
  const text = studentText.trim();
  for (const { key, re } of RULES) {
    if (re.test(text)) return key;
  }
  if (OTHER_RE.test(text)) return "other";
  return null;
}

export function initObjectionState() {
  return [];
}

const PHRASING_MAX = 140;
function truncPhrasing(text) {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > PHRASING_MAX ? t.slice(0, PHRASING_MAX - 1).trimEnd() + "…" : t;
}

export function raiseObjection(state, category, turn, phrasing) {
  if (!category) return;
  const trimmed = truncPhrasing(phrasing);
  const existing = state.find((o) => o.category === category);
  if (existing) {
    existing.timesRaised += 1;
    existing.lastRaisedTurn = turn;
    if (trimmed) existing.lastPhrasing = trimmed;
    if (existing.status === "addressed") {
      existing.status = "open";
      existing.addressedTurn = null;
    }
  } else {
    state.push({
      category,
      status: "open",
      firstRaisedTurn: turn,
      lastRaisedTurn: turn,
      addressedTurn: null,
      timesRaised: 1,
      lastPhrasing: trimmed || null,
    });
  }
}

const RELATED_GROUPS = [
  ["fee", "emi_affordability"],
  ["competing_priorities", "parents_family", "time_commitment"],
  ["job_guarantee_placement", "trust_legitimacy", "course_fit_relevance"],
];

function relatedKeys(category) {
  const out = new Set();
  for (const group of RELATED_GROUPS) {
    if (group.includes(category)) for (const k of group) if (k !== category) out.add(k);
  }
  return out;
}

export function resolveObjection(state, category, turn) {
  if (!category || !Array.isArray(state)) return;

  const exact = state.find((o) => o.category === category);
  if (exact) {
    exact.status = "addressed";
    exact.addressedTurn = turn;
    return;
  }

  const open = state.filter((o) => o.status === "open");
  if (!open.length) return;

  if (category === "other" && open.length === 1) {
    open[0].status = "addressed";
    open[0].addressedTurn = turn;
    return;
  }

  const related = relatedKeys(category);
  if (related.size) {
    const candidates = open
      .filter((o) => related.has(o.category))
      .sort((a, b) => (b.lastRaisedTurn ?? 0) - (a.lastRaisedTurn ?? 0));
    if (candidates.length) {
      candidates[0].status = "addressed";
      candidates[0].addressedTurn = turn;
    }
  }
}

export function openObjections(state) {
  return (state || []).filter((o) => o.status === "open");
}

export function addressedObjections(state) {
  return (state || []).filter((o) => o.status === "addressed");
}

const CATEGORY_LABELS = {
  fee:                   "fee / affordability",
  emi_affordability:     "EMI / monthly payments",
  parents_family:        "parental / family approval",
  time_commitment:       "time commitment / schedule",
  competing_priorities:  "competing priorities / needing time",
  trust_legitimacy:      "trust / legitimacy",
  job_guarantee_placement: "placement / job guarantee",
  course_fit_relevance:  "course fit / relevance",
  language_english:      "language / English comfort",
  tech_access:           "tech access / devices",
  other:                 "general concern",
};

function labelFor(category) {
  return CATEGORY_LABELS[category] || category;
}

export function summarizeForPrompt(state) {
  if (!state || state.length === 0) return "";

  const banClause = (o) =>
    o.lastPhrasing
      ? ` You already said it like this: "${o.lastPhrasing}" — do NOT reuse that phrasing.`
      : "";

  const parts = state.map((o) => {
    const label = labelFor(o.category);
    if (o.status === "addressed") {
      return `${label} (ANSWERED by the counsellor — do not raise it again verbatim; you may accept, ask ONE specific concrete follow-up question, or move on.${banClause(o)})`;
    }
    const timesNote = o.timesRaised >= 2
      ? ` — you have already pressed this ${o.timesRaised} times; you have made your point. If the counsellor has moved on to another topic, FOLLOW them; do NOT bring this up again unless they invite it or it is genuinely unresolved at decision time. Push back on any single concern at most once after a pivot.${banClause(o)}`
      : "";
    return `${label} (still open${timesNote})`;
  });

  const allAddressed = state.every((o) => o.status === "addressed");
  const closingNote = allAddressed
    ? " If the counsellor closes well now, it is okay to agree."
    : "";

  return `Concerns you have raised so far: ${parts.join(", ")}.${closingNote}`;
}

// Varied accent-reminder lines for the mid-call steering block. The standing
// voice prompt sets the Indian-English accent, but over a long call that
// instruction fades from context and the accent drifts to neutral — so a short
// reminder rides along on every steering injection. Phrasing is rotated so it
// never reads as a stuck loop. Rotation is deterministic (no Date.now/random):
// the caller passes a turn-ish index; we mod into the list.
const ACCENT_REMINDERS = [
  "Stay in your natural Indian English accent — syllable-timed, with the light Hinglish rhythm; don't let it drift to neutral.",
  "Keep your Indian-English accent and Hinglish cadence going strong, exactly as you sounded at the start of the call.",
  "Quick reminder: hold your authentic Indian English accent and the occasional Hindi particle — don't flatten out.",
  "Stay grounded in your Indian-English voice and rhythm; pull back to it if you've started sounding neutral.",
];

export function accentReminderLine(seed = 0) {
  const i = Math.abs(Math.trunc(Number(seed) || 0)) % ACCENT_REMINDERS.length;
  return ACCENT_REMINDERS[i];
}

export function steeringSummary(state, turn) {
  const arr = Array.isArray(state) ? state : [];
  if (!arr.length) return "";

  const open = arr.filter((o) => o.status === "open");
  const addressed = arr.filter((o) => o.status === "addressed");
  const lines = [];

  if (open.length) {
    const items = open.map((o) => {
      const base = labelFor(o.category);
      return o.lastPhrasing ? `${base} (do not reuse: "${o.lastPhrasing}")` : base;
    });
    lines.push(`Open concerns: ${items.join("; ")}.`);
    for (const o of open) {
      if (o.timesRaised >= 2) {
        lines.push(`You have raised ${labelFor(o.category)} ${o.timesRaised} times — stop returning to it; if the counsellor changed the subject, follow their lead and engage the new topic, and do not bring it up again unless they invite it.`);
      }
    }
  }
  if (addressed.length) {
    const items = addressed.map((o) => {
      const base = labelFor(o.category);
      return o.lastPhrasing ? `${base} (answered; do not reuse: "${o.lastPhrasing}")` : `${base} (answered)`;
    });
    lines.push(`Answered concerns: ${items.join("; ")}.`);
  }

  // Accent reminder — always included so it is restated every few turns mid-call.
  // Seed defaults to the total raise activity so it still rotates without a turn.
  const seed = Number.isFinite(Number(turn))
    ? Number(turn)
    : arr.reduce((n, o) => n + (o.timesRaised || 0), 0);
  lines.push(accentReminderLine(seed));

  return lines.join("\n");
}
