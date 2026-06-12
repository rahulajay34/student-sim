# Bug-hunt loop log

Autonomous 10-minute bug-hunt loop (cron 29bf0f2b), 2026-06-12 05:52 → 11:55 IST.
Each entry: focus area, findings (incl. refuted), fixes (file:line), verification.

## Coverage rotation
- [x] Prompts.jsx admin config editor vs current prompt-config/scoring-config shapes (iter 1)
- [x] analytics.js with mixed old/new report shapes (status:"generating" stubs) (iter 1)
- [ ] Admin CRUD pages (Personas/Courses/Rubrics/Assignments edit flows)
- [ ] Auth/routing guards + deep links
- [ ] Session resume edge cases (old sessions, ended sessions, foreign sessions)
- [ ] Objections/disposition logic edge cases
- [ ] Report fallback + regenerate paths
- [ ] useOpenAIRealtime lifecycle (reconnect, unmount, voice/mic change)
- [ ] GreenRoom flows (mic denied, assignment vs practice)
- [ ] store.js concurrency + data integrity
- [ ] stream.js SSE parsing edge cases
- [ ] lib/format.js helpers
- [ ] CallSidebar/CallStage UI state
- [ ] Keyboard/a11y
- [ ] smoke-api gaps

## Open items
(none yet)

## Iterations

### Iteration 1 — 2026-06-12 ~05:55–06:10 IST
Focus: Prompts.jsx config-editor seam · analytics.js vs mixed report shapes (2 parallel sonnet hunters).

Found 7 real bugs, all fixed and verified:
1. Stale `convincement` guideline in prompt-config.json promised dead behavior (thresholds/readyText no longer read since disposition.js) → rewrote guideline as DEPRECATED with pointers (data/prompt-config.json).
2. `coerceConfig` allowlist in scoring.js silently dropped unknown keys on admin save → now spreads `raw` (and `raw.counterMoves`) first so unknown keys survive round-trips (server/scoring.js:132,138).
3. Prompts.jsx "Register note" subtitle said "Hinglish cadence", contradicting the calibrated language policy → corrected subtitle (client/src/pages/admin/Prompts.jsx:274).
4. PUT /api/config/prompts could return the pre-write cached config on coarse-mtime filesystems → new invalidatePromptConfigCache() called after writeFileSync (server/promptConfig.js, server/index.js:1163).
5. `kpis.mocksCompleted` + heatmap reportCount counted status:"generating" stubs (inconsistent with counsellor rows) → filtered to scored reports (server/analytics.js:75,121).
6. `avgPercent` returned 0 instead of null with no scored reports — counsellor who just finished their first call saw "0% average" while the report generated → returns null; Dashboard's existing null-guard now renders "—" (server/analytics.js:355).
7. AdminReports score cell rendered a dangling "%" + empty red badge for stubs → "—" + slate "generating" badge (client/src/pages/admin/AdminReports.jsx:109).

Refuted/OK: prompt-config PUT round-trip preserves all keys (client sends full merged object); phaseInstructions key typing; turnDiscipline merge; backchannel empty-array fallback; analytics avgScore/weeklyTrend/recentReports/recommendedDrill all stub-safe; ReportDetail statusOf handles old reports; MyMocks links safe.

Verification: server tests 142/142 pass · client lint 0 errors · build success.
