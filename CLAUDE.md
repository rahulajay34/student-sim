# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **mock counselling training platform**. Two roles:
- **Admin** manages a persona library and assigns mock counselling sessions to counsellors.
- **Counsellor** runs a phase-based, voice-or-text sales simulation against an LLM-roleplayed prospective student for the IIM Ranchi × Masai analytics programme.

On session end, a report stub is returned immediately and LLM grading runs in the background; the rubric-based coaching report is visible to the counsellor (own reports) and admin (all reports). Auth is dummy/pre-seeded; no real security.

Two independent npm packages, no root package.json:
- `server/` — Express API (ESM) + JSON file store + the conversation/scoring/report engine.
- `client/` — React 19 + Vite 8 + react-router v7 + Tailwind v4 SPA.

See `CONTRACT.md` (repo root) for the authoritative API shapes, data shapes, routes, design tokens, and UI-kit component props. `docs/superpowers/specs/` holds the design doc.

## Commands

```bash
# Server (port 3001) — needs ANTHROPIC_API_KEY + OPENAI_API_KEY in repo-root .env
cd server && npm install && npm start         # or: npm run dev (node --watch)

# Client (Vite dev server, proxies /api -> :3001)
cd client && npm install && npm run dev
npm run build      # production build      | npm run lint   # eslint .

# End-to-end API smoke test (legacy Express server must be running)
node scripts/smoke-api.mjs

# End-to-end smoke against the DEPLOYED Supabase stack (auth, RLS, live LLM turns, report worker)
node scripts/smoke-edge.mjs

# Static check: every named ESM import across supabase/functions actually exists
# (catches the boot-error class node --check and deno cache both miss)
node scripts/check-edge-bindings.mjs

# Server unit tests (no running server needed)
node --test server/tests/*.mjs

# Regenerate the 15-course catalog text dumps (then re-run LLM extraction + assembly)
node scripts/scrape-courses.mjs
node scripts/validate-courses.mjs                # sanity-check courses.json shape

# Rebuild the 170 real-call lead profiles (deterministic, no LLM) from persona-profiles.md
node scripts/build-lead-profiles.mjs             # -> server/data/leadProfiles.json
```

Note: if `npm run dev/build/lint` fails with "Permission denied" on a `node_modules/.bin/*` shim, run `chmod +x node_modules/.bin/*` (a quirk of this filesystem; the bins ship without the execute bit).

## Environment

- `.env` at the **repo root** (server reads `../.env`); must contain `ANTHROPIC_API_KEY` (LLM analytics brain; optional `ANTHROPIC_MODEL` override, default `claude-sonnet-4-6`) and `OPENAI_API_KEY` (voice — never sent to the browser; mints ephemeral tokens). `OLLAMA_API_KEY` is only needed for the offline mining/diarization scripts; `MINIMAX_API_KEY` is no longer used.
- Optional OpenAI knobs: `OPENAI_REALTIME_MODEL` (default `gpt-realtime`), `OPENAI_REALTIME_VOICE` (female default, default `marin`), `OPENAI_REALTIME_VOICE_MALE` (default `cedar`), `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`), `OPENAI_VAD_EAGERNESS` (default `auto`).
- `ELEVENLABS_API_KEY` is **no longer used by the running app** (removed with the classic + ElevenLabs pipelines). No voice sidecar.
- The LLM is **Claude Sonnet 4.6** (`claude-sonnet-4-6` via the official `@anthropic-ai/sdk`) — `server/llm.js` is the client; `server/ollama.js` is a thin re-export shim kept for legacy import paths. Two modes: `mode:"fast"` (thinking disabled, effort low — student replies, coherence gate, per-turn scoring) and `mode:"reasoning"` (adaptive thinking, effort high — report calls + `/cue`). Scoring/cue/report calls use schema-enforced JSON via a `jsonSchema` option. Claude is the **analytics brain** — scoring, cues, objection tracking, phase, and the report — fed by `/observe` in voice sessions. See CONTRACT.md "Single-model note" for the full options surface.

## Server architecture (`server/`)

