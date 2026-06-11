// node --test server/tests/engine.test.mjs
//
// Unit tests for the pure structural screen in server/engine.js (#9).
// The runaway-length cap is decoupled from coherence: it was raised from 60 to
// 150 words so genuine multi-sentence "open" replies are NOT replaced by a canned
// 4-word ack. Word-loop garble must still be caught regardless of length.
// No network or LLM calls; importing engine.js triggers no I/O.

import test from "node:test";
import assert from "node:assert/strict";

import { structurallyBroken } from "../engine.js";

// Build a string of N space-separated, all-distinct words (no loops).
function words(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(`word${i}`);
  return out.join(" ");
}

test("short normal reply is not broken", () => {
  assert.equal(structurallyBroken("Haan sir, that sounds okay to me."), false);
});

test("a genuine 2-4 sentence open reply (~70 words) is NOT broken anymore (#9)", () => {
  // 70 distinct words — would have tripped the old 60-word cap, must pass now.
  assert.equal(structurallyBroken(words(70)), false);
});

test("a 120-word verbose-but-valid reply is still under the 150 cap", () => {
  assert.equal(structurallyBroken(words(120)), false);
});

test("exactly 150 words is allowed (cap is strictly greater-than)", () => {
  const t = words(150);
  assert.equal(t.split(/\s+/).filter(Boolean).length, 150);
  assert.equal(structurallyBroken(t), false);
});

test("runaway output over 150 words is broken", () => {
  assert.equal(structurallyBroken(words(151)), true);
  assert.equal(structurallyBroken(words(400)), true);
});

test("word loop is broken even though it is very short", () => {
  assert.equal(structurallyBroken("the the the the"), true);
});

test("two-word phrase loop is broken", () => {
  assert.equal(structurallyBroken("I think I think I think it is fine"), true);
});

test("comma/period-separated single-word loop is broken", () => {
  assert.equal(structurallyBroken("yes, yes, yes, yes sir"), true);
});

test("a long reply with a word loop is still broken (loop wins regardless of length)", () => {
  const loopy = `${words(40)} refund refund refund refund ${words(40)}`;
  assert.equal(structurallyBroken(loopy), true);
});

test("a normal word repeated only twice (not 3+) is not a loop", () => {
  // The loop regex needs 3+ consecutive repeats; "very very good" must stay valid.
  assert.equal(structurallyBroken("It is very very good for me."), false);
});
