#!/usr/bin/env bash
# Run the voice sidecar (port 3002).
# Creates/reuses .venv with uv, installs deps, starts FastAPI via uvicorn.
#
# Env flags (set before running):
#   VOICE_TTS=off       disable TTS (saves ~0.4–4 GB RAM)
#   VOICE_STT=off       disable STT
#   VOICE_ANALYZE=off   disable /analyze

set -euo pipefail
cd "$(dirname "$0")"

UV="${UV:-uv}"
if ! command -v "$UV" &>/dev/null; then
    UV="$HOME/.local/bin/uv"
fi

echo "[voice-sidecar] Creating/updating virtualenv with Python 3.11..."
"$UV" venv --python 3.11 --allow-existing

echo "[voice-sidecar] Installing dependencies..."
"$UV" pip install -q -e .

echo "[voice-sidecar] Starting on http://127.0.0.1:3002 ..."
.venv/bin/python main.py
