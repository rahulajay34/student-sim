// _shared/lib/analytics.js — ported from server/analytics.js.
// CHANGES: no fs/path/process.env deps — byte-identical logic.

function safe(num, den) {
  if (!den || !Number.isFinite(num / den)) return 0;
  return num / den;
}

function rubricItems(report) {
  if (!Array.isArray(report.rubric)) return [];
  return report.rubric.map((r) => ({ key: r.key, score: r.score })).filter((r) => r.key && typeof r.score === "number");
}

function humanizeCategory(str) {
  if (!str) return "(unknown)";
  return str
    .replace(/[_|]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isoWeekMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

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

export function buildAdminAnalytics({ reports, assignments, users }) {
  reports = reports || [];
  assignments = assignments || [];
  users = users || [];

  const counsellors = users.filter((u) => u.role === "counsellor");

  const mocksCompleted = reports.filter((r) => Number.isFinite(r.overall?.percent)).length;
  const totalAssigned = assignments.length;
  const completedAssignments = assignments.filter((a) => a.status === "completed").length;
  const completionRatePct = totalAssigned === 0 ? 0 : Math.round(safe(completedAssignments, totalAssigned) * 100);

  const percents = reports.map((r) => r.overall?.percent).filter((v) => typeof v === "number" && Number.isFinite(v));
  const avgScore = percents.length === 0 ? null : Math.round(safe(percents.reduce((s, v) => s + v, 0), percents.length));

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

  const allKeysMap = new Map();
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

  const heatmapRows = counsellors.map((c) => {
    const ownReports = reports.filter((r) => r.counsellorId === c.id && Number.isFinite(r.overall?.percent));
    const keyScores = {};
    for (const r of ownReports) {
      for (const item of rubricItems(r)) {
        if (!keyScores[item.key]) keyScores[item.key] = [];
        keyScores[item.key].push(item.score);
      }
    }
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

  const weekMap = new Map();
  for (const r of reports) {
    if (!r.generatedAt) continue;
    const pct = r.overall?.percent;
    if (typeof pct !== "number" || !Number.isFinite(pct)) continue;
    const ws = isoWeekMonday(new Date(r.generatedAt));
    if (!weekMap.has(ws)) weekMap.set(ws, []);
    weekMap.get(ws).push(pct);
  }

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

  const counsellorsList = counsellors.map((c) => {
    const ownReports = reports
      .filter((r) => r.counsellorId === c.id && typeof r.overall?.percent === "number")
      .sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1));

    const mocks = ownReports.length;
    const allPcts = ownReports.map((r) => r.overall.percent);
    const avgPercent = mocks === 0 ? null : Math.round(safe(allPcts.reduce((s, v) => s + v, 0), mocks));

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

  const catCount = new Map();
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

export function buildCounsellorAnalytics(counsellorId, { reports, assignments, users }) {
  reports = reports || [];
  assignments = assignments || [];
  users = users || [];

  const ownReports = reports
    .filter((r) => r.counsellorId === counsellorId && r.overall)
    .sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1));

  const trend = ownReports.map((r, i) => ({
    turn: i + 1,
    percent: r.overall.percent,
    generatedAt: r.generatedAt,
    reportId: r.id,
  }));

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

  const ownAssignments = assignments.filter((a) => a.counsellorId === counsellorId);
  const pendingMocks = ownAssignments.filter((a) => a.status === "assigned" || a.status === "in_progress").length;
  const completedMocks = ownAssignments.filter((a) => a.status === "completed").length;

  const ownPercents = ownReports.map((r) => r.overall.percent).filter((v) => typeof v === "number" && Number.isFinite(v));
  const avgPercent = ownPercents.length === 0 ? null : Math.round(safe(ownPercents.reduce((s, v) => s + v, 0), ownPercents.length));

  let recommendedDrill = null;
  const reportsWithDrills = ownReports.filter((r) => Array.isArray(r.drills) && r.drills.length > 0);
  if (reportsWithDrills.length > 0) {
    const latest = reportsWithDrills[reportsWithDrills.length - 1];
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
