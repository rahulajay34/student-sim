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

# ---------- ElevenLabs helpers ----------

# Primary model: eleven_v3 (expressive, supports inline audio tags for emotion delivery).
# The conversation is English-majority so eleven_v3 is stable and delivers noticeably
# more natural student voices than the flat eleven_flash_v2_5 output.
# Override via VOICE_ELEVENLABS_MODEL env var to switch to a different model if needed.
# The automatic error-fallback is always eleven_flash_v2_5 — if eleven_v3 returns a
# 4xx/5xx the request retries once with the flash model (no audio tags) so a turn
# never goes silent.
_EL_MODEL_DEFAULT = "eleven_v3"
_EL_MODEL_FALLBACK = "eleven_flash_v2_5"
_EL_API_BASE = "https://api.elevenlabs.io/v1"


def _el_model() -> str:
    """Return the configured ElevenLabs TTS model (env override or default).

    Default is eleven_v3 — expressive, supports inline audio tags, preferred for
    the English-majority student roleplay voices (Prashant / Priya / Vikram).
    Override via VOICE_ELEVENLABS_MODEL env var (e.g. eleven_flash_v2_5 for speed).
    The automatic error-fallback path (v3 HTTP error → flash retry) is separate and
    always uses eleven_flash_v2_5 regardless of this setting.
    """
    return os.environ.get("VOICE_ELEVENLABS_MODEL", _EL_MODEL_DEFAULT).strip() or _EL_MODEL_DEFAULT


# eleven_v3 inline audio-tag mapping (prepended to text before synthesis).
# eleven_v3 supports audio tags like [cheerful], [excited], [hesitant], [sighs],
# [nervous], [frustrated].  neutral gets no tag (let the model breathe naturally).
# Tags are applied whenever eleven_v3 is the active model (default or via env var);
# the fallback eleven_flash_v2_5 uses voice_settings (stability/style/speed) only.
_EL_V3_AUDIO_TAGS: dict[str, str] = {
    "neutral":    "",
    "happy":      "[cheerful]",
    "excited":    "[excited]",
    "hesitant":   "[hesitant]",
    "worried":    "[nervous]",
    "frustrated": "[frustrated]",
}

# Emotion → ElevenLabs voice_settings
# stability:  lower = more expressive/variable; higher = more consistent
# similarity_boost: kept neutral (0.75) across emotions
# style: 0–1 expressive style exaggeration (ElevenLabs v2+ models)
# use_speaker_boost: True for all (better clarity)
# speed: 0.7–1.3 range (maps conceptually to kokoro speed nudges)
_EL_EMOTION_MAP: dict[str, dict] = {
    "neutral":    {"stability": 0.55, "similarity_boost": 0.75, "style": 0.20, "use_speaker_boost": True, "speed": 1.00},
    "happy":      {"stability": 0.45, "similarity_boost": 0.75, "style": 0.40, "use_speaker_boost": True, "speed": 1.05},
    "excited":    {"stability": 0.35, "similarity_boost": 0.75, "style": 0.60, "use_speaker_boost": True, "speed": 1.12},
    "hesitant":   {"stability": 0.70, "similarity_boost": 0.75, "style": 0.10, "use_speaker_boost": True, "speed": 0.88},
    "worried":    {"stability": 0.65, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": True, "speed": 0.94},
    "frustrated": {"stability": 0.40, "similarity_boost": 0.75, "style": 0.50, "use_speaker_boost": True, "speed": 1.06},
}


def _mp3_to_wav(mp3_bytes: bytes) -> bytes:
    """Convert raw MP3 bytes to WAV bytes (via soundfile or ffmpeg fallback)."""
    import io as _io
    import soundfile as _sf

    audio_buf = _io.BytesIO(mp3_bytes)
    try:
        arr, sr = _sf.read(audio_buf, dtype="float32", always_2d=False)
        arr = _resample_if_needed(arr, sr, TARGET_SR)
        return _to_wav_bytes(arr, TARGET_SR)
    except Exception:
        # soundfile can't read mp3 — fall back to ffmpeg subprocess.
        import tempfile, subprocess
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_mp3:
            tmp_mp3.write(mp3_bytes)
            tmp_mp3_path = tmp_mp3.name
        tmp_wav_path = tmp_mp3_path.replace(".mp3", ".wav")
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_mp3_path, "-ar", "22050", "-ac", "1",
                 "-f", "wav", tmp_wav_path],
                check=True, capture_output=True,
            )
            return Path(tmp_wav_path).read_bytes()
        finally:
            import os as _os
            _os.unlink(tmp_mp3_path)
            try:
                _os.unlink(tmp_wav_path)
            except FileNotFoundError:
                pass


