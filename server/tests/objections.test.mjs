// node --test server/tests/objections.test.mjs
//
// Unit tests for server/objections.js
// Covers: detection of 6+ real phrasings from the seed file per category,
// and the raise/resolve/no-dup lifecycle.
// No network or LLM calls; no file I/O beyond the module import itself.

import test from "node:test";
import assert from "node:assert/strict";

import {
  detectObjectionCategory,
  initObjectionState,
  raiseObjection,
  resolveObjection,
  openObjections,
  addressedObjections,
  summarizeForPrompt,
  steeringSummary,
} from "../objections.js";

// ---------------------------------------------------------------------------
// detectObjectionCategory — real seed phrasings
// ---------------------------------------------------------------------------

test("detect fee: 'I am interested, but the fee is too much for me to afford'", () => {
  assert.equal(detectObjectionCategory("I am interested, but the fee is too much for me to afford"), "fee");
});

test("detect fee: 'For the middle class, spending 50,000 here is a bit difficult'", () => {
  assert.equal(detectObjectionCategory("For the middle class, spending 50,000 here is a bit difficult"), "fee");
});

test("detect fee: 'Would there be any scope of a scholarship or something in the fee?'", () => {
  assert.equal(detectObjectionCategory("Would there be any scope of a scholarship or something in the fee?"), "fee");
});

test("detect emi_affordability: 'Is there any facility that it can be paid in EMI?'", () => {
  assert.equal(detectObjectionCategory("Is there any facility that it can be paid in EMI?"), "emi_affordability");
});

test("detect emi_affordability: 'What would be the amount per month?'", () => {
  assert.equal(detectObjectionCategory("What would be the amount per month?"), "emi_affordability");
});

test("detect emi_affordability: 'I can pay monthly like two to three thousand. That is my budget.'", () => {
  assert.equal(detectObjectionCategory("I can pay monthly like two to three thousand. That is my budget."), "emi_affordability");
});

test("detect parents_family: 'I have to talk to my father first about this'", () => {
  assert.equal(detectObjectionCategory("I have to talk to my father first about this"), "parents_family");
});

test("detect parents_family: 'Right now mom is not home, so I cannot pay it at this moment'", () => {
  assert.equal(detectObjectionCategory("Right now mom is not home, so I cannot pay it at this moment"), "parents_family");
});

test("detect parents_family: 'My mom had agreed but she wanted to run it through my dad as well'", () => {
  assert.equal(detectObjectionCategory("My mom had agreed but she wanted to run it through my dad as well"), "parents_family");
});

test("detect time_commitment: 'My office timing is 2 to 11, that is a night shift'", () => {
  assert.equal(detectObjectionCategory("My office timing is 2 to 11, that is a night shift"), "time_commitment");
});

test("detect time_commitment: 'I am working full-time as well — I'll have to juggle my job'", () => {
  assert.equal(detectObjectionCategory("I am working full-time as well — I'll have to juggle my job"), "time_commitment");
});

test("detect time_commitment: 'My university exams are starting from the 10th — can you make it for July?'", () => {
  assert.equal(detectObjectionCategory("My university exams are starting from the 10th — can you make it for July?"), "time_commitment");
});

test("detect competing_priorities: 'I also inquired at a few places, so now I need to compare and then take a decision'", () => {
  assert.equal(detectObjectionCategory("I also inquired at a few places, so now I need to compare and then take a decision"), "competing_priorities");
});

test("detect competing_priorities: 'Can you give me two more days, then I can finalize?'", () => {
  assert.equal(detectObjectionCategory("Can you give me two more days, then I can finalize?"), "competing_priorities");
});

test("detect trust_legitimacy: 'I didn't know if it was genuine or not... I thought maybe it's a scam'", () => {
  assert.equal(detectObjectionCategory("I didn't know if it was genuine or not... I thought maybe it's a scam"), "trust_legitimacy");
});

test("detect trust_legitimacy: 'In my family there is a big scam happened online, so that's why I have to be sure'", () => {
  assert.equal(detectObjectionCategory("In my family there is a big scam happened online, so that's why I have to be sure"), "trust_legitimacy");
});

test("detect job_guarantee_placement: 'I expect a placement guarantee or at least some assurance from your end'", () => {
  assert.equal(detectObjectionCategory("I expect a placement guarantee or at least some assurance from your end"), "job_guarantee_placement");
});

