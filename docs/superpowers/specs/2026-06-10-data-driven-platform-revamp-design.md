# Data-Driven Platform Revamp — Design

**Date:** 2026-06-10
**Status:** Approved pending user review
**Approach:** Evolve in place (Express + JSON store + React SPA stay; new capabilities added around them)

## 1. Context & goals

The mock counselling trainer (see `2026-06-09-mock-counselling-trainer-design.md`) works end-to-end but is synthetic: invented personas, a one-line rubric, a hardcoded course blurb, a chat UI, and no use of the real counselling corpus. We now have **216 real counselling calls** (`counselling_ba_courses - Sheet1.csv`: transcripts, durations, counsellor, paid outcome, HLS recording URLs — 39 converted, ~18%, median 17 min) and access to the live masaischool.com catalog.

Goals, in priority order:

1. **Ground the simulation in real data** — personas, objections, phase structure, rubric anchors, benchmarks mined from the corpus.
2. **Course-aware assignments** — admin picks a real course per mock; the student and the grader both know the course facts.
3. **Expressive local voice + delivery coaching** — better TTS, and tone/energy/pace analysis of the counsellor's speech.
4. **A call, not a chat** — Zoom-like session experience.
5. **Data-driven dashboards** for admin and counsellor, computed from the app's own sessions/reports.

Constraints: local-only (no cloud inference beyond the existing Ollama Cloud LLM), Apple M2 / 8 GB RAM dev machine, two-role dummy-auth model unchanged.

## 2. Decisions log (user-confirmed)

| Decision | Choice |
|---|---|
| Scope | All four streams, one phased revamp |
| Voice architecture | Python sidecar (FastAPI) + existing browser pipeline as automatic fallback |
| Rubric | Data-grounded expanded default **and** admin-configurable templates |
| Real-call data in app | **Offline grounding only** — no raw transcripts/PII in the product |
| Audio mining depth | Stratified sample of ~20 recordings; all 216 transcripts mined |
| Session UI | Focus Stage (immersive orb) + collapsible glass sidebar with Transcript/Coach tabs |
| Personas | Library stays fully admin-managed; mined archetypes seed it + "start from archetype" helper |
| Course catalog | 15 diverse courses now (curated slug list; rescrape to expand) |
| Platform | Keep JSON file store (no SQLite); analytics computed in-memory |

## 3. Gap audit (what this fixes)

1. Course context hardcoded (`courseContext.js`) — no course entity.
2. Rubric unanchored — six one-line criteria, LLM grades on vibes.
3. Phase machine (4 phases, strict ladder) doesn't match real calls (intro → discovery → **presentation** → fee/objections anywhere → in-call payment ask).
4. Personas invented, not derived from real archetypes (UPSC-switchers, parent-funded freshers, working upskillers).
5. No delivery feedback despite voice mode.
6. Dashboards are counts, not insight.
7. Chat UI trains typing, not call presence.
8. Hygiene: Ollama API key in `client/.claude/settings.local.json`; `.DS_Store`, stale `*-out.log`/`*-err.log` at root.

## 4. Offline mining pipeline

**Location:** `scripts/mine/` (working files, git-ignored where they contain PII) → outputs checked into `server/data/seed/`.

**Execution model:** transcript mining runs as a Claude Code multi-agent workflow at build time — transcripts in parallel batches to cheaper-model subagents with JSON-schema-forced outputs, deterministic merge scripts, then a reviewer agent pass before artifacts are accepted. Audio mining is a local batch script. Artifacts are versioned in git; regeneration = re-run the workflow/scripts.

**Artifacts (`server/data/seed/`):**

| File | Contents | Feeds |
|---|---|---|
| `archetypes.json` | 6–10 student archetypes: background, goals, core anxiety, decision dynamics (parents, employer), language texture (incl. Hinglish), typical questions; evidence stats (% of corpus, conversion correlation) | Persona library seeding; "start from archetype"; drill generator |
| `objections.json` | Objection library by category (fee, parents, time, competing exams/UPSC, trust, job guarantee, …): frequency, redacted real phrasings, counter-moves seen in converting calls vs moves preceding drop-offs | Student prompt; report coaching; drill generator; admin analytics categories |
| `conversation-structure.json` | Real opening patterns, presentation timing, payment-ask timing, segment durations | Phase machine v2 tuning |
| `rubric-anchors.json` | Per criterion, behaviour-anchored level descriptions 1–5 with redacted exemplar quotes | Grounded v2 rubric template; report justifications |
| `benchmarks.json` | Duration, talk-ratio, wpm, pause norms (converted vs not) + prosody fields from the audio sample (per-speaker pitch variance, energy, pauses) | Live tone thresholds; report benchmark comparisons |

