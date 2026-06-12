# Bug-hunt loop log

Autonomous 10-minute bug-hunt loop (cron 29bf0f2b), 2026-06-12 05:52 → 11:55 IST.
Each entry: focus area, findings (incl. refuted), fixes (file:line), verification.

## Coverage rotation
- [x] Prompts.jsx admin config editor vs current prompt-config/scoring-config shapes (iter 1)
- [x] analytics.js with mixed old/new report shapes (status:"generating" stubs) (iter 1)
- [x] Admin CRUD pages (Personas/Courses/Rubrics/Assignments edit flows) (iter 2)
- [x] Auth/routing guards + deep links (iter 6)
- [x] Session resume edge cases (old sessions, ended sessions, foreign sessions) (iter 2)
- [x] Objections/disposition logic edge cases (iter 3)
- [x] Report fallback + regenerate paths (iter 3)
- [x] useOpenAIRealtime lifecycle (reconnect, unmount, voice/mic change) (iter 4)
- [x] GreenRoom flows (mic denied, assignment vs practice) (iter 4)
- [x] store.js concurrency + data integrity (iter 5)
- [x] stream.js SSE parsing edge cases (iter 5)
- [x] lib/format.js helpers (iter 6)
- [x] CallSidebar/CallStage UI state (iter 6)
- [x] Keyboard/a11y (iter 7)
- [x] smoke-api gaps (iter 7) — rotation COMPLETE; further iterations go deeper on open items + re-sweeps

## Open items
- ~~Session ownership check~~ DONE iter 8 (X-User-Id header + 403 guards on session/report routes, header-absent = back-compat allow).
- ~~EndedScreen report deep-link~~ DONE iter 8 (GET /reports?sessionId= + direct View-report link).
- ~~Remaining smoke checks~~ DONE iter 9 (104/104: persona/rubric delete 409s, /cue, ownership 403 trios, lead-profiles, config round-trip; practice-mode lifecycle deliberately skipped — doubles LLM smoke cost, noted in script).

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

### Iteration 3 — 2026-06-12 ~06:16–06:35 IST
Focus: objections/disposition edge cases · report fallback+regenerate paths (2 read-only sonnet hunters with node -e probes).

Found 5 real bugs, all fixed:
1. Premature "ready" with ZERO objections raised — 42.8% of easy-persona session ids could hit "agree to pay" in phase 1 off 10 good turns alone (probe: 428/1000) → ready now also requires raisedCount > 0 (server/disposition.js stageFromSignal + call sites).
2. RELATED_GROUPS over-grouping: answering tech_access or language_english silently resolved the unrelated course_fit_relevance concern → removed both micro-groups (server/objections.js:184-185).
3. Retry after the 3-min poll timeout left ReportDetail polling-dead forever (isGenerating true→true never re-ran the effect) → retryNonce dep + pollStartRef reset in handleRegenerate (ReportDetail.jsx).
4. session.endedAt overwritten on every regeneration → stamped only once (server/index.js:1092).
5. Session deleted between stub insert and job start left the report at "generating" forever → orphaned stub now flips to fallback/regenerable (server/index.js startReportJob).

Refuted/OK (heavily probed): computeDisposition NaN-safe on empty/missing scoreHistory/personality/scenario and at score 0/100; persuadability deterministic per session id and varies across ids; no stuck-guarded with all-addressed; raise/resolve safe on null/unknown/never-raised categories; re-raise updates lastPhrasing; /message vs /observe same resolve→raise order, no duplicate-category entries; steeringSummary safe on null phrasings/5 objections; regenerate arg sessionId correct end-to-end; stub fields preserved on regeneration (store.update merge); reportJobs Map always cleaned via finally; partial reports render sane; DELETE on generating report crash-free; pre-refactor fallback reports regenerate correctly.

Verification: server tests 142/142 pass · client lint 0 errors · build success · live probe: zero-objection perfect history → "warming" (was "ready"), one addressed concern → "ready".

### Iteration 4 — 2026-06-12 ~06:27–06:50 IST
Focus: useOpenAIRealtime lifecycle · GreenRoom/join flows (2 read-only sonnet hunters).

