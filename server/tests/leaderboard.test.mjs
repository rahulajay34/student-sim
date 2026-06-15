// node --test server/tests/leaderboard.test.mjs
//
// Unit tests for:
//   (issue 5)  buildLeaderboard — average/high/byPersona boards, both metrics,
//              stub exclusion, role-based visibility (top-10 + own rank).
//   (issue 13) counsellorCode — deterministic, stable, formatted derivation.
//
// Pure functions only — no network, no LLM, no file I/O.

import test from "node:test";
import assert from "node:assert/strict";

import { buildLeaderboard } from "../analytics.js";
import { counsellorCode } from "../store.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────
function report({ id, counsellorId, sessionId, percent, finalScore, status = "ready" }) {
  return {
    id,
    counsellorId,
    sessionId,
    status,
    overall: percent == null ? {} : { percent, finalScore },
    finalScore,
    rubric: [],
  };
}

function session({ id, profileId = null, category = null }) {
  return {
    id,
    leadCard: profileId ? { profileId } : null,
    personaSnapshot: category ? { category } : {},
  };
}

const users = [
  { id: "c1", name: "Alice", role: "counsellor" },
  { id: "c2", name: "Bob", role: "counsellor" },
  { id: "c3", name: "Carol", role: "counsellor" },
];

const leadProfiles = [
  { id: "lp-study", category: "studying" },
  { id: "lp-diff", category: "diff-field" },
];

// ─── counsellorCode ──────────────────────────────────────────────────────────
test("counsellorCode is deterministic and stable", () => {
  const a = counsellorCode({ id: "counsellor-1" });
  const b = counsellorCode({ id: "counsellor-1" });
  assert.equal(a, b);
});

test("counsellorCode format is MAS-C-XXXX uppercase hex", () => {
  const code = counsellorCode({ id: "abc-123-def" });
  assert.match(code, /^MAS-C-[0-9A-F]{4}$/);
});

test("counsellorCode differs across distinct ids (collision-resistant)", () => {
  const codes = new Set();
  for (let i = 0; i < 500; i++) codes.add(counsellorCode({ id: `user-${i}` }));
  // FNV-1a over 16 bits — expect very few collisions across 500 ids.
  assert.ok(codes.size >= 495, `expected near-unique codes, got ${codes.size}`);
});

test("counsellorCode returns null for an id-less user", () => {
  assert.equal(counsellorCode({}), null);
  assert.equal(counsellorCode(null), null);
});

// ─── buildLeaderboard: average board ─────────────────────────────────────────
test("average board ranks by mean percent and excludes stubs", () => {
  const reports = [
    report({ id: "r1", counsellorId: "c1", sessionId: "s1", percent: 80, finalScore: 70 }),
    report({ id: "r2", counsellorId: "c1", sessionId: "s2", percent: 60, finalScore: 50 }),
    report({ id: "r3", counsellorId: "c2", sessionId: "s3", percent: 90, finalScore: 88 }),
    // stub / generating — no percent, must be excluded
    report({ id: "r4", counsellorId: "c2", sessionId: "s4", percent: null, status: "generating" }),
  ];
  const lb = buildLeaderboard(
    { reports, sessions: [], users, leadProfiles },
    { metric: "percent", board: "average", viewer: { id: "admin", role: "admin" }, counsellorCode },
  );
  assert.equal(lb.board, "average");
  assert.equal(lb.metric, "percent");
  // c2 mean = 90 (one scored), c1 mean = 70 → c2 ranks first
  assert.equal(lb.rows[0].counsellorId, "c2");
  assert.equal(lb.rows[0].value, 90);
  assert.equal(lb.rows[0].rank, 1);
  assert.equal(lb.rows[1].counsellorId, "c1");
  assert.equal(lb.rows[1].value, 70);
  // each row carries name + stable code
  assert.equal(lb.rows[0].name, "Bob");
  assert.match(lb.rows[0].code, /^MAS-C-/);
  // c3 has no reports → omitted
  assert.ok(!lb.rows.some((r) => r.counsellorId === "c3"));
});

test("high board ranks by single best session", () => {
  const reports = [
    report({ id: "r1", counsellorId: "c1", sessionId: "s1", percent: 50, finalScore: 95 }),
    report({ id: "r2", counsellorId: "c1", sessionId: "s2", percent: 99, finalScore: 40 }),
    report({ id: "r3", counsellorId: "c2", sessionId: "s3", percent: 70, finalScore: 70 }),
  ];
  const lb = buildLeaderboard(
    { reports, sessions: [], users, leadProfiles },
    { metric: "percent", board: "high", viewer: { id: "admin", role: "admin" }, counsellorCode },
  );
  // c1 best percent = 99
  assert.equal(lb.rows[0].counsellorId, "c1");
  assert.equal(lb.rows[0].value, 99);
});

