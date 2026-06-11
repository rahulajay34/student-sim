// node --test server/tests/a2-fixes.test.mjs
//
// Unit tests for A2 workstream fixes:
//   (W4) computeConvincementHint is now a thin alias over the dynamic disposition
//        — willingness EMERGES from momentum + objection ledger, not a fixed
//        score threshold (the old #10 warming/ready threshold tests are gone).
//   (#22) RELATED_GROUPS split — fee does NOT auto-close competing_priorities
//   (#19) advancePhase case-1 counsellor-only counter
//
// No network or LLM calls; no file I/O (all pure-function assertions).

import test from "node:test";
import assert from "node:assert/strict";

import {
  raiseObjection,
  resolveObjection,
  initObjectionState,
  openObjections,
  addressedObjections,
} from "../objections.js";

import { advancePhase, initMilestones, initPhaseCounters, PHASE_NAMES } from "../phases.js";

// computeConvincementHint lives in prompt.js which imports prompt-config.json;
// that import is fine — it falls soft to defaults when the file is absent.
import { computeConvincementHint } from "../prompt.js";

// ─── Helper: build a minimal session object ──────────────────────────────────
function makeSession(overrides = {}) {
  return {
    id: "ses-a2-fixes",
    satisfactionScore: 50,
    scenarioSnapshot: { difficulty: "medium" },
    personaSnapshot: { personality: { skepticism: 3 } },
    objectionState: [],
    scoreHistory: [],
    ...overrides,
  };
}

// ============================================================================
// (W4) computeConvincementHint — now a thin alias over disposition.stage.
//   Returns one of 'resistant' | 'warming' | 'ready'. A fresh call with no
//   momentum and nothing addressed must NOT already read 'ready'; a string in
//   the legacy set is always returned (so old imports keep working).
// ============================================================================

test("W4: computeConvincementHint returns a legacy hint string", () => {
  const hint = computeConvincementHint(makeSession());
  assert.ok(["resistant", "warming", "ready"].includes(hint), `unexpected hint '${hint}'`);
});

test("W4: a fresh session (no momentum, nothing addressed) is not already 'ready'", () => {
  const hint = computeConvincementHint(makeSession({ scoreHistory: [], objectionState: [] }));
  assert.notEqual(hint, "ready", `a brand-new call should not read 'ready', got '${hint}'`);
});

test("W4: null session falls soft to 'resistant'", () => {
  assert.equal(computeConvincementHint(null), "resistant");
});

// ============================================================================
// (#22) RELATED_GROUPS split — fee/EMI should NOT auto-close competing_priorities
// ============================================================================

test("#22: resolving 'fee' does NOT auto-close open 'competing_priorities'", () => {
  const state = initObjectionState();
  raiseObjection(state, "competing_priorities", 2);
  // Counsellor addresses fee (exact key not in state; should NOT fuzzy-close competing_priorities)
  resolveObjection(state, "fee", 5);
  const open = openObjections(state);
  assert.equal(open.length, 1, "competing_priorities should still be open");
  assert.equal(open[0].category, "competing_priorities");
});

test("#22: resolving 'emi_affordability' does NOT auto-close open 'parents_family'", () => {
  const state = initObjectionState();
  raiseObjection(state, "parents_family", 2);
  resolveObjection(state, "emi_affordability", 5);
  const open = openObjections(state);
  assert.equal(open.length, 1, "parents_family should still be open after emi_affordability resolve");
  assert.equal(open[0].category, "parents_family");
});

test("#22: resolving 'fee' does NOT auto-close open 'time_commitment'", () => {
  const state = initObjectionState();
  raiseObjection(state, "time_commitment", 2);
  resolveObjection(state, "fee", 5);
  const open = openObjections(state);
  assert.equal(open.length, 1, "time_commitment should still be open after fee resolve");
});

