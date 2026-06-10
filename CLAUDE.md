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
# Server (port 3001) — needs OLLAMA_API_KEY in repo-root .env
cd server && npm install && npm start         # or: npm run dev (node --watch)

# Client (Vite dev server, proxies /api -> :3001)
cd client && npm install && npm run dev
npm run build      # production build      | npm run lint   # eslint .

# Voice sidecar (port 3002) — Python 3.11 via uv; models lazy-load on first request
bash voice-server/run.sh                     # installs venv if needed, then starts server

# End-to-end API smoke test (server must be running)
node scripts/smoke-api.mjs

# Regenerate the 15-course catalog text dumps (then re-run LLM extraction + assembly)
node scripts/scrape-courses.mjs

# Verify local TTS model works (writes voice-smoke.wav)
cd client && node scripts/tts-smoke.mjs

# Smoke-test the voice sidecar (sidecar must be running on :3002)
python3 voice-server/smoke.py
```

Note: if `npm run dev/build/lint` fails with "Permission denied" on a `node_modules/.bin/*` shim, run `chmod +x node_modules/.bin/*` (a quirk of this filesystem; the bins ship without the execute bit).

## Environment

- `.env` at the **repo root** (server reads `../.env`); must contain `OLLAMA_API_KEY`.
- The LLM is **Ollama Cloud** (`gpt-oss:120b` via `https://ollama.com` with a Bearer token) — not a local Ollama, and **not** Google Gemini despite the legacy project name. `server/ollama.js` is the client.

## Server architecture (`server/`)

`index.js` wires the REST API; logic is split into focused modules:
- `store.js` — JSON file store under `server/data/*.json`. `users.json` + `personas.json` + `courses.json` + `rubric-templates.json` ship seeded (`courses.json` contains 15 scraped courses across 9 domains; `rubric-templates.json` contains the default "Grounded v2" template — regenerate via `node scripts/seed-rubric-template.mjs`); `assignments.json`/`sessions.json`/`reports.json` are created empty on first run. Sessions snapshot the course as `courseSnapshot` at start time (like `personaSnapshot`). Generic `getAll/getById/insert/update/remove`.
- `phases.js` — 5-phase non-strict machine (Opening → Discovery → Presentation → Objections & Negotiation → Close) + milestone tracking (`discoveryDone`/`presentationDone`/`paymentAsked` booleans, `objectionsRaised` counter). `advancePhase` mutates `session.currentPhase` and `session.milestones` based on message counts + corpus-derived keyword regexes; milestones are tracked independently of the linear phase pointer.
- `grounding.js` — loads `server/data/seed/*` once (archetypes, objections, benchmarks, conversation-structure); exposes `archetypeForPersona(personaSnapshot)` (category→archetype mapping) and `objectionRepertoire(archetype, difficulty)` (difficulty-scaled objection list with real phrasings) for the student prompt and report engine.
- `prompt.js` — composes the student system prompt from **persona + archetype + objection repertoire + scenario + phase + score** (the general profile, phase instructions, score bands, and `courseContext.js` are shared scaffolding; personas supply the variable identity; `grounding.js` adds archetype texture and corpus-derived objection phrasings).
- `engine.js` — `getFirstMessage` / `getStudentReply`; builds the Ollama message array from the **server-owned** transcript (student→assistant, counsellor→user, with a synthetic opening trigger).
- `scoring.js` — per-message −10..+10 LLM scoring → live satisfaction score; scoring prompt includes grounded counter-move guidance from real converting calls.
- `report.js` — `generateReport`: one LLM call over the transcript → grades against the session's `rubricSnapshot` with anchor-quoted levels; renormalizes weights when `voice_delivery` is unscoreable (text sessions → 7 graded criteria); adds `keyMoments`/`drills`/`benchmarks`; falls back to `LEGACY_RUBRIC` (6 criteria) for pre-v2 sessions without a `rubricSnapshot`.

**Per chat turn** (`POST /api/sessions/:id/message`): advance phase on counsellor msg → score it → append to transcript → generate student reply → advance phase on reply → persist. The server owns the transcript; the client never sends history.

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

`Session.jsx` uses `useVoiceConversation({onUserUtterance})`. Push-to-talk = hold Space (interrupt while speaking). STT = `whisper-tiny.en` (`stt.js`), TTS = Kokoro-82M (`tts.js`), gapless playback with epoch-based barge-in (`audioPlayer.js`). Models download once, browser-cached, WebGPU→WASM fallback.

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

**Degradation matrix:** sidecar down → client falls back to browser Kokoro-82M (TTS) / whisper-tiny
(STT) automatically; mic denied → text-only input; `VOICE_ANALYZE=off` or sidecar unreachable →
no `deliveryMetrics` on transcript, `voice_delivery` rubric criterion excluded and weights
renormalized to 100 for that session.

**Smoke test:** `python3 voice-server/smoke.py` — hits `/health`, `/tts` (asserts RIFF header +
>10 KB WAV), `/stt` (feeds the TTS output back, asserts non-empty transcript), `/analyze` (same
wav, asserts numeric `wpm`). Exits 0 on full pass, 1 on any failure.

## Notes

- Originally a Windows-developed single-screen MVP (see stale PowerShell entries in `client/.claude/settings.local.json` and the root `*-out.log`/`*-err.log` files); now a two-role platform on macOS.
- The `OLLAMA_API_KEY` currently sits in plaintext in `.env` (gitignored) and is hardcoded in `client/.claude/settings.local.json` — scrub the latter before sharing.
