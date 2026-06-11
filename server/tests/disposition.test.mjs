// node --test server/tests/disposition.test.mjs
//
// Unit tests for Task W1-A (Workstream 4 dynamic convincement + Workstream 2
// language/anti-loop):
//   - disposition determinism (same session id -> same persuadability)
//   - stage rises when objections get addressed + momentum positive
//   - the composed full student prompt exposes NO threshold/score numbers and
//     carries the C6 language policy verbatim
//   - objection lastPhrasing ban appears after a re-raise
//   - steeringSummary output shape
//
// No network or LLM calls; pure composition (prompt-config.json import is
// fail-soft to built-in defaults).

import test from "node:test";
import assert from "node:assert/strict";

import { computeDisposition, computePersuadability, renderDispositionSection } from "../disposition.js";
import { composeForInspection, LANGUAGE_POLICY } from "../prompt.js";
import {
  initObjectionState,
  raiseObjection,
  resolveObjection,
  summarizeForPrompt,
  steeringSummary,
} from "../objections.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeSession(overrides = {}) {
  return {
    id: "ses-disp-001",
    satisfactionScore: 50,
    currentPhase: 4,
    personaSnapshot: {
      label: "a recent graduate",
      category: "graduate",
      coreAnxiety: "Will this actually get me a job?",
      behaviourPrompt: "Be cautious about money.",
      personality: { skepticism: 3, talkativeness: 2, formality: 3 },
    },
    scenarioSnapshot: { title: "Mock", difficulty: "medium", hesitancy: 3 },
    courseSnapshot: { name: "Business Analytics", institute: "IIM Ranchi" },
    objectionState: [],
    scoreHistory: [],
    ...overrides,
  };
}

// ============================================================================
// 1) Persuadability determinism — same id -> same value; differs across ids.
// ============================================================================

test("persuadability is deterministic for the same session id", () => {
  const a = computePersuadability(makeSession({ id: "ses-fixed-id" }));
  const b = computePersuadability(makeSession({ id: "ses-fixed-id" }));
  assert.equal(a, b, "same id must yield identical persuadability");
  assert.ok(a >= 0 && a <= 1, `persuadability out of range: ${a}`);
});

test("persuadability varies across different session ids (same persona)", () => {
  const vals = new Set();
  for (const id of ["ses-a", "ses-b", "ses-c", "ses-d", "ses-e"]) {
    vals.add(computePersuadability(makeSession({ id })));
  }
  assert.ok(vals.size > 1, "different ids should not all collapse to one value");
});

test("computeDisposition is deterministic for the same session", () => {
  const s = makeSession({ id: "ses-deterministic" });
  const d1 = computeDisposition(s);
  const d2 = computeDisposition(s);
  assert.deepEqual(d1, d2, "disposition must be stable for an unchanged session");
});

test("disposition shape: stage in enum, narrative non-empty, persuadability 0..1", () => {
  const d = computeDisposition(makeSession());
  assert.ok(["guarded", "listening", "warming", "ready"].includes(d.stage), `bad stage '${d.stage}'`);
  assert.ok(typeof d.narrative === "string" && d.narrative.length > 0, "narrative should be non-empty");
  assert.ok(d.persuadability >= 0 && d.persuadability <= 1, "persuadability out of range");
});

// ============================================================================
// 2) Stage rises as objections get addressed AND momentum is positive.
// ============================================================================

test("stage rises when objections are addressed with positive momentum", () => {
  // Start: a guarded/listening call with an open objection and no momentum.
  const earlyState = initObjectionState();
  raiseObjection(earlyState, "fee", 1, "the fees feel a bit much for me honestly");
  const early = makeSession({
    objectionState: earlyState,
    scoreHistory: [{ adjustment: 0 }, { adjustment: 0 }],
  });

  // Later: the objection is addressed, several strong counsellor turns landed.
  const lateState = initObjectionState();
  raiseObjection(lateState, "fee", 1, "the fees feel a bit much for me honestly");
  resolveObjection(lateState, "fee", 3);
  const late = makeSession({
    objectionState: lateState,
    scoreHistory: [{ adjustment: 3 }, { adjustment: 4 }, { adjustment: 3 }, { adjustment: 2 }],
  });

  const rank = { guarded: 0, listening: 1, warming: 2, ready: 3 };
  const earlyStage = computeDisposition(early).stage;
  const lateStage = computeDisposition(late).stage;
  assert.ok(
    rank[lateStage] > rank[earlyStage],
    `expected stage to rise; early='${earlyStage}' late='${lateStage}'`,
  );
});

test("stage reaches 'ready' when all concerns addressed and momentum is strongly positive", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1, "the fees feel a bit much");
  raiseObjection(state, "job_guarantee_placement", 2, "is placement actually guaranteed");
  resolveObjection(state, "fee", 3);
  resolveObjection(state, "job_guarantee_placement", 4);
  const s = makeSession({
    id: "ses-ready",
    objectionState: state,
    // strong sustained positive momentum, several good turns
    scoreHistory: [{ adjustment: 3 }, { adjustment: 4 }, { adjustment: 4 }, { adjustment: 3 }, { adjustment: 5 }, { adjustment: 4 }],
  });
  const d = computeDisposition(s);
  assert.equal(d.stage, "ready", `expected 'ready', got '${d.stage}' (persuadability ${d.persuadability})`);
  // The crucial preserved behavior: the ready narrative explicitly invites the
  // student to agree naturally when asked to book/pay.
  assert.match(d.narrative, /ready/i, "ready narrative should say the student feels ready");
  assert.match(d.narrative, /book|pay|agree/i, "ready narrative should invite booking/paying agreement");
});