def _elevenlabs_tts_with_model(
    text: str,
    emotion: str,
    model_id: str,
    voice_id: str,
    api_key: str,
    add_audio_tag: bool,
) -> bytes:
    """Send a single ElevenLabs TTS request for the given model and return WAV bytes.

    Raises RuntimeError on HTTP error or empty/conversion failure.
    """
    import requests as _requests

    vs = _EL_EMOTION_MAP.get(emotion, _EL_EMOTION_MAP["neutral"])
    speed = vs.get("speed", 1.0)
    voice_settings = {k: v for k, v in vs.items() if k != "speed"}
    if speed != 1.0:
        voice_settings["speed"] = speed

    # eleven_v3: prepend inline audio tag to the text for expressive delivery.
    # Other models (eleven_flash_v2_5, etc.) don't support audio tags — omit them.
    request_text = text
    if add_audio_tag:
        tag = _EL_V3_AUDIO_TAGS.get(emotion, "")
        if tag:
            request_text = f"{tag} {text}"

    payload = {
        "text": request_text,
        "model_id": model_id,
        "voice_settings": voice_settings,
        "output_format": "mp3_22050_32",
    }

    url = f"{_EL_API_BASE}/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    resp = _requests.post(url, json=payload, headers=headers, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"ElevenLabs HTTP {resp.status_code}: {resp.text[:200]}")

    mp3_bytes = resp.content
    if not mp3_bytes:
        raise RuntimeError("ElevenLabs returned empty audio body")

    try:
        return _mp3_to_wav(mp3_bytes)
    except Exception as conv_err:
        raise RuntimeError(f"ElevenLabs mp3->wav conversion failed: {conv_err}") from conv_err


