# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **sales-training simulator**. A counsellor (the human user) practices selling the "Executive Certification Programme in Business Analytics and AI" (IIM Ranchi × Masai School) to an **LLM-roleplayed prospective student**. The student has a configurable archetype + personality, moves through a 4-phase counselling call, and only agrees to pay if the counsellor earns a high enough satisfaction score. Supports both typed and fully-in-browser voice conversation.

Two independent npm packages, no root package.json, not a git repo:
- `server/` — Express API (ESM), the conversation/scoring engine.
- `client/` — React 19 + Vite 8 SPA, the chat UI and voice pipeline.

## Commands

```bash
# Server (port 3001) — needs OLLAMA_API_KEY in repo-root .env
cd server && npm install
npm start          # node index.js
npm run dev        # node --watch index.js (auto-restart)

# Client (Vite dev server, proxies /api → localhost:3001)
cd client && npm install
npm run dev        # start dev server
npm run build      # production build
npm run lint       # eslint .
npm run preview    # serve the build

# Verify the local TTS model works end-to-end (writes voice-smoke.wav)
cd client && node scripts/tts-smoke.mjs
```

Run **both** server and client for a working app. There is no test framework; `tts-smoke.mjs` is the only standalone verification script.

## Environment

- `.env` lives at the **repo root** (server reads `../.env` via `dirname(import.meta.url)`), and must contain `OLLAMA_API_KEY`.
- The LLM is **Ollama Cloud** (`gpt-oss:120b` served from `https://ollama.com` with a Bearer token) — **not** a local Ollama install.
- `server/gemini.js` is misleadingly named: it uses Ollama, not Google Gemini. The `@google/generative-ai` dependency is vestigial/unused. Don't reintroduce Gemini calls expecting it to be wired up.

## Server architecture (`server/`)

The whole engine lives in three files, all driven by `index.js`'s `POST /api/chat` handler. One chat turn does, in order:

1. `advancePhase(session, "counsellor", message)` — maybe advance the phase based on the counsellor's message.
2. `scoreMessage(counsellorMessage, lastStudentMessage)` — a **separate LLM call** that rates the counsellor's move −10..+10; `updateScore` clamps the running satisfaction score to 0–100.
3. `sendMessage(...)` — generate the student reply, with the current phase **and** score baked into the system prompt.
4. `advancePhase(session, "student", reply)` — maybe advance again based on the reply.

Two coupled state machines govern behaviour:

- **Phase state machine** (`sessions.js`, `advancePhase`): 1 Introduction → 2 Course Information → 3 Concerns/Objections → 4 Closing. Transitions are **heuristic**, not LLM-decided: message counts per role plus keyword detection (`PHASE2_KEYWORDS`, e.g. "iim", "masai", "curriculum", "fee"). Each session tracks per-phase message counters.
- **Satisfaction score** (starts 50, agreement threshold 70): the LLM scorer's output drives it. The score maps to an emotional-state band (`buildScoreSection`) injected into the prompt. **Hard rule encoded in the prompt:** if the counsellor tries to close while score < 70, the student must firmly decline.

**Prompt assembly** (`gemini.js` `buildSystemPrompt`) is the heart of the persona. It concatenates: archetype label → counsellor's free-text description → general student profile → `COURSE_CONTEXT` (static facts: fees, curriculum, faculty — `courseContext.js`) → situation → archetype core anxiety → current-phase instructions → current-score emotional state → archetype-specific per-phase behaviour → global rules (short replies, match Hinglish/English, never break character). Editing student behaviour almost always means editing one of the `ARCHETYPE_*` / `PHASE_*` constants here.

The four archetypes (`studying`, `graduate`, `same-field`, `diff-field`) each have distinct anxieties and phase-by-phase scripts.

**Sessions are in-memory** (`Map` in `sessions.js`). Restarting the server drops all sessions; the client then gets 404s and must start a new session.

## Client architecture (`client/`)

- `App.jsx` — three-screen flow: `ArchetypePicker` → `DescriptionForm` (free-text persona description, posts `/api/start`) → `ChatInterface`.
- `ChatInterface.jsx` — chat loop, phase indicator, satisfaction score bar. **Role mapping for the LLM:** student = `assistant`, counsellor = `user`. `buildHistory` prepends a synthetic `"Start the conversation"` user turn because the opening student message has no preceding user turn and Ollama requires alternating roles. A single `submitMessage` path serves both typed and spoken input (`submitRef` keeps the voice hook pointed at the freshest closure).

### Voice pipeline (fully local, in-browser — no cloud STT/TTS)

Push-to-talk: **hold Space to speak, release to send; press Space again to interrupt the student mid-sentence** (barge-in). Ignored while focus is in the textarea.

- `useVoiceConversation.js` — orchestrates the state machine: `off → loading → idle → recording → transcribing → speaking`. Records via `MediaRecorder`, decodes to 16 kHz Float32, discards <100 ms clips.
- `stt.js` — `whisper-tiny.en` via `@huggingface/transformers`.
- `tts.js` — Kokoro-82M via `kokoro-js`; streams synthesis sentence-by-sentence. Note: it creates and `close()`s its own `TextSplitterStream` because kokoro-js otherwise never flushes the final sentence.
- `audioPlayer.js` — `StreamingAudioPlayer` schedules gapless chunks on one `AudioContext`; an `epoch` counter bumped on `stop()` is the barge-in mechanism (the TTS loop stops feeding the moment the epoch changes).
- Models download once (~80–330 MB) and are browser-cached. WebGPU is used when available, else WASM (`dtype` chosen accordingly).

### Vite gotcha (do not "clean up")

`vite.config.js` `optimizeDeps.exclude` lists `@huggingface/transformers`, `kokoro-js`, `@ricky0123/vad-web`, `onnxruntime-web`. These ship WASM loaders whose paths Vite's pre-bundler rewrites to broken `.vite/deps/ort-wasm-*.mjs` (404). They **must** stay excluded, and `@ricky0123/vad-web` must be `import()`-ed lazily, or the WASM/WebGPU backends fail to initialise.

## Notes

- The repo was originally developed on Windows (see the PowerShell entries in `client/.claude/settings.local.json` referencing `c:\Users\rahul\student-sim`); it now runs on macOS. The `*-out.log` / `*-err.log` files at the root are stale process logs, not part of the app.
