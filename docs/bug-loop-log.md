# Bug-hunt loop log

Autonomous 10-minute bug-hunt loop (cron 29bf0f2b), 2026-06-12 05:52 → 11:55 IST.
Each entry: focus area, findings (incl. refuted), fixes (file:line), verification.

## Coverage rotation
- [x] Prompts.jsx admin config editor vs current prompt-config/scoring-config shapes (iter 1)
- [x] analytics.js with mixed old/new report shapes (status:"generating" stubs) (iter 1)
- [x] Admin CRUD pages (Personas/Courses/Rubrics/Assignments edit flows) (iter 2)
- [ ] Auth/routing guards + deep links
- [x] Session resume edge cases (old sessions, ended sessions, foreign sessions) (iter 2)
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
- Session routes have no ownership check (any counsellor can read/message/end another's session by URL). Dummy auth is by design (CLAUDE.md), but a light counsellorId check on /sessions/:id routes would prevent accidental cross-ending. Deferred — needs an identity header the client doesn't send yet.
- EndedScreen "View reports" links to the list, not the session's own report (minor UX; needs reportId lookup on the ended path).

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

### Iteration 2 — 2026-06-12 ~06:09–06:22 IST
Focus: admin CRUD flows · session resume/lifecycle edges (2 parallel sonnet hunters; CRUD hunter applied its fixes directly — diff reviewed and accepted).

Found 8 real bugs, 7 fixed + 1 deferred:
1. Personas.jsx client default formality 2 vs server default 3 — every untouched new persona saved the wrong formality → aligned to 3 (client/src/pages/admin/Personas.jsx:34).
2. DELETE /api/personas/:id allowed deleting personas with active assignments → 409 with actionable message (server/index.js).
3. DELETE /api/rubric-templates/:id same gap → 409 guard (server/index.js).
4. DELETE /api/assignments/:id with a live session left the session's assignment update no-oping at /end → 409 guard (server/index.js).
5. AssignmentCreate submit silently discarded manual edits to the pre-filled situation textarea (profile description always won) → textarea is source of truth (AssignmentCreate.jsx:206).
6. Practice.jsx had the identical situation-override bug the hunter missed → same fix (Practice.jsx:148).
7. Voice sessions never reconnected on refresh/resume/bookmark — live call UI mounted with a dead connection (autoVoice router-state gate) → voice now (re)connects whenever the session is a voice session (Session.jsx:549).
8. DEFERRED (open item): no ownership check on /sessions/:id routes.

Refuted/OK: ended-session resume renders EndedScreen safely; /end double-call idempotent across tabs (withSessionLock + status branches); turnCounter staleness after remount safe; /app/session/new with null router state redirects cleanly; sessionMode stale-default race is safely ordered by .then/.finally; prompt-config PUT round-trip clobber concern unfounded.

Verification: server tests 142/142 pass · client lint 0 errors · build success.