def _elevenlabs_tts(text: str, emotion: str, voice_override: str | None = None) -> bytes:
    """Call ElevenLabs HTTP API and return WAV bytes.

    Uses eleven_v3 by default (expressive, inline audio tags for emotion delivery);
    override via VOICE_ELEVENLABS_MODEL env var to select a different model.
    When eleven_v3 is active and returns a 4xx/5xx, retries once with
    eleven_flash_v2_5 (no audio tags) before raising RuntimeError, so a turn
    never goes silent due to a transient v3 error.
    Logs which model actually served each request.

    Raises RuntimeError on all-engine failure so the caller can fall back.
    """
    api_key, voice_id = capabilities.get_elevenlabs_credentials()
    if not api_key:
        raise RuntimeError("ElevenLabs API key not available")
    if voice_override:
        voice_id = voice_override

    primary_model = _el_model()
    is_v3 = primary_model == "eleven_v3"

    # --- Primary attempt ---
    try:
        wav = _elevenlabs_tts_with_model(
            text, emotion, primary_model, voice_id, api_key,
            add_audio_tag=is_v3,
        )
        log.info("TTS/elevenlabs model=%s emotion=%s", primary_model, emotion)
        return wav
    except RuntimeError as primary_err:
        err_str = str(primary_err)
        # Only retry for HTTP errors (4xx/5xx); propagate immediately for other failures.
        is_http_error = "ElevenLabs HTTP" in err_str
        if not is_v3 or not is_http_error:
            # Non-v3 model or non-HTTP error: don't retry, let caller fall back.
            raise

        log.warning(
            "TTS/elevenlabs v3 request failed (%s) — retrying with %s",
            err_str, _EL_MODEL_FALLBACK,
        )

    # --- v3 retry with fallback model (no audio tags) ---
    try:
        wav = _elevenlabs_tts_with_model(
            text, emotion, _EL_MODEL_FALLBACK, voice_id, api_key,
            add_audio_tag=False,
        )
        log.info(
            "TTS/elevenlabs model=%s (v3 retry fallback) emotion=%s",
            _EL_MODEL_FALLBACK, emotion,
        )
        return wav
    except RuntimeError as fallback_err:
        raise RuntimeError(
            f"ElevenLabs v3 failed and {_EL_MODEL_FALLBACK} retry also failed: {fallback_err}"
        ) from fallback_err

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
    tts_engine = capabilities.get_tts_engine()
    stt_engine = capabilities.get_stt_engine()
    return {
        "ok": True,
        "capabilities": {
            "tts": status["tts"],
            "stt": status["stt"],
            "analyze": status["analyze"],
        },
        "ttsEngine": tts_engine,
        "sttEngine": stt_engine,
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
    voice: str | None = None  # ElevenLabs voice ID override (per-session student voice)


# ---------- Devanagari normalizer (for local kokoro only) ----------

# Lookup table: common Hinglish / Hindi words written in Devanagari → Latin transliteration.
# Kokoro is an English-only model; Devanagari codepoints cause garbled or silent output.
# ElevenLabs handles Hindi natively so this normalizer is NOT applied on that path.
_DEVANAGARI_LOOKUP: dict[str, str] = {
    "हाँ": "haan",
    "हां": "haan",
    "नहीं": "nahin",
    "नही": "nahi",
    "ठीक": "theek",
    "अच्छा": "accha",
    "बहुत": "bahut",
    "क्या": "kya",
    "मैं": "main",
    "मुझे": "mujhe",
    "मुझको": "mujhko",
    "हम": "hum",
    "आप": "aap",
    "तुम": "tum",
    "यह": "yeh",
    "वह": "woh",
    "कैसे": "kaise",
    "कब": "kab",
    "कहाँ": "kahan",
    "क्यों": "kyun",
    "कोर्स": "course",
    "फीस": "fees",
    "पैसे": "paise",
    "लाख": "lakh",
    "हजार": "hazaar",
    "साल": "saal",
    "महीना": "mahina",
    "महीने": "mahine",
    "समझ": "samajh",
    "बात": "baat",
    "काम": "kaam",
    "सोच": "soch",
    "देख": "dekh",
    "सुन": "sun",
    "पढ़": "padh",
    "करना": "karna",
    "करूँगा": "karunga",
    "करूँगी": "karungi",
    "जाना": "jaana",
    "आना": "aana",
    "रहा": "raha",
    "रही": "rahi",
    "था": "tha",
    "थी": "thi",
    "है": "hai",
    "हैं": "hain",
    "था": "tha",
    "होगा": "hoga",
    "होगी": "hogi",
    "लेकिन": "lekin",
    "और": "aur",
    "या": "ya",
    "तो": "to",
    "भी": "bhi",
    "ही": "hi",
    "से": "se",
    "में": "mein",
    "पर": "par",
    "के": "ke",
    "का": "ka",
    "की": "ki",
    "को": "ko",
    "ने": "ne",
    "अगर": "agar",
    "जब": "jab",
    "फिर": "phir",
    "सिर्फ": "sirf",
    "थोड़ा": "thoda",
    "ज्यादा": "zyada",
    "अभी": "abhi",
    "जल्दी": "jaldi",
    "बाद": "baad",
    "पहले": "pehle",
    "साथ": "saath",
    "बिना": "bina",
    "तक": "tak",
    "मतलब": "matlab",
    "सही": "sahi",
    "गलत": "galat",
    "नया": "naya",
    "पुराना": "purana",
    "बड़ा": "bada",
    "छोटा": "chhota",
    "अच्छी": "acchi",
    "बुरा": "bura",
    "खुश": "khush",
    "परेशान": "pareshan",
    "डर": "dar",
    "उम्मीद": "ummeed",
    "सपना": "sapna",
    "नाम": "naam",
    "जगह": "jagah",
    "वक्त": "waqt",
    "जिंदगी": "zindagi",
    "दोस्त": "dost",
    "घर": "ghar",
    "स्कूल": "school",
    "कॉलेज": "college",
    "नौकरी": "naukri",
    "पैसा": "paisa",
    "रुपए": "rupaye",
    "रुपये": "rupaye",
    "हजार": "hazaar",
    "लाखों": "lakhon",
    "पढ़ाई": "padhai",
    "कैरियर": "career",
    "सफलता": "safalta",
    "मेहनत": "mehnat",
    "प्लेसमेंट": "placement",
    "एडमिशन": "admission",
    "आवेदन": "aavedan",
    "परीक्षा": "pariksha",
    "सर्टिफिकेट": "certificate",
}

# Devanagari Unicode block: U+0900–U+097F
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]+")

