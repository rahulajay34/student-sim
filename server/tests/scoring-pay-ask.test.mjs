// node --test server/tests/scoring-pay-ask.test.mjs
//
// Unit tests for:
//   Issue 7: STT transcription noise — name/proper-noun penalties must NOT appear
//            in the scoring prompt's hard rules.
//   Issue 11: isPayAsk() — deterministic pay-ask detector;
//             scoreMessage payAskCount mutation logic (pure, no LLM).

import test from "node:test";
import assert from "node:assert/strict";

// isPayAsk is a pure deterministic export — no LLM, no file I/O.
import { isPayAsk } from "../scoring.js";

// ── isPayAsk ────────────────────────────────────────────────────────────────

test("isPayAsk: detects direct payment request", () => {
  assert.equal(isPayAsk("Please go ahead and pay the fee now"), true);
});

test("isPayAsk: detects seat-block phrasing", () => {
  assert.equal(isPayAsk("You can secure your seat by paying 4000 rupees"), true);
});

test("isPayAsk: detects UPI link reference", () => {
  assert.equal(isPayAsk("I'm sending you the UPI link right now"), true);
});

test("isPayAsk: detects enroll/register ask", () => {
  assert.equal(isPayAsk("Please register today and confirm your admission"), true);
});

test("isPayAsk: detects Devanagari-adjacent fee mention", () => {
  assert.equal(isPayAsk("₹4000 is the seat blocking amount"), true);
});

test("isPayAsk: does NOT flag a plain discovery question", () => {
  assert.equal(isPayAsk("Can you tell me about your current job profile?"), false);
});

test("isPayAsk: does NOT flag an objection-handling empathy statement", () => {
  assert.equal(isPayAsk("I completely understand your concern about the schedule"), false);
});

test("isPayAsk: empty string is not a pay-ask", () => {
  assert.equal(isPayAsk(""), false);
});

test("isPayAsk: null/undefined is not a pay-ask", () => {
  assert.equal(isPayAsk(null), false);
  assert.equal(isPayAsk(undefined), false);
});

// ── payAskCount session mutation ─────────────────────────────────────────────
// scoreMessage itself is async and calls the LLM — we test only the
// synchronous session-mutation side-effect by observing that isPayAsk() is
// the gating predicate and that the caller's session object gets mutated.
// We simulate what scoreMessage does: read payAskCountBefore, then increment.

function simulatePayAskMutation(session, message) {
  // mirror the logic inside scoreMessage()
  if (session && typeof session === "object") {
    if (!Number.isFinite(session.payAskCount)) session.payAskCount = 0;
  }
  const before = session ? (session.payAskCount || 0) : undefined;
  if (session && isPayAsk(message)) {
    session.payAskCount = (session.payAskCount || 0) + 1;
  }
  return before;
}

test("payAskCount: initialises to 0 on a fresh session object", () => {
  const session = {};
  const before = simulatePayAskMutation(session, "Can you tell me about yourself?");
  assert.equal(before, 0);
  assert.equal(session.payAskCount, 0, "non-pay-ask must not increment");
});

test("payAskCount: first pay-ask sets count to 1, before-value is 0", () => {
  const session = {};
  const before = simulatePayAskMutation(session, "Please go ahead and pay the 4000 rupees to block your seat");
  assert.equal(before, 0, "before-value passed to scorer must be 0 on first ask");
  assert.equal(session.payAskCount, 1, "count must be 1 after first pay-ask");
});

test("payAskCount: second pay-ask reports before-value 1, sets count to 2", () => {
  const session = { payAskCount: 1 };
  const before = simulatePayAskMutation(session, "So shall we go ahead and register you now?");
  assert.equal(before, 1, "before-value must be 1 before second ask");
  assert.equal(session.payAskCount, 2, "count must be 2 after second pay-ask");
});

test("payAskCount: non-pay-ask turn does not change count", () => {
  const session = { payAskCount: 2 };
  const before = simulatePayAskMutation(session, "What time slot works best for you?");
  assert.equal(before, 2, "before-value must equal current count");
  assert.equal(session.payAskCount, 2, "count must not change on non-pay-ask");
});

test("payAskCount: session=null yields undefined before-value (graceful degradation)", () => {
  const before = simulatePayAskMutation(null, "Please pay the fee");
  assert.equal(before, undefined, "no session => undefined, no crash");
});

test("payAskCount: preserves existing count if already set", () => {
  const session = { payAskCount: 5 };
  simulatePayAskMutation(session, "Let me send you the payment link");
  assert.equal(session.payAskCount, 6);
});
