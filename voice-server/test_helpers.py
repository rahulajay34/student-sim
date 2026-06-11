"""Unit tests for pure-function helpers in main.py.

Covers:
  - _normalize_devanagari_for_kokoro: lookup table, danda substitution, residual stripping
  - _sentence_chunks / _safe_hard_split: ASCII splitting, danda splitting, hard-split safety

These tests import the helpers directly from main.py without starting the server
(no model loading, no FastAPI, no external calls).
"""
import unittest
import importlib
import sys
import types
import os

# ---------------------------------------------------------------------------
# Stub heavy dependencies so main.py can be imported without installing them.
# ---------------------------------------------------------------------------

def _stub(name: str) -> types.ModuleType:
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


# numpy — provide just enough for the module to parse
np_stub = _stub("numpy")
np_stub.ndarray = object
np_stub.int16 = "int16"
np_stub.float32 = "float32"
np_stub.abs = lambda x: x
np_stub.clip = lambda x, a, b: x
np_stub.concatenate = lambda segs: segs[0]

# soundfile
_stub("soundfile")

# librosa
_stub("librosa")

# uvicorn
_stub("uvicorn")

# fastapi and sub-modules
_stub("fastapi")
fastapi_stub = sys.modules["fastapi"]


class _FakeApp:
    """Minimal FastAPI stub — accepts add_middleware, get, post decorator calls."""
    def add_middleware(self, *a, **kw): pass
    def get(self, *a, **kw):
        return lambda f: f
    def post(self, *a, **kw):
        return lambda f: f


fastapi_stub.FastAPI = lambda **kw: _FakeApp()  # type: ignore[attr-defined]
fastapi_stub.HTTPException = Exception           # type: ignore[attr-defined]
fastapi_stub.File = lambda *a, **kw: None        # type: ignore[attr-defined]
fastapi_stub.Form = lambda *a, **kw: None        # type: ignore[attr-defined]
fastapi_stub.UploadFile = object                 # type: ignore[attr-defined]
fastapi_stub.Annotated = lambda *a: a[0]         # type: ignore[attr-defined]

_stub("fastapi.middleware")
_stub("fastapi.middleware.cors")
cors_stub = sys.modules["fastapi.middleware.cors"]
cors_stub.CORSMiddleware = object  # type: ignore[attr-defined]

_stub("fastapi.responses")
resp_stub = sys.modules["fastapi.responses"]
resp_stub.Response = object  # type: ignore[attr-defined]

_stub("pydantic")
pydantic_stub = sys.modules["pydantic"]


class _BaseModel:
    def __init_subclass__(cls, **kw): pass
    def __init__(self, **kw): pass


pydantic_stub.BaseModel = _BaseModel          # type: ignore[attr-defined]
pydantic_stub.Field = lambda *a, **kw: None   # type: ignore[attr-defined]

# capabilities (avoid loading the real module with threading / model logic)
cap_stub = _stub("capabilities")
cap_stub.get_tts = lambda: (None, "")  # type: ignore[attr-defined]
cap_stub.get_status = lambda: {"tts": "ready", "stt": "ready", "analyze": "ready"}  # type: ignore[attr-defined]
cap_stub.get_tts_engine = lambda: None  # type: ignore[attr-defined]
cap_stub.get_stt_engine = lambda: None  # type: ignore[attr-defined]
cap_stub.get_elevenlabs_credentials = lambda: (None, "")  # type: ignore[attr-defined]
cap_stub.MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
cap_stub._ensure_kokoro_models = lambda *a: None  # type: ignore[attr-defined]
cap_stub.get_stt = lambda: None   # type: ignore[attr-defined]
cap_stub._get_stt_with_engine = lambda: (None, None)  # type: ignore[attr-defined]
cap_stub.init_analyze = lambda: None  # type: ignore[attr-defined]

# contextlib.asynccontextmanager is in stdlib — no stub needed.

# ---------------------------------------------------------------------------
# Now import the helpers from main.py
# ---------------------------------------------------------------------------

import importlib.util, pathlib

_main_path = pathlib.Path(__file__).parent / "main.py"
_spec = importlib.util.spec_from_file_location("voice_main", str(_main_path))
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

