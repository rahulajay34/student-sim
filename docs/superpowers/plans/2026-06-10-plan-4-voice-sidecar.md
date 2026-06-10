# Plan 4: Voice Sidecar (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. NO-GIT RULE: no git commands.

**Goal:** A local FastAPI voice sidecar (`voice-server/`, port 3002) providing expressive TTS (Chatterbox, emotion-driven), accurate STT (faster-whisper, word timestamps), and counsellor delivery analysis (librosa prosody vs mined benchmarks) — with the existing in-browser pipeline as automatic fallback. The student LLM emits an emotion tag per reply that drives TTS expressiveness and the (Phase 5) orb tint; counsellor `deliveryMetrics` persist on transcript entries, unlocking the `voice_delivery` rubric criterion.

**Architecture:** Python 3.11 via uv (`voice-server/pyproject.toml`); models lazy-load on first use per capability with env kill-switches (8 GB RAM). `GET /health` reports per-capability status; client `voice/sidecarClient.js` probes once per session and routes per capability, falling back to browser models. `engine.js` parses a trailing `[emotion:...]` tag from student replies (never shown). `POST /api/sessions/:id/message` accepts optional `deliveryMetrics` and stores them on the counsellor transcript entry.

**8 GB design rules:** Chatterbox (~3-4 GB) is the only big model; STT small-int8 (~0.5 GB); /analyze is pure librosa + benchmark thresholds (no ML emotion model in v1 — response shape stays future-proof). If Chatterbox fails to install/load on this machine, the sidecar auto-falls back to `kokoro-onnx` (~0.4 GB, less expressive but still server-side; logged in /health as `engine: "kokoro"`).

---

## Endpoints (CONTRACT addendum)

```
GET  /health      -> { ok: true, capabilities: { tts: "ready"|"loading"|"off"|"error", stt: ..., analyze: ... }, ttsEngine: "chatterbox"|"kokoro"|null }
POST /tts         -> body { text, emotion?: "neutral"|"happy"|"hesitant"|"worried"|"frustrated"|"excited", intensity?: 0..1 }  -> audio/wav bytes
POST /stt         -> multipart file "audio" (wav/webm) -> { text, words: [{word, start, end}], durationSec }
POST /analyze     -> multipart file "audio" + form field "transcript" (optional) -> { tone: "warm"|"neutral"|"flat"|"tense", energy: "low"|"medium"|"high", wpm, pitchVarSemitones, pauseRatio, energyCv, verdicts: { pace: "slow"|"good"|"fast", energy: "flat"|"good"|"hot", pitchVariation: "monotone"|"good" } }
```