Found 7 real bugs, all fixed:
1. Zombie WebRTC connection: unmount during the token fetch let the in-flight connect() finish against a dead component (live mic + audio element + red recording dot) → unmount cleanup bumps connectGenRef before teardown (useOpenAIRealtime.js:584).
2. Late transcription.completed corrupted the NEXT utterance's delivery metrics (utterRef reset clobbered N+1 mid-speech) → pendingUtterRef parks a finished-but-untranscribed utterance; transcripts read it and never reset a live accumulator (useOpenAIRealtime.js speech_started/completed cases).
3. Steering error misattribution: ANY realtime error within 2s of a steering send was swallowed + permanently flipped role fallback → steering sends carry a client event_id; rejection matched by echoed id (or steering-shaped message), all other errors surface (useOpenAIRealtime.js error case + sendSteeringRaw).
4. Mic denied on voice join left a dead voice UI with no escape → degrades to text chat with a warn toast ("allow mic + refresh to retry voice") (Session.jsx auto-enable catch).
5. Test-mic stream + rAF leaked forever if the user clicked Join while the permission prompt was open → mountedRef guard releases the late stream (GreenRoom.jsx testMic).
6. Double /sessions/start for one assignment created a duplicate session and orphaned the first (assignment.sessionId overwritten) → 409 guard when a live session exists (server/index.js:441).
7. Auto-enable effect depended on the location.state OBJECT (its own state-clearing navigate re-fired it; only the ref guard prevented a second connect) → stable primitive deps (Session.jsx).

Refuted/OK: StrictMode double-mount guarded; changeVoice/changeMic/enable interleavings via generation counter; PTT mute-latch across reconnects; RMS sampler cleanup; metric division guards; no handler stacking or AudioContext growth across reconnects; steering never sends response.create; unmount teardown closes pc/mic/ctx; mic-device ideal-fallback wired through join+changeMic; devicechange listener cleanup; assignment override/rubric/profile threading; router state shape compatibility (assigned vs practice vs voice/text); back-navigation replace semantics; double-click Start guards; Safari permissions API absence.

Verification: server tests 142/142 pass · client lint 0 errors · build success.

### Iteration 5 — 2026-06-12 ~06:42–07:05 IST
Focus: store.js concurrency/durability · stream.js SSE parsing (2 read-only sonnet hunters with node -e probes).

Found 7 real bugs, all fixed:
1. Non-atomic writeFileSync: a crash mid-write truncates a collection and read()'s silent [] fallback wipes it permanently (sessions.json is written every turn) → tmp + renameSync atomic write, and corrupt reads now log loudly (server/store.js).
2. newId at 32 bits (~1.2% birthday collision by 10k records; getById silently serves the older record forever) → 48-bit 12-hex ids (server/store.js).
3. TOCTOU duplicate-session race on /sessions/start for assignments via the legacy counsellorFirst=false path (409 guard and insert straddle an LLM await) → per-assignment start lock reusing withSessionLock (server/index.js).
4. DELETE /api/sessions/:id on an ACTIVE session made in-flight turn writes silently no-op → 409 unless ended (server/index.js).
5. No SSE heartbeat before the first token (thinking mode can be silent 30s+; nginx/ALB idle defaults cut at 60s) → ": ping" comment frames every 15s until the first event (server/index.js /message).
6. Sentence chunker emitted tiny fragments on an early em-dash ("Ha —") via an unguarded fallback branch → branch removed; probe confirms no fragment + flush remainder intact (client/src/lib/stream.js:147).
7. No AbortController on the reply stream: late tokens/done could mutate wrapping-screen state and fire stale cue fetches after end-call/unmount → signal threaded through postMessageStream; aborted in doEndSession + unmount; AbortError clears the bubble quietly (stream.js, Session.jsx).

Refuted/OK (probed): cross-session concurrent /observe writes safe (store.update re-reads synchronously; single-threaded event loop); background report job's check+update atomic in one tick; withSessionLock covers reads; half-frame SSE buffering correct; JSON-escaped newlines make frame injection impossible; heartbeat comment frames skipped by the client parser; applyDone single-call; anti-loop substitution swap clean; sendingRef never deadlocks; abbreviation/ellipsis/danda/currency chunking correct; MAX_CHUNK force-flush correct; server error mid-stream sends an explicit error event.

Verification: server tests 142/142 pass · client lint 0 errors · build success · probes: newId 12-hex, chunker fragment gone + flush intact.

### Iteration 6 — 2026-06-12 ~06:58–07:15 IST
Focus: auth/routing guards + deep links · format.js helpers + CallStage/CallSidebar UI state (2 read-only sonnet hunters).

