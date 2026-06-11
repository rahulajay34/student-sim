# OpenAI-Realtime Consolidation & Platform Polish — Design

Date: 2026-06-12 · Status: approved by owner (build it all)

## Context

v4 shipped three voice engines (classic STT→MiniMax→TTS, OpenAI Realtime S2S, ElevenLabs
S2S). Owner decisions:

1. Keep **only OpenAI Realtime** for voice; remove classic + ElevenLabs engines.
2. OpenAI **plays the student** during voice calls (speech-to-speech); MiniMax stays the
   analytics brain (scoring/cues/objections/phases/report) via `/observe`.
3. **Text-only chat survives** as a fallback (existing MiniMax `/message` path).
4. Live 0–100 score **stays visible** to the counsellor, but the student's decisions must
   not be gated by hardcoded thresholds — willingness must be dynamic, driven by counsellor
   performance and persona.
5. Student speech: **mostly English with an Indian accent**, Hinglish only occasional.
6. Push final work to GitHub `main` (guard secrets).

Recon evidence (5 parallel agents over v3 + v4 delta): only-one-mode → v4 added engines;
Hinglish has 7 ranked prompt-side root causes; real transcripts show verbatim objection
loops (same concern raised 7×), 22.7-word average student turns (target 8–15), 42% of
turns starting with the same 3 openers; report is one monolithic 15–90s LLM call with a
silent 240s worst case; realtime mode never updates instructions mid-call.

## Workstream 1 — Voice: OpenAI Realtime only

**Removals**
- Client: `useVoiceConversation.js`, `tts.js`, `stt.js`, `audioPlayer.js`,
  `sidecarClient.js`, `useElevenLabsRealtime.js`; engine picker in GreenRoom;
  ElevenLabs voices/constants in `engines.js`; sidecar checks in GreenRoom/CallStage.
- Server: ElevenLabs agent functions in `realtime.js`; `/realtime/elevenlabs-token`
  route; `server/data/realtime.json`.
- `voice-server/` (Python sidecar) deleted; CLAUDE.md/CONTRACT.md updated.
- Keep: `Orb.jsx`, `useCallAudioLevel.js` (OpenAI path provides a real AnalyserNode),
  text-chat `/message` path (incl. SSE) for text-only sessions.

**GreenRoom join choices**: "Join call" (voice, OpenAI) and "Practice by text" with
equal visual prominence. Engine storage key removed; engine is always `openai` for
voice sessions, `text` recorded for text-only sessions.

**Mid-call steering (new)**: `/observe` response gains a compact `steering` string
(open/answered objections with their last used phrasing, disposition narrative, phase,
turn-length guidance). Client sends `session.update` over the WebRTC data channel with
`instructions = BASE_INSTRUCTIONS + "\n\nCURRENT STATE\n" + steering` after each
student turn. Base instructions stay byte-stable for prompt caching.

**Latency**
- `turn_detection: { type: "semantic_vad", eagerness: "auto" }` → keep semantic, expose
  `OPENAI_VAD_EAGERNESS` env (default `auto`).
- Transcription `whisper-1` → `gpt-4o-mini-transcribe` (default; env-overridable).
- Dedicated `buildRealtimeInstructions` producing ~1.2–1.8k tokens (voice-acting prompt,
  no text-chat scaffolding: no emotion tags, no written-style few-shots, no verbosity
  roll text, no turn-discipline statements meant for typed chat).
- `/observe` scoring: thinking disabled, last-6-turn context, 15s timeout, never blocks
  the reply (provider talks regardless); cue stays instant-first.

**Delivery metrics without the sidecar**: in-browser metrics per counsellor utterance —
WPM (word count from realtime transcription ÷ speech duration from VAD start/stop),
pause count/ratio, energy variance from the local mic AnalyserNode. Attached to
`/observe` counsellor turns as `deliveryMetrics` (same shape the report already reads),
keeping the `voice_delivery` rubric criterion scoreable in voice sessions.

**Indian accent grounding**: bounded research task — run the existing
`scripts/mine/audio` tooling on a sample of recordings from
`counselling_ba_courses - Sheet1.csv` to extract tempo/pause/pitch stats; write
`docs/research/indian-accent-prosody.md`; the realtime delivery section quotes real
numbers (target WPM band, pause cadence, intonation notes). Voices: gender-mapped
`marin`/`cedar` (env-overridable), in-call voice picker kept.

## Workstream 2 — Persona realism + Hinglish fix

Language policy (single source of truth, stated once, no named-Hindi-token lists):
"Speak Indian English. At most one light Hindi word every few turns; never full Hindi
sentences unless the counsellor speaks full Hindi sentences repeatedly."

- `archetypes.json`: rewrite `languageTexture` for `automation_scared_switcher`,
  `reel_struck_parent_gated_fresher`, `family_business_modernizer` — Indian-English
  texture, no Hinglish example sentences.