Session message body gains `deliveryMetrics?` (the /analyze response, attached by the client to the matching utterance). Transcript counsellor entries gain `deliveryMetrics`. `/sessions/start` + `/message` responses gain `emotion` (the student's current emotion tag, default "neutral").

Emotion→TTS mapping (Chatterbox `exaggeration`/`cfg_weight`): neutral 0.45/0.5 · happy 0.6/0.45 · excited 0.75/0.4 · hesitant 0.35/0.6 · worried 0.5/0.55 · frustrated 0.7/0.45. Intensity scales exaggeration ±0.15.

---

### Task 1: Sidecar scaffold + /health + ops

**Files:** Create `voice-server/pyproject.toml`, `voice-server/main.py`, `voice-server/capabilities.py`, `voice-server/smoke.py`, `voice-server/README.md`; modify root `package.json`? (none exists — instead add `voice-server/run.sh` and document).

- `pyproject.toml`: requires-python ">=3.11,<3.12"; deps: fastapi, uvicorn, python-multipart, numpy, soundfile, librosa, faster-whisper, chatterbox-tts (TRY; if unresolvable: comment out + note), kokoro-onnx, torch (pulled by chatterbox anyway).
- `capabilities.py`: lazy singletons — `get_tts()` (try chatterbox → kokoro fallback; record engine + status), `get_stt()`, analyze needs no model. Env flags `VOICE_TTS/VOICE_STT/VOICE_ANALYZE` ("off" disables). Status dict consumed by /health.
- `main.py`: FastAPI app, permissive CORS for http://localhost:5173, the four endpoints (tts/stt/analyze in Tasks 2-4 — scaffold returns 503 "loading/off" until implemented), `if __name__ == "__main__": uvicorn.run(app, host="127.0.0.1", port=3002)`.
- `run.sh`: `cd "$(dirname "$0")" && uv venv --python 3.11 --allow-existing && uv pip install -q -e . && .venv/bin/python main.py`.
- `smoke.py`: hits /health, /tts (writes /tmp/voice-tts-smoke.wav, asserts RIFF header + >10KB), /stt (feeds the tts output back, asserts non-empty text), /analyze (same wav, asserts wpm number) — exits 1 on failure, prints capability table.
- README: setup, env flags, degradation matrix (sidecar down → browser Kokoro/whisper-tiny; mic denied → text input; analyze off → no delivery metrics, voice_delivery criterion auto-dropped).

### Task 2: /tts (Chatterbox + kokoro fallback)

- Sentence-split text (`re.split` on sentence enders, keep ≤280-char chunks), synthesize sequentially, concatenate waveforms, return single wav (24 kHz mono float32 → int16). Emotion mapping table above. Kokoro path: voice "af_heart", ignore emotion (log once).
- Probe (manual): time-to-first-byte for a 2-sentence reply on this M2; record in README ("expect 2-8 s on M2 8GB").

### Task 3: /stt (faster-whisper small int8)

- Accept wav/webm (ffmpeg-python not needed — librosa/soundfile read webm via audioread? NO: browser sends what it records. Keep contract simple: client sends 16 kHz mono WAV (the existing browser pipeline already captures PCM for whisper-tiny — reuse that buffer, encode WAV client-side). Sidecar asserts wav.
- `word_timestamps=True`, language en; return shape per contract.

### Task 4: /analyze (prosody vs benchmarks)

- librosa: pyin pitch (semitone std via the same math as scripts/mine/audio/analyze.py — copy the helpers, keep them dependency-light), RMS energy CV, wpm from transcript+duration (or STT word count if transcript absent), pauseRatio from energy gaps.
- Thresholds from `server/data/seed/benchmarks.json` prosody block when present (read at startup; fall back to constants: paid-call counsellor medians). Verdicts: pace good = within ±25% of paid median wpm; energy flat if energyCv < 0.5× median; pitchVariation monotone if < 0.6× median pitchVar. tone: warm if pitchVar good + energy good; flat if monotone+low; tense if fast pace + high energy; else neutral.

### Task 5: emotion tag (server)

- `prompt.js`: add to response rules — "End EVERY reply with a tag [emotion:X] where X ∈ neutral|happy|hesitant|worried|frustrated|excited reflecting your current feeling. The tag is invisible to the counsellor."
- `engine.js`: `parseEmotion(text)` → strips trailing tag, returns {text, emotion} (default neutral; tolerate tag anywhere in last line). Both getFirstMessage and getStudentReply return {text, emotion}.
- `index.js`: store `emotion` on student transcript entries; return `emotion` in /sessions/start and /message responses. Sessions GET already returns transcript (emotion rides along).
- `/message` accepts `deliveryMetrics` (object, optional, validated shallowly: numbers/strings only) → stored on the counsellor entry.
- smoke: assert /message response has `emotion` string; assert POST with deliveryMetrics persists it (GET session → entry has it).

### Task 6: client integration

- `client/src/voice/sidecarClient.js` (new): `probe()` (GET /health, 1 s timeout, cached per session), `tts(text, emotion)` → ArrayBuffer, `stt(wavBlob)`, `analyze(wavBlob, transcript)`. Base URL `http://localhost:3002`.
- `useVoiceConversation.js`: READ first. Add optional backend routing: when sidecar tts ready → fetch wav → play through existing gapless player (epoch/barge-in semantics preserved — the player takes decoded buffers; decode via AudioContext.decodeAudioData). When sidecar stt ready → send captured PCM as WAV to sidecar instead of running whisper-tiny locally (keep VAD/push-to-talk capture identical). After each finalized utterance, if analyze ready: fire-and-forget analyze → resolve deliveryMetrics → expose via `onDeliveryMetrics(metrics)` callback option.
- `Session.jsx`: pass `onDeliveryMetrics` → keep latest in a ref → include as `deliveryMetrics` in the next `api.sendMessage(id, text, deliveryMetrics)`; `api.js` sendMessage gains optional third param. Speak replies with the `emotion` returned by /message (api response already carries it). Show nothing new in UI yet (Phase 5 owns the call UI; a tiny "sidecar voice" Badge near the voice status is fine).
- Fallbacks: every sidecar call try/catch → flip capability off for the session → browser path. No retry storms.

### Task 7: docs + smoke + e2e

- CONTRACT: endpoints table (sidecar section), message body/response changes, transcript entry fields.
- CLAUDE.md: voice-server section (run via `voice-server/run.sh`, port 3002, capability env flags, degradation matrix).
- smoke-api.mjs: emotion assertion + deliveryMetrics round-trip (no sidecar needed — POST fake metrics).
- `voice-server/smoke.py` full pass on this machine; record timings. Client lint/build. Manual Playwright spot-check deferred to Phase 5 (call UI).

## Self-review notes
- voice_delivery rubric: Phase 3's `sessionHasVoiceMetrics` keys off `transcript[].deliveryMetrics` — Task 5/6 make that real; an all-voice session now grades 8 criteria.
- Latency honesty: Chatterbox on M2-CPU may be slow; sentence-chunked synthesis + the existing queue keeps perceived latency tolerable; README documents expectations; kokoro fallback exists.
- PII: nothing leaves localhost.
