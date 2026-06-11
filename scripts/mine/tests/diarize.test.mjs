// node --test scripts/mine/tests/diarize.test.mjs
//
// Tests: prompt construction, output-shape validation, callId scheme.
// LLM calls are mocked — no network or API key required.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the pure-function exports from diarize.mjs
import {
  callId,
  extractJson,
  normaliseTurns,
  buildUserMessage,
  SYSTEM_PROMPT,
} from "../diarize.mjs";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "diarize-fixture.json"), "utf-8"),
);

// ---------------------------------------------------------------------------
// callId — matches prepare.py: sha1(email|slotDate|slotTime)[:10]
// ---------------------------------------------------------------------------
test("callId: deterministic hash for fixture call 1", () => {
  const id = callId("fixture.student1@example.com", "2026-01-10", "10:00:00");
  assert.equal(id, "3e86c7f4e5");
});

test("callId: deterministic hash for fixture call 2", () => {
  const id = callId("fixture.student2@example.com", "2026-01-11", "14:00:00");
  assert.equal(id, "d22dc220cd");
});

test("callId: different emails produce different IDs", () => {
  const a = callId("a@x.com", "2026-01-01", "09:00:00");
  const b = callId("b@x.com", "2026-01-01", "09:00:00");
  assert.notEqual(a, b);
});

test("callId: IDs are exactly 10 hex chars", () => {
  const id = callId("test@example.com", "2026-05-15", "12:30:00");
  assert.match(id, /^[0-9a-f]{10}$/);
});

// ---------------------------------------------------------------------------
// buildUserMessage — includes the raw transcript verbatim
// ---------------------------------------------------------------------------
test("buildUserMessage: contains the transcript verbatim", () => {
  const raw = FIXTURE[0].transcript;
  const msg = buildUserMessage(raw);
  assert.ok(msg.includes(raw), "user message should embed the raw transcript");
});

test("buildUserMessage: has a leading instruction line", () => {
  const msg = buildUserMessage("test transcript");
  assert.ok(msg.startsWith("Diarize this call transcript:"), "should start with instruction");
});

// ---------------------------------------------------------------------------
// SYSTEM_PROMPT — verify it references the 5-phase model and key invariants
// ---------------------------------------------------------------------------
test("SYSTEM_PROMPT: references all 5 phase labels", () => {
  assert.ok(SYSTEM_PROMPT.includes("Phase 1 Opening"), "missing Phase 1");
  assert.ok(SYSTEM_PROMPT.includes("Phase 2 Discovery"), "missing Phase 2");
  assert.ok(SYSTEM_PROMPT.includes("Phase 3 Presentation"), "missing Phase 3");
  assert.ok(SYSTEM_PROMPT.includes("Phase 4 Objections"), "missing Phase 4");
  assert.ok(SYSTEM_PROMPT.includes("Phase 5 Close"), "missing Phase 5");
});

test("SYSTEM_PROMPT: specifies output uses phases 1-5, not 1-4", () => {
  // Should mention valid range 1|2|3|4|5
  assert.ok(
    SYSTEM_PROMPT.includes("1|2|3|4|5") || SYSTEM_PROMPT.includes("1–5") || SYSTEM_PROMPT.includes("1-5"),
    "SYSTEM_PROMPT should specify 5-phase range",
  );
});

test("SYSTEM_PROMPT: phase 2 is Discovery (student answers)", () => {
  assert.ok(
    SYSTEM_PROMPT.includes("Discovery"),
    "Phase 2 should be Discovery",
  );
  const discoveryIdx = SYSTEM_PROMPT.indexOf("Discovery");
  const snippet = SYSTEM_PROMPT.slice(discoveryIdx, discoveryIdx + 200);
  assert.ok(
    snippet.includes("ANSWERS") || snippet.includes("background") || snippet.includes("student"),
    "Phase 2 description should mention student answering questions",
  );
});

test("SYSTEM_PROMPT: phase 4 mentions objections concentration", () => {
  assert.ok(SYSTEM_PROMPT.includes("Objections"), "Phase 4 should mention Objections");
  assert.ok(
    SYSTEM_PROMPT.includes("pushback") || SYSTEM_PROMPT.includes("concerns") || SYSTEM_PROMPT.includes("CONCENTRATES"),
    "Phase 4 should describe objection concentration",
  );
});

