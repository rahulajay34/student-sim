"""Voice sidecar — FastAPI app on port 3002.

Endpoints:
  GET  /health
  POST /tts    {text, emotion?, intensity?} -> audio/wav
  POST /stt    multipart "audio" (wav)      -> {text, words, durationSec}
  POST /analyze multipart "audio" + "transcript" -> prosody metrics + verdicts
"""
from __future__ import annotations

import io
import json
import logging
import math
import os
import re
import time
from pathlib import Path
from typing import Annotated

import numpy as np
import soundfile as sf
import librosa

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

import capabilities

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voice.main")

# ---------- app + CORS ----------

@asynccontextmanager
async def _lifespan(application: FastAPI):
    _load_thresholds()
    capabilities.init_analyze()
    log.info("Voice sidecar ready on port 3002 (models load on first request)")
    yield


app = FastAPI(title="voice-sidecar", version="0.1.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- /health ----------

@app.get("/health")
def health() -> dict:
    status = capabilities.get_status()
    engine = capabilities.get_tts_engine()
    return {
        "ok": True,
        "capabilities": {
            "tts": status["tts"],
            "stt": status["stt"],
            "analyze": status["analyze"],
        },
        "ttsEngine": engine,
    }


# ---------- /tts ----------

# Emotion→Chatterbox parameter mapping
EMOTION_MAP: dict[str, dict[str, float]] = {
    "neutral":    {"exaggeration": 0.45, "cfg_weight": 0.5},
    "happy":      {"exaggeration": 0.60, "cfg_weight": 0.45},
    "excited":    {"exaggeration": 0.75, "cfg_weight": 0.40},
    "hesitant":   {"exaggeration": 0.35, "cfg_weight": 0.60},
    "worried":    {"exaggeration": 0.50, "cfg_weight": 0.55},
    "frustrated": {"exaggeration": 0.70, "cfg_weight": 0.45},
}

# Emotion→Kokoro speed mapping (Chatterbox uses exaggeration/cfg_weight instead)
KOKORO_SPEED_MAP: dict[str, float] = {
    "neutral":    1.00,
    "happy":      1.05,
    "excited":    1.12,
    "hesitant":   0.88,
    "worried":    0.94,
    "frustrated": 1.06,
}

VALID_EMOTIONS = set(EMOTION_MAP.keys())
MAX_CHUNK_CHARS = 280
TARGET_SR = 24_000  # output sample rate


class TtsRequest(BaseModel):
    text: str
    emotion: str = "neutral"
    intensity: float = Field(default=0.5, ge=0.0, le=1.0)


def _sentence_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split text into sentence-level chunks ≤ max_chars."""
    # Split on sentence-ending punctuation; keep delimiter with preceding sentence
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    current = ""
    for part in parts:
        if not part:
            continue
        if len(current) + len(part) + 1 <= max_chars:
            current = (current + " " + part).strip()
        else:
            if current:
                chunks.append(current)
            # If single part exceeds max, hard-split it
            while len(part) > max_chars:
                chunks.append(part[:max_chars])
                part = part[max_chars:]
            current = part
    if current:
        chunks.append(current)
    return chunks or [text[:max_chars]]


def _to_wav_bytes(audio: np.ndarray, sr: int) -> bytes:
    """Encode numpy float32/int16 array to 16-bit mono WAV bytes."""
    if audio.dtype != np.int16:
        # Normalize and convert to int16
        peak = np.abs(audio).max()
        if peak > 0:
            audio = audio / peak * 32767
        audio = audio.astype(np.int16)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


def _resample_if_needed(audio: np.ndarray, src_sr: int, target_sr: int = TARGET_SR) -> np.ndarray:
    if src_sr == target_sr:
        return audio
    return librosa.resample(audio.astype(np.float32), orig_sr=src_sr, target_sr=target_sr)


@app.post("/tts")
def tts(req: TtsRequest) -> Response:
    if not req.text or not req.text.strip():
        raise HTTPException(400, "text must be non-empty")

    model, engine = capabilities.get_tts()
    status = capabilities.get_status()["tts"]

    if status == "off":
        raise HTTPException(503, "TTS disabled (VOICE_TTS=off)")
    if status == "loading":
        raise HTTPException(503, "TTS model loading, retry shortly")
    if status.startswith("error") or model is None:
        raise HTTPException(503, f"TTS unavailable: {status}")

    emotion = req.emotion if req.emotion in VALID_EMOTIONS else "neutral"
    chunks = _sentence_chunks(req.text)

    t0 = time.perf_counter()
    segments: list[np.ndarray] = []

    if engine == "chatterbox":
        params = EMOTION_MAP[emotion].copy()
        # Intensity scales exaggeration ±0.15 around the base value
        base_exag = params["exaggeration"]
        delta = (req.intensity - 0.5) * 2 * 0.15  # maps [0,1] → [-0.15, +0.15]
        params["exaggeration"] = float(np.clip(base_exag + delta, 0.0, 1.0))

        for chunk in chunks:
            wav_tensor = model.generate(chunk, **params)
            arr = wav_tensor.squeeze().cpu().numpy().astype(np.float32)
            arr = _resample_if_needed(arr, model.sr, TARGET_SR)
            segments.append(arr)

    elif engine == "kokoro":
        speed = KOKORO_SPEED_MAP.get(emotion, 1.0)
        for chunk in chunks:
            samples, sr = model.create(chunk, voice="af_heart", speed=speed, lang="en-us")
            arr = np.array(samples, dtype=np.float32)
            arr = _resample_if_needed(arr, sr, TARGET_SR)
            segments.append(arr)

    else:
        raise HTTPException(503, "TTS engine unknown")

    combined = np.concatenate(segments) if len(segments) > 1 else segments[0]
    wav_bytes = _to_wav_bytes(combined, TARGET_SR)

    elapsed = time.perf_counter() - t0
    log.info("TTS/%s: %d chunks, %.1fs, %d KB", engine, len(chunks), elapsed, len(wav_bytes) // 1024)

    return Response(content=wav_bytes, media_type="audio/wav")


# ---------- /stt ----------

@app.post("/stt")
def stt(audio: UploadFile = File(...)) -> dict:
    model = capabilities.get_stt()
    status = capabilities.get_status()["stt"]

    if status == "off":
        raise HTTPException(503, "STT disabled (VOICE_STT=off)")
    if status == "loading":
        raise HTTPException(503, "STT model loading, retry shortly")
    if status.startswith("error") or model is None:
        raise HTTPException(503, f"STT unavailable: {status}")

    raw = audio.file.read()
    if len(raw) > 30_000_000:
        raise HTTPException(413, "Audio upload too large (max 30 MB)")
    buf = io.BytesIO(raw)

    # Load audio via soundfile (expects WAV)
    try:
        y, sr = sf.read(buf, dtype="float32", always_2d=False)
    except Exception as e:
        raise HTTPException(400, f"Could not read audio: {e}") from e

    if y.ndim > 1:
        y = y.mean(axis=1)

    # faster-whisper expects 16 kHz mono float32
    if sr != 16000:
        y = librosa.resample(y, orig_sr=sr, target_sr=16000)
        sr = 16000

    duration_sec = len(y) / sr

    # Write to temp buffer for faster-whisper (it reads from file path or numpy)
    segments, _info = model.transcribe(
        y,
        word_timestamps=True,
        language="en",
    )

    words: list[dict] = []
    text_parts: list[str] = []
    for seg in segments:
        text_parts.append(seg.text.strip())
        for w in (seg.words or []):
            words.append({
                "word": w.word.strip(),
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
            })

    return {
        "text": " ".join(text_parts),
        "words": words,
        "durationSec": round(duration_sec, 2),
    }


# ---------- /analyze ----------

# Benchmark thresholds (loaded once at startup, fall back to constants)
_THRESHOLDS: dict[str, float] = {}


def _load_thresholds() -> None:
    """Read ../server/data/seed/benchmarks.json prosody block if available."""
    global _THRESHOLDS
    bench_path = Path(__file__).parent.parent / "server" / "data" / "seed" / "benchmarks.json"
    try:
        data = json.loads(bench_path.read_text())
        prosody = data.get("prosody", {})
        _THRESHOLDS = {
            "wpm": float(prosody.get("wpm", 150)),
            "pitchVarSemitones": float(prosody.get("pitchVarSemitones", 2.8)),
            "energyCv": float(prosody.get("energyCv", 0.7)),
            "pauseRatio": float(prosody.get("pauseRatio", 0.45)),
        }
        log.info("Loaded prosody thresholds from benchmarks.json: %s", _THRESHOLDS)
    except Exception:
        _THRESHOLDS = {
            "wpm": 150.0,
            "pitchVarSemitones": 2.8,
            "energyCv": 0.7,
            "pauseRatio": 0.45,
        }
        log.info("Using default prosody thresholds (benchmarks.json not found): %s", _THRESHOLDS)


# Pure-math helpers (mirrored from scripts/mine/audio/analyze.py)

def _group_spans(words_list: list[dict], gap: float = 0.4) -> list[dict]:
    spans: list[dict] = []
    for w in words_list:
        if spans and w["start"] - spans[-1]["end"] <= gap:
            spans[-1]["end"] = w["end"]
            spans[-1]["words"] += 1
        else:
            spans.append({"start": w["start"], "end": w["end"], "words": 1})
    return spans


def _pause_ratio(spans: list[dict], total_seconds: float) -> float:
    if total_seconds <= 0:
        return 0.0
    speech = sum(s["end"] - s["start"] for s in spans)
    return max(0.0, min(1.0, (total_seconds - speech) / total_seconds))


def _semitone_std(f0_values: list[float]) -> float:
    vals = [v for v in f0_values if v and v > 0 and not math.isnan(v)]
    if len(vals) < 2:
        return 0.0
    ref = sum(vals) / len(vals)
    semis = [12.0 * math.log2(v / ref) for v in vals]
    mean_s = sum(semis) / len(semis)
    return math.sqrt(sum((s - mean_s) ** 2 for s in semis) / len(semis))


def _wpm(word_count: int, speech_seconds: float) -> float:
    return 0.0 if speech_seconds <= 0 else word_count / (speech_seconds / 60.0)


@app.post("/analyze")
def analyze(
    audio: UploadFile = File(...),
    transcript: Annotated[str | None, Form()] = None,
) -> dict:
    status = capabilities.get_status()["analyze"]

    if status == "off":
        raise HTTPException(503, "Analyze disabled (VOICE_ANALYZE=off)")

    raw = audio.file.read()
    if len(raw) > 30_000_000:
        raise HTTPException(413, "Audio upload too large (max 30 MB)")
    buf = io.BytesIO(raw)

    try:
        y, sr = sf.read(buf, dtype="float32", always_2d=False)
    except Exception as e:
        raise HTTPException(400, f"Could not read audio: {e}") from e

    if y.ndim > 1:
        y = y.mean(axis=1)

    # Resample to 16 kHz for analysis
    if sr != 16000:
        y = librosa.resample(y, orig_sr=sr, target_sr=16000)
        sr = 16000

    total_seconds = len(y) / sr

    # --- Pitch (pyin) ---
    f0, _voiced_flag, _voiced_probs = librosa.pyin(
        y,
        sr=sr,
        fmin=float(librosa.note_to_hz("C2")),
        fmax=float(librosa.note_to_hz("C6")),
    )
    f0_vals = [float(v) for v in f0 if v is not None and not math.isnan(v) and v > 0]
    pitch_var = _semitone_std(f0_vals)

    # --- RMS energy ---
    rms = librosa.feature.rms(y=y)[0]
    rms_mean = float(rms.mean()) if len(rms) > 0 else 0.0
    rms_std = float(rms.std()) if len(rms) > 0 else 0.0
    energy_cv = (rms_std / rms_mean) if rms_mean > 0 else 0.0

    # --- Pause ratio (energy-gap method) ---
    # Build pseudo-spans from RMS energy: frame is "speech" if rms > 10% of mean
    hop = 512
    frame_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    speech_frames = rms > (rms_mean * 0.1)
    pseudo_spans: list[dict] = []
    for i, (t, active) in enumerate(zip(frame_times, speech_frames)):
        if active:
            frame_dur = float(hop / sr)
            if pseudo_spans and t - pseudo_spans[-1]["end"] <= 0.4:
                pseudo_spans[-1]["end"] = t + frame_dur
                pseudo_spans[-1]["words"] += 1
            else:
                pseudo_spans.append({"start": float(t), "end": float(t + frame_dur), "words": 1})

    pause_r = _pause_ratio(pseudo_spans, total_seconds)

    # --- WPM ---
    computed_wpm: float | None = None
    if transcript and transcript.strip():
        word_count = len(transcript.strip().split())
        speech_s = sum(s["end"] - s["start"] for s in pseudo_spans) or total_seconds
        computed_wpm = _wpm(word_count, speech_s)
    else:
        # Try STT if ready
        stt_status = capabilities.get_status()["stt"]
        if stt_status == "ready":
            stt_model = capabilities.get_stt()
            if stt_model is not None:
                try:
                    segs, _ = stt_model.transcribe(y, word_timestamps=True, language="en")
                    words_list: list[dict] = []
                    for seg in segs:
                        for w in (seg.words or []):
                            words_list.append({"start": w.start, "end": w.end, "words": 1})
                    if words_list:
                        spans_from_stt = _group_spans(words_list)
                        speech_s_stt = sum(s["end"] - s["start"] for s in spans_from_stt)
                        word_count_stt = sum(s["words"] for s in spans_from_stt)
                        computed_wpm = _wpm(word_count_stt, speech_s_stt)
                except Exception:
                    pass  # wpm stays None

    # --- Verdicts ---
    thr = _THRESHOLDS
    median_wpm = thr["wpm"]
    median_pitch = thr["pitchVarSemitones"]
    median_energy_cv = thr["energyCv"]

    pace_verdict: str | None = None
    if computed_wpm is not None:
        if computed_wpm < median_wpm * 0.75:
            pace_verdict = "slow"
        elif computed_wpm > median_wpm * 1.25:
            pace_verdict = "fast"
        else:
            pace_verdict = "good"

    energy_verdict: str
    if energy_cv < median_energy_cv * 0.5:
        energy_verdict = "flat"
    elif energy_cv > median_energy_cv * 1.5:
        energy_verdict = "hot"
    else:
        energy_verdict = "good"

    pitch_verdict: str
    if pitch_var < median_pitch * 0.6:
        pitch_verdict = "monotone"
    else:
        pitch_verdict = "good"

    # --- Tone ---
    tone: str
    if pitch_verdict == "good" and energy_verdict == "good":
        tone = "warm"
    elif pitch_verdict == "monotone" and energy_verdict == "flat":
        tone = "flat"
    elif pace_verdict == "fast" and energy_verdict == "hot":
        tone = "tense"
    else:
        tone = "neutral"

    # --- Energy label ---
    energy_label: str
    if energy_cv < median_energy_cv * 0.5:
        energy_label = "low"
    elif energy_cv > median_energy_cv * 1.5:
        energy_label = "high"
    else:
        energy_label = "medium"

    return {
        "tone": tone,
        "energy": energy_label,
        "wpm": round(computed_wpm, 1) if computed_wpm is not None else None,
        "pitchVarSemitones": round(pitch_var, 2),
        "pauseRatio": round(pause_r, 3),
        "energyCv": round(energy_cv, 3),
        "verdicts": {
            "pace": pace_verdict,
            "energy": energy_verdict,
            "pitchVariation": pitch_verdict,
        },
    }


# ---------- entry point ----------

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=3002, log_level="info")