test("#22: resolving 'fee' still auto-closes open 'emi_affordability' (same group)", () => {
  const state = initObjectionState();
  raiseObjection(state, "emi_affordability", 2);
  resolveObjection(state, "fee", 5); // fee and emi_affordability are in the same group
  const addressed = addressedObjections(state);
  assert.equal(addressed.length, 1, "emi_affordability should be fuzzy-closed by fee");
  assert.equal(addressed[0].category, "emi_affordability");
});

test("#22: resolving 'competing_priorities' still auto-closes open 'parents_family' (same group)", () => {
  const state = initObjectionState();
  raiseObjection(state, "parents_family", 2);
  resolveObjection(state, "competing_priorities", 5);
  const addressed = addressedObjections(state);
  assert.equal(addressed.length, 1, "parents_family should be fuzzy-closed by competing_priorities");
  assert.equal(addressed[0].category, "parents_family");
});

test("#22: resolving 'competing_priorities' auto-closes 'time_commitment' (same group)", () => {
  const state = initObjectionState();
  raiseObjection(state, "time_commitment", 2);
  resolveObjection(state, "competing_priorities", 5);
  const addressed = addressedObjections(state);
  assert.equal(addressed.length, 1, "time_commitment should be fuzzy-closed by competing_priorities");
  assert.equal(addressed[0].category, "time_commitment");
});

// ============================================================================
// (#19) advancePhase case-1 — counsellor-only counter
// ============================================================================

function makePhaseSession(phase = 1) {
  return {
    currentPhase: phase,
    phaseCounters: initPhaseCounters(),
    milestones: initMilestones(),
  };
}

test("#19: student messages alone do NOT advance phase 1", () => {
  const session = makePhaseSession(1);
  advancePhase(session, "student", "Haan hello");
  advancePhase(session, "student", "Ji okay");
  advancePhase(session, "student", "Haan sir");
  assert.equal(session.currentPhase, 1, "three student messages should not advance out of phase 1");
  assert.equal(session.phaseCounters.phase1Msgs, 0, "phase1Msgs should still be 0 (not incremented for students)");
});

test("#19: first counsellor message does not advance phase 1 (threshold is 2)", () => {
  const session = makePhaseSession(1);
  advancePhase(session, "counsellor", "Hi there, how are you?");
  assert.equal(session.currentPhase, 1, "one counsellor message should not advance yet");
  assert.equal(session.phaseCounters.phase1Msgs, 1, "phase1Msgs should be 1 after one counsellor message");
});

test("#19: second counsellor message advances phase 1 to 2", () => {
  const session = makePhaseSession(1);
  advancePhase(session, "counsellor", "Hi, welcome!");
  advancePhase(session, "student", "Haan hello");
  advancePhase(session, "counsellor", "Tell me about yourself");
  assert.equal(session.currentPhase, 2, "second counsellor message should advance to phase 2");
  assert.equal(session.phaseCounters.phase1Msgs, 2);
});

test("#19: DISCOVERY_RE on first counsellor message still advances immediately", () => {
  const session = makePhaseSession(1);
  // A DISCOVERY_RE match on the very first counsellor message is an early advance
  advancePhase(session, "counsellor", "Can you tell me about your background and goals?");
  assert.equal(session.currentPhase, 2, "DISCOVERY_RE should still trigger early advance from phase 1");
});

test("#19: interleaved counsellor + student messages count only counsellors", () => {
  const session = makePhaseSession(1);
  advancePhase(session, "student", "Hello");     // student: ignored
  advancePhase(session, "counsellor", "Hi!");    // counsellor: phase1Msgs=1
  advancePhase(session, "student", "Haan");      // student: ignored
  assert.equal(session.currentPhase, 1, "still phase 1 after 1 counsellor + 2 student msgs");
  advancePhase(session, "counsellor", "How are you?"); // counsellor: phase1Msgs=2 → advance
  assert.equal(session.currentPhase, 2, "should advance to 2 after 2nd counsellor message");
});