test("SYSTEM_PROMPT: instructs to preserve Hinglish register", () => {
  assert.ok(
    SYSTEM_PROMPT.includes("Hinglish") || SYSTEM_PROMPT.includes("haan") || SYSTEM_PROMPT.includes("PRESERVE"),
    "should instruct to preserve Hinglish register",
  );
});

test("SYSTEM_PROMPT: instructs to remove ASR garble only", () => {
  assert.ok(
    SYSTEM_PROMPT.includes("ASR") && SYSTEM_PROMPT.includes("REMOVE ONLY"),
    "should instruct to remove only ASR noise",
  );
});

test("SYSTEM_PROMPT: output schema includes diarizationConfidence", () => {
  assert.ok(SYSTEM_PROMPT.includes("diarizationConfidence"), "schema should include diarizationConfidence");
});

test("SYSTEM_PROMPT: output schema includes ambiguous and ambiguousNote", () => {
  assert.ok(SYSTEM_PROMPT.includes("ambiguous"), "schema should include ambiguous");
  assert.ok(SYSTEM_PROMPT.includes("ambiguousNote"), "schema should include ambiguousNote");
});

// ---------------------------------------------------------------------------
// extractJson — mirrors server/ollama.js
// ---------------------------------------------------------------------------
test("extractJson: parses a bare JSON object", () => {
  const raw = `{"diarizationConfidence":0.9,"turns":[]}`;
  const result = extractJson(raw);
  assert.equal(result.diarizationConfidence, 0.9);
  assert.deepEqual(result.turns, []);
});

test("extractJson: strips markdown code fences", () => {
  const raw = '```json\n{"foo":"bar"}\n```';
  const result = extractJson(raw);
  assert.equal(result.foo, "bar");
});

test("extractJson: throws on non-JSON model blurb", () => {
  assert.throws(() => extractJson("Sorry, I cannot do that."), /No JSON/);
});

test("extractJson: extracts JSON embedded in prose", () => {
  const raw = 'Here is the result: {"key":"value"} Hope that helps!';
  const result = extractJson(raw);
  assert.equal(result.key, "value");
});

// ---------------------------------------------------------------------------
// normaliseTurns — output-shape validation
// ---------------------------------------------------------------------------
const MOCK_LLM_RESPONSE = {
  diarizationConfidence: 0.87,
  ambiguous: false,
  ambiguousNote: "",
  turns: [
    { speaker: "student", phase: 1, text: "Hello sir, am I audible?" },
    { speaker: "counsellor", phase: 1, text: "Yes, you are. Can you turn on camera?" },
    { speaker: "counsellor", phase: 2, text: "Tell me about yourself — background, what you are doing currently?" },
    { speaker: "student", phase: 2, text: "Myself Rahul, BCA final year from Jaipur. Mujhe data analytics mein interest hai." },
    { speaker: "counsellor", phase: 3, text: "Great. So this programme is 6 months, IIM Ranchi certificate, covers SQL, Python, analytics." },
    { speaker: "student", phase: 3, text: "Acha theek hai." },
    { speaker: "student", phase: 4, text: "Fees kitni hai total? Papa se baat karni padegi, itna toh sochna padega na sir." },
    { speaker: "counsellor", phase: 4, text: "Total is 62000 but EMI hai. Block seat with only 4000 today." },
    { speaker: "student", phase: 5, text: "Okay send kar dijiye link, main shaam tak confirm karta hoon." },
  ],
};

test("normaliseTurns: all turns have speaker, phase, text", () => {
  const turns = normaliseTurns(MOCK_LLM_RESPONSE.turns);
  assert.ok(turns.length > 0, "should have turns");
  for (const t of turns) {
    assert.ok(["counsellor", "student"].includes(t.speaker), `bad speaker: ${t.speaker}`);
    assert.ok(t.phase === null || (Number.isInteger(t.phase) && t.phase >= 1 && t.phase <= 5),
      `phase out of range: ${t.phase}`);
    assert.ok(typeof t.text === "string" && t.text.length > 0, "text should be non-empty string");
  }
});

test("normaliseTurns: 5-phase values accepted (no old 4-phase-only clipping)", () => {
  const turns = normaliseTurns([
    { speaker: "student", phase: 5, text: "Okay I will pay." },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].phase, 5, "phase 5 should be preserved");
});

test("normaliseTurns: phase 6 becomes null", () => {
  const turns = normaliseTurns([
    { speaker: "counsellor", phase: 6, text: "Invalid phase." },
  ]);
  assert.equal(turns[0].phase, null, "phase 6 should be normalised to null");
});

