/**
 * analytics.js — pure in-memory analytics builders for the dashboard endpoints.
 * No I/O here; callers pass { reports, assignments, users } slices.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Guard division; returns 0 when denominator is 0 or result would be NaN/Infinity. */
function safe(num, den) {
  if (!den || !Number.isFinite(num / den)) return 0;
  return num / den;
}

/**
 * Extract all rubric items from a report as { key, score } pairs.
 * Supports both legacy 6-criterion (array of {key,score}) and v2 reports.
 */
function rubricItems(report) {
  if (!Array.isArray(report.rubric)) return [];
  return report.rubric.map((r) => ({ key: r.key, score: r.score })).filter((r) => r.key && typeof r.score === "number");
}

/**
 * Humanize an objectionCategory string:
 * replace underscores with spaces, title-case each word.
 */
function humanizeCategory(str) {
  if (!str) return "(unknown)";
  return str
    .replace(/[_|]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Return ISO week start (Monday) for a given Date, as "YYYY-MM-DD".
 */
function isoWeekMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, …
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Average an array of numbers. Returns null if array is empty.
 */
function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// Collapse an LLM-emitted objection category onto the canonical keys defined in
// objections.js. Substring rules, checked in order — first hit wins; anything
// unrecognized passes through unchanged (it still aggregates with itself).
const OBJECTION_KEY_RULES = [
  ["emi", "emi_affordability"],
  ["installment", "emi_affordability"],
  ["afford", "emi_affordability"],
  ["fee", "fee"],
  ["price", "fee"],
  ["cost", "fee"],
  ["money", "fee"],
  ["budget", "fee"],
  ["parent", "parents_family"],
  ["family", "parents_family"],
  ["father", "parents_family"],
  ["mother", "parents_family"],
  ["time", "time_commitment"],
  ["schedule", "time_commitment"],
  ["priorit", "competing_priorities"],
  ["exam", "competing_priorities"],
  ["placement", "job_guarantee_placement"],
  ["job", "job_guarantee_placement"],
  ["salary", "job_guarantee_placement"],
  ["guarantee", "job_guarantee_placement"],
  ["trust", "trust_legitimacy"],
  ["legitimacy", "trust_legitimacy"],
  ["scam", "trust_legitimacy"],
  ["certificate", "trust_legitimacy"],
  ["fit", "course_fit_relevance"],
  ["relevan", "course_fit_relevance"],
  ["background", "course_fit_relevance"],
  ["tech_access", "tech_access"],
  ["laptop", "tech_access"],
  ["english", "language_english"],
  ["language", "language_english"],
];
function canonicalObjectionKey(cat) {
  for (const [needle, canonical] of OBJECTION_KEY_RULES) {
    if (cat.includes(needle)) return canonical;
  }
  return cat;
}

// ---------------------------------------------------------------------------
// Leaderboard (issue 5)
// ---------------------------------------------------------------------------

// The four canonical lead-profile categories always shown on the byPersona board.
// "other" is appended only when a report actually falls into it.
const PERSONA_CATEGORIES = ["studying", "same-field", "diff-field", "non-working"];

// Pull the leaderboard value out of a report for the chosen metric.
//   "percent"      → report.overall.percent (report grade %)
//   "satisfaction" → report.finalScore (end-of-session satisfaction score)
// Returns null when the value is missing/non-finite (stub or ungraded report).
function reportMetricValue(report, metric) {
  // Stub/generating reports never have a finite overall.percent — exclude them
  // from every board regardless of which metric is selected.
  if (!Number.isFinite(report?.overall?.percent)) return null;
  if (metric === "satisfaction") {
    const v = report.finalScore;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  const v = report.overall.percent;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Map a sessionId → lead-profile category. Resolves the session's leadCard
// profileId through leadProfiles; falls back to the snapshot category; returns
// "other" when neither yields a canonical category.
function categoryForSession(session, profileCategoryById) {
  if (!session) return "other";
  const pid = session.leadCard?.profileId;
  if (pid && profileCategoryById.has(pid)) return profileCategoryById.get(pid);
  const snap = session.personaSnapshot?.category || session.leadCard?.category;
  if (snap && PERSONA_CATEGORIES.includes(snap)) return snap;
  return "other";
}

// Rank a set of { counsellorId, name, code, value, sessions } entries, assigning
// 1-based dense ranks by descending value, then apply role-based visibility:
//   admin/superadmin → full list, untruncated.
//   counsellor       → top 10; if the viewer is outside the top 10, their own row
//                      is appended and viewerRank is set.
// Returns { rows, truncated, viewerRank }.
function rankAndGate(entries, viewer, isAdmin) {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  sorted.forEach((e, i) => { e.rank = i + 1; });

  const viewerRow = viewer ? sorted.find((e) => e.counsellorId === viewer.id) : null;
  const viewerRank = viewerRow ? viewerRow.rank : null;

  if (isAdmin) {
    return { rows: sorted, truncated: false, viewerRank };
  }

  const truncated = sorted.length > 10;
  const rows = sorted.slice(0, 10);
  // Append the viewer's own row when it falls outside the visible top 10.
  if (truncated && viewerRow && !rows.some((r) => r.counsellorId === viewer.id)) {
    rows.push(viewerRow);
  }
  return { rows, truncated, viewerRank };
}

// Build leaderboard entries for a slice of reports keyed by counsellor.
// reduce: "average" → mean of values; "high" → max single value.
function entriesFor(reportsSlice, metric, reduce, userById, counsellorCode) {
  const byCounsellor = new Map(); // counsellorId -> number[]
  for (const r of reportsSlice) {
    const v = reportMetricValue(r, metric);
    if (v == null) continue;
    if (!byCounsellor.has(r.counsellorId)) byCounsellor.set(r.counsellorId, []);
    byCounsellor.get(r.counsellorId).push(v);
  }
  const entries = [];
  for (const [counsellorId, values] of byCounsellor.entries()) {
    if (values.length === 0) continue;
    const user = userById.get(counsellorId);
    // Skip ids that don't resolve to a known user (orphaned reports).
    if (!user) continue;
    const value =
      reduce === "high"
        ? Math.max(...values)
        : Math.round((values.reduce((s, x) => s + x, 0) / values.length) * 10) / 10;
    entries.push({
      counsellorId,
      name: user.name || "",
      code: counsellorCode ? counsellorCode(user) : null,
      value,
      sessions: values.length,
    });
  }
  return entries;
}

/**
 * Build the leaderboard payload.
 * @param {{ reports:object[], sessions:object[], users:object[], leadProfiles:object[] }} store
 * @param {{ metric:"percent"|"satisfaction", board:"average"|"high"|"byPersona",
 *           viewer:{id,role}, counsellorCode:(u)=>string|null }} opts
 */
export function buildLeaderboard(
  { reports, sessions, users, leadProfiles },
  { metric = "percent", board = "average", viewer = null, counsellorCode } = {},
) {
  reports = reports || [];
  sessions = sessions || [];
  users = users || [];
  leadProfiles = leadProfiles || [];

  metric = metric === "satisfaction" ? "satisfaction" : "percent";
  const isAdmin = viewer?.role === "admin" || viewer?.role === "superadmin";

  const userById = new Map(users.map((u) => [u.id, u]));
  const reduce = board === "high" ? "high" : "average";

  if (board === "byPersona") {
    const profileCategoryById = new Map(leadProfiles.map((p) => [p.id, p.category]));
    const sessionById = new Map(sessions.map((s) => [s.id, s]));

    // Bucket reports by their session's lead-profile category.
    const buckets = new Map(); // category -> report[]
    for (const cat of PERSONA_CATEGORIES) buckets.set(cat, []);
    for (const r of reports) {
      if (reportMetricValue(r, metric) == null) continue;
      const cat = categoryForSession(sessionById.get(r.sessionId), profileCategoryById);
      if (!buckets.has(cat)) buckets.set(cat, []); // "other" appears only when present
      buckets.get(cat).push(r);
    }

    const categories = {};
    for (const [cat, slice] of buckets.entries()) {
      const entries = entriesFor(slice, metric, "average", userById, counsellorCode);
      categories[cat] = rankAndGate(entries, viewer, isAdmin);
    }

    return {
      metric,
      board: "byPersona",
      top: 10,
      isAdmin,
      categories,
    };
  }

  // average / high
  const entries = entriesFor(reports, metric, reduce, userById, counsellorCode);
  const { rows, truncated, viewerRank } = rankAndGate(entries, viewer, isAdmin);

  return {
    metric,
    board: reduce,
    top: 10,
    isAdmin,
    rows,
    truncated,
    viewerRank,
  };
}

// ---------------------------------------------------------------------------
// Admin analytics
// ---------------------------------------------------------------------------

/**
 * Build the full admin analytics payload.
 * @param {{ reports: object[], assignments: object[], users: object[] }} store
 */
export function buildAdminAnalytics({ reports, assignments, users }) {
  reports = reports || [];
  assignments = assignments || [];
  users = users || [];

  const counsellors = users.filter((u) => u.role === "counsellor");

  // ---- KPIs ----------------------------------------------------------------

  // Only scored reports count as completed mocks — status:"generating" stubs are
  // sessions whose report is still being written and would inflate the KPI.
  const mocksCompleted = reports.filter((r) => Number.isFinite(r.overall?.percent)).length;
  const totalAssigned = assignments.length;
  const completedAssignments = assignments.filter((a) => a.status === "completed").length;
  const completionRatePct = totalAssigned === 0 ? 0 : Math.round(safe(completedAssignments, totalAssigned) * 100);

  const percents = reports.map((r) => r.overall?.percent).filter((v) => typeof v === "number" && Number.isFinite(v));
  // null (not 0) with no scored reports — the dashboard renders "—" for null but
  // a fresh install showed a real-looking "0%".
  const avgScore = percents.length === 0 ? null : Math.round(safe(percents.reduce((s, v) => s + v, 0), percents.length));

  // trendDelta: delta of the trailing window vs the preceding equal-size window
  // (window = min(5, floor(n/2))); null when fewer than 2 reports
  let trendDelta = null;
  if (percents.length >= 2) {
    const sorted = [...reports]
      .filter((r) => typeof r.overall?.percent === "number")
      .sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1))
      .map((r) => r.overall.percent);
    const n = sorted.length;
    const w = Math.min(5, Math.floor(n / 2));
    const lastW = sorted.slice(-w);
    const prevW = sorted.slice(-2 * w, -w);
    const avgLast = avg(lastW);
    const avgPrev = avg(prevW);
    if (avgLast !== null && avgPrev !== null) {
      trendDelta = Math.round((avgLast - avgPrev) * 10) / 10;
    }
  }

  const kpis = { mocksCompleted, avgScore, completionRatePct, trendDelta };

  // ---- Team heatmap --------------------------------------------------------

  // Union all rubric keys across ALL reports
  const allKeysMap = new Map(); // key -> label
  for (const r of reports) {
    for (const item of rubricItems(r)) {
      if (!allKeysMap.has(item.key)) {
        const label = r.rubric.find((x) => x.key === item.key)?.label || item.key;
        allKeysMap.set(item.key, label);
      }
    }
  }
  const criteriaKeys = [...allKeysMap.keys()];
  const criteria = criteriaKeys.map((key) => ({ key, label: allKeysMap.get(key) }));

  // Per counsellor: accumulate scores per rubric key
  const heatmapRows = counsellors.map((c) => {
    const ownReports = reports.filter((r) => r.counsellorId === c.id && Number.isFinite(r.overall?.percent));
    // key -> [score, ...]
    const keyScores = {};
    for (const r of ownReports) {
      for (const item of rubricItems(r)) {
        if (!keyScores[item.key]) keyScores[item.key] = [];
        keyScores[item.key].push(item.score);
      }
    }
    // Build cells: null when counsellor has 0 reports containing that key
    const cells = {};
    for (const key of criteriaKeys) {
      const scores = keyScores[key];
      if (!scores || scores.length === 0) {
        cells[key] = null;
      } else {
        const a = avg(scores);
        cells[key] = Math.round(a * 10) / 10;
      }
    }
    return {
      counsellorId: c.id,
      counsellorName: c.name,
      cells,
      reportCount: ownReports.length,
    };
  });

  const teamHeatmap = { criteria, rows: heatmapRows };

  // ---- Weekly trend --------------------------------------------------------

  // Bucket reports by ISO week (Monday as weekStart)
  const weekMap = new Map(); // "YYYY-MM-DD" -> { percents: [] }
  for (const r of reports) {
    if (!r.generatedAt) continue;
    const pct = r.overall?.percent;
    if (typeof pct !== "number" || !Number.isFinite(pct)) continue;
    const ws = isoWeekMonday(new Date(r.generatedAt));
    if (!weekMap.has(ws)) weekMap.set(ws, []);
    weekMap.get(ws).push(pct);
  }

  // Sort ascending, take last 8 buckets that have data (non-empty weeks only)
  const sortedWeeks = [...weekMap.keys()].sort();
  const last8Weeks = sortedWeeks.slice(-8);
  const weeklyTrend = last8Weeks.map((ws) => {
    const pcts = weekMap.get(ws);
    return {
      weekStart: ws,
      avgPercent: Math.round(safe(pcts.reduce((s, v) => s + v, 0), pcts.length)),
      count: pcts.length,
    };
  });

  // ---- Counsellors list ----------------------------------------------------

  const counsellorsList = counsellors.map((c) => {
    const ownReports = reports
      .filter((r) => r.counsellorId === c.id && typeof r.overall?.percent === "number")
      .sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1));

    const mocks = ownReports.length;
    const allPcts = ownReports.map((r) => r.overall.percent);
    // null (not 0) with no scored reports — matches the top-level avgScore fix;
    // the AdminDashboard row guard renders "—" for null.
    const avgPercent = mocks === 0 ? null : Math.round(safe(allPcts.reduce((s, v) => s + v, 0), mocks));

    // lastFiveDelta: delta of trailing window vs preceding equal-size window
    // (window = min(5, floor(n/2))); null when fewer than 2 reports
    let lastFiveDelta = null;
    if (allPcts.length >= 2) {
      const cn = allPcts.length;
      const cw = Math.min(5, Math.floor(cn / 2));
      const aL = avg(allPcts.slice(-cw));
      const aP = avg(allPcts.slice(-2 * cw, -cw));
      if (aL !== null && aP !== null) {
        lastFiveDelta = Math.round((aL - aP) * 10) / 10;
      }
    }

    // weakestCriterion: key with lowest avg score across own reports
    const keyScores = {};
    for (const r of ownReports) {
      for (const item of rubricItems(r)) {
        if (!keyScores[item.key]) keyScores[item.key] = [];
        keyScores[item.key].push(item.score);
      }
    }
    let weakestCriterion = null;
    let weakestAvg = Infinity;
    for (const [key, scores] of Object.entries(keyScores)) {
      const a = avg(scores);
      if (a !== null && a < weakestAvg) {
        weakestAvg = a;
        const label = allKeysMap.get(key) || key;
        weakestCriterion = { key, label, avg: Math.round(a * 10) / 10 };
      }
    }
    if (weakestAvg === Infinity) weakestCriterion = null;

    return {
      counsellorId: c.id,
      name: c.name,
      mocks,
      avgPercent,
      lastFiveDelta,
      weakestCriterion,
    };
  });

  // ---- Objection performance -----------------------------------------------

  // Aggregate drills[].objectionCategory across all reports that have drills.
  // The category comes from an LLM and drifts ("fee" / "fees" / "fee_concerns"),
  // fragmenting one real objection into several count-1 buckets — collapse onto
  // the canonical keys from objections.js via canonicalObjectionKey.
  const catCount = new Map(); // category -> count
  for (const r of reports) {
    if (!Array.isArray(r.drills) || r.drills.length === 0) continue;
    for (const d of r.drills) {
      const raw = (d.objectionCategory || "").trim().toLowerCase();
      if (!raw || raw === "none" || raw === "n/a" || raw === "unknown") continue;
      const cat = canonicalObjectionKey(raw.replace(/[\s/‐-―-]+/g, "_"));
      catCount.set(cat, (catCount.get(cat) || 0) + 1);
    }
  }
  const objectionPerformance = [...catCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, drillCount]) => ({
      category,
      label: humanizeCategory(category),
      drillCount,
    }));

  // ---- Recent reports (last 6) ---------------------------------------------

  const recentReports = [...reports]
    .filter((r) => r.overall)
    .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      counsellorName: r.counsellorName || "",
      personaName: r.personaName || "",
      percent: r.overall.percent,
      band: r.overall.band,
      outcome: r.overall.outcome,
      generatedAt: r.generatedAt,
    }));

  return {
    kpis,
    teamHeatmap,
    weeklyTrend,
    counsellors: counsellorsList,
    objectionPerformance,
    recentReports,
  };
}