test("detect job_guarantee_placement: 'I have heard it is something like placement assistance but not 100% placement'", () => {
  assert.equal(detectObjectionCategory("I have heard it is something like placement assistance but not 100% placement"), "job_guarantee_placement");
});

test("detect job_guarantee_placement: 'Is this just assistance or an actual placement opportunity?'", () => {
  assert.equal(detectObjectionCategory("Is this just assistance or an actual placement opportunity?"), "job_guarantee_placement");
});

test("detect course_fit_relevance: 'I am not from a technical background, I was not coding. So how easy or how complex?'", () => {
  assert.equal(detectObjectionCategory("I am not from a technical background, I was not coding. So how easy or how complex?"), "course_fit_relevance");
});

test("detect course_fit_relevance: 'How will it add value to my resume or CV if I am trying to switch to a different domain?'", () => {
  assert.equal(detectObjectionCategory("How will it add value to my resume or CV if I am trying to switch to a different domain?"), "course_fit_relevance");
});

// Verify that unrelated text returns null.
test("detect null for neutral greeting", () => {
  assert.equal(detectObjectionCategory("Hello, good morning sir"), null);
});

test("detect null for empty string", () => {
  assert.equal(detectObjectionCategory(""), null);
});

test("detect null for null input", () => {
  assert.equal(detectObjectionCategory(null), null);
});

// The session-problem phrasing: 'I can't pay without a placement guarantee and longer refund window'
test("detect job_guarantee_placement for session-problem phrasing", () => {
  const cat = detectObjectionCategory("I can't pay without a placement guarantee and longer refund window");
  assert.equal(cat, "job_guarantee_placement");
});

// ---------------------------------------------------------------------------
// initObjectionState
// ---------------------------------------------------------------------------

test("initObjectionState returns an empty array", () => {
  const state = initObjectionState();
  assert.deepEqual(state, []);
});

// ---------------------------------------------------------------------------
// raiseObjection — basic creation
// ---------------------------------------------------------------------------

test("raiseObjection creates a new open entry", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 5);
  assert.equal(state.length, 1);
  assert.equal(state[0].category, "fee");
  assert.equal(state[0].status, "open");
  assert.equal(state[0].timesRaised, 1);
  assert.equal(state[0].firstRaisedTurn, 5);
  assert.equal(state[0].lastRaisedTurn, 5);
  assert.equal(state[0].addressedTurn, null);
});

// ---------------------------------------------------------------------------
// raiseObjection — no duplicate open
// ---------------------------------------------------------------------------

test("raiseObjection on already-open entry increments timesRaised, does not duplicate", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 5);
  raiseObjection(state, "fee", 8);
  assert.equal(state.length, 1);
  assert.equal(state[0].timesRaised, 2);
  assert.equal(state[0].lastRaisedTurn, 8);
  assert.equal(state[0].status, "open");
});

// ---------------------------------------------------------------------------
// resolveObjection
// ---------------------------------------------------------------------------

test("resolveObjection marks entry as addressed", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 5);
  resolveObjection(state, "fee", 7);
  assert.equal(state[0].status, "addressed");
  assert.equal(state[0].addressedTurn, 7);
});

test("resolveObjection on unknown category is a no-op", () => {
  const state = initObjectionState();
  resolveObjection(state, "fee", 7); // nothing to resolve
  assert.deepEqual(state, []);
});

// Key-disagreement fallback: scorer returns a related key, not the exact one the
// session is tracking. resolveObjection should still defuse a sibling open concern.
test("resolveObjection resolves a related open objection when no exact key matches", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 2); // session tracks 'fee'
  resolveObjection(state, "emi_affordability", 4); // scorer said sibling key
  assert.equal(state[0].status, "addressed", "related sibling should be resolved");
  assert.equal(state[0].addressedTurn, 4);
});

test("resolveObjection with 'other' resolves the single open concern", () => {
  const state = initObjectionState();
  raiseObjection(state, "parents_family", 2);
  resolveObjection(state, "other", 4);
  assert.equal(state[0].status, "addressed");
});

test("resolveObjection 'other' with multiple open concerns does not guess", () => {
  const state = initObjectionState();
  raiseObjection(state, "parents_family", 2);
  raiseObjection(state, "time_commitment", 3);
  resolveObjection(state, "other", 4);
  // Ambiguous — leave both open rather than guess.
  assert.equal(openObjections(state).length, 2);
});

