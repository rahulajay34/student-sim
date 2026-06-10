# voice-server — Voice Sidecar (port 3002)

Local FastAPI service providing expressive TTS, accurate STT, and counsellor
delivery analysis for the mock-counselling trainer.  The client probes once per
session and routes per capability, falling back to in-browser models
automatically.

## Quick start

```bash
cd voice-server
./run.sh          # creates .venv, installs deps, starts on :3002
```

Or manually:

```bash
cd voice-server
uv venv --python 3.11 --allow-existing
uv pip install -e .
.venv/bin/python main.py
```

## Env flags

| Variable        | Default | Effect                                       |
|-----------------|---------|----------------------------------------------|
| `VOICE_TTS`     | `on`    | Set `off` to disable TTS (saves RAM)         |
| `VOICE_STT`     | `on`    | Set `off` to disable STT                     |
| `VOICE_ANALYZE` | `on`    | Set `off` to disable /analyze                |

Example — STT only:
```bash
VOICE_TTS=off VOICE_ANALYZE=off ./run.sh
```

## Model files

Models are downloaded automatically on first request to `voice-server/models/`:

| Model                  | Size    | Purpose                              |
|------------------------|---------|--------------------------------------|
| `kokoro-v1.0.onnx`     | ~0.3 GB | TTS synthesis (primary fallback)     |
| `voices-v1.0.bin`      | ~0.1 GB | Kokoro voice embeddings              |
| faster-whisper `small` | ~0.5 GB | STT (downloaded by faster-whisper)   |

Chatterbox (~3-4 GB) is attempted first for TTS; if it fails to install or
load on this machine it falls back to kokoro-onnx automatically.  `/health`
reports `ttsEngine: "chatterbox"` or `"kokoro"`.

## Endpoints

### GET /health
```json
{
  "ok": true,
  "capabilities": { "tts": "ready", "stt": "ready", "analyze": "ready" },
  "ttsEngine": "kokoro"
}
```
Status values: `"ready"` | `"loading"` | `"unloaded"` | `"off"` | `"error:<msg>"`

### POST /tts
```json
{ "text": "...", "emotion": "happy", "intensity": 0.6 }
```
Returns `audio/wav` (24 kHz mono int16).  Emotion is one of:
`neutral` · `happy` · `excited` · `hesitant` · `worried` · `frustrated`

Intensity (0–1) scales Chatterbox exaggeration ±0.15; ignored by kokoro.

**Chatterbox emotion → parameter mapping:**
| Emotion     | exaggeration | cfg_weight |
|-------------|-------------|------------|
| neutral     | 0.45        | 0.50       |
| happy       | 0.60        | 0.45       |
| excited     | 0.75        | 0.40       |
| hesitant    | 0.35        | 0.60       |
| worried     | 0.50        | 0.55       |
| frustrated  | 0.70        | 0.45       |

Expected time-to-audio on Apple M2 8 GB:
- Kokoro: **1–3 s** per 2-sentence chunk
- Chatterbox (if available): **3–10 s** per sentence (CPU-only)

### POST /stt
Multipart `audio` field (WAV, 16 kHz mono recommended).
```json
{
  "text": "full transcript",
  "words": [{"word": "hello", "start": 0.1, "end": 0.4}],
  "durationSec": 4.2
}
```

### POST /analyze
Multipart `audio` field (WAV) + optional `transcript` form field.
```json
{
  "tone": "warm",
  "energy": "medium",
  "wpm": 142.5,
  "pitchVarSemitones": 3.1,
  "pauseRatio": 0.38,
  "energyCv": 0.72,
  "verdicts": {
    "pace": "good",
    "energy": "good",
    "pitchVariation": "good"
  }
}
```
Thresholds are read from `../server/data/seed/benchmarks.json` (prosody block)
if present; otherwise uses paid-call counsellor medians:
- WPM: 150, pitchVarSemitones: 2.8, energyCv: 0.7, pauseRatio: 0.45

## Smoke test

```bash
# Server must be running first
python3 smoke.py
```

## Degradation matrix

| Sidecar condition          | TTS fallback                   | STT fallback                    | Analysis            |
|----------------------------|--------------------------------|----------------------------------|---------------------|
| Sidecar not running        | Browser Kokoro (WebGPU/WASM)   | Browser whisper-tiny             | No delivery metrics |
| `VOICE_TTS=off`            | Browser Kokoro                 | Sidecar STT (if on)              | Delivery metrics from browser |
| `VOICE_STT=off`            | Sidecar TTS (if on)            | Browser whisper-tiny             | Partial (no wpm via STT) |
| `VOICE_ANALYZE=off`        | Sidecar TTS (if on)            | Sidecar STT (if on)              | No delivery metrics |
| Mic permission denied      | — (voice disabled)             | — (voice disabled)               | — |
| All capabilities off/error | Browser Kokoro                 | Browser whisper-tiny             | No delivery metrics |

When delivery metrics are absent, the `voice_delivery` rubric criterion is
auto-dropped from the coaching report (Phase 3 sessionHasVoiceMetrics check).

## Architecture notes

- Python 3.11 via `uv` (pinned `requires-python = ">=3.11,<3.12"`).
- Models lazy-load on **first request** — `/health` reports `"unloaded"` until
  triggered, then `"loading"`, then `"ready"` or `"error:<msg>"`.
- Thread-safe singleton loading with `threading.Lock`.
- Nothing leaves localhost; no telemetry.
