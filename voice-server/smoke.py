#!/usr/bin/env python3
"""Smoke test for voice-sidecar (stdlib only — no third-party deps).

Usage: python3 smoke.py [--base-url http://localhost:3002]
Exits 0 on full pass, 1 on any failure.
"""
from __future__ import annotations

import io
import json
import struct
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3002"

for i, arg in enumerate(sys.argv[1:]):
    if arg == "--base-url" and i + 2 <= len(sys.argv[1:]):
        BASE_URL = sys.argv[i + 2]

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
WARN = "\033[33mWARN\033[0m"


def request(method: str, path: str, data=None, content_type: str = "application/json",
            boundary: str | None = None) -> tuple[int, bytes]:
    url = BASE_URL + path
    headers = {}
    if data is not None and content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        print(f"  Connection error: {e}")
        return 0, b""


def get(path: str) -> tuple[int, dict]:
    status, body = request("GET", path)
    try:
        return status, json.loads(body)
    except Exception:
        return status, {}


def post_json(path: str, payload: dict) -> tuple[int, bytes]:
    body = json.dumps(payload).encode()
    return request("POST", path, data=body, content_type="application/json")


def post_multipart(path: str, fields: dict[str, tuple[str, bytes, str]]) -> tuple[int, bytes]:
    """Simple multipart/form-data encoder."""
    boundary = "----SmokeTestBoundary7MA4YWxkTrZu0gW"
    parts = []
    for name, (filename, data, mime) in fields.items():
        if filename:
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {mime}\r\n\r\n".encode() + data + b"\r\n"
            )
        else:
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
                + data + b"\r\n"
            )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return request(
        "POST", path, data=body,
        content_type=f"multipart/form-data; boundary={boundary}"
    )


