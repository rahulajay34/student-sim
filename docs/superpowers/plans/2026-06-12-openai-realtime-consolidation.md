# OpenAI-Realtime Consolidation & Platform Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Tasks are dispatched to parallel subagents in waves; each wave merges + verifies before
> the next starts. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved spec at `docs/superpowers/specs/2026-06-12-openai-realtime-consolidation-design.md` — OpenAI-realtime-only voice with mid-call steering, English-first personas, async parallel reports, dynamic (non-threshold) convincement, UI overhaul, bug audit — then push to GitHub main.

**Architecture:** Three waves. Wave 1 runs four independent agents (student brain · report pipeline · UI overhaul · accent research) with disjoint file ownership. Wave 2 runs two agents (realtime server · session client) against pinned contracts, consuming Wave 1 modules. Wave 3 is a find→verify bug workflow plus full verification and push. The orchestrator (main session) merges, resolves, verifies between waves.

**Tech stack:** Express ESM + JSON store + MiniMax-M3 (`server/ollama.js`); React 19 + Vite + Tailwind v4; OpenAI Realtime GA API over WebRTC (`gpt-realtime`, ephemeral client secrets, `session.update` steering).

**Verification gate (every wave):** `node --test server/tests/*.mjs` · `cd client && npm run lint && npm run build` · server boots (`node server/index.js` smoke) · wave-specific checks below.

---

## File ownership map (no agent may touch files outside its set)

| Agent | Owns |
|---|---|
| W1-A student-brain | `server/prompt.js`, `server/disposition.js` (new), `server/personality.js`, `server/objections.js`, `server/scoring.js`, `server/engine.js`, `server/data/prompt-config.json`, `server/data/scoring-config.json`, `server/data/personas.json`, `server/data/seed/archetypes.json`, `server/tests/*` |
| W1-B report-pipeline | `server/report.js`, `server/index.js` (ONLY `/end` handler + `/reports` routes), `client/src/lib/api.js`, `client/src/pages/shared/ReportDetail.jsx` |
| W1-C ui-overhaul | `client/src/ui/*`, `client/src/layouts/*`, `client/src/pages/admin/*`, `client/src/pages/counsellor/{Dashboard,MyMocks,Practice,Reports}.jsx`, `client/src/pages/Login.jsx`, `client/src/index.css`, `client/src/lib/format.js`, `client/src/main.jsx` |
| W1-R accent-research | read-only + `docs/research/indian-accent-prosody.md` (new) + temp work dir |
| W2-S realtime-server | `server/realtime.js`, `server/index.js` (observe/token/session-start regions), `server/voices.js`, `scripts/smoke-api.mjs`, delete `voice-server/`, `server/data/realtime.json` |
| W2-C session-client | `client/src/pages/counsellor/Session.jsx`, `client/src/pages/counsellor/session/*`, `client/src/voice/*`, `client/src/lib/stream.js` |
| W3 | bug fixes anywhere (orchestrator-mediated), `CLAUDE.md`, `CONTRACT.md` |

## Pinned interface contracts

**C1 — Disposition module** (`server/disposition.js`, W1-A provides; W2-S consumes):
```js
// Deterministic per session (hash sessionId for the hidden roll), no Date.now/random.
export function computeDisposition(session) {
  return {
    stage: "guarded" | "listening" | "warming" | "ready", // emergent, for telemetry/steering
    narrative: "...2-4 sentences, second person, NO numbers, NO 'threshold'...",
    persuadability: 0.0-1.0, // hidden; from persona skepticism/hesitancy ± seeded variance
  };
}
export function renderDispositionSection(disposition) { /* prompt block, replaces score bands + convincement */ }
```

**C2 — `/observe`** (W2-S): request `{ counsellorText?, studentText?, deliveryMetrics? }` →
response adds `steering: string` (compact CURRENT STATE block: disposition narrative,
open/answered objections with last-used phrasing, phase, turn-length reminder) to the
existing `{ currentPhase, satisfactionScore, scoreReason, turnType, milestones, cue }`.