`index.js` wires the REST API; logic is split into focused modules:
- `store.js` — JSON file store under `server/data/*.json`. `users.json` + `personas.json` + `courses.json` + `rubric-templates.json` ship seeded; `assignments.json`/`sessions.json`/`reports.json` are created empty on first run. Writes are atomic (tmp-file + rename). `newId` emits 12-hex-char suffixes (48-bit). Corrupt-read (non-ENOENT) prints a loud warning and treats the collection as empty. Generic `getAll/getById/insert/update/remove`.
- **Lead profiles** (`leadProfiles.json`, read directly in `index.js`): 170 PII-free real-call lead descriptions in 4 categories, built by `scripts/build-lead-profiles.mjs`. Served read-only via `GET /api/lead-profiles`. An assignment/session carries an optional `profileId`; at session start it resolves to a `leadCard` snapshot that gives the student a real name and gender, which drives the gender-matched OpenAI voice (marin/cedar).
- `phases.js` — 5-phase non-strict machine (Opening → Discovery → Presentation → Objections & Negotiation → Close) + milestone tracking. `advancePhase` mutates `session.currentPhase` and `session.milestones` based on message counts + corpus-derived keyword regexes.
- `register.js` — loads `server/data/seed/{register-lines,voice-bank,register-stats}.json` once; exposes `registerLines()`, `voiceBankFor(category, phase, n?)`, and `registerStatsFor(phase)` for grounding the text-session student prompt.
- `personality.js` — trait schema (talkativeness/humour/skepticism/formality 1–5 scales, quirks array), `DEFAULT_PERSONALITY`, `rollSessionFlavour(persona.personality)`, and `renderPersonalitySection(flavour)`.
- `grounding.js` — loads `server/data/seed/*` once; exposes `archetypeForPersona(personaSnapshot)` and `objectionRepertoire(archetype, difficulty)` for the student prompt and report engine.
- `prompt.js` — composes the student system prompt for text sessions; exports `LANGUAGE_POLICY` (English-first, one light Hindi particle every couple of turns — calibrated dial) and `buildKnowledgeBounds(cfg, course)` (reused by `realtime.js`). Disposition replaces the old score-band/convincement sections: `computeDisposition` + `renderDispositionSection` from `disposition.js` inject a narrative of how the student feels, with no numbers exposed. Custom personas (category `"custom"`, no mined archetype) receive a generic fallback objection repertoire from phase 3 onward.
- `styleExemplars.js` — loads `server/data/seed/style-exemplars.json` (81 owner-calibrated lines, grouped by moment + phase, with dials + anti-patterns). `exemplarsFor(phase, n, seed)` returns deterministically rotated style anchor lines; `renderAddress(line, addressTerm)` swaps "sir" → "ma'am" when the counsellor is female. Both are used in the text prompt (`prompt.js`) and the voice steering block (`buildSteering` in `index.js`). Session start calls `inferGenderFromName` on the counsellor's name to set `session.counsellorAddress` ("sir"/"ma'am"/null), snapshotted so the address term stays stable across the call.
- `disposition.js` — replaces the old threshold-based convincement model. `computeDisposition(session)` → `{ stage: "guarded"|"listening"|"warming"|"ready", narrative, persuadability }`. Stage emerges from score momentum, objection-addressed ratio, good/bad turn counts, and a per-session deterministic persuadability roll (FNV-1a hash of session id blended with persona skepticism + scenario hesitancy). `"ready"` requires a high readiness signal AND no open objections AND `raisedCount > 0` (the student can't agree to pay before any concern has been raised and addressed). No numeric thresholds; no score value is exposed to the student prompt. `convincementParamsFor` is LEGACY — kept for unit tests only.
- `engine.js` — `getFirstMessage` / `getStudentReply`; builds the LLM message array for text sessions; runs the coherence gate and anti-loop guard (>0.8 token-overlap with the last 6 student turns → regenerate once → move-forward fallback).
- `scoring.js` — per-message −10..+10 LLM scoring → live satisfaction score; includes early-phase (1–3) severity bands. Leniency knobs load fail-soft from `data/scoring-config.json`.
- `report.js` — `generateReport`: parallel LLM fan-out: Call A (rubric + phaseBreakdown) and Call B (strengths/improvements/keyMoments + overall.headline) run via `Promise.all`; Call C (drills) runs after A; Call D (personaAddressed) runs concurrently with A/B; Call E (integrityCheck — `mode:"reasoning"`, independent try/catch) runs concurrently and writes `report.integrityCheck` (admin-only); Call F (`newReport` — `mode:"reasoning"`, independent try/catch) runs concurrently and writes `report.newReport` (admin-only additive 8-parameter 0-5 evaluation scaled to /100, persisted via migration `0010_new_report.sql`, stripped at the edge for non-admins, rendered in ReportDetail as "New Report Section" beneath an "Old Report Section" divider); Call G (`transliterate` — `mode:"fast"`, independent try/catch) runs concurrently ONLY when the transcript has turns in a non-Latin script (deterministic `hasNonLatinScript` detector — Devanagari/Arabic/…; romanized Hinglish + English never match, so all-English calls add no LLM cost), and writes a `latinText` field onto just those turns (original `text` preserved) in `report.transcript`, persisted via migration `0011_transcript_latin.sql` (adds `transcript` to the `commit_report` whitelist) — live in-call transcription is unaffected; the report shows `latinText` by default with an admin-only "Show original" toggle in ReportDetail. If Call A fails entirely → neutral fallback (`fallback:true`); if only B/C/D/E/F/G fails → `report.partial = true`. `stubReportSections(session)` returns instantly-available data (scoreArc/benchmarks/transcript) for the stub. `needsRegeneration(report)` is true when `report.fallback === true`.
- `classify.js` — `classifyCounsellorTurn(text)`: deterministic, LLM-free classifier into `statement`/`question`/`invite` (Hinglish + Devanagari aware).
- `promptConfig.js` — loads editable prompt scaffolding from `data/prompt-config.json`, failing soft to built-in defaults.
- `courseContext.js` — `fmtINR` + `LEGACY_COURSE_CONTEXT`; the v2 prompt injects scoped knowledge bounds per the session's course.
- `voices.js` — `pickStudentVoice`: assigns a voice identity (name + gender) at session start, snapshotted as `session.voice`. No ElevenLabs voice ids; only `key`, `name`, `gender` are used — for the student's display name and to gender-match the OpenAI realtime voice.
- `realtime.js` — OpenAI Realtime plumbing: `mintOpenAIClientSecret` (mints ephemeral `ek_…` token), `buildRealtimeInstructions(session)` (voice-first persona prompt: character framing, who-you-are, situation, knowledge bounds, disposition narrative, language policy, voice delivery, conversation rules — ≤~1.8k tokens), `openAIVoiceForSession` (gender-matched default: female→marin, male→cedar). Never exposes the standing `OPENAI_API_KEY` to the browser. Endpoint: `POST /sessions/:id/realtime/openai-token`.
- `objections.js` / `cues.js` — objection lifecycle tracker + `steeringSummary(state)` (compact plain-text, used in the `steering` field returned by `/observe`). Objections track `lastPhrasing` with re-use bans; loop-break nudge fires when `timesRaised >= 2`.
- `integrityProbes.js` — integrity-probe feature: `DEFAULT_PROBES` (24 seed probes — 10 added over the original 14, covering placement timing, interview guarantee, attendance-break placement, assessment retakes, recordings download, anytime mentor, project shortlist, specific-company placement, native-language support, and free tools/subscriptions), `loadProbes(configValue)` (fail-soft merge over defaults), `pickProbe(probes, sessionId)` (deterministic FNV-1a hash, active probes only). Probe library stored in `app_config` key `integrityProbes` and served/persisted via `GET/PUT /integrity-probes` (admin-only). At session start one probe is picked and snapshotted as `session.integrityProbe` (via `SNAPSHOT_KEYS`); injected into text prompt (`prompt.js`) and voice instructions (`realtime.js`) as a natural "ask once" directive without exposing `groundTruth`. After session end, report Call E evaluates the transcript and writes `report.integrityCheck`; `integrityProbe` and `integrityCheck` are stripped from non-admin API responses. Migration `0009_integrity_check.sql` adds `reports.integrity_check` (jsonb) and extends `commit_report`. Admin UI: `client/src/pages/admin/IntegrityProbes.jsx` at route `/admin/integrity-probes`. Mirror module at `supabase/functions/_shared/lib/integrityProbes.js` (Supabase parity).

## Usage / cost tracking (`Usage` admin section)

Per-call API cost tracking for both providers, admin/superadmin-only. `usagePricing.js` holds USD rate cards (Claude Sonnet 4.6 confirmed: $3 in / $15 out / $3.75 cache-write / $0.30 cache-read per MTok; OpenAI realtime + transcribe best-effort, isolated for one-line correction) and `priceUsage()`; `usageFx.js` fetches a live USD→INR rate (cached in `app_config` key `usdInrRate`, ≤2×/day, fallback ₹86.5) applied at **read time** so re-rating is free. Both mirrored to `supabase/functions/_shared/lib/`.

`llm.js` exposes `setUsageSink(fn)` — `chat()`/`chatStream()` capture `response.usage` and emit `{provider,model,mode,usage,meta}` when a caller passes `options.usage` ({feature,sessionId,counsellorId,personaLabel}) (absorbed into `_rest`, never sent to the API). Instrumented call sites: report Calls A–G (feature `report`), `getStudentReply`/`getStudentReplyStream` (`student_reply`), `scoreMessage` via chatOpts (`scoring`), `llmCue` (`cue`). OpenAI voice/transcription usage is forwarded by the browser (`useOpenAIRealtime` stashes `response.done` usage onto the next student turn + transcription usage onto the counsellor turn) → `/observe` body `realtimeUsage`/`transcriptionUsage` → recorded as features `voice`/`transcription`. Tracking starts at ship time (no backfill). The Anthropic sink is registered in the `session` + `report-worker` edge functions; the `api` function serves the read endpoints.

Storage: migration `0012_usage_events.sql` — `usage_events` table (RLS enabled, **no policies** → service-role only) + `usage_overview`/`usage_sessions`/`usage_session_detail` SQL RPCs (service-role grant). Edge functions buffer events and `flushUsage()` (one batched insert, awaited) before returning. Legacy Express writes to a JSON `usage` collection and aggregates in JS. Endpoints: `GET /usage?from&to&model&page&pageSize` (overview KPIs + per-day/model/feature/provider breakdowns + paged per-session rows + distinct models + fxRate) and `GET /usage/session/:id` (per-call drilldown). Client: `pages/admin/Usage.jsx` at `/admin/usage` (KPI cards, SVG bar/trend charts, date+model filters, paginated per-session table with expandable per-call breakdown); `fmtINR`/`fmtTokens` in `lib/format.js`.

## Spoken English Fluency (Tier 1, Supabase stack only)

Judges how fluently/confidently a counsellor speaks English from their **voice**, not the cleaned Realtime transcript (which silently drops fillers/false-starts and tidies grammar — erasing the evidence). Voice sessions only; report-time. Flow:
1. **Capture** — `useOpenAIRealtime` records the counsellor's mic track (the same track already on the WebRTC peer connection — no second `getUserMedia`) via `MediaRecorder` (Opus/WebM, 32kbps, 3s timeslice) for the whole call. `finishRecording()` flushes + returns the blob. Records the counsellor only, never the student's synthesized voice. GreenRoom shows an informational consent line.
2. **Upload + trigger** — on call end (`doEndSession`), after the report stub exists, `Session.jsx` uploads the blob to the private `call-audio` Storage bucket (`{sessionId}/counsellor.webm`, via the browser `supabase` client — RLS by `auth.uid()` owns the session) then calls `POST /sessions/:id/fluency` (detached, best-effort). Decoupled from the report worker on purpose: the worker is kicked the instant a call ends and would race the upload.
3. **Analyze** (`session` edge fn `POST /sessions/:id/fluency`, owner/admin) — downloads the audio (service role), re-transcribes **verbatim** with Whisper (`_shared/whisper.js`, `whisper-1` + `verbose_json` + word timestamps; reuses `OPENAI_API_KEY`), computes deterministic metrics (`_shared/lib/fluencyMetrics.js` — articulation rate, mid-speech pauses, filled-pause rate, repair rate, mean-length-of-run; pure/unit-tested), then Claude judges (`_shared/lib/fluency.js` — `judgeFluency`, schema-enforced reasoning call, fairness guardrail: grade intelligibility/fluency NOT accent — Indian-English/ESL is the norm). Writes `report.fluency` via a **direct** service-role update (NOT `commit_report`, so report regenerations preserve it; no `commit_report` change needed). Whisper cost recorded via the usage sink (`whisper-1` per-minute pricing in `usagePricing.js`).
4. **Render** — `ReportDetail` "Spoken English Fluency" card (overall /100 + CEFR estimate + 5 sub-scores [fluency/hesitation/grammar/lexical/coherence] via `NewParamBar` + verbatim examples + metrics footnote). Visible to the owning counsellor + admins (report access is already owner/admin-gated — no stripping). For a voice session with no fluency yet it polls ~90s and shows an "Analyzing…" placeholder; degrades silently to no card on text sessions / failed upload.

Storage/schema: migration `0013_fluency_report.sql` adds `reports.fluency` (jsonb) + a private `call-audio` bucket with owner-insert/update RLS by session ownership (reads are service-role only). Audio retained indefinitely (owner decision). Pronunciation/prosody are out of scope for Tier-1 (the judge reads verbatim text + timings, it does not hear audio). Pure helpers tested in `server/tests/fluency.test.mjs`.

**Ownership guard:** `requesterFor(req)` reads `X-User-Id` header → user record or null. `deniedForSession`/`deniedForReport` 403s a non-admin counsellor accessing another's session/report. Absent header → back-compat allow. Applied to `/message`, `/observe`, `/end`, `/realtime/openai-token`, `GET /sessions/:id`, `GET /reports/:id`, and `/cue`.

**409 guards:** `/sessions/start` locks per `assignmentId` to prevent duplicate starts; `/message` + `/observe` + `/end` reject (409) on ended sessions; `DELETE /sessions/:id` rejects active sessions; `DELETE /personas/:id` and `DELETE /rubric-templates/:id` reject when active assignments reference them; `DELETE /assignments/:id` rejects when an active session exists.

**Per chat turn** (`POST /api/sessions/:id/message`, text sessions only): advance phase on counsellor msg → score it → append to transcript → roll `session.lastTurnVerbosity` → generate student reply → advance phase on reply → raise the student's new objection → persist `session.objectionState` → compute the instant counsellor `cue` (`instantCue`). The server owns the transcript. `POST /api/sessions/:id/cue` serves a richer `llmCue` with `instantCue` fallback.

**SSE ping heartbeat:** while `Accept: text/event-stream`, the server sends `: ping\n\n` comment frames every 15 s until the first real token (prevents idle-proxy cutoffs during long thinking-mode waits). `postMessageStream` in `client/src/lib/stream.js` accepts an `AbortController` `signal` for client-side cancellation.

**Voice session turn flow** (`POST /api/sessions/:id/observe`): called after each completed S2S turn pair. Runs classify + phase + LLM scoring on the counsellor text; tracks the student's objection + advances phase on the student text; appends both to the server-owned transcript; returns `{ currentPhase, satisfactionScore, scoreReason, turnType, milestones, cue, steering }`. The `steering` string is a compact disposition narrative + open/answered objections + phase hint (≤~120 words) that the client injects mid-call over the data channel. Serialized per session; 409 if ended.

**Async report generation** (`POST /api/sessions/:id/end`): immediately persists a stub (status:`"generating"`, with scoreArc/benchmarks/transcript already filled) and returns `{ reportId, status }`. LLM fan-out runs in a background job outside the per-session lock, flipping status to `"ready"` or `"fallback"` when done. Re-calling `/end` on a stale `"generating"` stub (e.g. after a server restart) re-kicks generation. Client `ReportDetail` polls every 2 s (gives up at 3 min).

**Sessions snapshot** the persona+scenario (incl. `pushiness`/`hesitancy` sliders), course, rubric, picked voice identity, and — when a `profileId` was chosen — the resolved `leadCard`, at start time. `session.voiceEngine` = `"openai"` for voice sessions, `"text"` for text sessions.

## Real-data mining (`scripts/mine/`)

Offline pipeline that grounds the simulation in 216 real counselling calls. Deterministic stages are scripts; LLM stages run as Claude workflows (see `scripts/mine/workflow-mine.js`). Outputs are the five PII-free artifacts in `server/data/seed/`.

Re-run order: `prepare.py` → `sample.py` → `make_batches.py` → extraction workflow → `assemble-extractions.mjs` → `merge-extractions.mjs` → synthesis agents → `node scripts/mine/validate-artifacts.mjs`. Audio: `audio/fetch.py` → `audio/analyze.py --all` → `audio/aggregate.py`.

**Text diarization:** `node scripts/mine/diarize.mjs [--all] [--n 50] [--concurrency 4]`. PII-containing; git-ignored under `scripts/mine/work/`. Requires `OLLAMA_API_KEY`.

Tests: `python3 -m unittest discover -s scripts/mine/tests` · `python3 -m unittest discover -s scripts/mine/audio/tests` · `node --test scripts/mine/tests/*.test.mjs`.

## Client architecture (`client/`)

- `main.jsx` — react-router setup: role-guarded layouts. `/login`; admin under `AdminLayout` (`/admin/*`); counsellor under `CounsellorLayout` (`/app/*`); the live chat `/app/session/:sessionId` runs full-bleed.
- `lib/auth.jsx` — `AuthProvider`/`useAuth`/`ProtectedRoute`; dummy login cached in `localStorage` (`mct_user`).
- `lib/api.js` — flat `api` object; `api.getOpenAIRealtimeToken(id, voice?)`, `api.observeTurn(id, {counsellorText?, studentText?, deliveryMetrics?})`, `api.getReports(counsellorId?, sessionId?)`, and standard CRUD methods. Populates `X-User-Id` header from `getUserId()` (localStorage `mct_user`). Also exported by `lib/stream.js` for the SSE path. Throws `Error(data.error)` on non-2xx.
- `lib/format.js` — score/band/difficulty/rubric color helpers, date/initials formatters.
- `ui/` — shared Tailwind UI kit: Button, Card, Input, Modal (with focus trap), Badge, Table (sortable/searchable), Sidebar, ScoreMeter, ConfirmDialog, SearchInput, CountUp, plus `useCreateShortcut` (keyboard shortcut hook). `layouts/` wrap pages with `Sidebar` + `Topbar`.
- `pages/` — `admin/*` (incl. `Courses.jsx`, `Rubrics.jsx`, data-driven `AdminDashboard`), `counsellor/*` (data-driven `Dashboard` with skill radar + recommended drill), and `shared/` (`ReportDetail` — polls 2 s while status=`"generating"` + `RubricBar`/`ScoreArcChart`/`TranscriptView`/`PhaseStepper`).
- `pages/counsellor/Session.jsx` + `session/` — the call experience: GreenRoom (brief + "Join call" / "Practice by text") → CallStage (Orb) → CallSidebar (Transcript/Coach tabs, milestones) → wrapping screen → report. `/app/session/:sessionId` resumes; voice sessions resume as text when the stored `voiceEngine` is not `"openai"`.
- `server/analytics.js` — pure in-memory analytics for `/api/analytics/admin` and `/api/analytics/counsellor/:id`. Key design points: stubs (status:`"generating"`) are excluded from KPI counts and heatmap rows (filtered by `Number.isFinite(r.overall?.percent)`); `avgScore`/`avgPercent` return null (not 0) when no scored reports exist; team radar excludes the requesting counsellor's own reports (falls back to all when no others have data); `drills[].objectionCategory` values are collapsed to canonical keys via substring rules before aggregation; weekly trend uses real ISO week Monday dates (time-proportional x-axis when rendered).

### Voice pipeline (`src/voice/`)

**One engine: OpenAI Realtime speech-to-speech over WebRTC.**

`Session.jsx` uses `useOpenAIRealtime` from `src/voice/useOpenAIRealtime.js`. No WASM models, no Python sidecar, no Kokoro, no ElevenLabs. The classic browser pipeline and its deps (`kokoro-js`, `@huggingface/transformers`, `@ricky0123/vad-web`) are **deleted**.

`voice/engines.js` holds the OpenAI voice catalog (11 voices including `"auto"` which gender-matches to marin/cedar) and the `localStorage` storage key for the preferred voice. No engine toggle; `voiceEngine` is now always `"openai"` for voice sessions or `"text"` for text sessions.

**How it works:** `useOpenAIRealtime` mints an ephemeral token via `POST /sessions/:id/realtime/openai-token` (pre-loaded with persona instructions + voice + `input_audio_transcription` + `semantic_vad`), opens a `RTCPeerConnection`, does SDP exchange with `https://api.openai.com/v1/realtime/calls`, and receives audio + transcripts over the `oai-events` data channel. Counsellor transcripts arrive via `conversation.item.input_audio_transcription.completed`; student transcripts via `response.output_audio_transcript.done`. Each completed turn pair is POSTed to `/observe` via a sequential queue so the server-owned transcript stays in order. Mid-call **steering** (`/observe` response `steering` field) is injected non-destructively as a `conversation.item.create` (role:`"system"`, with a defensive fallback to role:`"user"`).

**Delivery metrics** (computed in-browser per counsellor utterance): `{ wpm, pauses, energyVar, durationMs }` derived from VAD speech events and a mic `AnalyserNode`. The hook also derives `paceVerdict` (slow/good/fast), `energyVerdict` (low/good/high), and `tone` (cold/neutral/warm) for the CoachPanel chips. Forwarded to `/observe` for `voice_delivery` grading.

**Mic device selection:** `engines.js` stores/loads the preferred mic as `{ deviceId, label }` in localStorage key `mct_mic_device`. `useOpenAIRealtime` exposes `changeMic(deviceId, label)` which calls `replaceTrack()` on the existing `RTCRtpSender` without reconnecting.

**Voice selection:** `"auto"` (default) gender-matches from the student's lead card / persona snapshot (female→marin, male→cedar). Any of the 11 voices can be auditioned live via the in-call picker — `changeVoice` re-mints a token and reconnects the WebRTC session. Preference persisted in `localStorage`.

Typed sidebar input works via `sendText` (injects a user conversation item + `response.create`). `voice_delivery` rubric criterion is excluded for text sessions and the weights renormalized, matching the pre-refactor behaviour.

**Accent block re-injection:** the accent/language-style block from `buildRealtimeInstructions` is re-injected as a steering `conversation.item.create` every ~3 completed voice exchanges (not just at session start) to prevent model drift on Indian-English delivery. **Garbled-STT neutral scoring:** counsellor turns that are incoherent fragments or phonetic gibberish (STT noise) are scored neutral (adjustment `0`) rather than penalized — extending the existing name-noise rule to whole-turn noise. Applies to both `/observe` (voice) and `/message` (text) pipelines.

### Tailwind + Vite gotchas (do not "clean up")

- Tailwind v4 via the `@tailwindcss/vite` plugin (in `vite.config.js`); design tokens live in `src/index.css` under `@theme` (custom utilities like `bg-canvas`, `text-ink`, `text-muted`, `border-line`, `bg-brand-600`, `text-success/warn/danger`).
- `vite.config.js` has **no** `optimizeDeps.exclude` — the WASM/ONNX voice model deps are gone. The comment in the file explains why it was removed.
- eslint: `react-refresh/only-export-components` is downgraded to a warning (we co-locate small helpers with providers + the router entry).

## Notes

- Originally a Windows-developed single-screen MVP (see stale PowerShell entries in `client/.claude/settings.local.json` and the root `*-out.log`/`*-err.log` files); now a two-role platform on macOS.
- The `OLLAMA_API_KEY` currently sits in plaintext in `.env` (gitignored) and is hardcoded in `client/.claude/settings.local.json` — scrub the latter before sharing.
- `server/voices.js` no longer carries ElevenLabs voice ids; the catalog is name/gender/key only. The `session.voice` snapshot field retains the same shape but `elevenLabsVoiceId` is absent.
- `docs/bug-loop-log.md` is the audit trail for the June 2026 autonomous bug-fix loop (~17 commits); consult it for the rationale behind any non-obvious change in that batch.
