// node --test server/tests/engine.test.mjs
//
// Unit tests for the pure structural screen in server/engine.js (#9).
// The runaway-length cap is decoupled from coherence: it was raised from 60 to
// 150 words so genuine multi-sentence "open" replies are NOT replaced by a canned
// 4-word ack. Word-loop garble must still be caught regardless of length.
// No network or LLM calls; importing engine.js triggers no I/O.
//
// Also tests prompt-caching in getStudentReply/getFirstMessage:
//   - The fake LLM client must receive systemParts (not a system-role message)
//   - messages[] must contain no system-role entry

import test from "node:test";
import assert from "node:assert/strict";

import { structurallyBroken, getStudentReply, getFirstMessage } from "../engine.js";
import { _setClientForTests } from "../llm.js";

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

// ─── Prompt-caching: getStudentReply passes systemParts, not system-role ──────
//
// We inject a fake Anthropic client that captures what chat() receives and
// returns a minimal valid student reply. The assertions verify that:
//   1. options.systemParts is an object with { stable, variable } strings
//   2. params.messages[] contains no system-role entry
//   3. params.system is an array (the 2-block caching shape built by llm.js)

const PERSONA_FIXTURE = {
  label: "a working professional",
  category: "professional",
  coreAnxiety: "Is this worth the money?",
  behaviourPrompt: "Ask about ROI and career impact.",
};
const SCENARIO_FIXTURE = { title: "Standard mock", difficulty: "medium" };
const SESSION_FIXTURE = {
  id: "engine-test-session-xyz",
  personaSnapshot: PERSONA_FIXTURE,
  scenarioSnapshot: SCENARIO_FIXTURE,
  courseSnapshot: null,
  currentPhase: 2,
  satisfactionScore: 50,
  transcript: [
    { role: "student", text: "Hello sir, I am Ravi. I took the test last week." },
    { role: "counsellor", text: "Great Ravi! What made you take the qualifier test?" },
  ],
  personalityFlavour: null,
  objectionState: [],
  scoreHistory: [],
  counsellorAddress: "sir",
};

test("getStudentReply passes systemParts to LLM; messages[] has no system-role entry", async () => {
  let capturedParams = null;
  let capturedSystemParts = null;

  // Intercept at the Anthropic SDK client level.
  const fakeClient = {
    messages: {
      create(params, _reqOpts) {
        capturedParams = params;
        // Return a minimal valid response so parseEmotion + gating can run.
        return Promise.resolve({ content: [{ type: "text", text: "Haan sir, okay. [emotion:neutral]" }] });
      },
      stream() {
        return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }) };
      },
    },
  };

  // The fake client also intercepts the coherence gate call (makesSense) — it
  // returns "VALID" which makes the gate pass without a real LLM call.
  // We override create to handle multiple calls: first call is the main student
  // reply; second (optional) is the coherence gate. Both return valid text.
  let callCount = 0;
  fakeClient.messages.create = function(params, _reqOpts) {
    callCount += 1;
    if (callCount === 1) {
      capturedParams = params;
      // Capture systemParts from what was built by normalizeOpts/buildParams.
      // params.system will be an array of blocks when systemParts was provided.
      capturedSystemParts = params.system;
    }
    return Promise.resolve({ content: [{ type: "text", text: "VALID" }] });
  };

  _setClientForTests(fakeClient);
  try {
    // We expect this to resolve (the fake always returns VALID/non-empty text).
    await getStudentReply(SESSION_FIXTURE);
  } finally {
    _setClientForTests(null);
  }

  // The primary (first) call should have systemParts-shaped system param.
  assert.ok(capturedParams, "chat must have been called");
  assert.ok(
    Array.isArray(capturedSystemParts),
    "params.system must be an array (systemParts caching shape)",
  );
  assert.ok(capturedSystemParts.length >= 1, "system array must have at least 1 block");
  assert.ok(
    capturedSystemParts[0]?.cache_control?.type === "ephemeral",
    "block 0 must have ephemeral cache_control",
  );
  // messages[] must NOT contain a system-role entry.
  assert.ok(
    !capturedParams.messages.some((m) => m.role === "system"),
    "messages[] must contain no system-role entry when systemParts is used",
  );
});

test("getFirstMessage passes systemParts to LLM; messages[] has no system-role entry", async () => {
  let capturedParams = null;

  const fakeClient = {
    messages: {
      create(params, _reqOpts) {
        capturedParams = params;
        return Promise.resolve({ content: [{ type: "text", text: "Hi sir, I am Priya. [emotion:neutral]" }] });
      },
      stream() {
        return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }) };
      },
    },
  };

  _setClientForTests(fakeClient);
  try {
    await getFirstMessage(PERSONA_FIXTURE, SCENARIO_FIXTURE, null, null);
  } finally {
    _setClientForTests(null);
  }

  assert.ok(capturedParams, "chat must have been called for getFirstMessage");
  assert.ok(
    Array.isArray(capturedParams.system),
    "params.system must be an array (systemParts caching shape) in getFirstMessage",
  );
  assert.ok(
    capturedParams.system[0]?.cache_control?.type === "ephemeral",
    "block 0 must have ephemeral cache_control in getFirstMessage",
  );
  assert.ok(
    !capturedParams.messages.some((m) => m.role === "system"),
    "messages[] must contain no system-role entry in getFirstMessage",
  );
});
