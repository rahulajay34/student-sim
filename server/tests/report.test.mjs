// node --test server/tests/report.test.mjs
//
// Unit tests for the 4-way parallel report fan-out in server/report.js.
// A stubbed chat() is injected via _setChatForTests so there is no network/LLM
// call. Covers:
//   - Call A (rubric), Call B (narrative), Call C (drills) and Call D (persona)
//     ALL run in parallel (single Promise.allSettled) — C is decoupled from A.
//   - overall.headline lands from Call B.
//   - report.personaAddressed lands from Call D (issue 2 shape).
//   - report.personaCard + stubReportSections persona/slider fields (issue 9).
//   - A B/C/D failure still assembles a partial report (partial:true).
//   - An A-failure produces the neutral fallback report (fallback:true), which
//     still carries personaCard + the default personaAddressed.

import test from "node:test";
import assert from "node:assert/strict";

import { generateReport, stubReportSections, buildFallbackReport, _setChatForTests } from "../report.js";

// ─── Classify which fan-out call a prompt belongs to ─────────────────────────
function callKind(input) {
  // Accept the raw messages array (system+user for Call F) or a single prompt
  // string — join all message contents so the marker is found regardless of role.
  const prompt = Array.isArray(input)
    ? input.map((m) => m.content).join("\n")
    : input;
  if (prompt.includes("THE 8 PARAMETERS WITH THEIR EXACT 0-5 ANCHORS")) return "F";
  if (prompt.includes("ADDRESSED this specific")) return "D";
  if (prompt.includes("prescribing practice drills")) return "C";
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

const RESP_D = JSON.stringify({
  concerns: [
    { concern: "Worried about the fee", addressed: "partially", howRelatedToCourse: "EMI lowers monthly outlay", evidence: "Let me explain the EMI options", comment: "Tie EMI to her salary band next time" },
    // 6th item to prove the 0-5 slice clamp:
    { concern: "c2", addressed: "fully", howRelatedToCourse: "h2", evidence: "e2", comment: "k2" },
    { concern: "c3", addressed: "not_addressed", howRelatedToCourse: "h3", evidence: "e3", comment: "k3" },
    { concern: "c4", addressed: "weird_value", howRelatedToCourse: "h4", evidence: "e4", comment: "k4" },
    { concern: "c5", addressed: "fully", howRelatedToCourse: "h5", evidence: "e5", comment: "k5" },
    { concern: "c6-overflow", addressed: "fully", howRelatedToCourse: "h6", evidence: "e6", comment: "k6" },
  ],
  summary: "Concerns surfaced but not fully tied to the course.",
  score: 12, // out of range → must clamp to 10
});

// Call F (New Report Section): 8 parameters, deliberately out-of-order + with an
// out-of-range score (6 → clamp to 5) and a missing key (objection_handling) to
// prove fixed-order assembly + 0-5 clamp + default-0 for an absent parameter.
const RESP_F = JSON.stringify({
  parameters: [
    { key: "needs_discovery", score: 2, summary: "Asked a couple of questions but pitched early." },
    { key: "rapport_opening", score: 6, summary: "Warm, used the learner's name." },           // 6 → clamp to 5
    { key: "programme_presentation", score: 3, summary: "Covered curriculum and fees clearly." },
    // objection_handling intentionally omitted → defaults to score 0, summary ""
    { key: "product_knowledge", score: 4, summary: "Accurate on fees and EMI." },
    { key: "closing_payment_ask", score: 3, summary: "Asked for the seat-block, a bit tentative." },
    { key: "communication_empathy", score: 4, summary: "Clear and patient throughout." },
    { key: "personalised_experience", score: 2, summary: "Some tailoring, mostly generic." },
  ],
});

// ─── Minimal session (no rubricSnapshot → LEGACY_RUBRIC path) ─────────────────
function makeSession(overrides = {}) {
  return {
    id: "sess-test-1",
    satisfactionScore: 72,
    startedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    personaSnapshot: {
      label: "anxious switcher",
      category: "career_switcher",
      coreAnxiety: "Will this actually get me a job?",
      voiceName: "Priya",
      personality: { talkativeness: 4, humour: 2, skepticism: 5, formality: 3, quirks: ["over-researches"] },
    },
    scenarioSnapshot: { title: "Fee objection", difficulty: "medium", pushiness: 2, hesitancy: 4 },
    courseSnapshot: { name: "Analytics", duration: "6m", format: "online", feeTotal: 120000, feeBooking: 4000, curriculum: ["SQL"], usps: ["IIM cert"] },
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
// A, B, C, D all run in parallel (single allSettled); sections + headline +
// personaAddressed + personaCard all assemble
// ============================================================================
test("A,B,C,D run in parallel; all sections assembled", async () => {
  const started = []; // records when each call STARTS
  let releaseAll;
  const gate = new Promise((r) => { releaseAll = r; });

  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    started.push(kind);
    // Hold every call open until all five have started — proves a single
    // concurrent dispatch (no call waits on another's result, incl. C on A and
    // the additive Call F new-report scoring).
    if (started.length >= 5) releaseAll();
    await gate;
    if (kind === "A") return RESP_A;
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    if (kind === "D") return RESP_D;
    if (kind === "F") return RESP_F;
    throw new Error("unexpected prompt kind: " + kind);
  });

  const report = await generateReport(makeSession());

  // All five were dispatched before any resolved → fully parallel (F included).
  assert.deepEqual([...started].sort(), ["A", "B", "C", "D", "F"]);

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

  // Call D → personaAddressed (issue 2 shape).
  const pa = report.personaAddressed;
  assert.ok(pa, "personaAddressed present");
  assert.equal(pa.concerns.length, 5, "concerns clamped to 0-5");
  assert.equal(pa.score, 10, "score clamped to 1-10");
  assert.equal(pa.summary, "Concerns surfaced but not fully tied to the course.");
  assert.equal(pa.concerns[0].addressed, "partially");
  // Unknown enum value falls back to not_addressed.
  assert.equal(pa.concerns[3].addressed, "not_addressed");
  for (const ci of pa.concerns) {
    assert.deepEqual(Object.keys(ci).sort(), ["addressed", "comment", "concern", "evidence", "howRelatedToCourse"]);
  }

  // personaCard (issue 9 shape).
  const pc = report.personaCard;
  assert.equal(pc.name, "Priya");
  assert.equal(pc.label, "anxious switcher");
  assert.equal(pc.category, "career_switcher");
  assert.equal(pc.coreAnxiety, "Will this actually get me a job?");
  assert.deepEqual(pc.traits, { talkativeness: 4, humour: 2, skepticism: 5, formality: 3, quirks: ["over-researches"] });
  assert.deepEqual(pc.scenario, { title: "Fee objection", difficulty: "medium", pushiness: 2, hesitancy: 4 });

  // Call F → newReport (additive 8-parameter section).
  const nr = report.newReport;
  assert.ok(nr, "newReport present");
  assert.equal(nr.parameters.length, 8, "exactly 8 parameters");
  // Fixed key order (matches the spec's NEW_REPORT_PARAMS).
  assert.deepEqual(
    nr.parameters.map((p) => p.key),
    [
      "rapport_opening", "needs_discovery", "programme_presentation", "objection_handling",
      "product_knowledge", "closing_payment_ask", "communication_empathy", "personalised_experience",
    ],
  );
  // Each entry carries its human label + rawScore + calibrated score + summary.
  // CALIB offsets: rapport_opening+1.0, needs_discovery+0.5, programme_presentation+0.6,
  //   objection_handling+0.9, product_knowledge+1.2, closing_payment_ask+0.8,
  //   communication_empathy+1.2, personalised_experience+0.8. All clamped to [0,5], 1dp.
  const byKey = Object.fromEntries(nr.parameters.map((p) => [p.key, p]));
  assert.equal(byKey.rapport_opening.label, "Rapport & Opening");
  // raw 6 clamps to 5; calibrated = clamp5(5 + 1.0) = 5.0
  assert.equal(byKey.rapport_opening.rawScore, 5, "raw out-of-range 6 clamps to 5");
  assert.equal(byKey.rapport_opening.score, 5, "calibrated rapport_opening = 5.0");
  // omitted parameter → raw=0; calibrated = clamp5(0 + 0.9) = 0.9
  assert.equal(byKey.objection_handling.rawScore, 0, "omitted parameter rawScore defaults to 0");
  assert.equal(byKey.objection_handling.score, 0.9, "calibrated objection_handling = 0.9");
  assert.equal(byKey.objection_handling.summary, "", "omitted parameter summary defaults to ''");
  // needs_discovery raw=2; calibrated = clamp5(2 + 0.5) = 2.5
  assert.equal(byKey.needs_discovery.rawScore, 2);
  assert.equal(byKey.needs_discovery.score, 2.5);
  // total = sum(calibrated scores)/40*100, rounded to 1 decimal.
  // calibrated: rapport_opening=5, needs_discovery=2.5, programme_presentation=3.6,
  //   objection_handling=0.9, product_knowledge=5 (clamp5(4+1.2)), closing_payment_ask=3.8,
  //   communication_empathy=5 (clamp5(4+1.2)), personalised_experience=2.8
  // sum = 5+2.5+3.6+0.9+5+3.8+5+2.8 = 28.6 → 28.6/40*100 = 71.5
  assert.equal(nr.total, 71.5, "total = sum(calibrated scores)/40*100, 1 decimal");
});

// ============================================================================
// C is decoupled from A: it must NOT wait on A's result
// ============================================================================
test("Call C runs without A having resolved first", async () => {
  let aResolved = false;
  let cStartedBeforeA = false;
  let releaseA;
  const aGate = new Promise((r) => { releaseA = r; });
  let cStarted = false;

  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") {
      // Hold A until C has already started.
      await aGate;
      aResolved = true;
      return RESP_A;
    }
    if (kind === "C") {
      cStarted = true;
      if (!aResolved) cStartedBeforeA = true;
      releaseA(); // now let A finish
      return RESP_C;
    }
    if (kind === "B") return RESP_B;
    if (kind === "D") return RESP_D;
    if (kind === "F") return RESP_F;
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  assert.ok(cStarted, "C should have run");
  assert.ok(cStartedBeforeA, "C must start before A resolves (decoupled)");
  assert.equal(report.drills.length, 1);
});

