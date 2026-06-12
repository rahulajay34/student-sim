// Objection lifecycle tracker for counselling sessions.
//
// Responsible for:
//   1. Detecting which objection category a student text belongs to.
//   2. Maintaining per-session objection state (raise / resolve / count).
//   3. Producing a concise prompt fragment that steers the student LLM away
//      from verbatim repetition once an objection has been answered.
//
// Category keys match the seed file (server/data/seed/objections.json).
// Regexes are derived from the real phrasings in that file; they are intentionally
// broad enough to catch Hinglish/mixed-language variants (the corpus is Hinglish).

// ---------------------------------------------------------------------------
// Detection: keyword / regex rules per category
// ---------------------------------------------------------------------------

// Each rule is { key, re } where `re` is tested against the student text
// (case-insensitive). Categories are checked in order; the FIRST match wins.
// Keys mirror the seed file's category keys exactly.

const RULES = [
  {
    // Fee / Affordability
    key: "fee",
    re: /(can'?t afford|cannot afford|fee.{0,20}(too (much|high|expensive|costly))|too (much|expensive|costly|high).{0,20}fee|afford.{0,30}fee|fee.{0,30}afford|middle class.{0,30}(fee|spend|paying)|spending.{0,20}(here|on this).{0,10}difficult|fee.{0,20}problem|fee.{0,20}high|fee.{0,20}lot|pay.{0,20}later|4,?000.{0,20}(now|right now|immediately)|(price|fee|cost).{0,20}different|brochure.{0,20}(fee|price)|scholarship|discount.{0,15}fee)/i,
  },
  {
    // EMI / Monthly Affordability (before generic fee check)
    key: "emi_affordability",
    re: /\bemi\b|no.?cost.?emi|monthly.{0,20}(amount|instalment|installment|pay)|per month|instalment|installment.{0,20}(interest|without)|pay.{0,20}monthly|(two|three|four|five|six|seven|eight|nine|ten|2|3|4|5|6|7|8|9|10).{0,10}(months?|month).{0,20}(emi|pay|instalment)|interest.{0,20}(emi|loan)|(emi|monthly).{0,20}interest/i,
  },
  {
    // Parents / Family Approval (need-to-consult-family)
    key: "parents_family",
    re: /(talk|discuss|speak|check).{0,30}(father|dad|mother|mom|mum|parents|family|husband|wife|spouse|home)|father.{0,20}(not home|not here|away|busy)|(parents|family).{0,20}(agree|agreed|okay|permission|convince|discuss|check|decide|approval)|mom.{0,20}not home|run it through|discuss.{0,10}(internally|with)|husband.{0,20}not home|leverage.{0,20}(decision|own)|first year.{0,20}(decision|own)|can'?t decide.{0,20}own/i,
  },
  {
    // Time Commitment / Schedule
    key: "time_commitment",
    re: /(recorded?.{0,20}(attend|lecture|class|count)|live.{0,20}(miss|can'?t attend|not attend|schedule|timing|clash)|night shift|work.{0,15}(timing|schedule|hours)|office.{0,10}timing|too busy|exam.{0,20}(start|coming|from|clash|10th|conflict)|juggle.{0,10}job|weekend.{0,20}(class|timing|extend)|two.{0,10}(times|classes).{0,10}week|class.{0,20}(wednesday|saturday|sunday|weekday)|can'?t manage.{0,15}time|no time|time.{0,20}manage)/i,
  },
  {
    // Competing Priorities / Need Time to Decide
    key: "competing_priorities",
    re: /(compare.{0,30}(option|place|other|alternative|decision)|inquired.{0,20}(places?|other)|need.{0,20}(time|day|two days|more time|little time).{0,30}(decide|think|finalize|compare|check)|(give me|can you give).{0,20}(day|days|more time|two|three).{0,20}day|(can you give|give me).{0,15}(two|three|more).{0,10}(day|days)|just exploring|won'?t be able.{0,20}(take|manage|right now)|batch.{0,20}(after|later|september|july)|internship.{0,20}clash|promotion.{0,20}focused|pcs exam|upsc.{0,20}(exam|prep)|government.{0,10}(job|exam|prep)|not desperate|summer internship|deadline.{0,20}(operational|fake|tactic)|same day.{0,20}(counselling|course))/i,
  },
  {
    // Trust / Legitimacy
    key: "trust_legitimacy",
    re: /(scam|genuine|legit|fraud|fake|not heard.{0,20}(masai|school|institute)|association.{0,20}(bits|iim|campus)|masai.{0,15}(associated|autonomous|role|what is)|contribution.{0,20}(iim|bits|masai)|check.{0,20}review|verify|demo.{0,20}(class|facility|session)|certificate.{0,20}(value|nothing|fake)|how many.{0,20}placed|specific(ally)?.{0,20}not overall|payment.{0,20}(official|portal|where|safe)|is (this|it).{0,10}(a )?(scam|genuine|legit|real|fake|valid))/i,
  },
  {
    // Job Guarantee / Placement Assurance
    key: "job_guarantee_placement",
    re: /(placement.{0,20}(guarantee|assured|assurance|guaranteed|commitment|100%|promise|confirm|written)|guarantee.{0,20}(job|placement|placed)|job.{0,20}(guarantee|assured|assurance)|(just|only).{0,10}(assistance|support).{0,20}(not|or)|actual.{0,10}(placement|opportunity)|is (this|it).{0,10}(assistance|support|placement opportunity)|100%.{0,20}(placement|placed|get.{0,5}job)|eligibility.{0,20}(sit.{0,10}placement|placement)|(highest|average).{0,20}package|non.?tech.{0,20}(placed|background.{0,15}placement)|(placed|placement).{0,20}(non.?tech|background)|can you give.{0,20}figure.{0,20}(non.?tech|placed))/i,
  },
  {
    // Course Fit / Relevance
    key: "course_fit_relevance",
    re: /(not.{0,10}technical?.{0,10}background|non.?tech.{0,20}(background|person)|how.{0,20}relate.{0,15}background|design.{0,15}(link|data|relate)|theoretical?.{0,10}(or|vs).{0,10}practical|practical.{0,15}project|already.{0,15}(creat|build|do|making).{0,20}(ai|agentic|project)|what.{0,15}(will i|i will|actually).{0,15}(learn|gain|get)|two.?.?half months.{0,20}enough|add value.{0,20}(resume|cv|switch)|confusion.{0,15}(between|course|program)|which.{0,15}(better|course|program|for me)|live.{0,20}(or|vs).{0,20}recorded)/i,
  },
  {
    // Language / English Comfort
    key: "language_english",
    re: /(completely.{0,10}english|medium.{0,10}english|english.{0,10}medium|comfortable.{0,15}english|english.{0,15}comfortable|limited.{0,10}english|english.{0,10}hesitant)/i,
  },
  {
    // Tech Access / Devices & Tools
    key: "tech_access",
    re: /(tools?.{0,20}(purchase|subscription|free|given|provided|practice)|purchase.{0,20}(subscription|tools?)|chatgpt.{0,20}(limited|access|purchase)|log.{0,15}(into|in).{0,15}(dashboard|portal)|technical.{0,10}issue|camera.{0,15}(not|can'?t|issue|open|mandatory)|connected.{0,15}phone|phone.{0,15}connected|laptop.{0,20}(good|enough|ryzen|required|needed)|access.{0,20}(chatgpt|tools?|limited))/i,
  },
];

// Fallback: anything matching the broader objection signal from phases.js that
// did not match a specific category gets labelled "other".
const OTHER_RE = /(can'?t afford|cannot afford|think about it|need.{0,10}time|too (much|expensive|costly)|worried|doubt|is (this|it).{0,5}(a )?(scam|genuine)|refund|money.?back|guarantee|no time|too busy|after.{0,10}exam|upsc|government.{0,5}job|next.{0,5}(month|batch)|can i join later|emi|loan|interest)/i;

/**
 * Detect the objection category present in a piece of student text.
 *
 * @param {string} studentText
 * @returns {string|null} Category key from the seed file, or null if no
 *   objection detected.
 */
export function detectObjectionCategory(studentText) {
  if (!studentText || typeof studentText !== "string") return null;
  const text = studentText.trim();
  for (const { key, re } of RULES) {
    if (re.test(text)) return key;
  }
  if (OTHER_RE.test(text)) return "other";
  return null;
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Initialise a fresh objection-state array for a new session.
 *
 * @returns {Array}
 */
export function initObjectionState() {
  return [];
}

// Truncate the student's actual sentence to ~140 chars for storage as the
// objection's lastPhrasing (so the prompt can quote it and ban its reuse without
// bloating the prompt).
const PHRASING_MAX = 140;
function truncPhrasing(text) {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > PHRASING_MAX ? t.slice(0, PHRASING_MAX - 1).trimEnd() + "…" : t;
}

/**
 * Record that a student has raised an objection of the given category.
 *
 * Rules:
 *  - If an objection of this category is already `open`, DO NOT create a
 *    duplicate; instead bump its `timesRaised` counter and update `lastRaisedTurn`.
 *  - If an objection was previously `addressed`, also bump `timesRaised` and
 *    reset it to `open` (the counsellor's answer was insufficient — the objection
 *    is alive again) AND update `lastRaisedTurn`.
 *  - If the category has never been seen, push a new entry with `timesRaised: 1`.
 *  - When `phrasing` (the student's actual sentence) is supplied, store it
 *    truncated as `lastPhrasing` so the student prompt can quote it and forbid
 *    reusing the same wording (the anti-loop fix). Omitting it leaves the prior
 *    lastPhrasing in place (backward-compatible 3-arg call).
 *
 * @param {Array} state   The array returned by initObjectionState (mutated in place).
 * @param {string} category
 * @param {number} turn   Transcript turn index (0-based).
 * @param {string} [phrasing] The student's actual sentence raising this concern.
 * @returns {void}
 */
export function raiseObjection(state, category, turn, phrasing) {
  if (!category) return;
  const trimmed = truncPhrasing(phrasing);
  const existing = state.find((o) => o.category === category);
  if (existing) {
    existing.timesRaised += 1;
    existing.lastRaisedTurn = turn;
    if (trimmed) existing.lastPhrasing = trimmed;
    // Re-open if the counsellor's answer did not permanently defuse it.
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

// Related-category groups. The scorer LLM (which reads the raw transcript) and
// detectObjectionCategory (which keyword-matches the student text) frequently
// disagree on the exact key for the SAME underlying concern — e.g. a "I can't
// pay without a placement guarantee and refund window" line is tracked as
// parents_family/fee by the regexes but scored as job_guarantee_placement. These
// groups let resolveObjection() defuse a sibling open objection when no exact
// match exists, so the addressed-objection loop actually closes.
// (#22) Groups intentionally SPLIT so addressing a money concern (fee/EMI) does
// NOT auto-close need-time/parents/schedule concerns (and vice versa).
// Exact-match resolve is unchanged; only the sibling fuzzy-close path uses these.
const RELATED_GROUPS = [
  // Money concerns cluster together (fee ↔ EMI affordability only).
  ["fee", "emi_affordability"],
  // Need-time / family / schedule cluster (no longer joined with fee/EMI).
  ["competing_priorities", "parents_family", "time_commitment"],
  // Trust / quality cluster.
  ["job_guarantee_placement", "trust_legitimacy", "course_fit_relevance"],
  // NOTE: tech_access and language_english were once grouped with
  // course_fit_relevance, which made answering a laptop/tools or
  // English-instruction question silently resolve the unrelated
  // "is this right for my background?" concern. They stand alone now.
];

function relatedKeys(category) {
  const out = new Set();
  for (const group of RELATED_GROUPS) {
    if (group.includes(category)) for (const k of group) if (k !== category) out.add(k);
  }
  return out;
}

/**
 * Mark an open objection as addressed (answered by the counsellor).
 *
 * Matching strategy (first hit wins), so a key disagreement between the scorer
 * and detectObjectionCategory does not strand an open concern forever:
 *   1. Exact category match.
 *   2. If the scorer says "other", the single open objection (if exactly one).
 *   3. A related/sibling open objection (RELATED_GROUPS), most-recently-raised first.
 * Only OPEN objections are eligible; already-addressed ones are left untouched.
 *
 * @param {Array} state
 * @param {string} category
 * @param {number} turn   Turn index of the counsellor's reply.
 * @returns {void}
 */
export function resolveObjection(state, category, turn) {
  if (!category || !Array.isArray(state)) return;

  // 1. Exact match (open or already-addressed — re-affirming an addressed one is fine).
  const exact = state.find((o) => o.category === category);
  if (exact) {
    exact.status = "addressed";
    exact.addressedTurn = turn;
    return;
  }

  const open = state.filter((o) => o.status === "open");
  if (!open.length) return; // Nothing open to resolve.

  // 2. "other" from the scorer with a single open concern -> resolve that one.
  if (category === "other" && open.length === 1) {
    open[0].status = "addressed";
    open[0].addressedTurn = turn;
    return;
  }

  // 3. A related/sibling open objection, preferring the most recently raised.
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

/**
 * Return all objection entries currently in the 'open' state.
 *
 * @param {Array} state
 * @returns {Array}
 */
export function openObjections(state) {
  return (state || []).filter((o) => o.status === "open");
}

/**
 * Return all objection entries that have been marked 'addressed'.
 *
 * @param {Array} state
 * @returns {Array}
 */
export function addressedObjections(state) {
  return (state || []).filter((o) => o.status === "addressed");
}

// ---------------------------------------------------------------------------
// Prompt fragment
// ---------------------------------------------------------------------------

// Human-readable labels for the prompt fragment (matches seed file labels).
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

/**
 * Produce a short prompt fragment describing the current objection state.
 * This is injected into the student system prompt so the LLM knows which
 * concerns have been answered and stops repeating them verbatim.
 *
 * Format:
 *   "Concerns you have raised: <concern A> (ANSWERED by the counsellor — do not
 *   repeat it; accept, ask ONE specific follow-up, or move on), <concern B> (still
 *   open — you have already said this N times; vary your wording or escalate/
 *   de-escalate). If ALL your concerns are answered and the counsellor closes well,
 *   it is okay to agree."
 *
 * Returns "" when state is empty (no objections yet).
 *
 * @param {Array} state
 * @returns {string}
 */
export function summarizeForPrompt(state) {
  if (!state || state.length === 0) return "";

  // The explicit phrasing-ban clause, used for addressed concerns and for open
  // concerns raised 2+ times. Quotes the student's own last sentence so the model
  // cannot recycle it word-for-word.
  const banClause = (o) =>
    o.lastPhrasing
      ? ` You already said it like this: "${o.lastPhrasing}" — do NOT reuse that phrasing.`
      : "";

  const parts = state.map((o) => {
    const label = labelFor(o.category);
    if (o.status === "addressed") {
      return `${label} (ANSWERED by the counsellor — do not raise it again verbatim; you may accept, ask ONE specific concrete follow-up question, or move on.${banClause(o)})`;
    }
    // Open objection — loop-break nudge once it has been raised 2+ times.
    const timesNote = o.timesRaised >= 2
      ? ` — you have raised this ${o.timesRaised} times already; do NOT repeat the same wording; either escalate your doubt with new specifics or shift to a different concern.${banClause(o)}`
      : "";
    return `${label} (still open${timesNote})`;
  });

  const allAddressed = state.every((o) => o.status === "addressed");
  const closingNote = allAddressed
    ? " If the counsellor closes well now, it is okay to agree."
    : "";

  return `Concerns you have raised so far: ${parts.join(", ")}.${closingNote}`;
}

// steeringSummary(state) — a compact, plain-text summary (1-4 lines) for the
// realtime mid-call steering block (contract C2). Lists the OPEN concerns and the
// ANSWERED concerns, quoting each one's banned phrasing so the voice model does
// not recycle the exact same sentence. Returns "" when nothing has been raised.
export function steeringSummary(state) {
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
  }
  if (addressed.length) {
    const items = addressed.map((o) => {
      const base = labelFor(o.category);
      return o.lastPhrasing ? `${base} (answered; do not reuse: "${o.lastPhrasing}")` : `${base} (answered)`;
    });
    lines.push(`Answered concerns: ${items.join("; ")}.`);
  }

  return lines.join("\n");
}
