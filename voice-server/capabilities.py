"""Lazy capability singletons for TTS, STT, and prosody analysis.

Env flags (set to "off" to disable a capability):
  VOICE_TTS=off     disable TTS endpoint
  VOICE_STT=off     disable STT endpoint
  VOICE_ANALYZE=off disable /analyze endpoint

TTS engine selection order:
  1. elevenlabs (HTTP API, ~zero RAM) — active when ELEVENLABS_API_KEY is present in
     repo-root .env or the process environment; any per-request failure falls back
     to the next engine at request time (not permanently disabled).
  2. chatterbox-tts (expressive, ~3-4 GB RAM) — imported and loaded; any load failure falls back
  3. kokoro-onnx (~0.4 GB RAM) — less expressive but reliable
  4. None — capability reports "error"

STT engine selection order:
  1. elevenlabs-scribe (HTTP API, ~zero RAM, supports Hinglish/mixed-script) — active when
     ELEVENLABS_API_KEY is present; any per-request failure falls back to faster-whisper.
     Scribe may return Devanagari for Hindi words in mixed Hindi-English utterances — this
     is expected and acceptable behaviour for the Hinglish counselling context.
  2. faster-whisper (small int8, local, English-forced)
  3. None — capability reports "error"

Status values: "ready" | "loading" | "unloaded" | "off" | "error:<msg>"

Scribe eager reporting:
  /health reports sttEngine:'scribe' based solely on ELEVENLABS_API_KEY presence
  (no model load required — Scribe is a stateless HTTP API).  The client reads
  /health at voice-enable time and routes counsellor STT to the sidecar only when
  sttEngine == 'scribe'; without this eager report Scribe never engages.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger("voice.capabilities")

# Load repo-root .env eagerly at import time so ELEVENLABS_API_KEY is visible
# before the first request arrives (needed for get_stt_engine_eager()).
# This mirrors the lazy load inside get_tts/get_stt but runs unconditionally.
_env_loaded = False


def _load_repo_env_once() -> None:
    """Load repo-root .env into os.environ (idempotent, called at module import)."""
    global _env_loaded
    if _env_loaded:
        return
    _env_loaded = True
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] in ('"', "'") and value[-1] == value[0]:
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as e:
        log.warning(".env eager load failed (non-fatal): %s", e)


_load_repo_env_once()

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# ---------- status tracking ----------

_lock = threading.Lock()

_status: dict[str, str] = {
    "tts": "unloaded",
    "stt": "unloaded",
    "analyze": "unloaded",
}
_tts_engine: str | None = None  # "elevenlabs" | "chatterbox" | "kokoro" | None
_stt_engine: str | None = None  # "scribe" | "whisper" | None

# Singletons
_tts_model: Any = None  # None for elevenlabs (stateless HTTP), model object for others
_stt_model: Any = None  # None for scribe (stateless HTTP), WhisperModel for whisper

# ElevenLabs config (populated during _load_elevenlabs_config, called by get_tts)
_elevenlabs_api_key: str | None = None
_elevenlabs_voice_id: str = "khNT67c7kgWhlbNQynFY"  # Default: Prashant (cloned); sessions normally override per request

# ---------- env kill-switches ----------

def _flag(name: str) -> bool:
    """Return True if capability is enabled (default on)."""
    return os.environ.get(f"VOICE_{name}", "on").strip().lower() != "off"


def tts_enabled() -> bool:
    return _flag("TTS")


def stt_enabled() -> bool:
    return _flag("STT")


def analyze_enabled() -> bool:
    return _flag("ANALYZE")


# ---------- .env loader (mirrors Node server's dotenv pattern) ----------

def _load_repo_env() -> None:
    """Load repo-root .env (../. env relative to this file) into os.environ if not set.

    Follows the same path as Node's dotenv.config({ path: join(__dirname, '../.env') }).
    Keys already in the environment take precedence (standard dotenv behaviour).
    """
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # Strip surrounding quotes if present
            if len(value) >= 2 and value[0] in ('"', "'") and value[-1] == value[0]:
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as e:
        log.warning(".env load failed (non-fatal): %s", e)


# ---------- ElevenLabs config ----------

def _load_elevenlabs_config() -> bool:
    """Read ELEVENLABS_API_KEY (and optional VOICE_ELEVENLABS_VOICE_ID) from env.

    Must be called after _load_repo_env().
    Returns True if ElevenLabs should be used, False if key is absent.
    """
    global _elevenlabs_api_key, _elevenlabs_voice_id

    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        log.info("TTS: ELEVENLABS_API_KEY not set — ElevenLabs engine skipped")
        return False

    _elevenlabs_api_key = key
    voice_id = os.environ.get("VOICE_ELEVENLABS_VOICE_ID", "").strip()
    if voice_id:
        _elevenlabs_voice_id = voice_id
    log.info("TTS: ElevenLabs key found (voice_id=%s)", _elevenlabs_voice_id)
    return True


# ---------- TTS loading ----------

def get_tts() -> tuple[Any, str]:
    """Return (model, engine_name). Lazy-loads on first call. Thread-safe.

    For elevenlabs the returned model is None (all state is in module globals).
    First caller loads; concurrent callers block on the lock and return the
    already-loaded singleton (unloaded→loading→ready|error inside the lock).
    """
    global _tts_model, _tts_engine

    import time

    with _lock:
        # Already settled — return immediately.
        if _status["tts"] in ("ready", "off") or _status["tts"].startswith("error"):
            return _tts_model, _tts_engine or ""

        if not tts_enabled():
            _status["tts"] = "off"
            return None, ""

        if _status["tts"] == "loading":
            # Another thread is already loading — fall through to wait loop below.
            first_caller = False
        else:
            # First caller: claim the loading slot.
            _status["tts"] = "loading"
            first_caller = True

    if not first_caller:
        # Concurrent caller: wait for the loading thread to settle.
        while True:
            with _lock:
                if _status["tts"] in ("ready", "off") or _status["tts"].startswith("error"):
                    return _tts_model, _tts_engine or ""
            time.sleep(0.05)

    # We are the first loader — proceed to load (lock not held).

    # Step 0: load repo-root .env so API keys are available.
    _load_repo_env()

    # Step 1: Try ElevenLabs first (HTTP API, no model download needed).
    if _load_elevenlabs_config():
        # Validate the key with a lightweight /user endpoint call.
        try:
            import requests as _requests
            resp = _requests.get(
                "https://api.elevenlabs.io/v1/user",
                headers={"xi-api-key": _elevenlabs_api_key},
                timeout=10,
            )
            if resp.status_code == 200:
                with _lock:
                    _tts_model = None  # stateless HTTP engine
                    _tts_engine = "elevenlabs"
                    _status["tts"] = "ready"
                log.info("TTS: ElevenLabs validated and ready (voice_id=%s)", _elevenlabs_voice_id)
                return None, "elevenlabs"
            else:
                log.warning(
                    "TTS: ElevenLabs key validation failed (HTTP %d) — falling back to chatterbox",
                    resp.status_code,
                )
        except Exception as e:
            log.warning("TTS: ElevenLabs validation error (%s) — falling back to chatterbox", e)

    # Step 2: Try chatterbox.
    try:
        log.info("TTS: attempting chatterbox-tts import...")
        import chatterbox.tts as cbtts  # type: ignore
        model = cbtts.ChatterboxTTS.from_pretrained(device="cpu")
        with _lock:
            _tts_model = model
            _tts_engine = "chatterbox"
            _status["tts"] = "ready"
        log.info("TTS: chatterbox loaded successfully")
        return model, "chatterbox"
    except Exception as e:
        log.warning("TTS: chatterbox failed (%s) — falling back to kokoro-onnx", e)

    # Step 3: Fall back to kokoro-onnx.
    try:
        log.info("TTS: loading kokoro-onnx...")
        from kokoro_onnx import Kokoro  # type: ignore

        # Model files: downloaded to models/ on first use
        onnx_path = MODELS_DIR / "kokoro-v1.0.onnx"
        voices_path = MODELS_DIR / "voices-v1.0.bin"

        _ensure_kokoro_models(onnx_path, voices_path)

        model = Kokoro(str(onnx_path), str(voices_path))
        with _lock:
            _tts_model = model
            _tts_engine = "kokoro"
            _status["tts"] = "ready"
        log.info("TTS: kokoro-onnx loaded successfully")
        return model, "kokoro"
    except Exception as e2:
        err_msg = f"error:{e2}"
        with _lock:
            _status["tts"] = err_msg[:120]
        log.error("TTS: kokoro also failed: %s", e2)
        return None, ""


def get_elevenlabs_credentials() -> tuple[str | None, str]:
    """Return (api_key, voice_id) for use by the TTS handler in main.py."""
    return _elevenlabs_api_key, _elevenlabs_voice_id


def _ensure_kokoro_models(onnx_path: Path, voices_path: Path) -> None:
    """Download kokoro model files if not present."""
    import urllib.request

    BASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
    files = {
        onnx_path: f"{BASE_URL}/kokoro-v1.0.onnx",
        voices_path: f"{BASE_URL}/voices-v1.0.bin",
    }
    for dest, url in files.items():
        if not dest.exists():
            log.info("Downloading %s ...", dest.name)
            try:
                urllib.request.urlretrieve(url, str(dest))
                log.info("Downloaded %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
            except Exception as e:
                raise RuntimeError(f"Failed to download {dest.name} from {url}: {e}") from e


# ---------- STT loading ----------

def get_stt():
    """Return (model, engine_name) for STT. Lazy-loads on first call. Thread-safe.

    Engine selection:
      1. ElevenLabs Scribe (HTTP API, no local model) — when ELEVENLABS_API_KEY present.
         Returns (None, "scribe"); per-request failures fall back to faster-whisper in main.py.
      2. faster-whisper small int8 — local fallback.

    For compatibility with callers that only unpack the model (not the engine), this function
    returns just the model object when called as get_stt(). Use get_stt_engine() for the engine
    name, or call _get_stt_with_engine() to get both.

    First caller loads; concurrent callers block on the lock and return the
    already-loaded singleton (unloaded→loading→ready|error inside the lock).
    """
    model, _engine = _get_stt_with_engine()
    return model


def _get_stt_with_engine() -> tuple[Any, str | None]:
    """Internal: return (model, engine_name). Called by get_stt() and the /stt handler."""
    global _stt_model, _stt_engine

    import time

    with _lock:
        if _status["stt"] in ("ready", "off") or _status["stt"].startswith("error"):
            return _stt_model, _stt_engine

        if not stt_enabled():
            _status["stt"] = "off"
            return None, None

        if _status["stt"] == "loading":
            # Another thread is already loading — fall through to wait loop.
            first_caller = False
        else:
            # First caller: claim the loading slot.
            _status["stt"] = "loading"
            first_caller = True

    if not first_caller:
        # Concurrent caller: wait for the loading thread to settle.
        while True:
            with _lock:
                if _status["stt"] in ("ready", "off") or _status["stt"].startswith("error"):
                    return _stt_model, _stt_engine
            time.sleep(0.05)

    # We are the first loader — proceed (lock not held).

    # Step 0: ensure .env is loaded so ELEVENLABS_API_KEY is available.
    _load_repo_env()

    # Step 1: Try ElevenLabs Scribe (HTTP API, no model download).
    el_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if el_key:
        log.info("STT: ELEVENLABS_API_KEY present — using ElevenLabs Scribe (no local model load)")
        with _lock:
            _stt_model = None  # stateless HTTP engine
            _stt_engine = "scribe"
            _status["stt"] = "ready"
        return None, "scribe"

    # Step 2: Fall back to faster-whisper.
    try:
        log.info("STT: loading faster-whisper small int8...")
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel("small", device="cpu", compute_type="int8")
        with _lock:
            _stt_model = model
            _stt_engine = "whisper"
            _status["stt"] = "ready"
        log.info("STT: faster-whisper loaded")
        return model, "whisper"
    except Exception as e:
        err_msg = f"error:{e}"
        with _lock:
            _status["stt"] = err_msg[:120]
            _stt_engine = None
        log.error("STT: failed: %s", e)
        return None, None


# ---------- STT engine accessor ----------

def get_stt_engine() -> str | None:
    """Return the loaded STT engine name, or the prospective engine if not yet loaded.

    - If STT is off: returns None.
    - If already loaded: returns the settled engine name ('scribe' or 'whisper').
    - If not yet loaded: returns get_stt_engine_eager() so /health reports the
      prospective engine before the first /stt call (critical for scribe routing).
    """
    with _lock:
        settled = _status["stt"] in ("ready", "off") or _status["stt"].startswith("error")
        if settled:
            return _stt_engine
    # Not yet loaded — return what we expect based on key presence.
    return get_stt_engine_eager()


def get_stt_engine_eager() -> str | None:
    """Return the prospective STT engine name without loading any model.

    Scribe is a stateless HTTP API — ELEVENLABS_API_KEY presence is sufficient.
    If STT is disabled via VOICE_STT=off, returns None.
    If key is present: returns 'scribe'.
    If key is absent and faster-whisper is already loaded: returns 'whisper'.
    If key is absent and faster-whisper is not yet loaded: returns 'whisper'
    (the prospective engine — it will load on first /stt call).
    """
    if not stt_enabled():
        return None
    el_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if el_key:
        return "scribe"
    # No ElevenLabs key — whisper is the fallback (loaded or prospective).
    with _lock:
        if _stt_engine is not None:
            return _stt_engine
    return "whisper"


# ---------- Analyze (no model needed) ----------

def init_analyze() -> None:
    """Mark analyze as ready (pure librosa, no model singleton needed)."""
    with _lock:
        if _status["analyze"] == "unloaded":
            if analyze_enabled():
                _status["analyze"] = "ready"
            else:
                _status["analyze"] = "off"


# ---------- Status accessors ----------

def get_status() -> dict[str, str]:
    with _lock:
        return dict(_status)


def get_tts_engine() -> str | None:
    with _lock:
        return _tts_engine