// ============================================================================
// B-failure → partial report still assembles (A + C + D succeed)
// ============================================================================
test("B failure yields a partial report with A, C, D intact", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") return RESP_A;
    if (kind === "C") return RESP_C;
    if (kind === "D") return RESP_D;
    if (kind === "F") return RESP_F;
    if (kind === "B") throw new Error("simulated Call B failure");
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());

  assert.equal(report.partial, true, "report must be marked partial when B fails");
  assert.ok(!report.fallback, "B-failure must NOT degrade to a full fallback");

  assert.equal(report.rubric.length, 6);
  assert.equal(report.phaseBreakdown.length, 5);
  assert.equal(report.drills.length, 1);
  assert.equal(report.personaAddressed.concerns.length, 5);

  // B failed → narrative sections fall back to minimal defaults.
  assert.equal(report.overall.headline, "");
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.improvements, []);
  assert.deepEqual(report.keyMoments, []);
});

// ============================================================================
// C-failure → partial, drills default to []
// ============================================================================
test("C failure yields a partial report with empty drills", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") return RESP_A;
    if (kind === "B") return RESP_B;
    if (kind === "D") return RESP_D;
    if (kind === "F") return RESP_F;
    if (kind === "C") throw new Error("simulated Call C failure");
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  assert.equal(report.partial, true);
  assert.ok(!report.fallback);
  assert.deepEqual(report.drills, []);
  assert.equal(report.overall.headline, "Next session, focus on deeper needs discovery.");
  assert.equal(report.personaAddressed.concerns.length, 5);
});