# Danda (।) and double danda (॥) — Devanagari sentence-ending punctuation
_DANDA_RE = re.compile(r"[।॥]")


def _normalize_devanagari_for_kokoro(text: str) -> str:
    """Transliterate/strip Devanagari from text so local kokoro can speak it.

    Strategy:
      1. Word-boundary lookup: replace known Hindi words with their Latin forms.
      2. Replace dandas (।॥) with periods so sentence structure is preserved.
      3. Strip any remaining Devanagari codepoints (U+0900–U+097F) — unknown
         words become silent gaps, which is better than garbled phonemes.

    This normalizer is ONLY for the local kokoro path.
    ElevenLabs handles Hindi natively and must NOT have its text modified here.
    """
    # Step 1: replace dandas with periods so the sentence splitter still works.
    text = _DANDA_RE.sub(".", text)
    # Step 2: word-boundary lookup (longest word first is already implicit in the dict).
    for hindi, latin in _DEVANAGARI_LOOKUP.items():
        # Use word-boundary-style replacement: match whole token surrounded by
        # non-Devanagari / whitespace / start-of-string / end-of-string.
        text = text.replace(hindi, latin)
    # Step 3: strip any remaining Devanagari codepoints.
    text = _DEVANAGARI_RE.sub("", text)
    # Clean up multiple spaces left after stripping.
    text = re.sub(r"  +", " ", text).strip()
    return text


def _safe_hard_split(text: str, max_chars: int) -> list[str]:
    """Split a long string into chunks ≤ max_chars, avoiding bisecting Devanagari
    combining sequences (Devanagari vowel signs U+093E–U+094F, virama U+094D).

    For purely ASCII/Latin text this is equivalent to the simple slice.
    """
    _DEVANAGARI_COMBINING = re.compile(r"[ा-ॏऀ-ं़्]")
    chunks: list[str] = []
    while len(text) > max_chars:
        cut = max_chars
        # Walk back up to 6 chars to avoid cutting mid combining-sequence.
        for back in range(0, min(6, cut)):
            candidate = cut - back
            # Safe cut: the character at `candidate` must not be a combining mark.
            if candidate > 0 and not _DEVANAGARI_COMBINING.match(text[candidate]):
                cut = candidate
                break
        chunks.append(text[:cut])
        text = text[cut:]
    if text:
        chunks.append(text)
    return chunks


