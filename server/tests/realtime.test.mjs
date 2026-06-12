// node --test server/tests/realtime.test.mjs
//
// Unit tests for Task W2-S (realtime server — OpenAI-only + voice-first prompt):
//   - buildRealtimeInstructions is a VOICE-FIRST prompt under the size budget,
//     carries the C6 language policy + the VOICE DELIVERY block, and exposes NO
//     text-pipeline artifacts (no [emotion tags, no THRESHOLD, no /100 score).
//   - the eight required sections are present and ordered.
//   - voice resolution (gender-mapped marin/cedar + explicit override) is correct.
//   - no ElevenLabs symbols leak out of realtime.js.
//
// Pure composition — no network or LLM calls.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRealtimeInstructions,
  normalizeOpenAIVoice,
  openAIVoiceForSession,
  OPENAI_DEFAULT_VOICE_FEMALE,
  OPENAI_DEFAULT_VOICE_MALE,
  OPENAI_REALTIME_MODEL,
  REALTIME_FIRST_MESSAGE,
} from "../realtime.js";
import * as realtime from "../realtime.js";
import { LANGUAGE_POLICY } from "../prompt.js";

function sampleSession(overrides = {}) {
  return {
    id: "ses_test_abc",
    currentPhase: 3,
    satisfactionScore: 55,
    leadCard: {
      name: "Priya", gender: "female", age: 24,
      occupation: "Sales associate", education: "B.Com graduate", city: "Pune",
    },
    personaSnapshot: {
      label: "A working professional unsure about switching.",
      coreAnxiety: "wasting money on something that does not lead to a job",
      category: "working-professional", voiceName: "Priya", voiceGender: "female",
      personality: { skepticism: 4 },
    },
    scenarioSnapshot: {
      title: "Fee-sensitive switcher", difficulty: "hard",
      situation: "You just heard the fees and they feel high.",
      contextNotes: "You support family financially.", pushiness: 4, hesitancy: 4,
    },
    courseSnapshot: {
      name: "Business Analytics and AI", institute: "IIM Ranchi",
      duration: "6 months", format: "Online", feeBooking: 4000,
    },
    objectionState: [
      { category: "fee", status: "open", timesRaised: 2, lastPhrasing: "the fees are a bit much for me" },
      { category: "job_guarantee_placement", status: "addressed", timesRaised: 1, lastPhrasing: "is placement guaranteed" },
    ],
    scoreHistory: [
      { turn: 0, score: 50, adjustment: 0 }, { turn: 1, score: 53, adjustment: 3 },
      { turn: 2, score: 50, adjustment: -3 }, { turn: 3, score: 55, adjustment: 5 },
    ],
    ...overrides,
  };
}

test("S2: realtime prompt is under the 9500-char budget", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(out.length < 9500, `expected < 9500 chars, got ${out.length}`);
  assert.ok(out.length > 1000, "prompt should not be empty/degenerate");
});

test("S2: realtime prompt has NO text-pipeline artifacts", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(!/\[emotion/i.test(out), "must not contain an [emotion tag");
  assert.ok(!/THRESHOLD/.test(out), "must not contain THRESHOLD");
  assert.ok(!out.includes("/100"), "must not expose a /100 score");
  // No bare numeric score band exposure to the student.
  assert.ok(!/satisfaction score/i.test(out), "must not mention a satisfaction score");
});

test("S2: realtime prompt carries the C6 language policy + VOICE DELIVERY block", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(out.includes(LANGUAGE_POLICY), "language policy must appear verbatim");
  assert.ok(out.includes("VOICE DELIVERY"), "VOICE DELIVERY block must be present");
  // Real numbers from the research doc, baked in (not read at runtime). The pace
  // band is the deliberately-slow 90–115 wpm the VOICE DELIVERY block specifies.
  assert.ok(/90.?115 words per minute/.test(out), "VOICE DELIVERY should carry the WPM band");
});

test("S2: the eight required sections are present and ordered", () => {
  const out = buildRealtimeInstructions(sampleSession());
  const markers = [
    "You ARE Priya",              // (1) character framing
    "WHO YOU ARE:",               // (2)
    "YOUR SITUATION:",            // (3)
    "WHAT YOU KNOW",              // (4) knowledge bounds
    "HOW YOU FEEL RIGHT NOW:",    // (5) disposition + objections
    "LANGUAGE:",                  // (6)
    "VOICE DELIVERY",             // (7)
    "CONVERSATION RULES:",        // (8)
  ];
  let last = -1;
  for (const m of markers) {
    const idx = out.indexOf(m);
    assert.ok(idx >= 0, `missing section marker: ${m}`);
    assert.ok(idx > last, `section out of order: ${m}`);
    last = idx;
  }
});