test("normaliseTurns: old-style phase 4 from 4-phase model still valid", () => {
  // Phase 4 in the 5-phase model = Objections & Negotiation — still a valid phase
  const turns = normaliseTurns([
    { speaker: "student", phase: 4, text: "Fees too much, papa se puchna padega." },
  ]);
  assert.equal(turns[0].phase, 4);
});

test("normaliseTurns: filters out blank text turns", () => {
  const turns = normaliseTurns([
    { speaker: "student", phase: 1, text: "   " },
    { speaker: "counsellor", phase: 1, text: "Hello." },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "Hello.");
});

test("normaliseTurns: filters out unknown speakers", () => {
  const turns = normaliseTurns([
    { speaker: "moderator", phase: 1, text: "This is a moderator note." },
    { speaker: "student", phase: 1, text: "Hello." },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].speaker, "student");
});

test("normaliseTurns: null phase preserved as null", () => {
  const turns = normaliseTurns([
    { speaker: "counsellor", phase: null, text: "Can you hear me?" },
  ]);
  assert.equal(turns[0].phase, null);
});

test("normaliseTurns: handles non-array input gracefully", () => {
  const turns = normaliseTurns(null);
  assert.deepEqual(turns, []);
});

// ---------------------------------------------------------------------------
// End-to-end output shape validation (mocked LLM, no network)
// ---------------------------------------------------------------------------
test("output shape: mocked diarization produces valid record", () => {
  // Simulate the full output assembly used in diarizeOne()
  const parsed = MOCK_LLM_RESPONSE;
  const turns = normaliseTurns(parsed.turns);

  const out = {
    callId: FIXTURE[0].id,
    diarizationConfidence: Math.min(1, Math.max(0, Number(parsed.diarizationConfidence) || 0)),
    ambiguous: !!parsed.ambiguous,
    ambiguousNote: typeof parsed.ambiguousNote === "string" ? parsed.ambiguousNote : "",
    turns,
  };

  // Shape checks
  assert.equal(typeof out.callId, "string", "callId must be string");
  assert.ok(out.callId.length > 0, "callId must be non-empty");
  assert.ok(out.diarizationConfidence >= 0 && out.diarizationConfidence <= 1,
    "diarizationConfidence out of [0,1]");
  assert.equal(typeof out.ambiguous, "boolean", "ambiguous must be boolean");
  assert.equal(typeof out.ambiguousNote, "string", "ambiguousNote must be string");
  assert.ok(Array.isArray(out.turns), "turns must be array");
  assert.ok(out.turns.length > 0, "turns must be non-empty");
});

test("output shape: all 5 phases appear in mocked diarization", () => {
  const turns = normaliseTurns(MOCK_LLM_RESPONSE.turns);
  const phases = new Set(turns.map((t) => t.phase));
  for (const p of [1, 2, 3, 4, 5]) {
    assert.ok(phases.has(p), `phase ${p} should appear in the mock output`);
  }
});

test("output shape: Hinglish preserved verbatim in fixture transcript", () => {
  // Verify fixture data has expected Hinglish content (basic smoke test on the fixture itself)
  const tx = FIXTURE[0].transcript;
  assert.ok(tx.includes("mujhe"), "fixture should contain Hinglish token 'mujhe'");
  assert.ok(tx.includes("papa"), "fixture should contain Hinglish token 'papa'");
  assert.ok(tx.includes("abhi"), "fixture should contain Hinglish token 'abhi'");
});

test("output shape: fixture calls have correct IDs", () => {
  assert.equal(FIXTURE[0].id, callId("fixture.student1@example.com", "2026-01-10", "10:00:00"));
  assert.equal(FIXTURE[1].id, callId("fixture.student2@example.com", "2026-01-11", "14:00:00"));
});

// ---------------------------------------------------------------------------
// PII invariant: diarized output shape must NOT include email/phone
// ---------------------------------------------------------------------------
test("output shape: callId does not contain email (sha1 hash only)", () => {
  // The callId is a sha1 hex prefix — must not contain '@' or the original email
  const id = callId("realstudent@gmail.com", "2026-03-01", "11:00:00");
  assert.ok(!id.includes("@"), "callId should not contain '@'");
  assert.ok(!id.includes("gmail"), "callId should not contain email provider");
  assert.ok(!id.includes("realstudent"), "callId should not contain email user");
});