test("resolveObjection related-key prefers the most recently raised open sibling", () => {
  const state = initObjectionState();
  raiseObjection(state, "job_guarantee_placement", 2);
  raiseObjection(state, "trust_legitimacy", 6); // sibling, more recent
  resolveObjection(state, "course_fit_relevance", 8); // related to both
  const addressed = addressedObjections(state);
  assert.equal(addressed.length, 1);
  assert.equal(addressed[0].category, "trust_legitimacy", "most recent sibling should win");
});

test("resolveObjection does not touch an unrelated open objection", () => {
  const state = initObjectionState();
  raiseObjection(state, "language_english", 2);
  resolveObjection(state, "fee", 4); // unrelated, no exact match
  assert.equal(state[0].status, "open", "unrelated concern stays open");
});

// ---------------------------------------------------------------------------
// raiseObjection on addressed — re-opens, bumps counter
// ---------------------------------------------------------------------------

test("raiseObjection on addressed entry re-opens it and bumps timesRaised", () => {
  const state = initObjectionState();
  raiseObjection(state, "parents_family", 3);
  resolveObjection(state, "parents_family", 5);
  raiseObjection(state, "parents_family", 9);
  assert.equal(state.length, 1);
  assert.equal(state[0].status, "open");
  assert.equal(state[0].timesRaised, 2);
  assert.equal(state[0].lastRaisedTurn, 9);
  assert.equal(state[0].addressedTurn, null); // cleared on re-open
});

// ---------------------------------------------------------------------------
// openObjections / addressedObjections helpers
// ---------------------------------------------------------------------------

test("openObjections returns only open entries", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  raiseObjection(state, "time_commitment", 2);
  resolveObjection(state, "fee", 3);
  const open = openObjections(state);
  assert.equal(open.length, 1);
  assert.equal(open[0].category, "time_commitment");
});

test("addressedObjections returns only addressed entries", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  raiseObjection(state, "time_commitment", 2);
  resolveObjection(state, "fee", 3);
  const addressed = addressedObjections(state);
  assert.equal(addressed.length, 1);
  assert.equal(addressed[0].category, "fee");
});

test("openObjections on empty state returns empty array", () => {
  assert.deepEqual(openObjections(initObjectionState()), []);
});

test("addressedObjections on empty state returns empty array", () => {
  assert.deepEqual(addressedObjections(initObjectionState()), []);
});

// ---------------------------------------------------------------------------
// summarizeForPrompt
// ---------------------------------------------------------------------------

test("summarizeForPrompt returns empty string for empty state", () => {
  assert.equal(summarizeForPrompt([]), "");
  assert.equal(summarizeForPrompt(null), "");
});

test("summarizeForPrompt includes open objection", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("fee"), `expected 'fee' in: ${s}`);
  assert.ok(s.includes("still open"), `expected 'still open' in: ${s}`);
});

test("summarizeForPrompt includes ANSWERED note for addressed objection", () => {
  const state = initObjectionState();
  raiseObjection(state, "job_guarantee_placement", 5);
  resolveObjection(state, "job_guarantee_placement", 7);
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("ANSWERED"), `expected ANSWERED in: ${s}`);
  assert.ok(s.includes("placement"), `expected 'placement' label in: ${s}`);
});

test("summarizeForPrompt shows loop-break nudge when timesRaised >= 3", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  raiseObjection(state, "fee", 3);
  raiseObjection(state, "fee", 5);
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("3 times"), `expected '3 times' in: ${s}`);
  // New firm topic-following nudge (replaces the old "do NOT repeat the wording"
  // guidance that actually encouraged reworded repeats).
  assert.ok(/made your point/i.test(s), `expected 'made your point' loop-break nudge in: ${s}`);
  assert.ok(/FOLLOW/.test(s), `expected topic-following ('FOLLOW') instruction in: ${s}`);
  assert.ok(!/escalate your doubt with new specifics/i.test(s), `must not encourage reworded repeats: ${s}`);
});

test("summarizeForPrompt suggests agreement when all addressed", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  resolveObjection(state, "fee", 3);
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("okay to agree"), `expected agreement note in: ${s}`);
});

test("summarizeForPrompt with mixed open and addressed", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  raiseObjection(state, "parents_family", 2);
  resolveObjection(state, "fee", 4);
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("ANSWERED"), "addressed entry should show ANSWERED");
  assert.ok(s.includes("still open"), "open entry should show still open");
  // Not all addressed → no agreement note
  assert.ok(!s.includes("okay to agree"), "should not suggest agreement when open entries remain");
});