test("'ready' does not fire while an objection is still open, even with great momentum", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1, "the fees feel a bit much");
  raiseObjection(state, "time_commitment", 2, "i can't fit the classes in");
  resolveObjection(state, "fee", 3); // one still open
  const s = makeSession({
    objectionState: state,
    scoreHistory: [{ adjustment: 4 }, { adjustment: 4 }, { adjustment: 4 }, { adjustment: 4 }],
  });
  assert.notEqual(computeDisposition(s).stage, "ready", "an open concern must block 'ready'");
});

// ============================================================================
// 3) Composed prompt: NO numeric score/threshold exposure; HAS the C6 policy.
// ============================================================================

test("composed prompt exposes no THRESHOLD / 70 / /100 score numbers to the student", () => {
  const prompt = composeForInspection(makeSession());
  assert.ok(prompt.length > 0, "prompt should compose");
  assert.equal(prompt.includes("THRESHOLD"), false, "no AGREEMENT THRESHOLD text");
  assert.equal(prompt.includes("/100"), false, "no /100 score exposure");
  assert.equal(prompt.includes("SATISFACTION SCORE"), false, "no satisfaction-score line");
  // The literal closing-threshold number 70 must not leak into the prompt.
  assert.equal(/\b70\b/.test(prompt), false, "no bare '70' threshold number");
});

test("composed prompt carries the C6 language policy verbatim", () => {
  const prompt = composeForInspection(makeSession());
  assert.ok(prompt.includes(LANGUAGE_POLICY), "C6 language policy sentence must appear verbatim");
});

test("renderDispositionSection contains no digits at all", () => {
  const section = renderDispositionSection(computeDisposition(makeSession()));
  assert.equal(/\d/.test(section), false, `disposition section should be number-free: ${section}`);
});

test("composed prompt contains the disposition narrative block", () => {
  const prompt = composeForInspection(makeSession());
  assert.ok(prompt.includes("WHERE YOU ARE EMOTIONALLY RIGHT NOW"), "disposition block should render");
});

// ============================================================================
// 4) Objection lastPhrasing ban appears after a re-raise (timesRaised >= 2).
// ============================================================================

test("summarizeForPrompt bans the stored phrasing after an open re-raise", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1, "honestly the fees are too high for me");
  raiseObjection(state, "fee", 3, "i still feel the fees are too high for me"); // 2nd raise
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("do NOT reuse that phrasing"), `expected phrasing-ban in: ${s}`);
  assert.ok(s.includes("i still feel the fees are too high for me"), "should quote the latest phrasing");
  assert.ok(s.includes("2 times"), "loop-break nudge fires at timesRaised >= 2");
});

test("summarizeForPrompt bans the phrasing of an ANSWERED objection", () => {
  const state = initObjectionState();
  raiseObjection(state, "job_guarantee_placement", 1, "is a job actually guaranteed at the end");
  resolveObjection(state, "job_guarantee_placement", 2);
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("ANSWERED"), "addressed entry should be marked answered");
  assert.ok(s.includes("do NOT reuse that phrasing"), `expected phrasing-ban for answered concern in: ${s}`);
  assert.ok(s.includes("is a job actually guaranteed at the end"), "should quote the answered concern's phrasing");
});

test("a single open objection (raised once) does not yet show the loop-break ban", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1, "the fees feel a bit much");
  const s = summarizeForPrompt(state);
  assert.ok(s.includes("still open"), "should show the open concern");
  assert.equal(s.includes("do NOT reuse that phrasing"), false, "no ban after a single raise");
});

test("raiseObjection stores a truncated lastPhrasing (~140 chars)", () => {
  const state = initObjectionState();
  const long = "x".repeat(300);
  raiseObjection(state, "fee", 1, long);
  assert.ok(state[0].lastPhrasing.length <= 141, `phrasing should be truncated, got ${state[0].lastPhrasing.length}`);
});

// ============================================================================
// 5) steeringSummary output shape (compact 1-4 line plain text for C2).
// ============================================================================

test("steeringSummary returns '' for an empty state", () => {
  assert.equal(steeringSummary([]), "");
  assert.equal(steeringSummary(null), "");
});

test("steeringSummary lists open and answered concerns with banned phrasings", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1, "the fees feel a bit much");
  raiseObjection(state, "time_commitment", 2, "i can't fit the classes around work");
  resolveObjection(state, "fee", 3); // fee answered, time_commitment open
  const out = steeringSummary(state);
  const lines = out.split("\n");
  assert.ok(lines.length >= 1 && lines.length <= 4, `expected 1-4 lines, got ${lines.length}`);
  assert.ok(out.includes("Open concerns:"), "should list open concerns");
  assert.ok(out.includes("Answered concerns:"), "should list answered concerns");
  assert.ok(out.includes("the fees feel a bit much"), "answered concern should quote its banned phrasing");
  assert.ok(out.includes("i can't fit the classes around work"), "open concern should quote its phrasing");
});

test("steeringSummary with only open concerns omits the answered line", () => {
  const state = initObjectionState();
  raiseObjection(state, "fee", 1, "the fees feel a bit much");
  const out = steeringSummary(state);
  assert.ok(out.includes("Open concerns:"), "should list the open concern");
  assert.equal(out.includes("Answered concerns:"), false, "no answered line when nothing answered");
});