Found 7 real bugs, 6 fixed + 1 already-tracked:
1. Pressing N with the Assignments delete dialog open navigated away mid-confirm (focus on a button defeats the typing guard) → shortcut disabled while confirmRow set (Assignments.jsx:54).
2. /login rendered the form for already-authenticated users → immediate Navigate to homePathFor (Login.jsx).
3. homePathFor sent unknown/corrupt roles to /app where the role guard bounced them back — infinite redirect loop → explicit counsellor branch, unknown roles → /login (auth.jsx:43).
4. relativeDate("garbage") rendered "NaNd ago" in four list pages → NaN guard returns "" (format.js:103).
5. initials(null) threw TypeError (default param doesn't catch null; Avatar name={c.name} could crash Counsellors) → type guard returns "?" (format.js:121).
6. initials("🎉 Party") rendered a broken half-surrogate "�P" (found by own probe) → code-point-aware [...p][0] (format.js).
7. Score pulse fired spuriously on session resume (0 → hydrated score change on mount) → null-sentinel prevRef registers the first value silently (CallStage.jsx:722).
Already tracked: cross-counsellor report/session reads (ownership) — in open items since iter 2.
Refuted: "logout leaves voice running" — the hook's unmount cleanup (hardened in iter 4) tears down pc/mic on the redirect unmount.

Refuted/OK: corrupt mct_user fails soft to logged-out; role guards clean on cross-role deep links; bad report ids → EmptyState; login error handling; Personas/Courses/Rubrics N-guards include their modals; scoreColor/bandColor/difficultyColor on null/unknown; useCountUp on NaN/Infinity; StreamingBubble sink cleared on all exit paths; hidden Coach tab stays current (props flow while display:none); transcript auto-scroll respects user scroll-up; sendingRef double-submit guard; timer derives from origin (no background-throttle drift); Space PTT ignored while composer focused; MicPicker listener hygiene; orb rAF idle in text mode; analyser re-acquired after changeVoice; cue turn-counter guard covers both text and observe paths.

Verification: server tests 142/142 pass · client lint 0 errors · build success · probes: relativeDate ""/initials "?"/emoji initials correct.

### Iteration 7 — 2026-06-12 ~07:10–07:30 IST
Focus: keyboard/a11y · smoke-api gaps + live run (2 sonnet hunters; smoke hunter ran live probes with cleanup).

A11y: 7 functional breakages, all fixed:
1. Space PTT hijacked button activation in voice calls (focused "End call" + Space = mic unmute, every control Space-unreachable) → BUTTON/A/SELECT exempted from the PTT key handler (Session.jsx isTyping).
2. ToastStack live region early-returned when empty — AT ignores regions injected with their content → container always renders (Session.jsx:126).
3. Prompts admin toast silent to AT → persistent aria-live wrapper around the toast slot (Prompts.jsx).
4. Clickable table rows (reports lists) keyboard-unreachable → tabIndex + Enter/Space activation + focus-visible ring (ui/Table.jsx).
5. VoicePicker dropdown had no Escape/click-outside close and no aria-haspopup/expanded → mirrored MicPicker behavior (CallStage.jsx).
6. Input with label but no id rendered <label for="undefined"> → useId fallback (ui/Input.jsx).
7. GreenRoom mic permission status changes unannounced → role="status" on the always-mounted line (GreenRoom.jsx).

Smoke: live run 80/80 on the old suite; hunter's "regressions" were a STALE server process running pre-fix code since 05:07 (killed). Added 4 checks (now 84/84 on a fresh server at HEAD): duplicate-assignment-start → 409 with existing sessionId; delete-active-session → 409; /message and /observe after /end → 409. Deferred to open items: smoke checks for referenced-persona/rubric 409s, /cue endpoint, practice-mode lifecycle, lead-profiles, config round-trips.

Solid (verified): Modal trap incl. zero-focusables + Escape-during-loading; Table aria-sort semantics; native Slider semantics; SearchInput labels; Login form a11y; MicPicker dropdown a11y; cue turn guards.

Verification: server tests 142/142 · smoke 84/84 (fresh server) · lint 0 errors · build success.

### Iteration 8 — 2026-06-12 ~07:29–07:50 IST
Focus: open-items implementation · fresh-eyes re-sweep of today's 3 highest-churn files (1 implementer + 1 read-only hunter).

Implemented (open items):
1. Session/report ownership guard: client sends X-User-Id (api.js + stream.js); server 403s non-admin cross-counsellor access on GET/message/observe/end/cue/openai-token/DELETE session routes + GET report; absent header = back-compat allow (smoke/curl unaffected).
2. EndedScreen deep-links to the session's own report (GET /api/reports?sessionId= filter + View-report link with list fallback).

Re-sweep found 2 interaction bugs between today's fixes, both fixed:
3. Mic-denied degrade left the hook's stale voice.error rendering an error pill alongside the explanatory toast → status pill renders only in voice mode (CallStage.jsx:1090).
4. The final spoken turn could vanish from the report: a queued /observe racing /end at the server lock lost silently → doEndSession drains observeChainRef before calling /end (Session.jsx:852).

Interactions traced safe: auto-enable + degrade re-run (ref guard holds); start-lock key space + pruning (no leak); heartbeat cleared before every throw path; client abort leaves server transcript clean (turn not persisted on write-failure); replaceTrack doesn't strand utterance state (VAD is audio-based); score-pulse sentinel ordering; /message accepts voiceEngine=openai sessions (text degrade works).

Verification: server tests 142/142 · smoke 84/84 (fresh server) · lint 0 errors · build success · ownership probe on bad id → 404 (guard ordering correct).

### Iteration 9 — 2026-06-12 ~07:40–08:05 IST
Focus: prompt/report builders deep-sweep (probed composed output) · smoke coverage completion (1 hunter + 1 implementer).

Prompt sweep: 5 real bugs, all fixed — every one a self-contradiction in the composed prompts:
1. fewShot examples never address-rendered — "ma'am" calls saw four 'sir' example lines (prompt.js buildFewShotSection now renders; call moved after addressTerm init — caught a TDZ from my own first attempt via tests).
2. Voice-bank register lines never address-rendered ("Yes, sir." next to the ma'am rule) → rendered in buildRegisterReferenceSection.
3. personality.js injected a FOURTH language policy with conflicting wording ("at most one light Hindi word" vs the calibrated dial) → formality now only describes polish; LANGUAGE_POLICY is the single source (3 identical copies by design).
4. Realtime prompt had no phase-3 listen-and-acknowledge carve-out (10-30-word default = student talks over the pitch) → phase-3 rule added (3-10 words, one invited question).
5. Config meta-examples hardcode 'sir' ('hello sir', 'yes sir okay') and can't be auto-rendered → address sections in BOTH prompts explicitly de-fang generic 'sir' examples.

Smoke completion: +20 checks → 104/104 live (referenced-persona/rubric delete 409s, /cue endpoint, ownership 403/200/200 trios for session + report, lead-profiles + category filter, scoring-config PUT round-trip with restoration). No new server bugs found by the new checks.

Probes after fix: ma'am-call text prompt language-policy copies 4→3 (identical by design), exemplar/voice-bank/fewShot lines all ma'am-rendered; realtime carve-out present, 6.8k chars (budget 9.5k).

Verification: server tests 142/142 · smoke 104/104 · lint 0 errors · build success.

### Iteration 10 — 2026-06-12 ~08:01–08:15 IST
Focus: analytics math + dashboard rendering (1 probing hunter) · live browser sweep of both dashboards (orchestrator).

Found 4 real bugs, all fixed:
1. Radar "team average" included the requesting counsellor — at 2 counsellors the team line was half self (probe: mine=1, peer=5 → team showed 3) → team computed from OTHER counsellors' scored reports, solo fallback to all (server/analytics.js:334; probe now: team=5, solo=2).
2. Admin avgScore KPI returned 0 instead of null with zero scored reports — fresh installs showed a real-looking "0%" → null (server/analytics.js:83).
3. Weekly trend chart spaced points by array index, not date — 3 points spanning 9 calendar weeks rendered like consecutive weeks, lying about slope → time-proportional x from weekStart (AdminDashboard.jsx:122).
4. Objection hot-spots fragmented by LLM category drift ("fee"/"fees"/"fee_concerns" = 3 buckets of 1) → canonicalObjectionKey substring rules collapse onto objections.js keys (server/analytics.js).

Refuted/OK (probed): ISO-week Monday bucketing correct across the IST/UTC boundary; trendDelta guards for 1-2 reports; heatmap correct on mixed legacy/v2 rubrics with null (not 0) for absent criteria; recommendedDrill latest-by-generatedAt incl. regeneration; RadarChart <3-axes guard; CountUp renders 0; all .toFixed call sites null-guarded.

Live sweep: /login redirect for signed-in users works in-browser; counsellor + admin dashboards render with real data, zero console errors.

Verification: server tests 142/142 · lint 0 errors · build success · analytics probes (team-excl-self, solo fallback, null avgScore) pass.
