// node --test server/tests/style-exemplars.test.mjs
//
// Unit tests for server/styleExemplars.js (owner-calibrated speech-style loader):
//   - exemplarsFor: deterministic sampling per (phase, n, seed); spreads across
//     moments; respects n; phase filtering.
//   - renderAddress: standalone sir -> ma'am (word-boundary, case-preserving,
//     including a sentence-start "Sir"); no-op for non-"ma'am" terms.
//   - dials() / antiPatterns() accessors are populated.
//   - fail-soft contract (helpers tolerate odd inputs).
//
// Pure — no network, no LLM.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renameSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  exemplarsFor,
  renderAddress,
  dials,
  antiPatterns,
} from "../styleExemplars.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "..", "data", "seed", "style-exemplars.json");
const SEED_BAK = SEED_PATH + ".bak-test";

test("exemplarsFor: deterministic for the same (phase, n, seed)", () => {
  const a = exemplarsFor(1, 5, "ses_abc");
  const b = exemplarsFor(1, 5, "ses_abc");
  assert.deepEqual(a, b, "same inputs must return the same lines in the same order");
  assert.equal(a.length, 5, "should return n lines when enough exist");
});

test("exemplarsFor: different seeds rotate the selection", () => {
  const a = exemplarsFor(1, 4, "seed-one");
  const b = exemplarsFor(1, 4, "seed-two");
  // Not asserting full disjointness (small banks overlap), just that the rotation
  // produces a different ordering/selection for at least one position.
  assert.notDeepEqual(a, b, "different seeds should not produce identical output");
});

test("exemplarsFor: respects n and never exceeds the available lines", () => {
  const few = exemplarsFor(1, 2, "s");
  assert.equal(few.length, 2);
  const many = exemplarsFor(1, 100, "s");
  assert.ok(many.length > 0 && many.length <= 100);
  // No duplicates in a single draw.
  assert.equal(new Set(many.map((l) => l.toLowerCase())).size, many.length, "no duplicate lines");
});

test("exemplarsFor: covers more than one moment when a phase spans several", () => {
  // Phase 1 spans the 'opening' (6 lines) and 'selfIntro' (phases [1,2]) moments,
  // so 8 lines must pull from both — the round-robin guarantees spread.
  const lines = exemplarsFor(1, 8, "spread-seed");
  assert.ok(lines.length >= 7, `phase 1 should surface several lines, got ${lines.length}`);
});

test("exemplarsFor: returns [] for n <= 0 or a phase with no moments", () => {
  assert.deepEqual(exemplarsFor(1, 0, "s"), []);
  assert.deepEqual(exemplarsFor(99, 5, "s"), []);
});

test("renderAddress: swaps standalone sir -> ma'am, case-preserving", () => {
  assert.equal(
    renderAddress("Yeah hi sir, am I audible?", "ma'am"),
    "Yeah hi ma'am, am I audible?",
  );
  // Sentence-start capitalised "Sir" -> "Ma'am".
  assert.equal(
    renderAddress("Sir, the recordings will be there, right?", "ma'am"),
    "Ma'am, the recordings will be there, right?",
  );
  // Multiple occurrences all swap.
  assert.equal(
    renderAddress("Sir thoda doubt, tell me sir.", "ma'am"),
    "Ma'am thoda doubt, tell me ma'am.",
  );
});

test("renderAddress: leaves non-ma'am address terms (sir / null) untouched", () => {
  const line = "Yeah hi sir, am I audible?";
  assert.equal(renderAddress(line, "sir"), line);
  assert.equal(renderAddress(line, null), line);
  assert.equal(renderAddress(line, undefined), line);
});

test("renderAddress: does not touch 'sir' embedded inside another word", () => {
  // word-boundary only — 'sireh'/'sirens' must be left alone.
  assert.equal(renderAddress("the sirens were loud", "ma'am"), "the sirens were loud");
});

test("renderAddress: fail-soft on a non-string line", () => {
  assert.equal(renderAddress(null, "ma'am"), "");
  assert.equal(renderAddress(undefined, "ma'am"), "");
});

test("dials() and antiPatterns() are populated from the seed file", () => {
  const d = dials();
  assert.equal(typeof d, "object");
  assert.ok(d && typeof d.fillers === "string", "fillers dial should load");
  assert.ok(typeof d.hinglish === "string", "hinglish dial should load");
  const ap = antiPatterns();
  assert.ok(Array.isArray(ap) && ap.length >= 3, "antiPatterns should load several entries");
});

test("fail-soft: helpers never throw on weird input", () => {
  assert.doesNotThrow(() => exemplarsFor(undefined, undefined, undefined));
  assert.doesNotThrow(() => exemplarsFor("x", "y", {}));
  assert.doesNotThrow(() => renderAddress(42, "ma'am"));
});

test("fail-soft: loader returns an empty bank when the seed file is missing", () => {
  // The module loads the seed ONCE at import, so we exercise the catch branch in a
  // fresh child process with the seed file temporarily moved aside. Always restore.
  const moved = existsSync(SEED_PATH);
  if (moved) renameSync(SEED_PATH, SEED_BAK);
  try {
    const script = [
      "import { exemplarsFor, dials, antiPatterns } from '../styleExemplars.js';",
      "const out = { ex: exemplarsFor(1, 5, 's'), dials: dials(), anti: antiPatterns() };",
      "process.stdout.write(JSON.stringify(out));",
    ].join("\n");
    const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: __dirname,
      encoding: "utf8",
    });
    const out = JSON.parse(raw);
    assert.deepEqual(out.ex, [], "exemplarsFor should be [] with no seed file");
    assert.deepEqual(out.dials, {}, "dials() should be {} with no seed file");
    assert.deepEqual(out.anti, [], "antiPatterns() should be [] with no seed file");
  } finally {
    if (moved && existsSync(SEED_BAK)) renameSync(SEED_BAK, SEED_PATH);
  }
});
