# Plan 6: Data-Driven Dashboards + Drills + Taste Pass (Phase 6)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. NO-GIT RULE: no git commands.

**Goal:** Make both dashboards genuinely data-driven (computed from sessions/reports), add the one-click "recommended drill", and land the taste-pass polish items collected across phases.

## Analytics shapes (CONTRACT addendum)

```
GET /api/analytics/admin ->
{ kpis: { mocksCompleted, avgScore, completionRatePct, trendDelta },        // trendDelta: avg of last 5 reports minus previous 5 (null if <2 reports)
  teamHeatmap: { criteria: [{key,label}], rows: [{ counsellorId, counsellorName, cells: {<critKey>: avgScore1to5|null}, reportCount }] },
  weeklyTrend: [{ weekStart: "YYYY-MM-DD", avgPercent, count }],            // ISO weeks from report.generatedAt, last 8 buckets with data
  counsellors: [{ counsellorId, name, mocks, avgPercent, lastFiveDelta, weakestCriterion: {key,label,avg}|null }],
  objectionPerformance: [{ category, label, drillCount }],                  // frequency of drills[].objectionCategory across reports (descending)
  recentReports: [{ id, counsellorName, personaName, percent, band, outcome, generatedAt }] }  // last 6

GET /api/analytics/counsellor/:id ->
{ trend: [{ turn: n, percent, generatedAt, reportId }],                     // chronological, all own reports
  radar: { criteria: [{key,label}], mine: {<key>: avg1to5|null}, team: {<key>: avg1to5|null} },   // team = all counsellors avg (anonymous)
  pendingMocks: n, completedMocks: n, avgPercent,
  recommendedDrill: { title, focusCriterion, objectionCategory, instruction, fromReportId } | null }   // from the latest report's drills[0]; null if none
```

Notes: criterion averaging unions legacy (6) + v2 (7/8) rubrics by key; keys present in <2 reports for a counsellor → cell null. All computed in-memory from `reports`/`assignments` stores. Client api: `api.getAdminAnalytics()`, `api.getCounsellorAnalytics(id)`.

### Task 1: Server analytics endpoints
**Files:** create `server/analytics.js` (pure functions `buildAdminAnalytics(reports, assignments, users)`, `buildCounsellorAnalytics(id, ...)`), wire both GETs in `server/index.js`. Handle empties (no reports → kpis zeros/nulls, arrays empty — no NaN anywhere; guard divisions). Weekly buckets: `weekStart = Monday of generatedAt's week`. Smoke: both endpoints 200 with shape checks (kpis numbers, heatmap rows array, counsellor analytics radar has criteria + recommendedDrill key present) using the existing smoke data. CONTRACT addendum.

### Task 2: Admin dashboard v2
**Files:** rewrite `client/src/pages/admin/AdminDashboard.jsx` (READ current one + StatCard/Table/Badge/EmptyState/format.js first).
Layout: KPI StatCard row (Mocks completed / Avg score % with trend arrow ±delta / Completion rate) → "Team rubric heatmap" Card (table: counsellor rows × criterion columns; cell = avg score tinted via rubricColor + TOKEN_HEX background at ~15% opacity, value to 1 decimal; "—" for null; sticky first column) → two-column row: "Score trend" Card (inline SVG line chart of weeklyTrend, x = week labels dd MMM, y = 0-100 with 50/75 gridlines) + "Objection hot-spots" Card (objectionPerformance as ranked rows: label + count Badge + thin bar) → "Counsellors" Card (Table: name, mocks, avg %, last-5 delta with ↑↓ tint, weakest criterion Badge) → "Recent reports" Card (rows linking to /admin/reports/:id). Empty states everywhere ("Not enough data yet — completed mocks will appear here"). No new libs; inline SVG only.

### Task 3: Counsellor dashboard v2 + drill
**Files:** rewrite `client/src/pages/counsellor/Dashboard.jsx` (READ current + ScoreArcChart for chart conventions).
Layout: hero row: "Your progress" Card (avg %, big; trend line SVG of `trend` percents; last report band Badge) + "Recommended drill" Card (title, focusCriterion + objectionCategory Badges, instruction, primary button "Start this drill" → navigate `/app/session/new` with state `{ mode: "practice", drill: true, personaId: <persona matching weakest archetype — pick via simple map: objectionCategory parents_family→persona-graduate, fee/emi→persona-non-working, course_fit→persona-diff-field, time→persona-same-field, else persona-studying>, scenario: { title: drill.title, difficulty: "hard", situation: drill.instruction, contextNotes: "Drill focus: " + focusCriterion + " / " + objectionCategory } }`; GreenRoom already handles practice state with courseId omitted → IIM Ranchi default. Empty → "Complete your first mock to unlock drills.") → "Skill radar" Card (inline SVG radar polygon, 6-8 axes from radar.criteria, two polygons: mine (brand, filled 25%) vs team (slate outline); legend; axis labels abbreviated) → pending mocks strip (n assigned → link to My Mocks) → recent reports list.
SVG radar: compute points around a circle (r per value score/5), polygon + axis lines — keep ~60 lines, no lib.

### Task 4: Taste pass (collected items)
- MyMocks: sort assigned → in_progress → completed; section subheaders or just ordering (ordering + status Badge enough).
- GreenRoom: humanize the category chip (use CATEGORY_LABEL map like Personas page instead of raw `diff-field`); Join call icon → phone SVG (not envelope).
- AdminDashboard/Dashboard/Reports pages: skeleton loaders (animate-pulse blocks) instead of bare Spinner on first load (Spinner stays for in-card refreshes).
- Reports list pages (both roles): add outcome Badge + percent chip per row if missing; ensure consistent header pattern (title + sub).
- `client/src/pages/shared/TranscriptView.jsx`: READ — if student emotion is stored on entries, show a subtle emotion tag next to student bubbles in report transcripts ("hesitant" etc., text-xs muted); skip if intrusive.
- Login page: swap the tagline if it still references "Practice the call. Master the close." — keep, it's fine. (No change.)
- AdminLayout/CounsellorLayout: verify active-nav and titles for new routes all correct (Courses, Rubrics).

### Task 5: Verification + final review
- lint/build; full smoke (adds analytics checks); Playwright screenshots: admin dashboard, counsellor dashboard (with the walkthrough data present), drill navigation reaching the green room.
- CLAUDE.md: analytics module + dashboards note. Phase-wide quality review; fixes applied.

## Self-review notes
- Analytics unions rubric keys across template versions by key — weakestCriterion/heatmap stay meaningful with custom templates.
- Drill → practice preset uses ONLY existing flows (practice green room) — no new session modes.
- All charts inline SVG; no dependency additions.