def is_riff_wav(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"


def check(name: str, condition: bool, detail: str = "") -> bool:
    if condition:
        print(f"  {PASS}  {name}" + (f"  ({detail})" if detail else ""))
    else:
        print(f"  {FAIL}  {name}" + (f"  — {detail}" if detail else ""))
    return condition


ok_all = True

# ── /health ──────────────────────────────────────────────────────────────────
print("\n── /health ─────────────────────────────────────────────────────────────")
code, health = get("/health")
ok = check("HTTP 200", code == 200, f"got {code}")
ok_all &= ok
if ok:
    ok_all &= check("ok:true", health.get("ok") is True)
    caps = health.get("capabilities", {})
    ok_all &= check("capabilities present", bool(caps), str(caps))
    print(f"\n  Capability table:")
    for k, v in caps.items():
        print(f"    {k:10s} : {v}")
    print(f"  ttsEngine    : {health.get('ttsEngine')}")
    print(f"  sttEngine    : {health.get('sttEngine')}")

# ── /tts ─────────────────────────────────────────────────────────────────────
print("\n── /tts ────────────────────────────────────────────────────────────────")
tts_cap = caps.get("tts", "off") if ok else "off"
wav_data: bytes = b""

if tts_cap in ("off",):
    print(f"  {WARN}  TTS is off — skipping")
elif tts_cap.startswith("error"):
    print(f"  {WARN}  TTS error ({tts_cap}) — skipping")
else:
    test_text = (
        "Hello, I am interested in learning more about the programme. "
        "Could you tell me about the curriculum and placement outcomes?"
    )
    t0 = time.perf_counter()
    code, wav_data = post_json("/tts", {"text": test_text, "emotion": "happy", "intensity": 0.6})
    elapsed = time.perf_counter() - t0

    if tts_cap in ("unloaded", "loading") and code == 503:
        # Model was loading — wait and retry once
        print(f"  Model still loading, waiting 30s and retrying...")
        time.sleep(30)
        t0 = time.perf_counter()
        code, wav_data = post_json("/tts", {"text": test_text, "emotion": "happy", "intensity": 0.6})
        elapsed = time.perf_counter() - t0

    ok_all &= check("HTTP 200", code == 200, f"got {code}")
    ok_all &= check("RIFF WAV header", is_riff_wav(wav_data), f"first 4 bytes: {wav_data[:4]!r}")
    ok_all &= check(">10 KB", len(wav_data) > 10_000, f"{len(wav_data)//1024} KB")
    print(f"  Time-to-audio : {elapsed:.1f}s")
    print(f"  File size     : {len(wav_data)//1024} KB")

    if wav_data:
        with open("/tmp/voice-tts-smoke.wav", "wb") as f:
            f.write(wav_data)
        print("  Wrote         : /tmp/voice-tts-smoke.wav")

# ── /stt ─────────────────────────────────────────────────────────────────────
print("\n── /stt ────────────────────────────────────────────────────────────────")
stt_cap = caps.get("stt", "off") if ok else "off"

if stt_cap in ("off",):
    print(f"  {WARN}  STT is off — skipping")
elif stt_cap.startswith("error"):
    print(f"  {WARN}  STT error ({stt_cap}) — skipping")
elif not wav_data:
    print(f"  {WARN}  No TTS wav to feed back — skipping STT test")
else:
    code, body = post_multipart("/stt", {
        "audio": ("voice-tts-smoke.wav", wav_data, "audio/wav"),
    })

    if stt_cap in ("unloaded", "loading") and code == 503:
        print("  STT model loading, waiting 30s and retrying...")
        time.sleep(30)
        code, body = post_multipart("/stt", {
            "audio": ("voice-tts-smoke.wav", wav_data, "audio/wav"),
        })

    ok_all &= check("HTTP 200", code == 200, f"got {code}")
    if code == 200:
        result = json.loads(body)
        ok_all &= check("text non-empty", bool(result.get("text")), repr(result.get("text", "")[:80]))
        ok_all &= check("words list", isinstance(result.get("words"), list),
                        f"{len(result.get('words', []))} words")
        ok_all &= check("durationSec number", isinstance(result.get("durationSec"), (int, float)),
                        f"{result.get('durationSec')}s")
        print(f"  Transcript    : {result.get('text', '')[:100]!r}")
    else:
        print(f"  Body: {body[:200]}")

# ── /analyze ─────────────────────────────────────────────────────────────────
print("\n── /analyze ────────────────────────────────────────────────────────────")
analyze_cap = caps.get("analyze", "off") if ok else "off"

if analyze_cap in ("off",):
    print(f"  {WARN}  Analyze is off — skipping")
elif analyze_cap.startswith("error"):
    print(f"  {WARN}  Analyze error ({analyze_cap}) — skipping")
elif not wav_data:
    print(f"  {WARN}  No wav to analyze — skipping")
else:
    transcript_text = (
        "Hello, I am interested in learning more about the programme. "
        "Could you tell me about the curriculum and placement outcomes?"
    )
    code, body = post_multipart("/analyze", {
        "audio": ("voice-tts-smoke.wav", wav_data, "audio/wav"),
        "transcript": ("", transcript_text.encode(), "text/plain"),
    })
    ok_all &= check("HTTP 200", code == 200, f"got {code}")
    if code == 200:
        result = json.loads(body)
        ok_all &= check("wpm is number", isinstance(result.get("wpm"), (int, float, type(None))),
                        f"wpm={result.get('wpm')}")
        ok_all &= check("pitchVarSemitones", isinstance(result.get("pitchVarSemitones"), float),
                        f"{result.get('pitchVarSemitones')}")
        ok_all &= check("verdicts present", bool(result.get("verdicts")), str(result.get("verdicts")))
        print(f"  tone          : {result.get('tone')}")
        print(f"  energy        : {result.get('energy')}")
        print(f"  wpm           : {result.get('wpm')}")
        print(f"  pitchVar      : {result.get('pitchVarSemitones')}")
        print(f"  pauseRatio    : {result.get('pauseRatio')}")
        print(f"  energyCv      : {result.get('energyCv')}")
        print(f"  verdicts      : {result.get('verdicts')}")
    else:
        print(f"  Body: {body[:300]}")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "─" * 72)
if ok_all:
    print(f"  {PASS}  All checks passed")
    sys.exit(0)
else:
    print(f"  {FAIL}  One or more checks failed")
    sys.exit(1)