// ============================================================================
// D-failure → partial, personaAddressed defaults to {concerns:[],summary:"",score:7}
// ============================================================================
test("D failure yields a partial report with default personaAddressed", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") return RESP_A;
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    if (kind === "F") return RESP_F;
    if (kind === "D") throw new Error("simulated Call D failure");
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  assert.equal(report.partial, true, "D failure marks the report partial");
  assert.ok(!report.fallback, "D-failure must NOT degrade to a full fallback");
  assert.deepEqual(report.personaAddressed, { concerns: [], summary: "", score: 7 });
  // Other sections intact.
  assert.equal(report.drills.length, 1);
  assert.equal(report.overall.headline, "Next session, focus on deeper needs discovery.");
  // personaCard is snapshot-derived → still present on a D-failure.
  assert.equal(report.personaCard.name, "Priya");
});

// ============================================================================
// A-failure → neutral fallback report (still carries personaCard + default D)
// ============================================================================
test("A failure produces the neutral fallback report", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") throw new Error("simulated Call A failure");
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    if (kind === "D") return RESP_D;
    if (kind === "F") return RESP_F;
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());

  assert.equal(report.fallback, true, "A failure must produce a fallback report");
  assert.equal(report.regenerable, true, "fallback must be regenerable");
  assert.equal(report.rubric.length, 6);
  assert.equal(report.phaseBreakdown.length, 5);
  assert.ok(report.rubric.every((r) => r.score === 7), "fallback rubric is neutral mid-band (7 on the 1-10 scale)");
  assert.equal(report.overall.outcome, "Not Converted");
  // Fallback still carries the snapshot persona card + default persona-addressed.
  assert.equal(report.personaCard.name, "Priya");
  assert.deepEqual(report.personaAddressed, { concerns: [], summary: "", score: 7 });
});