test("S2: turn-length 10-30 words + no-emotion-label rules are present", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(/10 to 30/.test(out), "should state the 10-30 word target");
  assert.ok(/NO emotion labels/i.test(out), "should forbid emotion labels in speech");
});

test("S2: HOW YOU SOUND injects >= 5 exemplar lines for the phase", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(out.includes("HOW YOU SOUND"), "HOW YOU SOUND section must be present");
  // Count bulleted exemplar lines inside the HOW YOU SOUND block (before the
  // antiPatterns "NEVER do these" sub-list).
  const idx = out.indexOf("HOW YOU SOUND");
  const block = out.slice(idx, out.indexOf("CONVERSATION RULES"));
  const head = block.split("NEVER do these")[0];
  const exemplarCount = (head.match(/^- "/gm) || []).length;
  assert.ok(exemplarCount >= 5, `expected >= 5 exemplar lines, got ${exemplarCount}`);
});

test("S2: ma'am address renders in HOW YOU SOUND when session.counsellorAddress is ma'am", () => {
  const out = buildRealtimeInstructions(sampleSession({ counsellorAddress: "ma'am" }));
  const idx = out.indexOf("HOW YOU SOUND");
  const block = out.slice(idx, out.indexOf("CONVERSATION RULES"));
  const head = block.split("NEVER do these")[0];
  assert.ok(/ma'am/i.test(head), "exemplar lines should render the ma'am address term");
  assert.ok(!/\bsir\b/i.test(head), "no standalone 'sir' should survive ma'am rendering");
});

test("S2: open + answered objections steer the prompt with banned phrasing", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(out.includes("the fees are a bit much for me"), "open objection phrasing should be quoted/banned");
  assert.ok(/ANSWERED/.test(out), "addressed objection should be flagged answered");
});

test("S2: leadCard facts (age/occupation/city) flow into WHO YOU ARE", () => {
  const out = buildRealtimeInstructions(sampleSession());
  assert.ok(out.includes("24 years old"), "age should appear");
  assert.ok(out.includes("Pune"), "city should appear");
  assert.ok(out.includes("Sales associate"), "occupation should appear");
});

test("S2: fails soft for a malformed/empty session", () => {
  for (const bad of [null, undefined, {}, { id: "x" }, 42]) {
    const out = buildRealtimeInstructions(bad);
    assert.equal(typeof out, "string");
    assert.ok(out.length > 100, "should still produce a usable prompt");
    assert.ok(out.includes("VOICE DELIVERY"));
    assert.ok(out.includes(LANGUAGE_POLICY));
  }
});

test("S3: voice resolution — gender-mapped defaults + explicit override", () => {
  assert.equal(openAIVoiceForSession({ leadCard: { gender: "female" } }), OPENAI_DEFAULT_VOICE_FEMALE);
  assert.equal(openAIVoiceForSession({ leadCard: { gender: "male" } }), OPENAI_DEFAULT_VOICE_MALE);
  // Persona-snapshot gender fallback.
  assert.equal(openAIVoiceForSession({ personaSnapshot: { voiceGender: "male" } }), OPENAI_DEFAULT_VOICE_MALE);
  // Explicit live override wins.
  assert.equal(openAIVoiceForSession({ leadCard: { gender: "female" } }, "cedar"), "cedar");
  // Unknown gender defaults to the female voice.
  assert.equal(openAIVoiceForSession({}), OPENAI_DEFAULT_VOICE_FEMALE);
});

test("S3: normalizeOpenAIVoice keeps valid voices, sentinels the rest to auto", () => {
  assert.equal(normalizeOpenAIVoice("marin"), "marin");
  assert.equal(normalizeOpenAIVoice("CEDAR"), "cedar");
  assert.equal(normalizeOpenAIVoice("bogus"), "auto");
  assert.equal(normalizeOpenAIVoice(""), "auto");
  assert.equal(normalizeOpenAIVoice(undefined), "auto");
});

test("S1: realtime.js exports NO ElevenLabs symbols", () => {
  const banned = [
    "createElevenLabsAgent", "ensureElevenLabsAgent", "getElevenLabsConversationToken",
    "elevenLabsOverridesFor", "elevenLabsVoiceForSession",
  ];
  for (const name of banned) {
    assert.equal(realtime[name], undefined, `realtime.js should not export ${name}`);
  }
});

test("S3: defaults are the GA realtime model + non-empty first message contract", () => {
  assert.ok(typeof OPENAI_REALTIME_MODEL === "string" && OPENAI_REALTIME_MODEL.length);
  // Counsellor opens the call → the student never greets first.
  assert.equal(REALTIME_FIRST_MESSAGE, "");
});