normalize = _mod._normalize_devanagari_for_kokoro
sentence_chunks = _mod._sentence_chunks
safe_hard_split = _mod._safe_hard_split


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestNormalizeDevanagariForKokoro(unittest.TestCase):
    """Tests for _normalize_devanagari_for_kokoro."""

    def test_pure_latin_unchanged(self):
        text = "Hello, how are you?"
        self.assertEqual(normalize(text), text)

    def test_known_word_replaced(self):
        result = normalize("हाँ, that sounds good.")
        self.assertIn("haan", result)
        self.assertNotIn("हाँ", result)

    def test_multiple_known_words(self):
        result = normalize("नहीं, मैं नहीं जाना चाहता।")
        self.assertIn("nahin", result)
        self.assertIn("main", result)

    def test_danda_replaced_with_period(self):
        result = normalize("यह अच्छा है। वह ठीक है।")
        # dandas should become periods, not remain
        self.assertNotIn("।", result)
        self.assertIn(".", result)

    def test_double_danda_replaced(self):
        result = normalize("श्लोक समाप्त॥")
        self.assertNotIn("॥", result)

    def test_unknown_devanagari_stripped(self):
        # "अजीब" is not in the lookup table — should be stripped, not garbled
        result = normalize("That is अजीब behaviour.")
        self.assertNotIn("अजीब", result)
        # Latin words must survive
        self.assertIn("That is", result)
        self.assertIn("behaviour.", result)

    def test_mixed_hinglish(self):
        result = normalize("Okay हाँ, I understand बहुत well.")
        self.assertIn("haan", result)
        self.assertIn("bahut", result)
        self.assertIn("Okay", result)
        self.assertIn("well.", result)

    def test_no_double_spaces(self):
        # After stripping unknown Devanagari a double space might appear
        result = normalize("Hello अजीब world")
        self.assertNotIn("  ", result)

    def test_empty_string(self):
        self.assertEqual(normalize(""), "")

    def test_only_latin_with_danda(self):
        # A danda that somehow appears in otherwise-Latin text
        result = normalize("First sentence। Second sentence।")
        self.assertNotIn("।", result)
        self.assertIn("First sentence", result)
        self.assertIn("Second sentence", result)


class TestSentenceChunks(unittest.TestCase):
    """Tests for _sentence_chunks (danda-aware split + safe hard-split)."""

    def test_short_text_single_chunk(self):
        text = "Hello, how are you?"
        self.assertEqual(sentence_chunks(text), [text])

    def test_ascii_sentence_split(self):
        text = "First sentence. Second sentence. Third sentence."
        chunks = sentence_chunks(text, max_chars=50)
        # All original words must be present across chunks
        combined = " ".join(chunks)
        self.assertIn("First", combined)
        self.assertIn("Second", combined)
        self.assertIn("Third", combined)

    def test_chunks_within_max_chars(self):
        text = "Short. " * 20
        chunks = sentence_chunks(text, max_chars=40)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 40)

    def test_danda_splits_sentences(self):
        # Hindi text with dandas — should split at dandas
        text = "पहला वाक्य। दूसरा वाक्य। तीसरा वाक्य।"
        # With a small max_chars, should produce multiple chunks
        chunks = sentence_chunks(text, max_chars=20)
        self.assertGreater(len(chunks), 1)

    def test_double_danda_splits(self):
        text = "First part॥ Second part॥ Third part."
        chunks = sentence_chunks(text, max_chars=20)
        self.assertGreater(len(chunks), 1)

    def test_no_empty_chunks(self):
        text = "A. B. C. D. E."
        chunks = sentence_chunks(text)
        for chunk in chunks:
            self.assertTrue(chunk.strip())

    def test_very_long_word_hard_split(self):
        # A single word longer than max_chars must be split
        long_word = "a" * 400
        chunks = sentence_chunks(long_word, max_chars=100)
        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 100)
        # All original characters must be present
        self.assertEqual("".join(chunks), long_word)

    def test_empty_text_fallback(self):
        # Empty string should return a single-element list (may be empty str)
        result = sentence_chunks("", max_chars=100)
        self.assertIsInstance(result, list)

    def test_mixed_ascii_and_danda(self):
        text = "Hello world. यह है। More text!"
        chunks = sentence_chunks(text, max_chars=30)
        combined = " ".join(chunks)
        self.assertIn("Hello world", combined)
        self.assertIn("More text", combined)


class TestSafeHardSplit(unittest.TestCase):
    """Tests for _safe_hard_split."""

    def test_short_string_unchanged(self):
        text = "Hello"
        self.assertEqual(safe_hard_split(text, 100), ["Hello"])

    def test_exact_boundary(self):
        text = "a" * 50
        chunks = safe_hard_split(text, 50)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0], text)

    def test_longer_string_split(self):
        text = "b" * 150
        chunks = safe_hard_split(text, 50)
        self.assertEqual(len(chunks), 3)
        for c in chunks:
            self.assertLessEqual(len(c), 50)
        self.assertEqual("".join(chunks), text)

    def test_reconstructs_original(self):
        import random, string
        random.seed(42)
        text = "".join(random.choices(string.ascii_letters + " ", k=500))
        chunks = safe_hard_split(text, 80)
        self.assertEqual("".join(chunks), text)


if __name__ == "__main__":
    unittest.main()