// ============================================================================
// F-failure → newReport is non-fatal: report is partial, newReport undefined,
// every other section intact (additive section must never break the report)
// ============================================================================
test("F failure yields a partial report with newReport undefined", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") return RESP_A;
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    if (kind === "D") return RESP_D;
    if (kind === "F") throw new Error("simulated Call F failure");
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  assert.equal(report.partial, true, "F failure marks the report partial");
  assert.ok(!report.fallback, "F-failure must NOT degrade to a full fallback");
  assert.equal(report.newReport, undefined, "newReport left undefined on F failure");
  // Every other section intact.
  assert.equal(report.rubric.length, 6);
  assert.equal(report.drills.length, 1);
  assert.equal(report.personaAddressed.concerns.length, 5);
  assert.equal(report.overall.headline, "Next session, focus on deeper needs discovery.");
});

// ============================================================================
// newReport total math + ordering on a clean all-success run (own session)
// ============================================================================
test("newReport total = sum(scores)/40*100 with 8 fixed-order parameters", async () => {
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") return RESP_A;
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    if (kind === "D") return RESP_D;
    if (kind === "F") {
      return JSON.stringify({
        parameters: [
          { key: "rapport_opening", score: 5, summary: "s" },
          { key: "needs_discovery", score: 5, summary: "s" },
          { key: "programme_presentation", score: 5, summary: "s" },
          { key: "objection_handling", score: 5, summary: "s" },
          { key: "product_knowledge", score: 5, summary: "s" },
          { key: "closing_payment_ask", score: 5, summary: "s" },
          { key: "communication_empathy", score: 5, summary: "s" },
          { key: "personalised_experience", score: 5, summary: "s" },
        ],
      });
    }
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  // All 5s → 40/40*100 = 100.
  assert.equal(report.newReport.total, 100);
  assert.equal(report.newReport.parameters.length, 8);
  assert.ok(report.newReport.parameters.every((p) => p.score === 5 && p.label && p.summary === "s"));
});

// ============================================================================
// Each fan-out call retries once before failing (attempt 2 still tried)
// ============================================================================
test("a transient first-attempt failure is retried and succeeds", async () => {
  let aAttempts = 0;
  _setChatForTests(async (messages) => {
    const kind = callKind(messages);
    if (kind === "A") {
      aAttempts += 1;
      if (aAttempts === 1) throw new Error("transient A failure");
      return RESP_A;
    }
    if (kind === "B") return RESP_B;
    if (kind === "C") return RESP_C;
    if (kind === "D") return RESP_D;
    if (kind === "F") return RESP_F;
    throw new Error("unexpected");
  });

  const report = await generateReport(makeSession());
  assert.equal(aAttempts, 2, "Call A should have retried once");
  assert.ok(!report.fallback, "retry success must not be a fallback");
  assert.equal(report.overall.headline, "Next session, focus on deeper needs discovery.");
});

// ============================================================================
// buildFallbackReport carries personaCard + default personaAddressed directly
// ============================================================================
test("buildFallbackReport includes personaCard and default personaAddressed", () => {
  const report = buildFallbackReport(makeSession());
  assert.equal(report.fallback, true);
  assert.equal(report.personaCard.name, "Priya");
  assert.deepEqual(report.personaCard.scenario, { title: "Fee objection", difficulty: "medium", pushiness: 2, hesitancy: 4 });
  assert.deepEqual(report.personaAddressed, { concerns: [], summary: "", score: 7 });
});

// ============================================================================
// stubReportSections exposes the persona card with traits + sliders (issue 9)
// ============================================================================
test("stubReportSections exposes personaCard with traits and difficulty sliders", () => {
  const stub = stubReportSections(makeSession());
  assert.ok(stub.personaCard, "stub must include personaCard");
  assert.equal(stub.personaCard.name, "Priya");
  assert.equal(stub.personaCard.traits.skepticism, 5);
  assert.deepEqual(stub.personaCard.traits.quirks, ["over-researches"]);
  assert.equal(stub.personaCard.scenario.pushiness, 2);
  assert.equal(stub.personaCard.scenario.hesitancy, 4);
});

// ============================================================================
// personaCard name resolution: leadCard.name wins; missing traits/sliders → null
// ============================================================================
test("personaCard name precedence + null defaults", () => {
  // leadCard.name wins over voiceName/name.
  const withLead = stubReportSections(makeSession({
    leadCard: { name: "Rahul" },
  })).personaCard;
  assert.equal(withLead.name, "Rahul");

  // No name anywhere → "Student"; missing traits/sliders → null; quirks → [].
  const bare = stubReportSections({
    id: "s2",
    satisfactionScore: 0,
    startedAt: new Date().toISOString(),
    personaSnapshot: { label: "x", category: "custom" },
    scenarioSnapshot: { title: "t" },
    scoreHistory: [],
    transcript: [],
  }).personaCard;
  assert.equal(bare.name, "Student");
  assert.equal(bare.traits.talkativeness, null);
  assert.deepEqual(bare.traits.quirks, []);
  assert.equal(bare.scenario.pushiness, null);
  assert.equal(bare.scenario.hesitancy, null);
});
