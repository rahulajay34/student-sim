// Spoken English Fluency judge (Tier 1).
//
// Claude grades the counsellor's spoken English from the VERBATIM Whisper
// transcript (fillers/false-starts intact) + deterministic timing metrics
// (fluencyMetrics.js) — NOT the cleaned Realtime transcript, which hides exactly
// the hesitation/grammar evidence we want. Pronunciation/prosody are out of scope
// for Tier 1 (the model reads text + metrics, it does not hear audio).
//
// Mirrors the report.js call pattern: a schema-enforced reasoning call, a test
// seam (_setChatForTests), pure prompt/assembly so they can be unit-tested.

// NB: llm.js is imported LAZILY inside judgeFluency (dynamic import) so the pure
// helpers below (buildFluencyPrompt / assembleFluency / schema) can be unit-tested
// under node without pulling the Anthropic SDK.

export const FLUENCY_PARAMS = [
  { key: "fluency", label: "Fluency & flow (pace, smoothness)" },
  { key: "hesitation", label: "Hesitation control (fillers, getting stuck)" },
  { key: "grammar", label: "Grammatical accuracy" },
  { key: "lexical", label: "Vocabulary range & appropriateness" },
  { key: "coherence", label: "Coherence (followable, well-organised)" },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

export const FLUENCY_SCHEMA = {
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
    headline: { type: "string" },
    cefr: { type: "string" },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          issue: { type: "string" },
        },
        required: ["quote", "issue"],
        additionalProperties: false,
      },
    },
  },
  required: ["parameters", "headline", "examples"],
  additionalProperties: false,
};

const SYSTEM = `You are an expert spoken-English assessor coaching sales counsellors at an Indian edtech company. You grade how FLUENTLY and CONFIDENTLY the counsellor speaks English, from a verbatim transcript plus objective speech metrics.

FAIRNESS — read first: Most counsellors are Indian / ESL speakers. Judge INTELLIGIBILITY and FLUENCY, never accent or dialect. Indian-English vocabulary, phrasing, and a non-native accent are NOT errors. Do not reward sounding "American/British". Penalise only things that genuinely impede communication: heavy hesitation, frequent grammar errors that obscure meaning, losing the thread. If a stretch looks like transcription noise/garble rather than real speech, ignore it (do not penalise).`;

const SCALE = `Score EACH parameter 0–5:
  5 = consistently strong; speaks smoothly and confidently.
  4 = good, clearly above adequate.
  3 = competent / adequate — THE DEFAULT for a normal working counsellor. Minor fillers, an occasional grammar slip, or a brief pause do NOT pull below 3.
  2 = a real, recurring weakness on this dimension that affects communication.
  1 = barely functional on this dimension.
  0 = absent / unintelligible.
A typical competent counsellor averages ~3.3–3.6. Do not cluster at 2.`;

// Render the deterministic metrics as compact grounding for the judge.
function metricsBlock(m) {
  if (!m) return "(metrics unavailable)";
  const lines = [
    `words spoken: ${m.wordCount}`,
    m.wpm != null ? `speech rate: ${m.wpm} wpm (within-utterance)` : null,
    m.articulationRatePerSec != null ? `articulation rate: ${m.articulationRatePerSec} words/sec of speech` : null,
    m.longPauseCount != null ? `long mid-speech pauses (>0.6s): ${m.longPauseCount}${m.meanPauseSec ? ` (avg ${m.meanPauseSec}s)` : ""}` : null,
    m.meanLengthOfRunWords != null ? `mean length of run: ${m.meanLengthOfRunWords} words between pauses (higher = more fluent)` : null,
    `filled pauses (um/uh/er): ${m.filledPauseCount} (${m.filledPauseRatePer100}/100 words)`,
    `discourse-marker crutches (you know / i mean / like): ${m.discourseMarkerCount} (${m.discourseMarkerRatePer100}/100 words)`,
    `repetitions / false starts: ${m.repairCount} (${m.repairRatePer100}/100 words)`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildFluencyPrompt(verbatimText, metrics, session) {
  const p = session?.personaSnapshot || {};
  const learner = [p.label ? `persona: ${p.label}` : null].filter(Boolean).join(" · ");
  const schemaLine = `Output schema: { "parameters":[{"key":"<one of: ${FLUENCY_PARAMS.map((x) => x.key).join(", ")}>","score":0-5,"summary":"<one call-specific sentence>"}] (exactly 5), "headline":"<one coaching sentence>", "cefr":"<A2|B1|B2|C1|C2 estimate>", "examples":[{"quote":"<short verbatim quote from the counsellor>","issue":"<what it shows: hesitation/grammar/filler/repair>"}] (2-3, [] if none) }`;

  const user = `Grade the COUNSELLOR's spoken English fluency for one mock counselling call.${learner ? `\n(${learner})` : ""}

${SCALE}

OBJECTIVE SPEECH METRICS (computed from word timings — your scores must be consistent with these):
${metricsBlock(metrics)}

THE 5 PARAMETERS:
${FLUENCY_PARAMS.map((x) => `- ${x.key}: ${x.label}`).join("\n")}

VERBATIM TRANSCRIPT of the counsellor's speech (un-cleaned — fillers, false starts and repetitions are intentionally preserved; quote from this for examples):
=== START ===
${verbatimText || "(no speech captured)"}
=== END ===

${schemaLine}`;

  return { system: SYSTEM, user };
}

// Assemble the final fluency object: 5 parameters (0–5), overall scaled to /100,
// headline, CEFR estimate, examples, and the raw metrics for transparency.
export function assembleFluency(raw, metrics) {
  const byKey = new Map((Array.isArray(raw?.parameters) ? raw.parameters : []).map((p) => [p.key, p]));
  const parameters = FLUENCY_PARAMS.map(({ key, label }) => {
    const p = byKey.get(key) || {};
    return {
      key,
      label,
      score: clamp(p.score ?? 0, 0, 5),
      summary: typeof p.summary === "string" ? p.summary : "",
    };
  });
  const sum = parameters.reduce((n, p) => n + p.score, 0);
  const overall = Math.round((sum / (FLUENCY_PARAMS.length * 5)) * 100);
  const examples = (Array.isArray(raw?.examples) ? raw.examples : []).slice(0, 3).map((e) => ({
    quote: typeof e.quote === "string" ? e.quote : "",
    issue: typeof e.issue === "string" ? e.issue : "",
  }));
  return {
    overall,
    parameters,
    headline: typeof raw?.headline === "string" ? raw.headline : "",
    cefr: typeof raw?.cefr === "string" ? raw.cefr : null,
    examples,
    metrics: metrics || null,
  };
}

/**
 * judgeFluency(verbatimText, metrics, session, usageMeta?)
 * Runs the schema-enforced reasoning call and returns the assembled fluency object.
 * Throws on LLM failure (caller decides how to handle).
 */
export async function judgeFluency(verbatimText, metrics, session, usageMeta) {
  const { chat, DETERMINISTIC_SAMPLING, extractJson } = await import("./llm.js");
  const { system, user } = buildFluencyPrompt(verbatimText, metrics, session);
  const raw = await chat(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { ...DETERMINISTIC_SAMPLING, mode: "reasoning", effort: "low", timeoutMs: 90_000, maxRetries: 1, jsonSchema: FLUENCY_SCHEMA, ...(usageMeta ? { usage: usageMeta } : {}) },
  );
  return assembleFluency(extractJson(raw), metrics);
}
