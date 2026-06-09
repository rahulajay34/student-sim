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

# End-to-end API smoke test (server must be running)
node scripts/smoke-api.mjs

# Verify local TTS model works (writes voice-smoke.wav)
cd client && node scripts/tts-smoke.mjs
```

Note: if `npm run dev/build/lint` fails with "Permission denied" on a `node_modules/.bin/*` shim, run `chmod +x node_modules/.bin/*` (a quirk of this filesystem; the bins ship without the execute bit).

## Environment

- `.env` at the **repo root** (server reads `../.env`); must contain `OLLAMA_API_KEY`.
- The LLM is **Ollama Cloud** (`gpt-oss:120b` via `https://ollama.com` with a Bearer token) — not a local Ollama, and **not** Google Gemini despite the legacy project name. `server/ollama.js` is the client.

## Server architecture (`server/`)

`index.js` wires the REST API; logic is split into focused modules:
- `store.js` — JSON file store under `server/data/*.json`. `users.json` + `personas.json` ship seeded; `assignments.json`/`sessions.json`/`reports.json` are created empty on first run. Generic `getAll/getById/insert/update/remove`.
- `phases.js` — the heuristic 4-phase state machine (Introduction → Course Info → Concerns → Closing). `advancePhase` mutates `session.currentPhase` based on message counts + keyword detection.
- `prompt.js` — composes the student system prompt from **persona + scenario + phase + score** (the general profile, phase instructions, score bands, and `courseContext.js` are shared scaffolding; personas supply the variable identity).
- `engine.js` — `getFirstMessage` / `getStudentReply`; builds the Ollama message array from the **server-owned** transcript (student→assistant, counsellor→user, with a synthetic opening trigger).
- `scoring.js` — per-message −10..+10 LLM scoring → live satisfaction score.
- `report.js` — `generateReport`: one LLM call over the transcript → rubric scores + phase breakdown + strengths/improvements + outcome; the overall % is computed deterministically from the fixed 6-criterion `RUBRIC` (weights sum to 100; bands <50 / 50–74 / ≥75).

**Per chat turn** (`POST /api/sessions/:id/message`): advance phase on counsellor msg → score it → append to transcript → generate student reply → advance phase on reply → persist. The server owns the transcript; the client never sends history.

**Sessions snapshot** the persona+scenario (`personaSnapshot`/`scenarioSnapshot`) at start, so later library edits don't rewrite history. A per-assignment `personaPromptOverride` replaces the persona's `behaviourPrompt` for that mock.

## Client architecture (`client/`)

- `main.jsx` — react-router setup: role-guarded layouts. `/login`; admin under `AdminLayout` (`/admin/*`); counsellor under `CounsellorLayout` (`/app/*`); the live chat `/app/session/:sessionId` runs full-bleed.
- `lib/auth.jsx` — `AuthProvider`/`useAuth`/`ProtectedRoute`; dummy login cached in `localStorage` (`mct_user`).
- `lib/api.js` — flat `api` object, one method per endpoint; throws `Error(data.error)` on non-2xx.
- `lib/format.js` — score/band/difficulty/rubric color helpers, date/initials formatters.
- `ui/` — the shared Tailwind UI kit (Button, Card, Input, Modal, Badge, Table, Sidebar, ScoreMeter, etc.). `layouts/` wrap pages with `Sidebar` + `Topbar`.
- `pages/` — `admin/*`, `counsellor/*` (incl. `Session.jsx`, the revamped chat reusing the voice pipeline), and `shared/` (`ReportDetail` + `RubricBar`/`ScoreArcChart`/`TranscriptView`/`PhaseStepper`).

### Voice pipeline (`src/voice/*`, fully in-browser — reused, not rewritten)

`Session.jsx` uses `useVoiceConversation({onUserUtterance})`. Push-to-talk = hold Space (interrupt while speaking). STT = `whisper-tiny.en` (`stt.js`), TTS = Kokoro-82M (`tts.js`), gapless playback with epoch-based barge-in (`audioPlayer.js`). Models download once, browser-cached, WebGPU→WASM fallback.

### Tailwind + Vite gotchas (do not "clean up")

- Tailwind v4 via the `@tailwindcss/vite` plugin (in `vite.config.js`); design tokens live in `src/index.css` under `@theme` (custom utilities like `bg-canvas`, `text-ink`, `text-muted`, `border-line`, `bg-brand-600`, `text-success/warn/danger`).
- `vite.config.js` `optimizeDeps.exclude` (`@huggingface/transformers`, `kokoro-js`, `@ricky0123/vad-web`, `onnxruntime-web`) is **load-bearing** — removing it breaks the WASM/WebGPU loaders. `@ricky0123/vad-web` must stay lazily `import()`-ed.
- eslint: `react-refresh/only-export-components` is downgraded to a warning (we co-locate small helpers with providers + the router entry).

## Notes

- Originally a Windows-developed single-screen MVP (see stale PowerShell entries in `client/.claude/settings.local.json` and the root `*-out.log`/`*-err.log` files); now a two-role platform on macOS.
- The `OLLAMA_API_KEY` currently sits in plaintext in `.env` (gitignored) and is hardcoded in `client/.claude/settings.local.json` — scrub the latter before sharing.