**Audio sample pipeline (`scripts/mine/audio/`):** stratified ~20 calls (converting + non-converting, mixed counsellors) → ffmpeg pulls HLS to 16 kHz mono wav → faster-whisper word timestamps → lightweight diarization (speaker-embedding clustering) → librosa prosody per speaker. Calls with unreliable diarization are dropped, never silently averaged.

**PII rule:** emails and student names never leave `scripts/mine/` working files. Everything under `server/data/seed/` is pattern-level or redacted-quote-level. The raw CSV stays out of the app and out of git.

## 5. Course catalog

- `scripts/scrape-courses.mjs` scrapes a curated list of **15 diverse course slugs** (spread across the 9 site categories) from masaischool.com listing + detail pages → `server/data/courses.json`.
- Course shape: `{id, slug, name, category, institute, duration, format, fees|null, curriculum: [module], outcomes, eligibility, usps, batchInfo, sourceUrl, scrapedAt, active}`.
- The current hardcoded IIM Ranchi context becomes one catalog entry; `courseContext.js` is retired.
- **Admin Courses page:** browse, edit (fees especially — site often hides them), toggle active, add manual course.
- **Assignment creation** gains a course picker (required). **Practice mode** lets the counsellor pick a course.
- **Sessions snapshot the course** (`courseSnapshot`, same immutability pattern as `personaSnapshot`).
- `prompt.js` builds course context from the snapshot; the report engine receives course facts and penalizes mis-stated fees/duration/curriculum under Product Knowledge.

## 6. Rubric templates + report engine v2

**RubricTemplate entity** (admin CRUD): `{id, name, description, criteria: [{key, label, weight, anchors: {1..5}}], isDefault, createdAt, updatedAt}`. Server validates weights sum to 100. Assignments reference `rubricTemplateId`; sessions snapshot the template; reports store the snapshot.

**Seeded "Grounded v2" default** (from `rubric-anchors.json`), 8 criteria:
rapport/opening 10 · discovery 15 · **presentation 15** (new) · objections 20 · knowledge 15 (vs course snapshot) · **closing & payment ask 10** · communication/empathy 10 · **voice delivery 5** (voice sessions only; weight redistributed pro-rata in text sessions).

**Phase machine v2:** five phases — Opening → Discovery → Presentation → Objections & Negotiation → Close. Advancement stays heuristic (message counts + real-call vocabulary) but **non-strict**: objections register in any phase; a `milestones` coverage checklist is tracked alongside the linear pointer. Reports grade coverage, not just sequence.

**Scoring v2:** per-turn ±10 satisfaction scoring stays; student prompt gains archetype-specific triggers and the objection library so escalation/softening is realistic. Voice sessions attach `deliveryMetrics` `{tone, energy, pitchVariance, wpm, pauseRatio}` to each counsellor transcript entry.

**Report v2 additions:** anchor-quoted rubric justifications; delivery section (tone/pace/energy timeline vs benchmarks); key moments (turn-linked best/worst exchanges); benchmark comparisons (e.g. talk ratio vs converting-call median); 2–3 targeted practice drills. Report generation failure leaves the session intact with a retry affordance.

## 7. Voice sidecar (`voice-server/`, FastAPI on :3002)

**Models** (browser models stay unloaded while sidecar is healthy — fits 8 GB):

- **TTS: Chatterbox 0.5B** (MIT) with per-reply emotion/exaggeration control. The student LLM emits a structured emotion tag with each reply (parsed server-side in `engine.js`, never displayed); the tag drives TTS expressiveness and the orb tint.
- **STT: faster-whisper small (int8)** — accuracy + word timestamps.
- **Tone analysis:** compact wav2vec2-class speech-emotion model (~400 MB) + librosa prosody → delivery metrics judged against mined benchmarks.

**Endpoints:** `GET /health` (per-capability status) · `POST /tts {text, emotion, intensity}` → streamed wav, sentence-chunked · `POST /stt` (audio → text + word timings) · `POST /analyze` (audio → delivery metrics).