def _sentence_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split text into sentence-level chunks ≤ max_chars.

    Recognises both ASCII sentence-ending punctuation (.!?) and Devanagari
    dandas (। U+0964, ॥ U+0965) as sentence boundaries.
    Hard-split fallback avoids bisecting Devanagari combining sequences.
    """
    # Split on sentence-ending punctuation (ASCII or Devanagari danda).
    # (?<=[.!?]) and (?<=[।॥]) are positive look-behinds so the delimiter
    # stays with the preceding sentence.
    parts = re.split(r"(?<=[.!?।॥])\s+", text.strip())
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
            # If single part exceeds max, use safe hard-split
            if len(part) > max_chars:
                sub_chunks = _safe_hard_split(part, max_chars)
                # All but the last become complete chunks; the last continues accumulation.
                for sc in sub_chunks[:-1]:
                    chunks.append(sc)
                current = sub_chunks[-1]
            else:
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
    # ElevenLabs engine uses model=None (stateless HTTP); only reject None for local engines.
    if status.startswith("error") or (model is None and engine != "elevenlabs"):
        raise HTTPException(503, f"TTS unavailable: {status}")

    emotion = req.emotion if req.emotion in VALID_EMOTIONS else "neutral"
    chunks = _sentence_chunks(req.text)

    t0 = time.perf_counter()
    segments: list[np.ndarray] = []

    if engine == "elevenlabs":
        # ElevenLabs: synthesise the full text in one call (API handles chunking internally).
        # Per-request failure falls through to the next available local engine rather than
        # crashing the request, so a transient API error doesn't take the session down.
        try:
            wav_bytes = _elevenlabs_tts(req.text, emotion, req.voice)
            elapsed = time.perf_counter() - t0
            log.info("TTS/elevenlabs: %.1fs, %d KB", elapsed, len(wav_bytes) // 1024)
            return Response(content=wav_bytes, media_type="audio/wav")
        except Exception as el_err:
            log.warning(
                "TTS/elevenlabs: all-engine failure (%s) — falling back to local engine", el_err
            )
            # Fall through: try to synthesise with the next available local engine.
            # We attempt chatterbox then kokoro on this request without altering the
            # global engine selection (ElevenLabs remains the primary for future requests).
            try:
                import chatterbox.tts as cbtts  # type: ignore
                fallback_model = cbtts.ChatterboxTTS.from_pretrained(device="cpu")
                fallback_engine = "chatterbox"
            except Exception:
                fallback_model = None
                fallback_engine = None

            if fallback_engine is None:
                # Last resort: use the lock-protected singleton from capabilities
                # (avoids reloading Kokoro from disk on every ElevenLabs failure).
                try:
                    fallback_model, fallback_engine_name = capabilities.get_tts()
                    if fallback_model is not None and fallback_engine_name in ("kokoro", "chatterbox"):
                        fallback_engine = fallback_engine_name
                    else:
                        raise RuntimeError("no local model available in singleton")
                except Exception as kokoro_err:
                    raise HTTPException(503, f"TTS all engines failed: {el_err}; kokoro: {kokoro_err}")

            # Synthesise with the fallback engine
            fb_segments: list[np.ndarray] = []
            if fallback_engine == "chatterbox":
                params = EMOTION_MAP[emotion].copy()
                base_exag = params["exaggeration"]
                delta = (req.intensity - 0.5) * 2 * 0.15
                params["exaggeration"] = float(np.clip(base_exag + delta, 0.0, 1.0))
                for chunk in chunks:
                    wav_tensor = fallback_model.generate(chunk, **params)
                    arr = wav_tensor.squeeze().cpu().numpy().astype(np.float32)
                    arr = _resample_if_needed(arr, fallback_model.sr, TARGET_SR)
                    fb_segments.append(arr)
            else:  # kokoro — normalize Devanagari before synthesis (kokoro is English-only)
                speed = KOKORO_SPEED_MAP.get(emotion, 1.0)
                for chunk in chunks:
                    safe_chunk = _normalize_devanagari_for_kokoro(chunk)
                    samples, sr = fallback_model.create(safe_chunk, voice="af_heart", speed=speed, lang="en-us")
                    arr = np.array(samples, dtype=np.float32)
                    arr = _resample_if_needed(arr, sr, TARGET_SR)
                    fb_segments.append(arr)

            combined = np.concatenate(fb_segments) if len(fb_segments) > 1 else fb_segments[0]
            wav_bytes = _to_wav_bytes(combined, TARGET_SR)
            elapsed = time.perf_counter() - t0
            log.info(
                "TTS/elevenlabs-fallback-%s: %d chunks, %.1fs, %d KB",
                fallback_engine, len(chunks), elapsed, len(wav_bytes) // 1024,
            )
            return Response(content=wav_bytes, media_type="audio/wav")

    elif engine == "chatterbox":
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
        # Normalize Devanagari before synthesis — kokoro is English-only and
        # cannot speak Hindi codepoints (ElevenLabs handles Hindi natively).
        speed = KOKORO_SPEED_MAP.get(emotion, 1.0)
        for chunk in chunks:
            safe_chunk = _normalize_devanagari_for_kokoro(chunk)
            samples, sr = model.create(safe_chunk, voice="af_heart", speed=speed, lang="en-us")
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


# ---------- ElevenLabs Scribe STT helper ----------

_EL_SCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text"
_EL_SCRIBE_MODEL = "scribe_v1"


def _scribe_stt(raw_wav: bytes) -> dict:
    """Transcribe WAV bytes via ElevenLabs Scribe.

    Returns the normalised contract dict {text, words:[{word,start,end}], durationSec}.
    language_code is intentionally omitted (auto) so Hinglish transcribes as mixed
    Hindi-English.  Scribe may return Devanagari script for Hindi words — this is
    expected and acceptable.

    Raises RuntimeError on any failure so the caller can fall back to faster-whisper.
    """
    import requests as _req

    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY not available")

    # Compute duration from the WAV before we send it.
    duration_sec: float | None = None
    try:
        _buf = io.BytesIO(raw_wav)
        _arr, _sr = sf.read(_buf, dtype="float32", always_2d=False)
        duration_sec = round(len(_arr) / _sr, 2)
    except Exception:
        pass  # fall through; we will try to get it from the response

    files = {
        "file": ("audio.wav", io.BytesIO(raw_wav), "audio/wav"),
    }
    data = {
        "model_id": _EL_SCRIBE_MODEL,
        "timestamps_granularity": "word",
        # language_code intentionally omitted → Scribe auto-detects; supports Hinglish
    }

    resp = _req.post(
        _EL_SCRIBE_URL,
        headers={"xi-api-key": api_key},
        files=files,
        data=data,
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Scribe HTTP {resp.status_code}: {resp.text[:300]}")

    payload = resp.json()

    # Map Scribe response → contract shape.
    # Scribe response shape:
    #   { text: str, words: [{text, start, end, type, speaker_id}], ... }
    text = (payload.get("text") or "").strip()

    words: list[dict] = []
    for w in payload.get("words") or []:
        # Scribe word tokens have type "word"; spacing/punctuation tokens have other types.
        # We include only tokens with timestamps (word tokens always have them).
        word_text = (w.get("text") or "").strip()
        if not word_text:
            continue
        start_val = w.get("start")
        end_val = w.get("end")
        if start_val is None or end_val is None:
            continue
        words.append({
            "word": word_text,
            "start": round(float(start_val), 3),
            "end": round(float(end_val), 3),
        })

    # Derive durationSec from last word end if we couldn't read the WAV header.
    if duration_sec is None:
        if words:
            duration_sec = round(words[-1]["end"], 2)
        else:
            # Last resort: use Scribe's own duration if provided
            duration_sec = round(float(payload.get("audio_duration") or 0.0), 2)

    return {
        "text": text,
        "words": words,
        "durationSec": duration_sec,
    }


def _whisper_stt(raw_wav: bytes) -> dict:
    """Transcribe WAV bytes via the locally-loaded faster-whisper model.

    Returns the normalised contract dict {text, words:[{word,start,end}], durationSec}.
    Raises RuntimeError on any failure.
    """
    model = capabilities.get_stt()
    if model is None:
        raise RuntimeError("faster-whisper model not available")

    buf = io.BytesIO(raw_wav)
    try:
        y, sr = sf.read(buf, dtype="float32", always_2d=False)
    except Exception as e:
        raise RuntimeError(f"Could not read WAV: {e}") from e

    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr != 16000:
        y = librosa.resample(y, orig_sr=sr, target_sr=16000)
        sr = 16000

    duration_sec = round(len(y) / sr, 2)

    segments, _info = model.transcribe(y, word_timestamps=True, language="en")

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
        "durationSec": duration_sec,
    }


# ---------- /stt ----------

@app.post("/stt")
def stt(audio: UploadFile = File(...)) -> dict:
    _model, engine = capabilities._get_stt_with_engine()
    status = capabilities.get_status()["stt"]

    if status == "off":
        raise HTTPException(503, "STT disabled (VOICE_STT=off)")
    if status == "loading":
        raise HTTPException(503, "STT model loading, retry shortly")
    # For scribe engine, model is None (stateless HTTP) — only reject None for whisper.
    if status.startswith("error") or (_model is None and engine != "scribe"):
        raise HTTPException(503, f"STT unavailable: {status}")

    raw = audio.file.read()
    if len(raw) > 30_000_000:
        raise HTTPException(413, "Audio upload too large (max 30 MB)")

    if engine == "scribe":
        try:
            result = _scribe_stt(raw)
            log.info(
                "STT/scribe: %d words, %.1fs, %r...",
                len(result["words"]),
                result["durationSec"],
                result["text"][:60],
            )
            return result
        except Exception as scribe_err:
            log.warning(
                "STT/scribe: per-request failure (%s) — falling back to faster-whisper", scribe_err
            )
            # Per-request fallback: try faster-whisper without changing the global engine.
            try:
                result = _whisper_stt(raw)
                log.info(
                    "STT/scribe-fallback-whisper: %d words, %.1fs",
                    len(result["words"]),
                    result["durationSec"],
                )
                return result
            except Exception as whisper_err:
                raise HTTPException(503, f"STT all engines failed — scribe: {scribe_err}; whisper: {whisper_err}")

    # engine == "whisper" (or None already handled above)
    try:
        result = _whisper_stt(raw)
        log.info(
            "STT/whisper: %d words, %.1fs, %r...",
            len(result["words"]),
            result["durationSec"],
            result["text"][:60],
        )
        return result
    except Exception as e:
        raise HTTPException(503, f"STT/whisper failed: {e}") from e


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
