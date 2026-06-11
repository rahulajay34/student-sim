// node --test server/tests/tuning-voice.test.mjs
//
// Unit tests for the per-mock student-tuning sliders (pushiness / hesitancy) and
// the name-driven voice gender selection. Pure functions, no network/LLM.

import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt, convincementParamsFor } from "../prompt.js";
import { inferGenderFromName, pickStudentVoice, STUDENT_VOICES } from "../voices.js";

const PERSONA = {
  label: "a recent graduate",
  category: "graduate",
  coreAnxiety: "Will this actually get me a job?",
  behaviourPrompt: "Be cautious about money.",
};
const COURSE = { name: "Business Analytics", institute: "IIM Ranchi" };

function promptWith(pushiness, hesitancy) {
  return buildSystemPrompt(
    PERSONA,
    { title: "Mock", difficulty: "medium", pushiness, hesitancy },
    2, 50, COURSE,
  );
}

// ── Tuning → prompt text ─────────────────────────────────────────────────────

test("high pushiness injects the pushy steer", () => {
  assert.equal(promptWith(5, 3).includes("PUSHINESS (high)"), true);
});

test("low pushiness injects the easy-going steer", () => {
  assert.equal(promptWith(1, 3).includes("PUSHINESS (low)"), true);
});

test("high hesitancy injects the reluctant steer", () => {
  assert.equal(promptWith(3, 5).includes("HESITANCY (high)"), true);
});

test("neutral sliders (3/3) inject neither tuning steer", () => {
  const p = promptWith(3, 3);
  assert.equal(p.includes("PUSHINESS"), false);
  assert.equal(p.includes("HESITANCY"), false);
});

test("missing/undefined sliders are treated as neutral (no steer)", () => {
  const p = buildSystemPrompt(PERSONA, { title: "Mock", difficulty: "medium" }, 2, 50, COURSE);
  assert.equal(p.includes("HOW YOU CARRY YOURSELF ON THIS CALL"), false);
});

// ── Hesitancy → convincement threshold ───────────────────────────────────────

test("higher hesitancy raises the convincement threshold + effort", () => {
  const neutral = convincementParamsFor("medium", 3);
  const hard = convincementParamsFor("medium", 5);
  const eager = convincementParamsFor("medium", 1);
  assert.ok(hard.threshold > neutral.threshold, "hesitant > neutral threshold");
  assert.ok(eager.threshold < neutral.threshold, "eager < neutral threshold");
  assert.ok(hard.effortTurns >= neutral.effortTurns, "hesitant needs >= effort");
});

test("threshold stays inside the 35-95 clamp band at the extremes", () => {
  for (const d of ["easy", "medium", "hard"]) {
    for (const h of [1, 2, 3, 4, 5]) {
      const { threshold } = convincementParamsFor(d, h);
      assert.ok(threshold >= 35 && threshold <= 95, `${d}/${h} -> ${threshold}`);
    }
  }
});

test("convincementParamsFor defaults to neutral when hesitancy omitted", () => {
  assert.deepEqual(convincementParamsFor("medium"), convincementParamsFor("medium", 3));
});

// ── Name → gender → voice ────────────────────────────────────────────────────

test("inferGenderFromName resolves common names and degrades to null", () => {
  assert.equal(inferGenderFromName("Priya"), "female");
  assert.equal(inferGenderFromName("Suresh"), "male");
  assert.equal(inferGenderFromName("Ashwini"), "female");
  assert.equal(inferGenderFromName(""), null);
  assert.equal(inferGenderFromName(null), null);
});

test("pickStudentVoice honours the requested gender", () => {
  // Run a spread of seeds; every pick must match the asked-for gender.
  for (let i = 0; i < 20; i++) {
    assert.equal(pickStudentVoice("ses_" + i, "female").gender, "female");
    assert.equal(pickStudentVoice("ses_" + i, "male").gender, "male");
  }
});

test("pickStudentVoice is deterministic per seed", () => {
  assert.equal(pickStudentVoice("ses_abc", "male").key, pickStudentVoice("ses_abc", "male").key);
});

test("pickStudentVoice with no gender still returns a catalog voice", () => {
  const v = pickStudentVoice("ses_xyz");
  assert.ok(STUDENT_VOICES.some((x) => x.key === v.key));
});
