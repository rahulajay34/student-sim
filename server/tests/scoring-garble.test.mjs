// node --test server/tests/scoring-garble.test.mjs
//
// Unit tests for Issue #4: STT garble immunity.
//   1. isGarbled() — deterministic heuristic
//   2. scoreMessage() — garbled turn yields adjustment === 0 (non-penalizing)
//      and garbled:true flag, WITHOUT calling the LLM.
//
// isGarbled is a pure deterministic export — no LLM, no file I/O.
// scoreMessage is async but the garble short-circuit fires BEFORE any LLM call,
// so these tests run offline with no ANTHROPIC_API_KEY needed.

import test from "node:test";
import assert from "node:assert/strict";

import { isGarbled, scoreMessage, isBackchannel } from "../scoring.js";

// ── isGarbled: cases that MUST return true (clear garble) ───────────────────

test("isGarbled: very short 1-char string", () => {
  assert.equal(isGarbled("x"), true);
});

test("isGarbled: empty / null / undefined returns false (not garbled — they are vacuous)", () => {
  // empty is not 'garbled' text — it is no text at all
  assert.equal(isGarbled(""), false);
  assert.equal(isGarbled(null), false);
  assert.equal(isGarbled(undefined), false);
});

test("isGarbled: repeated-fragment ASR hallucination loop", () => {
  // 'hello' repeated 6 times — clear loop artifact
  assert.equal(isGarbled("hello hello hello hello hello hello"), true);
});

test("isGarbled: single token repeated 4 times in short turn", () => {
  assert.equal(isGarbled("fee fee fee fee"), true);
});

test("isGarbled: one word accounts for >60% of tokens in a 4-token turn", () => {
  // 'blah blah blah real' — blah:3/4 = 75%
  assert.equal(isGarbled("blah blah blah real"), true);
});

test("isGarbled: all-consonant token soup (no vowels, 4-10 words)", () => {
  // Looks like broken STT: consonant clusters that are not real words
  assert.equal(isGarbled("strng mrkng plsk snd"), true);
});

test("isGarbled: very low alpha ratio (symbol-dominated)", () => {
  // Only 2 out of 20 non-space chars are letters → ratio 10%
  assert.equal(isGarbled("!@#$%^&*()!@#$%^&*ab"), true);
});

// ── isGarbled: cases that MUST return false (coherent turns) ────────────────

test("isGarbled: normal English sentence", () => {
  assert.equal(isGarbled("So, tell me a little about your current work situation?"), false);
});

test("isGarbled: Hinglish code-switch counsellor turn", () => {
  assert.equal(isGarbled("Theek hai, toh fees ke baare mein baat karte hain — EMI available hai"), false);
});

test("isGarbled: Devanagari counsellor turn", () => {
  assert.equal(isGarbled("आपकी फीस की चिंता बिल्कुल समझ में आती है"), false);
});

test("isGarbled: normal Hinglish with abbreviations and numbers", () => {
  assert.equal(isGarbled("₹4000 ka seat block karo aur EMI se baaki dena hoga"), false);
});

test("isGarbled: short but coherent yes/no response (not backchannel, not garble)", () => {
  // 5 words with vowels — clearly readable
  assert.equal(isGarbled("Yes, please go ahead"), false);
});

test("isGarbled: normal objection-handling with proper noun", () => {
  assert.equal(isGarbled("IIM Ranchi is a premier institute and the placement record speaks for itself"), false);
});

test("isGarbled: mispronounced name (STT noise on name) but otherwise coherent", () => {
  // The name may be garbled but the sentence is coherent English
  assert.equal(isGarbled("So Rahool, I understand your concern about the schedule"), false);
});

test("isGarbled: counsellor turn with UPI / payment mention — must NOT be flagged", () => {
  assert.equal(isGarbled("I will send you the UPI link right now, please check"), false);
});

test("isGarbled: known abbreviation tokens are not treated as non-words", () => {
  // RS EMI UPI GST — 4 tokens, all known abbreviations → must NOT trigger signal 3
  assert.equal(isGarbled("RS EMI UPI GST"), false);
});

test("isGarbled: sentence with one repeated word is NOT garbled", () => {
  // 'very' repeats 3 times — below threshold of 4
  assert.equal(isGarbled("It is a very very very good programme"), false);
});

// ── scoreMessage: garbled turn returns 0 (non-penalizing) synchronously ─────

test("scoreMessage: garbled turn returns adjustment=0 and garbled:true (no LLM called)", async () => {
  // Use a clear loop-garble that isGarbled() will catch.
  const result = await scoreMessage("hello hello hello hello hello hello");
  assert.equal(typeof result.adjustment, "number", "adjustment must be a number");
  assert.equal(result.adjustment, 0, "garbled turn must return 0 adjustment");
  assert.equal(result.garbled, true, "garbled flag must be set");
  assert.equal(result.addressedObjection, null, "garbled turn must not resolve an objection");
});

test("scoreMessage: all-consonant soup returns 0 (non-penalizing)", async () => {
  const result = await scoreMessage("strng mrkng plsk snd");
  assert.equal(result.adjustment, 0);
  assert.equal(result.garbled, true);
});

test("scoreMessage: garbled turn does NOT reduce satisfaction (adjustment >= 0)", async () => {
  const garbledInputs = [
    "hello hello hello hello hello hello",
    "blah blah blah blah",
    "strng mrkng plsk snd",
  ];
  for (const msg of garbledInputs) {
    const { adjustment } = await scoreMessage(msg);
    assert.ok(adjustment >= 0, `Expected adjustment >= 0 for garbled turn "${msg}", got ${adjustment}`);
  }
});

test("scoreMessage: normal coherent turn does NOT get garbled flag (goes to LLM or errors gracefully)", async () => {
  // This will try the LLM — it may time out or fail with missing API key.
  // What we verify is that isGarbled returns false for this input, meaning it
  // won't be short-circuited. We test that directly via isGarbled.
  const coherentTurn = "Tell me about your current job and what made you apply for this programme.";
  assert.equal(isGarbled(coherentTurn), false, "coherent turn must not be flagged as garbled");
});

// ── Boundary: garble short-circuit fires BEFORE backchannel check order ─────
// (Both are before LLM — order doesn't matter for the caller, but let's confirm
//  a turn that is both a backchannel AND garble-like is still handled safely.)
test("scoreMessage: 1-2 char turns return 0 without LLM (caught by isGarbled ≤3 chars rule)", async () => {
  const result = await scoreMessage("a");
  assert.equal(result.adjustment, 0);
});
