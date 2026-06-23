// node --test server/tests/fluency.test.mjs
// Tests the PURE fluency helpers from the Supabase lib (no SDK / network).
import test from "node:test";
import assert from "node:assert/strict";

import { computeFluencyMetrics } from "../../supabase/functions/_shared/lib/fluencyMetrics.js";
import { assembleFluency, buildFluencyPrompt, FLUENCY_PARAMS } from "../../supabase/functions/_shared/lib/fluency.js";

// Build a simple word list at a steady cadence.
function words(list) {
  // list: [word, start, end]
  return list.map(([word, start, end]) => ({ word, start, end }));
}

test("metrics: wpm, articulation, fillers, repairs from word timings", () => {
  // 6 words across one utterance, ~0.5s each, no long pauses.
  const w = words([
    ["Hello", 0.0, 0.4], ["sir", 0.5, 0.9], ["I", 1.0, 1.2],
    ["um", 1.3, 1.6], ["want", 1.7, 2.0], ["want", 2.1, 2.4],
  ]);
  const m = computeFluencyMetrics(w, "Hello sir I um want want", 30);
  assert.equal(m.wordCount, 6);
  assert.equal(m.hasWordTimings, true);
  assert.equal(m.filledPauseCount, 1);          // "um"
  assert.equal(m.repairCount, 1);               // "want want"
  assert.ok(m.wpm > 0, "wpm computed from speaking time, not 30s wall clock");
  assert.ok(m.articulationRatePerSec > 0);
  assert.equal(m.longPauseCount, 0);            // all gaps < 0.6s
});

test("metrics: long mid-utterance pause is counted, between-turn gap is not", () => {
  const w = words([
    ["I", 0.0, 0.3], ["think", 0.4, 0.8],
    ["maybe", 2.0, 2.4],                 // 1.2s gap within an utterance (>0.6 long, <2.0 not a turn break)
    ["yes", 60.0, 60.4],                 // 57.6s gap → new utterance (student spoke), NOT a pause
  ]);
  const m = computeFluencyMetrics(w, "I think maybe yes", 120);
  assert.equal(m.longPauseCount, 1, "only the 1.2s within-utterance gap counts");
});

test("metrics: text-only fallback (no timings) still counts fillers/repairs", () => {
  const m = computeFluencyMetrics([], "uh so so basically like you know it works", 0);
  assert.equal(m.hasWordTimings, false);
  assert.equal(m.wpm, null);
  assert.equal(m.filledPauseCount, 1);          // "uh"
  assert.equal(m.discourseMarkerCount >= 2, true); // "like", "you know"
  assert.equal(m.repairCount, 1);               // "so so"
  assert.ok(m.wordCount > 0);
});

test("assembleFluency: overall = sum/25*100, clamps, fills missing params, attaches metrics", () => {
  const metrics = { wordCount: 100, wpm: 120 };
  const out = assembleFluency({
    parameters: [
      { key: "fluency", score: 4, summary: "smooth" },
      { key: "hesitation", score: 9, summary: "clamped" }, // >5 → clamp to 5
      { key: "grammar", score: 3, summary: "ok" },
      // lexical omitted → defaults to 0
      { key: "coherence", score: 3, summary: "followable" },
    ],
    headline: "Work on filler words.",
    cefr: "B2",
    examples: [{ quote: "um so the the fee", issue: "filler + repetition" }],
  }, metrics);

  assert.equal(out.parameters.length, FLUENCY_PARAMS.length); // exactly 5, fixed order
  const byKey = Object.fromEntries(out.parameters.map((p) => [p.key, p.score]));
  assert.equal(byKey.hesitation, 5);   // clamped
  assert.equal(byKey.lexical, 0);      // missing → 0
  // sum = 4+5+3+0+3 = 15 → 15/25*100 = 60
  assert.equal(out.overall, 60);
  assert.equal(out.cefr, "B2");
  assert.equal(out.examples.length, 1);
  assert.equal(out.metrics, metrics);
});

test("buildFluencyPrompt: includes verbatim transcript, metrics, and a fairness guardrail", () => {
  const { system, user } = buildFluencyPrompt("um hello sir", { wordCount: 3, wpm: 90, filledPauseCount: 1, filledPauseRatePer100: 33, discourseMarkerCount: 0, discourseMarkerRatePer100: 0, repairCount: 0, repairRatePer100: 0 }, { personaSnapshot: { label: "anxious switcher" } });
  assert.match(system, /accent/i);                 // fairness: don't penalise accent
  assert.match(user, /um hello sir/);              // verbatim included
  assert.match(user, /90 wpm/);                    // metrics grounding included
});