// ---------------------------------------------------------------------------
// Counsellor analytics
// ---------------------------------------------------------------------------

/**
 * Build the counsellor analytics payload for a given counsellor id.
 * @param {string} counsellorId
 * @param {{ reports: object[], assignments: object[], users: object[] }} store
 */
export function buildCounsellorAnalytics(counsellorId, { reports, assignments, users }) {
  reports = reports || [];
  assignments = assignments || [];
  users = users || [];

  // ---- Trend ---------------------------------------------------------------

  const ownReports = reports
    .filter((r) => r.counsellorId === counsellorId && r.overall)
    .sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1));

  const trend = ownReports.map((r, i) => ({
    turn: i + 1,
    percent: r.overall.percent,
    generatedAt: r.generatedAt,
    reportId: r.id,
  }));

  // ---- Radar ---------------------------------------------------------------

  // Union of rubric keys across ALL counsellors
  const allKeysMap = new Map();
  for (const r of reports) {
    for (const item of rubricItems(r)) {
      if (!allKeysMap.has(item.key)) {
        const label = r.rubric.find((x) => x.key === item.key)?.label || item.key;
        allKeysMap.set(item.key, label);
      }
    }
  }
  const radarCriteria = [...allKeysMap.keys()].map((key) => ({ key, label: allKeysMap.get(key) }));

  // mine: avg score per key from own reports
  const mineKeyScores = {};
  for (const r of ownReports) {
    for (const item of rubricItems(r)) {
      if (!mineKeyScores[item.key]) mineKeyScores[item.key] = [];
      mineKeyScores[item.key].push(item.score);
    }
  }
  const mine = {};
  for (const key of allKeysMap.keys()) {
    const scores = mineKeyScores[key];
    mine[key] = scores && scores.length > 0 ? Math.round(avg(scores) * 10) / 10 : null;
  }

  // team: avg score per key from the OTHER counsellors (anonymous). Including
  // self pulled the "team" line 1/N toward the counsellor's own polygon — at two
  // counsellors the comparison was half self. Solo fallback: when no one else
  // has scored reports yet, fall back to all reports so the radar still renders.
  const otherReports = reports.filter((r) => r.counsellorId !== counsellorId && Number.isFinite(r.overall?.percent));
  const teamSource = otherReports.length > 0 ? otherReports : reports;
  const teamKeyScores = {};
  for (const r of teamSource) {
    for (const item of rubricItems(r)) {
      if (!teamKeyScores[item.key]) teamKeyScores[item.key] = [];
      teamKeyScores[item.key].push(item.score);
    }
  }
  const team = {};
  for (const key of allKeysMap.keys()) {
    const scores = teamKeyScores[key];
    team[key] = scores && scores.length > 0 ? Math.round(avg(scores) * 10) / 10 : null;
  }

  const radar = { criteria: radarCriteria, mine, team };

  // ---- Counts & avgPercent -------------------------------------------------

  const ownAssignments = assignments.filter((a) => a.counsellorId === counsellorId);
  const pendingMocks = ownAssignments.filter((a) => a.status === "assigned" || a.status === "in_progress").length;
  const completedMocks = ownAssignments.filter((a) => a.status === "completed").length;

  const ownPercents = ownReports.map((r) => r.overall.percent).filter((v) => typeof v === "number" && Number.isFinite(v));
  // null (not 0) when no scored report exists yet — the dashboard renders "—" for
  // null but would show a real-looking "0%" if we defaulted to zero here.
  const avgPercent = ownPercents.length === 0 ? null : Math.round(safe(ownPercents.reduce((s, v) => s + v, 0), ownPercents.length));

  // ---- Recommended drill ---------------------------------------------------

  // Latest own report (by generatedAt) that has drills
  let recommendedDrill = null;
  const reportsWithDrills = ownReports.filter((r) => Array.isArray(r.drills) && r.drills.length > 0);
  if (reportsWithDrills.length > 0) {
    const latest = reportsWithDrills[reportsWithDrills.length - 1]; // already sorted ascending
    const drill = latest.drills[0];
    recommendedDrill = {
      title: drill.title || "",
      focusCriterion: drill.focusCriterion || "",
      objectionCategory: drill.objectionCategory || "",
      instruction: drill.instruction || "",
      fromReportId: latest.id,
    };
  }

  return {
    trend,
    radar,
    pendingMocks,
    completedMocks,
    avgPercent,
    recommendedDrill,
  };
}
