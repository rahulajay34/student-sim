# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **mock counselling training platform**. Two roles:
- **Admin** manages a persona library and assigns mock counselling sessions to counsellors.
- **Counsellor** runs a phase-based, voice-or-text sales simulation against an LLM-roleplayed prospective student for the IIM Ranchi × Masai analytics programme.

On session end, an LLM generates a **rubric-based coaching report** from the transcript, persisted to local JSON files and visible to the counsellor (own reports) and admin (all reports). Auth is dummy/pre-seeded; no real security.

Two independent npm packages, no root package.json:
- `server/` — Express API (ESM) + JSON file store + the conversation/scoring/report engine.
- `client/` — React 19 + Vite 8 + react-router v7 + Tailwind v4 SPA.

See `CONTRACT.md` (repo root) for the authoritative API shapes, data shapes, routes, design tokens, and UI-kit component props. `docs/superpowers/specs/` holds the design doc.

## Commands

```bash
# Server (port 3001) — needs MINIMAX_API_KEY in repo-root .env
cd server && npm install && npm start         # or: npm run dev (node --watch)

# Client (Vite dev server, proxies /api -> :3001)
cd client && npm install && npm run dev
npm run build      # production build      | npm run lint   # eslint .

# Voice sidecar (port 3002) — Python 3.11 via uv; models lazy-load on first request
bash voice-server/run.sh                     # installs venv if needed, then starts server

# End-to-end API smoke test (server must be running)
node scripts/smoke-api.mjs

# Server unit tests (no running server needed)
node --test server/tests/*.mjs

# Regenerate the 15-course catalog text dumps (then re-run LLM extraction + assembly)
node scripts/scrape-courses.mjs

# Verify local TTS model works (writes voice-smoke.wav)
cd client && node scripts/tts-smoke.mjs

# Smoke-test the voice sidecar (sidecar must be running on :3002)
python3 voice-server/smoke.py
```

Note: if `npm run dev/build/lint` fails with "Permission denied" on a `node_modules/.bin/*` shim, run `chmod +x node_modules/.bin/*` (a quirk of this filesystem; the bins ship without the execute bit).

## Environment

- `.env` at the **repo root** (server reads `../.env`); must contain `MINIMAX_API_KEY` (LLM) and `ELEVENLABS_API_KEY` (student TTS + Scribe STT). `OLLAMA_API_KEY` is only needed for the offline mining/diarization scripts.
- The LLM is **MiniMax** (`MiniMax-M3` via `https://api.minimax.io`, OpenAI-compatible; `MINIMAX_MODEL` to override) — `server/ollama.js` is the client (legacy filename kept; previously Ollama Cloud, and **not** Google Gemini despite the project name). M3 is a reasoning model: the client strips/suppresses the inline `<think>…</think>` block in both `chat()` and `chatStream()`.

## Server architecture (`server/`)

