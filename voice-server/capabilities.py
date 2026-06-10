"""Lazy capability singletons for TTS, STT, and prosody analysis.

Env flags (set to "off" to disable a capability):
  VOICE_TTS=off     disable TTS endpoint
  VOICE_STT=off     disable STT endpoint
  VOICE_ANALYZE=off disable /analyze endpoint

TTS engine selection order:
  1. chatterbox-tts (expressive, ~3-4 GB RAM) — imported and loaded; any failure falls back
  2. kokoro-onnx (~0.4 GB RAM) — less expressive but reliable
  3. None — capability reports "error"

Status values: "ready" | "loading" | "unloaded" | "off" | "error:<msg>"
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Literal

log = logging.getLogger("voice.capabilities")

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# ---------- status tracking ----------

_lock = threading.Lock()

_status: dict[str, str] = {
    "tts": "unloaded",
    "stt": "unloaded",
    "analyze": "unloaded",
}
_tts_engine: str | None = None  # "chatterbox" | "kokoro" | None

# Singletons
_tts_model: Any = None
_stt_model: Any = None

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


# ---------- TTS loading ----------

def get_tts() -> tuple[Any, str]:
    """Return (model, engine_name). Lazy-loads on first call. Thread-safe.

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
    # Try chatterbox first.
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

    # Fall back to kokoro-onnx
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
    """Return faster-whisper WhisperModel(small, int8). Lazy, thread-safe.

    First caller loads; concurrent callers block on the lock and return the
    already-loaded singleton (unloaded→loading→ready|error inside the lock).
    """
    global _stt_model

    import time

    with _lock:
        if _status["stt"] in ("ready", "off") or _status["stt"].startswith("error"):
            return _stt_model

        if not stt_enabled():
            _status["stt"] = "off"
            return None

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
                    return _stt_model
            time.sleep(0.05)

    # We are the first loader.
    try:
        log.info("STT: loading faster-whisper small int8...")
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel("small", device="cpu", compute_type="int8")
        with _lock:
            _stt_model = model
            _status["stt"] = "ready"
        log.info("STT: faster-whisper loaded")
        return model
    except Exception as e:
        err_msg = f"error:{e}"
        with _lock:
            _status["stt"] = err_msg[:120]
        log.error("STT: failed: %s", e)
        return None


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
