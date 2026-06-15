// node --test server/tests/integrityProbes.test.mjs
//
// Unit tests for the integrity-probe module:
//   - pickProbe is DETERMINISTIC per session id (same id → same probe)
//   - pickProbe only selects ACTIVE probes (and returns null when none active)
//   - loadProbes fail-soft: bad/missing config → DEFAULT_PROBES; merges stored
//
// No network, no LLM, no file I/O — all pure-function assertions.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROBES,
  loadProbes,
  pickProbe,
  newProbeId,
} from "../integrityProbes.js";

// ─── DEFAULT_PROBES shape ─────────────────────────────────────────────────────
test("DEFAULT_PROBES — 24 seed probes, all active, well-shaped, stable ids", () => {
  assert.equal(DEFAULT_PROBES.length, 24);
  const ids = new Set();
  for (const p of DEFAULT_PROBES) {
    assert.equal(typeof p.id, "string");
    assert.ok(p.id.length > 0);
    assert.equal(typeof p.category, "string");
    assert.equal(typeof p.question, "string");
    assert.ok(p.question.length > 0);
    assert.equal(typeof p.groundTruth, "string");
    assert.ok(p.groundTruth.length > 0);
    assert.equal(p.active, true);
    ids.add(p.id);
  }
  assert.equal(ids.size, 24, "ids must be unique");
});

// ─── pickProbe determinism ────────────────────────────────────────────────────
test("pickProbe — deterministic per session id", () => {
  const sid = "ses-abc123def456";
  const a = pickProbe(DEFAULT_PROBES, sid);
  const b = pickProbe(DEFAULT_PROBES, sid);
  assert.ok(a);
  assert.deepEqual(a, b);
  // The chosen probe is one of the input probes.
  assert.ok(DEFAULT_PROBES.some((p) => p.id === a.id));
});

test("pickProbe — different session ids generally select across the library", () => {
  const ids = ["ses-1", "ses-2", "ses-3", "ses-4", "ses-5", "ses-6", "ses-7", "ses-8"];
  const chosen = new Set(ids.map((id) => pickProbe(DEFAULT_PROBES, id).id));
  // FNV-1a over distinct ids should not collapse all 8 to a single probe.
  assert.ok(chosen.size > 1, "expected variety across distinct session ids");
});

// ─── pickProbe respects active flag ───────────────────────────────────────────
test("pickProbe — only selects ACTIVE probes", () => {
  // Disable all but one probe; that probe must always be chosen.
  const onlyActiveId = DEFAULT_PROBES[5].id;
  const probes = DEFAULT_PROBES.map((p) => ({ ...p, active: p.id === onlyActiveId }));
  for (const sid of ["x", "y", "zzz", "ses-99", "anything"]) {
    const got = pickProbe(probes, sid);
    assert.equal(got.id, onlyActiveId);
  }
});

test("pickProbe — null when no active probes", () => {
  const none = DEFAULT_PROBES.map((p) => ({ ...p, active: false }));
  assert.equal(pickProbe(none, "ses-1"), null);
  assert.equal(pickProbe([], "ses-1"), null);
  assert.equal(pickProbe(null, "ses-1"), null);
});

// ─── loadProbes fail-soft ─────────────────────────────────────────────────────
test("loadProbes — missing/bad config → DEFAULT_PROBES", () => {
  for (const bad of [null, undefined, 42, "str", {}, { probes: "nope" }, { probes: [] }]) {
    const { probes, guidelines } = loadProbes(bad);
    assert.equal(probes.length, 24);
    assert.ok(Array.isArray(guidelines));
  }
});

test("loadProbes — merges stored probes over defaults", () => {
  const stored = {
    probes: [
      { id: "probe-custom1", category: "fee", question: "Custom?", groundTruth: "GT", active: true },
      { id: "probe-job_guarantee", active: false }, // partial entry → merges over default
    ],
    guidelines: ["be honest"],
  };
  const { probes, guidelines } = loadProbes(stored);
  assert.equal(probes.length, 2);
  assert.deepEqual(guidelines, ["be honest"]);

  const custom = probes.find((p) => p.id === "probe-custom1");
  assert.equal(custom.question, "Custom?");

  // Partial stored entry inherits the default's question/groundTruth but takes
  // the stored active flag.
  const merged = probes.find((p) => p.id === "probe-job_guarantee");
  assert.equal(merged.active, false);
  assert.ok(merged.question.length > 0);
  assert.ok(merged.groundTruth.length > 0);
});

test("loadProbes — drops malformed entries, falls back when nothing usable", () => {
  const { probes } = loadProbes({ probes: [null, 5, { id: "", question: "" }, {}] });
  // Nothing usable survived → fall back to defaults.
  assert.equal(probes.length, 24);
});

// ─── newProbeId ───────────────────────────────────────────────────────────────
test("newProbeId — returns a unique prefixed id", () => {
  const a = newProbeId();
  const b = newProbeId();
  assert.equal(typeof a, "string");
  assert.ok(a.startsWith("probe-"));
  assert.notEqual(a, b);
});
