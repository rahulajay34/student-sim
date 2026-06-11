// node --test server/tests/report.test.mjs
//
// Unit tests for the parallel report fan-out in server/report.js (Task W1-B).
// A stubbed chat() is injected via _setChatForTests so there is no network/LLM
// call. Covers:
//   - Call A (rubric) and Call B (narrative) run in PARALLEL, before Call C
//     (drills), which depends on A's weakest criteria.
//   - overall.headline lands from Call B.
//   - A B-failure still assembles a partial report (partial:true).
//   - An A-failure produces the neutral fallback report (fallback:true).

import test from "node:test";
import assert from "node:assert/strict";

import { generateReport, _setChatForTests } from "../report.js";

// ─── Classify which fan-out call a prompt belongs to ─────────────────────────
function callKind(prompt) {
  if (prompt.includes("Prescribe") && prompt.includes("RUBRIC SCORES")) return "C";
  if (prompt.includes("Write the coaching narrative")) return "B";
  if (prompt.includes("on these rubric criteria")) return "A";
  return "?";
}

// ─── Canned valid JSON responses per call ────────────────────────────────────
const RESP_A = JSON.stringify({
  rubric: [
    { key: "rapport", score: 4, justification: "warm open" },
    { key: "discovery", score: 2, justification: "thin discovery" },
    { key: "objections", score: 3, justification: "ok" },
    { key: "knowledge", score: 5, justification: "accurate" },
    { key: "closing", score: 3, justification: "asked" },
    { key: "communication", score: 4, justification: "clear" },
  ],
  phaseBreakdown: [
    { phase: 1, summary: "s1", didWell: "d1", toImprove: "i1" },
    { phase: 2, summary: "s2", didWell: "d2", toImprove: "i2" },
    { phase: 3, summary: "s3", didWell: "d3", toImprove: "i3" },
    { phase: 4, summary: "s4", didWell: "d4", toImprove: "i4" },
    { phase: 5, summary: "s5", didWell: "d5", toImprove: "i5" },
  ],
  outcome: "Converted",
  outcomeDetail: "agreed to pay",
});

const RESP_B = JSON.stringify({
  headline: "Next session, focus on deeper needs discovery.",
  strengths: [{ point: "warm rapport", quote: "happy to help" }],
  improvements: [{ point: "ask more", quote: "ok", suggestion: "open questions" }],
  keyMoments: [{ turn: 1, type: "best", note: "good open" }],
});

const RESP_C = JSON.stringify({
  drills: [
    { title: "Discovery drill", focusCriterion: "discovery", objectionCategory: "fee", instruction: "practice open questions" },
  ],
});

// ─── Minimal session (no rubricSnapshot → LEGACY_RUBRIC path) ─────────────────
function makeSession(overrides = {}) {
  return {
    id: "sess-test-1",
    satisfactionScore: 72,
    startedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    personaSnapshot: { label: "anxious switcher" },
    scenarioSnapshot: { title: "Fee objection", difficulty: "medium" },
    milestones: { discoveryDone: true, presentationDone: true, paymentAsked: true, objectionsRaised: 3 },
    scoreHistory: [
      { turn: 0, score: 50 },
      { turn: 2, score: 60 },
      { turn: 4, score: 72 },
    ],
    transcript: [
      { role: "counsellor", text: "Hi, happy to help you with the programme." },
      { role: "student", text: "I am worried about the fee." },
      { role: "counsellor", text: "Let me explain the EMI options." },
      { role: "student", text: "Okay that sounds manageable." },
    ],
    ...overrides,
  };
}

test.afterEach(() => {
  _setChatForTests(null); // restore the real chat()
});