**Client integration:** `voice/sidecarClient.js` probes `/health` (1 s timeout) at session start; `useVoiceConversation` gains a pluggable backend per capability (sidecar or existing browser pipeline). Mid-call sidecar death → toast + seamless Kokoro fallback. Mic denied → text input. Delivery metrics ride the existing `POST /sessions/:id/message` body and persist on the transcript entry.

**Ops:** Python 3.11 pinned via `uv`; `npm run voice` one-command start; models lazy-download on first run; `voice-server/smoke.py` smoke test; README degradation matrix (no sidecar / no mic / no WebGPU).

## 8. Session experience (Focus Stage)

- **Green room:** assignment brief (scenario, course card, persona reveal controlled per-assignment by admin — named field `revealPersona`, default true; false = "blind call"), system check strip (mic, sidecar capabilities, browser-model download progress), Join call.
- **Stage:** dark full-bleed canvas; audio-reactive orb avatar (analyser-node scale/glow; emotion-tinted: calm indigo / hesitant amber / frustrated rose), name + speaking/thinking state, student replies as subtitles (latest line), call timer, minimal status pills (phase, mood), controls bar (mic with hold-Space PTT + latch toggle, keyboard toggle, end-call with confirm). Barge-in behaviour unchanged.
- **Glass sidebar** (collapsible): Transcript tab (bubbles, typing indicator, text input) · Coach tab (satisfaction sparkline, live delivery read vs benchmarks, phase milestone checklist, live objection-detected tag).
- **Call end:** wrap-up skeleton while report generates → Report v2. Failure-safe: transcript already persisted; retry regenerates.

## 9. Dashboards + taste pass

- **Admin:** KPI row (mocks completed, avg score, completion rate, trend) · team rubric heatmap (counsellor × criterion) · score trend over weeks · per-counsellor table (mocks, avg %, last-5 delta, weakest criterion) · objection-category performance · recent reports.
- **Counsellor:** progress arc, criterion radar vs anonymized team average, pending mocks, **recommended drill** card (weakest criterion + most-fumbled objection → one-click practice preset with matching archetype persona).
- **Endpoints:** `GET /api/analytics/admin`, `GET /api/analytics/counsellor/:id` — computed in-memory from the JSON store.
- **Taste pass:** keep Monexa-light shell; tighten headers/empty states/skeleton loaders/score-reveal motion; add dark call-stage tokens to `index.css` `@theme`. No icon library.

## 10. Phasing

| Phase | Deliverable | Verification |
|---|---|---|
| 0 Hygiene | Key scrubbed from `client/.claude/settings.local.json`, `.DS_Store` ignored, stale logs deleted, CLAUDE.md + CONTRACT v2 | git status clean; grep finds no key |
| 1 Mining | 5 seed artifacts + audio sample benchmarks | reviewer-agent pass; artifact schema checks; spot-check vs raw CSV |
| 2 Courses | 15-course catalog, Courses page, pickers, prompt integration | smoke-api extended; Playwright admin flow |
| 3 Rubric/report v2 | Templates entity + UI, phase machine v2, scoring v2, report v2 | smoke-api: full session → report asserts new shape |
| 4 Voice sidecar | FastAPI service, 3 capabilities, client routing/fallback | `voice-server/smoke.py`; fallback test with sidecar down |
| 5 Session UI | Green room, stage, sidebar, end flow | Playwright: login → assign → call (text + voice) → report |
| 6 Dashboards | Analytics endpoints, both dashboards, drills, taste pass | smoke-api analytics; Playwright dashboards |

Implementation uses cheaper-model subagents for batch/grunt work with schema-validated outputs and verification passes; each phase lands as a coherent commit (or branch) with its verification green before the next starts.

## 11. Error handling summary

- Sidecar unreachable/dies → browser fallback, toast, capability re-probe on next session.
- Mic denied / no WebGPU → text mode / WASM fallback (existing behaviour preserved).
- Report LLM failure → session persisted, retry button.
- Scrape failures → per-course skip with log; catalog ships checked-in, scrape is offline tooling.
- Mining: schema-invalid agent output → re-prompt once, else batch flagged for manual review; diarization-poor audio dropped from benchmarks.
- Analytics with sparse data → explicit empty/“not enough sessions yet” states, no NaN UI.

## 12. Out of scope (this revamp)

- Real auth/security, multi-tenant hosting, DB migration.
- Generated face video for the student (beyond local hardware); orb avatar instead.
- In-app browsing of real call transcripts/recordings (explicitly declined — offline grounding only).
- Live hint/teleprompter during calls beyond the Coach tab signals.