**C3 — Steering client-side** (W2-C): after each student-turn observe response, send on the
WebRTC data channel: `{ type: "session.update", session: { type: "realtime", instructions: BASE + "\n\n## CURRENT STATE (live)\n" + steering } }`. BASE is byte-stable from connect time.

**C4 — Async report** (W1-B provides; W2-C consumes): `POST /api/sessions/:id/end` persists a
stub report `{ ...metadata, scoreArc, benchmarks, transcript, status: "generating" }` and
returns `{ reportId, status }` **immediately**; background promise fills LLM sections and
flips `status` to `"ready"` or `"fallback"`. `GET /api/reports/:id` returns the current
record. Client navigates to ReportDetail instantly; ReportDetail polls every 2s while
`status === "generating"` (give up to fallback notice at 3 min). Idempotent `/end` re-calls.

**C5 — Session modes** (W2-S/W2-C): session start body gains `mode: "voice" | "text"`;
`session.voiceEngine` = `"openai" | "text"`. Text sessions use the existing `/message`
SSE path unchanged; voice sessions use realtime + `/observe`.

**C6 — Language policy** (single sentence used everywhere a language rule appears, W1-A + W2-S):
"Speak natural Indian English. At most one light Hindi word every few turns; never full
Hindi sentences unless the counsellor themselves speaks full Hindi sentences repeatedly."

---

## Wave 0 — Baseline (orchestrator)

- [ ] Run `node --test server/tests/*.mjs`, `cd client && npm run lint && npm run build`; record green baseline (fix execute-bit quirk via `chmod +x node_modules/.bin/*` if needed).

## Wave 1 (four agents in parallel)

### Task W1-A: Student brain — Hinglish, anti-loop, dynamic disposition

- [ ] **A1 Hinglish root-cause fixes** (use contract C6 verbatim):
  `server/data/seed/archetypes.json` — rewrite `languageTexture` of `automation_scared_switcher`, `reel_struck_parent_gated_fresher`, `family_business_modernizer`: Indian-English texture descriptions, delete every Hinglish example sentence.
  `server/personality.js` — `DEFAULT_PERSONALITY.formality` 2→3; rewrite the three formality language strings to C6 phrasing without naming Hindi tokens.
  `server/data/personas.json` — formality 2→3 for studying/diff-field/non-working; replace the diff-field quirk `"switches to Hindi phrases when worried…"` with an English anxiety tell (e.g. trails off, repeats "actually").
  `server/data/prompt-config.json` — replace the `"Achha haan okay…"` few-shot with plain Indian-English; remove `'theek hai'` from `turnDiscipline.statementListen` and the named tokens in `naturalSpeech`; rewrite the mirroring rule in `behaviourRules` + `registerNote` to C6.