// ============================================================================
// A + B run in parallel, before C; headline lands in overall
// ============================================================================
test("A and B run in parallel before C; headline + sections assembled", async () => {
  const order = []; // records when each call STARTS

  // Deferred gates so we can prove A and B are both in-flight before C starts.
  let releaseAB;
  const abGate = new Promise((r) => { releaseAB = r; });
  let aStarted = false;
  let bStarted = false;

  _setChatForTests(async (messages) => {
    const prompt = messages[0].content;
    const kind = callKind(prompt);
    order.push(kind);

    if (kind === "A") {
      aStarted = true;
      // Don't resolve A until we've confirmed B also started — proves parallelism.
      await abGate;
      return RESP_A;
    }
    if (kind === "B") {
      bStarted = true;
      // Both A and B are now in-flight; release the gate so A can resolve.
      releaseAB();
      return RESP_B;
    }
    if (kind === "C") {
      // C must only start after A resolved (it needs A's rubric scores).
      assert.ok(aStarted && bStarted, "C started before A and B were both in-flight");
      return RESP_C;
    }
    throw new Error("unexpected prompt kind: " + kind);
  });

  const report = await generateReport(makeSession());

  // Order: A and B started (in some order) before C.
  const cIndex = order.indexOf("C");
  assert.ok(cIndex >= 0, "C should have been called");
  assert.ok(order.indexOf("A") < cIndex, "A must start before C");
  assert.ok(order.indexOf("B") < cIndex, "B must start before C");
  // A and B both appear before C → they were dispatched in parallel.
  assert.deepEqual(order.slice(0, 2).sort(), ["A", "B"]);

  // Headline from Call B lands in overall.
  assert.equal(report.overall.headline, "Next session, focus on deeper needs discovery.");

  // Core sections assembled.
  assert.equal(report.rubric.length, 6);          // LEGACY_RUBRIC (no snapshot)
  assert.equal(report.phaseBreakdown.length, 5);
  assert.equal(report.strengths.length, 1);
  assert.equal(report.improvements.length, 1);
  assert.equal(report.keyMoments.length, 1);
  assert.equal(report.drills.length, 1);
  assert.equal(report.overall.outcome, "Converted");
  assert.ok(!report.fallback, "successful report must not be a fallback");
  assert.ok(!report.partial, "fully-successful report must not be partial");
});

// ============================================================================
// B-failure → partial report still assembles (A + C succeed)
// ============================================================================
test("B failure yields a partial report with A and C intact", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages[0].content);
    if (kind === "A") return RESP_A;
    if (kind === "C") return RESP_C;
    if (kind === "B") throw new Error("simulated Call B failure");
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());

  assert.equal(report.partial, true, "report must be marked partial when B fails");
  assert.ok(!report.fallback, "B-failure must NOT degrade to a full fallback");

  // A succeeded → rubric + phases present.
  assert.equal(report.rubric.length, 6);
  assert.equal(report.phaseBreakdown.length, 5);
  assert.equal(report.overall.outcome, "Converted");

  // C succeeded → drills present.
  assert.equal(report.drills.length, 1);

  // B failed → narrative sections fall back to minimal defaults.
  assert.equal(report.overall.headline, "");
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.improvements, []);
  assert.deepEqual(report.keyMoments, []);
});

// ============================================================================
// A-failure → neutral fallback report
// ============================================================================
test("A failure produces the neutral fallback report", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages[0].content);
    if (kind === "A") throw new Error("simulated Call A failure");
    // B may succeed but should be irrelevant once A fails.
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());

  assert.equal(report.fallback, true, "A failure must produce a fallback report");
  assert.equal(report.regenerable, true, "fallback must be regenerable");
  // Fallback is full-shaped with neutral scores.
  assert.equal(report.rubric.length, 6);
  assert.equal(report.phaseBreakdown.length, 5);
  assert.ok(report.rubric.every((r) => r.score === 3), "fallback rubric is neutral mid-band");
  assert.equal(report.overall.outcome, "Not Converted");
});

// ============================================================================
// Each fan-out call retries once before failing (attempt 2 still tried)
// ============================================================================
test("a transient first-attempt failure is retried and succeeds", async () => {
  let aAttempts = 0;
  _setChatForTests(async (messages) => {
    const kind = callKind(messages[0].content);
    if (kind === "A") {
      aAttempts += 1;
      if (aAttempts === 1) throw new Error("transient A failure");
      return RESP_A;
    }
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  assert.equal(aAttempts, 2, "Call A should have retried once");
  assert.ok(!report.fallback, "retry success must not be a fallback");
  assert.equal(report.overall.headline, "Next session, focus on deeper needs discovery.");
});