`index.js` wires the REST API; logic is split into focused modules:
- `store.js` — JSON file store under `server/data/*.json`. `users.json` + `personas.json` + `courses.json` + `rubric-templates.json` ship seeded (`courses.json` contains 15 scraped courses across 9 domains; `rubric-templates.json` contains the default "Grounded v2" template — regenerate via `node scripts/seed-rubric-template.mjs`); `assignments.json`/`sessions.json`/`reports.json` are created empty on first run. Sessions snapshot the course + persona (incl. personality) as `courseSnapshot`/`personaSnapshot` at start time. Generic `getAll/getById/insert/update/remove`.
- `phases.js` — 5-phase non-strict machine (Opening → Discovery → Presentation → Objections & Negotiation → Close) + milestone tracking (`discoveryDone`/`presentationDone`/`paymentAsked` booleans, `objectionsRaised` counter). `advancePhase` mutates `session.currentPhase` and `session.milestones` based on message counts + corpus-derived keyword regexes; milestones are tracked independently of the linear phase pointer.
- `register.js` — loads `server/data/seed/{register-lines,voice-bank,register-stats}.json` once (all PII-scrubbed real-call artifacts); exposes `registerLines()` (all diarized student/counsellor lines), `voiceBankFor(category, phase, n?)` (rotated sample of register-matched lines for a persona+phase), and `registerStatsFor(phase)` (word-band + filler stats) for grounding the natural-speech prompt sections.
- `personality.js` — trait schema (talkativeness/humour/skepticism/formality 1–5 scales, quirks array), `DEFAULT_PERSONALITY`, `rollSessionFlavour(persona.personality)` (stochastic mood + active quirks), and `renderPersonalitySection(flavour)` for injecting into the prompt.
- `grounding.js` — loads `server/data/seed/*` once (archetypes, objections, benchmarks, conversation-structure); exposes `archetypeForPersona(personaSnapshot)` (category→archetype mapping) and `objectionRepertoire(archetype, difficulty)` (difficulty-scaled objection list with real phrasings) for the student prompt and report engine.
- `prompt.js` — composes the student system prompt from **persona + personality flavour + archetype + objection repertoire + scenario + phase + score + convincement hint + objection state**; includes natural-speech rules, phase-aware verbosity (from register stats + talkativeness), register reference (real student lines), conditional tangents (mood/phase gated), the convincement section (`ready`/`warming` overrides) and the objection-state summary; all from editable `prompt-config.json` scaffolding. Exports `computeConvincementHint(session)` / `convincementParamsFor(difficulty)`.
- `engine.js` — `getFirstMessage` / `getStudentReply`; builds the Ollama message array from the **server-owned** transcript (student→assistant, counsellor→user, with a synthetic opening trigger); threads `personalityFlavour` + the convincement hint + objection state into the prompt builder; runs the coherence gate **and** the anti-loop guard (>0.8 token-overlap with the last 6 student turns → regenerate once → move-forward fallback).
- `scoring.js` — per-message −10..+10 LLM scoring → live satisfaction score; scoring prompt includes grounded counter-move guidance from real converting calls. Leniency knobs load fail-soft from `data/scoring-config.json` (kept in sync with in-file defaults).
- `report.js` — `generateReport`: one LLM call over the transcript → grades against the session's `rubricSnapshot` with anchor-quoted levels; renormalizes weights when `voice_delivery` is unscoreable (text sessions → 7 graded criteria); adds `keyMoments`/`drills`/`benchmarks`; falls back to `LEGACY_RUBRIC` (6 criteria) for pre-v2 sessions without a `rubricSnapshot`.
- `classify.js` — `classifyCounsellorTurn(text)`: deterministic, LLM-free classifier of the counsellor's latest message into `statement`/`question`/`invite` (Hinglish + Devanagari aware). `engine.js` + `index.js` feed it to `prompt.js` as the per-turn behaviour hint so the student reacts in kind (nods through explanations, answers questions, asks back mostly when invited).
- `promptConfig.js` — loads the editable prompt scaffolding (phase instructions, behaviour rules, knowledge-bounds template, turn-discipline, register note, FAQ framing) from `data/prompt-config.json`, **failing soft** to built-in defaults so a bad admin edit can't take the sim down. `prompt.js` reads everything through it.
- `courseContext.js` — `fmtINR` + `LEGACY_COURSE_CONTEXT`; the v2 prompt injects scoped **knowledge bounds** (per the session's course) instead of the old brochure dump, falling back to `LEGACY_COURSE_CONTEXT` when no course is attached.
- `voices.js` — `pickStudentVoice`: student ElevenLabs cloned-voice catalog, assigned at session start and snapshotted as `session.voice` so voice + name/gender stay stable across the call and resumes (sidecar falls back to its env default for pre-`voice` sessions).

**Per chat turn** (`POST /api/sessions/:id/message`): advance phase on counsellor msg → score it (`scoreMessage` returns `{adjustment, reason, addressedObjection}`) → append to transcript → roll `session.lastTurnVerbosity` (`open`/`short`; talkativeness-scaled, phase-3 short unless `invite`, never two `open` in a row) and thread it + the previous turn's `adjustment` (one-turn-lag momentum) into the reply prompt → resolve the addressed objection (`resolveObjection`) → generate student reply → advance phase on reply → raise the student's new objection (`raiseObjection`) → persist `session.objectionState` → compute the instant counsellor `cue` (`instantCue`, given the cue v2 context: last adjustment/reason + live objection state). The server owns the transcript; the client never sends history.

**Objection lifecycle + persistence (`objections.js`, `cues.js`):** `session.objectionState` (array of `{category,status,timesRaised,…}`, seeded empty, fail-soft to `[]` for old sessions) tracks each concern as `open`/`addressed`. The student prompt injects `summarizeForPrompt(state)` (which concerns are ANSWERED — do not repeat verbatim) plus a **convincement hint** (`resistant`/`warming`/`ready`) computed in `prompt.js` from the live score, the per-difficulty `convincement` thresholds/`effortTurns` in `prompt-config.json`, and the objection state — so addressing concerns and persistence actually raise the student toward "yes". `engine.js` adds an **anti-loop guard**: a coherent reply >0.8 token-overlap with any of the last 6 student turns is regenerated once ("do not repeat yourself"), then falls back to a short move-forward ack. The message endpoint returns a counsellor `cue` (`instantCue`); `POST /api/sessions/:id/cue` serves a richer `llmCue` (one deterministic LLM call) with `instantCue` fallback.

**Sessions snapshot** the persona+scenario (`personaSnapshot`/`scenarioSnapshot`) at start, so later library edits don't rewrite history. A per-assignment `personaPromptOverride` replaces the persona's `behaviourPrompt` for that mock.

## Real-data mining (`scripts/mine/`)

Offline pipeline that grounds the simulation in 216 real counselling calls
(`counselling_ba_courses - Sheet1.csv`, git-ignored, PII — never import into the app).
Deterministic stages are scripts; LLM stages run as Claude workflows (see
`scripts/mine/workflow-mine.js`). Outputs are the five PII-free artifacts in
`server/data/seed/` (archetypes, objections, conversation-structure, rubric-anchors,
benchmarks) — validated by `node scripts/mine/validate-artifacts.mjs`.

Re-run order: `prepare.py` → `sample.py` → `make_batches.py` → extraction workflow →
`assemble-extractions.mjs` → `merge-extractions.mjs` → synthesis agents → validator. Audio:
`audio/fetch.py` → `audio/analyze.py --all` (uv env in `scripts/mine/audio/`) → `audio/aggregate.py`.

**Text diarization** (after `prepare.py`, before extraction workflow):
`node scripts/mine/diarize.mjs [--all] [--n 50] [--concurrency 4]`
Reads `scripts/mine/work/calls.json`, writes per-call JSON to `scripts/mine/work/diarized/<callId>.json`.
Output shape: `{ callId, turns:[{speaker:'counsellor'|'student', phase:1-5|null, text}], diarizationConfidence, ambiguous, ambiguousNote }`.
PII-containing; git-ignored under `scripts/mine/work/`. Requires `OLLAMA_API_KEY`.

Tests: `python3 -m unittest discover -s scripts/mine/tests` ·
`python3 -m unittest discover -s scripts/mine/audio/tests` · `node --test scripts/mine/tests/*.test.mjs`.

## Client architecture (`client/`)

- `main.jsx` — react-router setup: role-guarded layouts. `/login`; admin under `AdminLayout` (`/admin/*`); counsellor under `CounsellorLayout` (`/app/*`); the live chat `/app/session/:sessionId` runs full-bleed.
- `lib/auth.jsx` — `AuthProvider`/`useAuth`/`ProtectedRoute`; dummy login cached in `localStorage` (`mct_user`).
- `lib/api.js` — flat `api` object, one method per endpoint; throws `Error(data.error)` on non-2xx.
- `lib/format.js` — score/band/difficulty/rubric color helpers, date/initials formatters.
- `ui/` — the shared Tailwind UI kit (Button, Card, Input, Modal, Badge, Table, Sidebar, ScoreMeter, etc.). `layouts/` wrap pages with `Sidebar` + `Topbar`.
- `pages/` — `admin/*` (incl. `Courses.jsx`, `Rubrics.jsx`, data-driven `AdminDashboard`), `counsellor/*` (data-driven `Dashboard` with skill radar + recommended drill), and `shared/` (`ReportDetail` v2 + `RubricBar`/`ScoreArcChart`/`TranscriptView`/`PhaseStepper`).
- `pages/counsellor/Session.jsx` + `session/` — the call experience: green room (`/app/session/new`, start-on-join) → Focus Stage (`CallStage`/`Orb`, emotion-tinted audio-reactive orb) → glass `CallSidebar` (Transcript/Coach tabs, milestones, live delivery read) → wrapping screen → report. `/app/session/:sessionId` resumes; ended sessions show an ended screen.
- `server/analytics.js` — pure in-memory analytics for `/api/analytics/admin` (KPIs, team rubric heatmap, weekly trend, objection hot-spots) and `/api/analytics/counsellor/:id` (trend, radar vs team, recommended drill from latest report).

### Voice pipeline (`src/voice/*`, fully in-browser — reused, not rewritten)

`Session.jsx` uses `useVoiceConversation({onUserUtterance})`. Push-to-talk = hold Space (interrupt while speaking). STT = browser whisper-tiny (default) or sidecar ElevenLabs Scribe (if sttEngine="scribe") via `sidecarClient.js` routing; TTS = Kokoro-82M (`tts.js`), gapless playback with epoch-based barge-in (`audioPlayer.js`). Models download once, browser-cached, WebGPU→WASM fallback.

### Tailwind + Vite gotchas (do not "clean up")

- Tailwind v4 via the `@tailwindcss/vite` plugin (in `vite.config.js`); design tokens live in `src/index.css` under `@theme` (custom utilities like `bg-canvas`, `text-ink`, `text-muted`, `border-line`, `bg-brand-600`, `text-success/warn/danger`).
- `vite.config.js` `optimizeDeps.exclude` (`@huggingface/transformers`, `kokoro-js`, `@ricky0123/vad-web`, `onnxruntime-web`) is **load-bearing** — removing it breaks the WASM/WebGPU loaders. `@ricky0123/vad-web` must stay lazily `import()`-ed.
- eslint: `react-refresh/only-export-components` is downgraded to a warning (we co-locate small helpers with providers + the router entry).

## Voice sidecar (`voice-server/`)

Local FastAPI server on port 3002, Python 3.11 managed by `uv`. Start via `bash voice-server/run.sh`
(creates `.venv` with uv if absent, installs the package in editable mode, then launches `main.py`).

**Capabilities (all lazy-loaded on first request, each independently kill-switchable):**

| Env flag | Default | Effect |
|---|---|---|
| `VOICE_TTS=off` | on | Disables TTS; `/tts` returns 503 |
| `VOICE_STT=off` | on | Disables STT; `/stt` returns 503 |
| `VOICE_ANALYZE=off` | on | Disables prosody analysis; `/analyze` returns 503 |

**TTS engine selection:** `capabilities.py` tries Chatterbox first (emotion-expressive, ~3-4 GB);
auto-falls back to `kokoro-onnx` (~0.4 GB) if Chatterbox fails to import or load — the fallback is
intentional on CPU-only Apple Silicon where Chatterbox's vocoder is broken. Reported in `/health`
as `ttsEngine: "chatterbox"|"kokoro"|null`.

**Kokoro emotion→pace:** Since Kokoro has no exaggeration/cfg_weight parameters, emotion shapes
delivery via speed: neutral 1.0 · happy 1.05 · excited 1.12 · hesitant 0.88 · worried 0.94 ·
frustrated 1.06.

**Degradation matrix:** sidecar down → client falls back to browser Kokoro-82M for TTS and browser
whisper-tiny for STT; mic denied → text-only input; `VOICE_ANALYZE=off` or sidecar unreachable →
no `deliveryMetrics` on transcript, `voice_delivery` rubric criterion excluded and weights renormalized
to 100 for that session. Counsellor STT routes through the sidecar only when it reports `sttEngine`
`"scribe"` (fast HTTP API with Hinglish auto-detect); otherwise uses browser whisper-tiny to avoid
the first-request faster-whisper stall.

**Smoke test:** `python3 voice-server/smoke.py` — hits `/health`, `/tts` (asserts RIFF header +
>10 KB WAV), `/stt` (feeds the TTS output back, asserts non-empty transcript), `/analyze` (same
wav, asserts numeric `wpm`). Exits 0 on full pass, 1 on any failure.

## Notes

- Originally a Windows-developed single-screen MVP (see stale PowerShell entries in `client/.claude/settings.local.json` and the root `*-out.log`/`*-err.log` files); now a two-role platform on macOS.
- The `OLLAMA_API_KEY` currently sits in plaintext in `.env` (gitignored) and is hardcoded in `client/.claude/settings.local.json` — scrub the latter before sharing.