- [ ] **A2 Anti-loop:** `server/objections.js` — store `lastPhrasing` (the student's actual sentence) when raising; `summarizeForPrompt` quotes it under "NEVER repeat this phrasing"; loop-break nudge at `timesRaised >= 2`. Export `steeringSummary(state)` (short form for C2).
- [ ] **A3 Disposition module (C1):** create `server/disposition.js` — momentum from last-6 `scoreHistory` deltas, objection ledger ratio, persona skepticism/hesitancy, seeded persuadability (FNV/xor hash of `session.id`); stage emerges from combined evidence (no fixed score cutoffs; score *level* may inform but trajectory + objections dominate). `renderDispositionSection` replaces `buildScoreSection` + `buildConvincementSection` in `prompt.js`; DELETE "AGREEMENT THRESHOLD", the below-70 decline rule, the 5 score-band strings, and any numeric score exposure to the student. Keep `computeConvincementHint` as a thin alias returning `stage` so existing imports don't break.
- [ ] **A4 Turn shape:** prompt-config verbosity/natural-speech — spoken target 5–15 words most turns; "never open two consecutive turns with the same word"; rotate fillers. Intro variety: opening message instruction parameterized with leadCard facts + instruction to improvise phrasing.
- [ ] **A5 Early-phase scoring:** `server/scoring.js` + `scoring-config.json` severity bands — add ±1–3 guidance for rapport/discovery quality (good open questions, acknowledgement, agenda-setting) so phases 1–3 move the meter; keep `neverPenalizeAbsence`.
- [ ] **A6 Tests:** extend `server/tests/` — disposition determinism per sessionId, stage progression on objection-addressed + momentum, no "70" or "THRESHOLD" string in any composed prompt, objection lastPhrasing ban present after re-raise, language-policy string present exactly once. Run `node --test server/tests/*.mjs` → PASS.

### Task W1-B: Report pipeline — async + parallel + structure (C4)

- [ ] **B1 Parallel fan-out:** `server/report.js` — split `buildPrompt` into Call A (rubric + phaseBreakdown), Call B (strengths/improvements/keyMoments + `overall.headline` "next session focus"), Call C (drills; runs after A with weakest criteria). `Promise.all([A,B])` then C. Adaptive thinking only when `transcript.length > 20`; retry attempt 2 = thinking disabled, 60s timeout. Same assembled shape + `headline`.
- [ ] **B2 Background generation:** `/end` in `server/index.js` — persist stub (scoreArc, benchmarks, transcript, metadata, `status:"generating"`), return immediately; in-memory `Map<sessionId, Promise>`; on resolve update report to `status:"ready"` (or `"fallback"`, `regenerable:true`); session marked ended at stub time so locks release. Re-call of `/end` while generating returns same `{reportId, status}`.
- [ ] **B3 Client live-fill:** `ReportDetail.jsx` — render instantly-available sections at once; skeleton + poll (2s) for LLM sections while `status==="generating"`; surface fallback notice with a working "Regenerate" button (fixes dead `degradedNotice`); count-up animation on `overall.percent`. `api.js` — ensure `getReport` passthrough + add `regenerateReport` if missing.
- [ ] **B4 Tests:** report assembly unit test with stubbed `chat` (parallel calls invoked, headline present, fallback path); run suite → PASS.

### Task W1-C: UI/UX overhaul (non-session pages)

- [ ] **C1 Kit:** `Modal.jsx` focus trap + `aria-labelledby`/`aria-describedby` + restore focus; new `ConfirmDialog` in `ui/`; `Table` sortable headers + optional search prop; toasts get `aria-live`.
- [ ] **C2 Replace all 4 `window.confirm`** (Assignments, Personas, Courses, Rubrics) with `ConfirmDialog`.
- [ ] **C3 Kill reload-as-retry:** `Practice.jsx`, `AssignmentCreate.jsx`, `Reports.jsx` — named `load()` + retry button; parallelize fetch waterfalls with `Promise.all`.
- [ ] **C4 Engagement:** admin list pages get search + sort + `N`-key create shortcut; dashboard stat cards count-up; consistent empty states; AssignmentCreate progress indicator; visual polish per frontend-design taste (existing indigo/light + dark-stage language refined, not rethemed).
- [ ] **C5 Verify:** `npm run lint && npm run build` → clean.

### Task W1-R: Accent research (read-only)

- [ ] Sample 8–12 audio URLs from `counselling_ba_courses - Sheet1.csv`; reuse `scripts/mine/audio` uv env (`fetch.py`/`analyze.py`) or ffmpeg+librosa fallback; aggregate WPM band, pause cadence, pitch range/variation, filler inventory for STUDENT speakers. Write `docs/research/indian-accent-prosody.md` including a ready-to-paste "VOICE DELIVERY" instruction block (used by W2-S in the realtime prompt). PII stays out of the doc (stats + style notes only).

## Wave 2 (two agents in parallel, after Wave 1 merged + verified)

### Task W2-S: Realtime server — OpenAI-only + steering + fast observe

- [ ] **S1 Removals:** strip ElevenLabs agent code from `server/realtime.js`; delete `/realtime/elevenlabs-token` route and `server/data/realtime.json`; delete `voice-server/` directory.
- [ ] **S2 Slim realtime prompt:** new `buildRealtimeInstructions(session)` composing FROM scratch for voice (persona/leadCard identity, scenario, knowledge bounds, archetype texture, disposition narrative, objection steering seed, C6 language policy, VOICE DELIVERY block from `docs/research/indian-accent-prosody.md` with real numbers, turn-length 5–15 words, no emotion tags, no text few-shots). Target ≤ ~1.8k tokens; add a unit test asserting no `[emotion`, no "THRESHOLD", and length budget.
- [ ] **S3 Token mint:** session config — `turn_detection: { type: "semantic_vad", eagerness: process.env.OPENAI_VAD_EAGERNESS || "auto" }`; transcription model default `gpt-4o-mini-transcribe` (env `OPENAI_TRANSCRIBE_MODEL`); voices gender-mapped marin/cedar unchanged.
- [ ] **S4 Observe (C2):** accept `deliveryMetrics` on counsellor turns (sanitized, same shape report reads); strip `[emotion:*]` and bare trailing emotion words server-side before storing; scoring call: thinking disabled, last-6-turns context, 15s timeout, score failure non-fatal (adjustment 0); response gains `steering` built from `computeDisposition` + `steeringSummary` + phase.
- [ ] **S5 Session start:** accept `mode` (C5), set `session.voiceEngine`; keep text mode on `/message`. Update `scripts/smoke-api.mjs` for new/removed endpoints. Run server tests + smoke → PASS.

### Task W2-C: Session client — one engine, steering, delivery metrics, call UX

- [ ] **CL1 Removals:** delete `useVoiceConversation.js`, `tts.js`, `stt.js`, `audioPlayer.js`, `sidecarClient.js`, `useElevenLabsRealtime.js`; purge engine picker + ElevenLabs voices from `engines.js` (engine constant `openai` only), GreenRoom `SidecarCheck`, CallStage sidecar pill; drop `kokoro-js`, `@huggingface/transformers`, `@ricky0123/vad-web`, `@elevenlabs/react` deps + the now-unneeded `optimizeDeps.exclude` entries (verify build).
- [ ] **CL2 GreenRoom:** two equal-prominence options — "Join call" (voice) and "Practice by text" (C5 `mode`); mic permission check stays; brief shows persona trait chips.
- [ ] **CL3 Steering (C3):** on each student-turn observe response, `session.update` with BASE + CURRENT STATE over the data channel (guard: dc open, debounce to latest).
- [ ] **CL4 Delivery metrics:** per counsellor utterance compute `{ wpm, pauses, energyVar, durationMs }` from VAD start/stop events + transcription word count + local mic AnalyserNode RMS sampling; attach to `/observe` (C2).
- [ ] **CL5 Text-in-call + text mode:** voice calls keep `sendText` via data channel; text sessions reuse `/message` SSE chat UI (no voice hooks mounted).
- [ ] **CL6 Call UX:** end-call navigates to report immediately (C4) — WrappingScreen becomes a brief transition (elapsed-time aware); `React.memo` transcript bubbles; isolate streaming text state so tokens don't re-render the whole tree; score-change pulse on the live meter; keep Space PTT (mute-latch) behavior.
- [ ] **CL7 Verify:** lint + build clean; manual flow check via dev server.

## Wave 3 — Bug audit, verification, ship (orchestrator)

- [ ] **V1 Bug workflow:** Workflow find→adversarial-verify over (a) server logic/store/locks, (b) client React/hooks/routing, (c) realtime+observe layer, (d) data-shape consistency (old sessions without new fields — fail-soft everywhere). Fix confirmed bugs.
- [ ] **V2 Full gate:** server tests, client lint+build, `scripts/smoke-api.mjs` against running server, Playwright drive: login → green room → text session 3 turns → end → report fills live; voice green-room mint path (skip if `OPENAI_API_KEY` absent — assert graceful error).
- [ ] **V3 Docs:** update `CLAUDE.md` + `CONTRACT.md` (modes, endpoints, env vars incl. `OPENAI_API_KEY` required for voice, sidecar removal).
- [ ] **V4 Ship:** secret scan (`git diff --staged` for keys; verify `.env`, `client/.claude/settings.local.json` not staged), commit, push `origin/main`.