- `personality.js`: `DEFAULT_PERSONALITY.formality` 2→3; formality≤2 language text loses
  the named Hindi tokens; keeps "occasional single Hindi word".
- `personas.json`: bump formality of studying/diff-field/non-working to 3; rewrite the
  diff-field "switches to Hindi phrases" quirk to an English-anxiety quirk.
- `prompt-config.json`: replace the Hinglish few-shot; drop "theek hai" from
  `turnDiscipline.statementListen` and `naturalSpeech`; narrow the mirroring rule.
- Realtime addendum: same policy; explicitly "mostly English in an Indian accent".

Anti-looping & turn shape:
- `objections.js`: store the last phrasing used per objection; prompt bans re-raising
  answered objections **quoting that phrasing**; loop-break nudge at `timesRaised >= 2`.
- Steering (WS1) delivers this state to the voice model mid-call.
- Spoken turn-length target 5–15 words, hard variety rule for openers (never start two
  consecutive turns with the same word; rotate fillers).
- Self-introduction variety: persona openers parameterized by leadCard so repeated
  sessions don't produce identical intros.

## Workstream 3 — Report: fast + restructured

- **Async generation**: `POST /end` kicks off generation in the background (in-memory
  promise map keyed by sessionId), immediately returns `{ reportId, status:"generating" }`
  with the instantly-computable parts persisted (scoreArc, benchmarks, transcript,
  metadata). Idempotent re-calls keep working.
- Client: end-of-call navigates to ReportDetail immediately; page renders score arc,
  benchmarks, transcript at once; LLM sections render skeletons and fill on 2s polling
  of `GET /reports/:id` until `status:"ready"` (or `"fallback"`).
- **Parallel LLM fan-out** inside generation: Call A (rubric + phase breakdown) ∥
  Call B (strengths/improvements/keyMoments); Call C (drills) after A (needs weakest
  criterion). Each call ~smaller prompt; adaptive thinking only when transcript > 20
  turns; retries: attempt 2 runs thinking-disabled with 60s timeout (worst case ≈ halved).
- Structure: add `overall.headline` ("next session, focus on X"); fix the dead
  `degradedNotice` so fallback reports visibly offer regeneration.

## Workstream 4 — Dynamic convincement

- Remove from the student prompt: "AGREEMENT THRESHOLD: 70", the below-70 decline rule,
  the 5 fixed score-band disposition strings, and numeric score exposure entirely.
- New **disposition narrative** per turn, computed server-side from: score *trajectory*
  (momentum over last N turns, not absolute value), objection ledger (which concerns
  were genuinely answered), persona traits (skepticism, hesitancy), and a hidden
  per-session **persuadability roll** (seeded from persona traits ± variance at session
  start) so identical personas vary between sessions. Rendered as natural language
  ("You came in guarded about fees; the EMI explanation genuinely helped…"). Agreement
  emerges when concerns are addressed and momentum is sustained — no fixed number; the
  narrative says "you feel ready; if asked to book, agree" only when earned.
- The 0–100 meter remains counsellor-facing (live UI + report). Scoring prompt gains
  early-phase guidance so rapport/discovery quality moves the score (currently frozen
  at 50 through phases 1–3).
- Same disposition module feeds both text mode (per-turn prompt) and voice mode
  (steering updates).

## Workstream 5 — UI/UX overhaul

Fix the ranked friction list: parallelize green-room fetch waterfall; replace 4×
`window.confirm` with kit Modal confirms; Modal focus trap + `aria-labelledby`;
`React.memo` transcript bubbles + stop per-token full-tree re-renders; equal-prominence
join buttons; retry-without-page-reload (Practice/AssignmentCreate/Reports); GreenRoom
tokens instead of raw hex; aria-live toasts; table sort + search + `N` shortcut on admin
lists; count-up score animation on report hero; score-change pulse in call UI; wrapping
screen with elapsed-time + instant navigation (ties to WS3). Polish pass via the
frontend-design skill; existing design language (indigo light admin shell + dark stage)
is kept, refined, not rethemed.

## Workstream 6 — Bug audit

Multi-agent find → adversarially-verify → fix workflow over server, client, realtime
layer, and data consistency. Already-queued confirmed bugs: `[emotion:*]` tags stored in
S2S transcripts (strip in `/observe` server-side), dead `degradedNotice` in ReportDetail,
session-lock contention on `/end` (mitigated by WS3 async), stale CLAUDE.md/CONTRACT.md.

## Verification

- `node --test server/tests/*.mjs` (extended for disposition, steering, objections,
  report assembly), `npm run lint`, `npm run build`.
- Live smoke: server + client up, Playwright drive of a text session end-to-end and a
  voice green-room (token mint mocked if no `OPENAI_API_KEY` present).
- `node scripts/smoke-api.mjs` updated for new endpoints.
- Final: commit + push to `origin/main` after secret scan.

## Out of scope

Real auth, DB migration off JSON files, mobile layout, the offline mining pipeline.
