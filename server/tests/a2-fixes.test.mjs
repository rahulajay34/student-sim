// node --test server/tests/a2-fixes.test.mjs
//
// Unit tests for A2 workstream fixes:
//   (#10) computeConvincementHint warming real-progress guard
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
    satisfactionScore: 50,
    scenarioSnapshot: { difficulty: "medium" },
    objectionState: [],
    scoreHistory: [],
    ...overrides,
  };
}

// ============================================================================
// (#10) computeConvincementHint — warming real-progress guard
// ============================================================================

test("#10: warming does NOT fire at start score=50 with zero good turns and no objections addressed", () => {
  const session = makeSession({ satisfactionScore: 50, scoreHistory: [] });
  // medium threshold is 60; score=50 is within 10 (>=50), but no progress yet
  const hint = computeConvincementHint(session);
  assert.equal(hint, "resistant", `expected 'resistant' at score=50 with no good turns, got '${hint}'`);
});

test("#10: warming fires when score has moved above 50 even without a good-turn", () => {
  const session = makeSession({ satisfactionScore: 51, scoreHistory: [] });
  // 51 > 50 satisfies (satisfactionScore > 50) branch, and 51 >= 60-10=50
  const hint = computeConvincementHint(session);
  assert.equal(hint, "warming", `expected 'warming' at score=51, got '${hint}'`);
});

test("#10: warming fires at score=50 when at least 1 good turn exists", () => {
  const session = makeSession({
    satisfactionScore: 50,
    scoreHistory: [{ turn: 1, score: 52, adjustment: 2 }],
  });
  const hint = computeConvincementHint(session);
  assert.equal(hint, "warming", `expected 'warming' with 1 good turn at score=50, got '${hint}'`);
});

test("#10: warming fires when half objections addressed even at score=50 with no good turns", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1);
  resolveObjection(state, "fee", 3); // 1 of 1 addressed = 100% >= 50%
  const session = makeSession({ satisfactionScore: 50, objectionState: state, scoreHistory: [] });
  const hint = computeConvincementHint(session);
  assert.equal(hint, "warming", `expected 'warming' when half+ objections addressed, got '${hint}'`);
});

test("#10: ready fires when score >= threshold (60) regardless of progress guard", () => {
  const session = makeSession({ satisfactionScore: 60, scoreHistory: [] });
  const hint = computeConvincementHint(session);
  assert.equal(hint, "ready", `expected 'ready' at score=60 (medium threshold), got '${hint}'`);
});

test("#10: resistant still fires when score is below 50 and no objections", () => {
  const session = makeSession({ satisfactionScore: 40, scoreHistory: [] });
  const hint = computeConvincementHint(session);
  assert.equal(hint, "resistant", `expected 'resistant' at score=40, got '${hint}'`);
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