test("satisfaction metric uses finalScore", () => {
  const reports = [
    report({ id: "r1", counsellorId: "c1", sessionId: "s1", percent: 50, finalScore: 95 }),
    report({ id: "r2", counsellorId: "c2", sessionId: "s2", percent: 99, finalScore: 40 }),
  ];
  const lb = buildLeaderboard(
    { reports, sessions: [], users, leadProfiles },
    { metric: "satisfaction", board: "high", viewer: { id: "admin", role: "admin" }, counsellorCode },
  );
  // by satisfaction, c1 (95) beats c2 (40)
  assert.equal(lb.rows[0].counsellorId, "c1");
  assert.equal(lb.rows[0].value, 95);
});

// ─── byPersona board ─────────────────────────────────────────────────────────
test("byPersona segments boards by lead-profile category", () => {
  const sessions = [
    session({ id: "s1", profileId: "lp-study" }),
    session({ id: "s2", profileId: "lp-diff" }),
  ];
  const reports = [
    report({ id: "r1", counsellorId: "c1", sessionId: "s1", percent: 80, finalScore: 70 }),
    report({ id: "r2", counsellorId: "c2", sessionId: "s2", percent: 90, finalScore: 60 }),
  ];
  const lb = buildLeaderboard(
    { reports, sessions, users, leadProfiles },
    { metric: "percent", board: "byPersona", viewer: { id: "admin", role: "admin" }, counsellorCode },
  );
  assert.equal(lb.board, "byPersona");
  // all four valid categories present as keys
  for (const cat of ["studying", "same-field", "diff-field", "non-working"]) {
    assert.ok(cat in lb.categories, `missing category ${cat}`);
  }
  assert.equal(lb.categories.studying.rows[0].counsellorId, "c1");
  assert.equal(lb.categories["diff-field"].rows[0].counsellorId, "c2");
  // empty categories have empty rows
  assert.deepEqual(lb.categories["same-field"].rows, []);
});

// ─── visibility / role gating ────────────────────────────────────────────────
test("counsellor view is capped at top 10 and appends own rank when outside", () => {
  const many = [];
  const manyUsers = [];
  // 15 counsellors, descending percents 95..81 → c-14 (lowest) is rank 15
  for (let i = 0; i < 15; i++) {
    const id = `m${i}`;
    manyUsers.push({ id, name: `M${i}`, role: "counsellor" });
    many.push(report({ id: `r${i}`, counsellorId: id, sessionId: `s${i}`, percent: 95 - i, finalScore: 50 }));
  }
  const lb = buildLeaderboard(
    { reports: many, sessions: [], users: manyUsers, leadProfiles },
    { metric: "percent", board: "average", viewer: { id: "m14", role: "counsellor" }, counsellorCode },
  );
  assert.equal(lb.isAdmin, false);
  assert.equal(lb.truncated, true);
  // top 10 + own appended = 11 rows
  assert.equal(lb.rows.length, 11);
  assert.equal(lb.rows[10].counsellorId, "m14");
  assert.equal(lb.viewerRank, 15);
});

test("admin view returns the full ranking untruncated", () => {
  const many = [];
  const manyUsers = [];
  for (let i = 0; i < 15; i++) {
    const id = `m${i}`;
    manyUsers.push({ id, name: `M${i}`, role: "counsellor" });
    many.push(report({ id: `r${i}`, counsellorId: id, sessionId: `s${i}`, percent: 95 - i, finalScore: 50 }));
  }
  const lb = buildLeaderboard(
    { reports: many, sessions: [], users: manyUsers, leadProfiles },
    { metric: "percent", board: "average", viewer: { id: "admin", role: "admin" }, counsellorCode },
  );
  assert.equal(lb.isAdmin, true);
  assert.equal(lb.rows.length, 15);
  assert.equal(lb.truncated, false);
});

test("counsellor inside top 10 is not duplicated", () => {
  const reports = [
    report({ id: "r1", counsellorId: "c1", sessionId: "s1", percent: 80, finalScore: 70 }),
    report({ id: "r2", counsellorId: "c2", sessionId: "s2", percent: 90, finalScore: 60 }),
  ];
  const lb = buildLeaderboard(
    { reports, sessions: [], users, leadProfiles },
    { metric: "percent", board: "average", viewer: { id: "c1", role: "counsellor" }, counsellorCode },
  );
  const c1Rows = lb.rows.filter((r) => r.counsellorId === "c1");
  assert.equal(c1Rows.length, 1);
  assert.equal(lb.viewerRank, 2);
});

test("empty input yields empty board (no throw)", () => {
  const lb = buildLeaderboard(
    { reports: [], sessions: [], users, leadProfiles },
    { metric: "percent", board: "average", viewer: { id: "admin", role: "admin" }, counsellorCode },
  );
  assert.deepEqual(lb.rows, []);
});
