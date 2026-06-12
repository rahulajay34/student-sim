// node --test server/tests/prompt-phase-scope.test.mjs
//
// Unit tests for WS4 — phase-scoping the student system prompt to cut size/
// latency. Asserts that phase-only-relevant content (the mined objection list,
// the course FAQ topics, the Hinglish register exemplars) is omitted in the
// early phases and present once the programme is being discussed/negotiated,
// while the prompt stays coherent (always ends with the emotion tag) in every
// phase.
//
// No network or LLM calls; pure prompt composition (prompt-config.json import
// is fail-soft to built-in defaults).

import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "../prompt.js";

const PERSONA = {
  label: "a recent graduate",
  category: "graduate",
  coreAnxiety: "Will this actually get me a job?",
  behaviourPrompt: "Be cautious about money and ask about placements.",
};
const SCENARIO = { title: "Standard mock", difficulty: "medium" };
const COURSE = {
  name: "Business Analytics",
  institute: "IIM Ranchi",
  faqQuestions: ["What is the placement rate?", "Are there EMI options?"],
};

const OBJ_MARKER = "OBJECTIONS YOU GENUINELY HOLD";
const FAQ_MARKER = "TOPICS REAL PROSPECTS ASK ABOUT";
const REGREF_MARKER = "LINES REAL STUDENTS SAID AT THIS EXACT STAGE";
const FULL_LADDER_A = "Phase 2 — Discovery:";
const FULL_LADDER_B = "Phase 5 — Close:";

function prompt(phase) {
  return buildSystemPrompt(PERSONA, SCENARIO, phase, 50, COURSE);
}

// ── (a) Phase 1 (Opening): objection list + FAQ omitted ──────────────────────

test("phase 1 prompt does NOT contain the objection list", () => {
  assert.equal(prompt(1).includes(OBJ_MARKER), false);
});

test("phase 1 prompt does NOT contain the course FAQ topics", () => {
  assert.equal(prompt(1).includes(FAQ_MARKER), false);
});

test("phase 1 prompt does NOT contain the Hinglish register exemplars", () => {
  assert.equal(prompt(1).includes(REGREF_MARKER), false);
});

test("phase 2 (Discovery) still omits the objection list and FAQ", () => {
  const p = prompt(2);
  assert.equal(p.includes(OBJ_MARKER), false, "no objection list in Discovery");
  assert.equal(p.includes(FAQ_MARKER), false, "no FAQ topics in Discovery");
});

// ── (b) Phase 4 (Objections): objection list + FAQ present ───────────────────

test("phase 4 prompt DOES contain the objection list", () => {
  assert.equal(prompt(4).includes(OBJ_MARKER), true);
});

test("phase 4 prompt DOES contain the course FAQ topics", () => {
  assert.equal(prompt(4).includes(FAQ_MARKER), true);
});

test("phase 3 (Presentation) is the earliest phase with objection list + FAQ", () => {
  const p = prompt(3);
  assert.equal(p.includes(OBJ_MARKER), true, "objection list present from phase 3");
  assert.equal(p.includes(FAQ_MARKER), true, "FAQ topics present from phase 3");
});

// ── Compact phase ladder: the full 5-phase ladder no longer appears ──────────

test("no phase injects the full 5-phase ladder", () => {
  for (const phase of [1, 2, 3, 4, 5]) {
    const p = prompt(phase);
    const hasFull = p.includes(FULL_LADDER_A) && p.includes(FULL_LADDER_B);
    assert.equal(hasFull, false, `phase ${phase} should not contain the full ladder`);
  }
});

test("non-final phases include a single next-phase pointer; phase 5 does not", () => {
  for (const phase of [1, 2, 3, 4]) {
    assert.match(prompt(phase), /Next \(do NOT jump ahead\): Phase \d+ —/, `phase ${phase} should point at the next phase`);
  }
  assert.doesNotMatch(prompt(5), /Next \(do NOT jump ahead\):/, "phase 5 (Close) has no next pointer");
});

// ── Register exemplars only in middle phases (2-4) ───────────────────────────

test("register exemplars appear in phases 2-5 (skipped only in 1)", () => {
  // Phase 1 (just a self-intro) still skips the register reference; phases 2-5 now
  // carry it — phases 2-4 mix mined voice-bank lines with style exemplars, and
  // phase 5 (Close) surfaces the close-response style exemplars.
  assert.equal(prompt(1).includes(REGREF_MARKER), false, "phase 1 skips register ref");
  for (const phase of [2, 3, 4, 5]) {
    assert.equal(prompt(phase).includes(REGREF_MARKER), true, `phase ${phase} includes register ref`);
  }
});

// ── Coherence: every phase prompt still ends with the emotion-tag instruction ─

test("every phase prompt still ends with the EMOTION TAG instruction", () => {
  for (const phase of [1, 2, 3, 4, 5]) {
    const p = prompt(phase);
    assert.match(p.trimEnd(), /\[emotion:X\][^]*$/, `phase ${phase} should retain the emotion tag block`);
    // The emotion-tag block is the tail when there is no per-turn hint (turnHint=null).
    assert.ok(p.trimEnd().lastIndexOf("EMOTION TAG") > p.length - 600, `phase ${phase} emotion block near the end`);
  }
});

// ── Size: early-phase prompts are smaller than negotiation-phase prompts ──────

test("phase 1 prompt is smaller than the phase 4 prompt (scope trimming works)", () => {
  assert.ok(prompt(1).length < prompt(4).length, "phase 1 should be smaller than phase 4");
});
