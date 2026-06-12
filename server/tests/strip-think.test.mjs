// stripThink edge cases — a truncated-mid-think response once leaked the raw
// reasoning monologue into the student transcript (iter 13 of the bug loop).
import test from "node:test";
import assert from "node:assert/strict";
import { stripThink } from "../ollama.js";

test("normal think block is stripped, reply preserved", () => {
  assert.equal(stripThink("<think>reasoning here</think>Yes sir, tell me."), "Yes sir, tell me.");
});

test("missing closing tag (truncated mid-think) yields empty, never the raw monologue", () => {
  assert.equal(stripThink("<think>partial internal reasoning that never closes"), "");
});

test("visible text BEFORE the think block is preserved", () => {
  assert.equal(
    stripThink("Haan, sounds good.<think>internal</think>But what about EMI?"),
    "Haan, sounds good. But what about EMI?",
  );
});

test("no think block at all passes through trimmed", () => {
  assert.equal(stripThink("  Plain reply.  "), "Plain reply.");
});

test("text before an UNCLOSED think block is kept, monologue dropped", () => {
  assert.equal(stripThink("Okay.<think>truncated reasoning"), "Okay.");
});