// ---------------------------------------------------------------------------
// detectObjectionCategory — neutral fee questions (loop-fix A1).
// Neutral price asks must be tracked as "fee" (previously returned null, so the
// objection was never tracked and the student looped on it). The EMI rule must
// still win for "per month" phrasings, and a time question must NOT be swallowed
// by the broadened fee regex.
// ---------------------------------------------------------------------------

test("detect fee: neutral 'can you tell me the fees, like the exact amount?' (turn 23)", () => {
  assert.equal(
    detectObjectionCategory("Can you tell me the fees, like the exact amount?"),
    "fee",
  );
});

test("detect fee: 'that's clearer now, but the main thing is still the fees part, na?' (turn 31)", () => {
  assert.equal(
    detectObjectionCategory("Okay that's clearer now, but the main thing is still the fees part, na?"),
    "fee",
  );
});

test("detect emi_affordability: 'And EMI options, like, how much per month roughly, ma'am?'", () => {
  assert.equal(
    detectObjectionCategory("And EMI options, like, how much per month roughly, ma'am?"),
    "emi_affordability",
  );
});

test("detect: 'how much time per week are we talking, roughly?' is NOT fee", () => {
  // Current behaviour: this maps to null (the time_commitment regex needs a
  // 'time manage'/'no time'/'night shift'-type token, not a bare 'time per week').
  // The important property for the loop fix is that the broadened fee regex does
  // NOT swallow a time question. Assert both: not fee, and the current null result.
  const cat = detectObjectionCategory("how much time per week are we talking, roughly?");
  assert.notEqual(cat, "fee", "a time question must not be miscategorised as fee");
  assert.equal(cat, null, "current behaviour for this phrasing is null");
});

test("detect: a neutral curriculum question returns null", () => {
  assert.equal(
    detectObjectionCategory("What topics will the curriculum cover in the first month?"),
    null,
  );
});

test("detect: generic 'how long is the program?' returns null (no fee/cost token)", () => {
  assert.equal(detectObjectionCategory("How long is the program?"), null);
});

// ---------------------------------------------------------------------------
// steeringSummary — mid-call loop-break (A3). Open concerns raised 2+ times get
// an explicit "stop returning to it" line; a concern raised once must NOT.
// ---------------------------------------------------------------------------

test("steeringSummary returns '' for empty/invalid state", () => {
  assert.equal(steeringSummary([]), "");
  assert.equal(steeringSummary(null), "");
});

test("steeringSummary adds a stop-returning line when an open objection has timesRaised >= 3", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  raiseObjection(state, "fee", 3);
  raiseObjection(state, "fee", 5); // timesRaised = 3
  const s = steeringSummary(state);
  assert.ok(/stop returning to it/i.test(s), `expected a stop-returning line in: ${s}`);
  assert.ok(s.includes("3 times"), `expected the raised count in: ${s}`);
  assert.ok(/follow their lead/i.test(s), `expected topic-following guidance in: ${s}`);
});

test("steeringSummary does NOT add a stop-returning line when timesRaised == 1", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1); // timesRaised = 1
  const s = steeringSummary(state);
  assert.ok(s.includes("Open concerns:"), `expected the concern still listed in: ${s}`);
  assert.ok(!/stop returning to it/i.test(s), `must NOT nudge to stop after a single raise: ${s}`);
});

// ---------------------------------------------------------------------------
// Regression: "exact amount/figure" must require a money token nearby —
// otherwise time/timeline questions misfile as fee objections.
// ---------------------------------------------------------------------------

test("'exact amount of time' does NOT misfile as a fee objection", () => {
  const cat = detectObjectionCategory(
    "what is the exact amount of time I need to study each week",
  );
  assert.notEqual(cat, "fee", `time question must not be a fee objection, got: ${cat}`);
});

test("'exact figure for the timeline' does NOT misfile as a fee objection", () => {
  const cat = detectObjectionCategory("exact figure please for the timeline");
  assert.notEqual(cat, "fee", `timeline question must not be a fee objection, got: ${cat}`);
});

test("'exact amount' WITH a money token still detects fee", () => {
  const cat = detectObjectionCategory("what is the exact amount I have to pay");
  assert.equal(cat, "fee");
});
