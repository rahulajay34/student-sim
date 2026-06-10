#!/usr/bin/env python3
"""Download sampled call recordings (HLS) as 16 kHz mono wav via ffmpeg. Idempotent."""
import json, subprocess, sys
from pathlib import Path

WORK = Path(__file__).resolve().parents[1] / "work"
OUT = WORK / "audio"
MIN_VALID_BYTES = 100_000


def ffmpeg_cmd(url, out_path):
    # -f wav: explicit muxer, since the .part temp suffix defeats extension inference
    return ["ffmpeg", "-y", "-loglevel", "error", "-i", url,
            "-f", "wav", "-ac", "1", "-ar", "16000", str(out_path)]


def main(dry=False):
    OUT.mkdir(parents=True, exist_ok=True)
    sample = json.loads((WORK / "audio-sample.json").read_text())
    failures = []
    for s in sample:
        out = OUT / f"{s['id']}.wav"
        if out.exists() and out.stat().st_size > MIN_VALID_BYTES:
            print("skip (exists)", s["id"])
            continue
        if dry:
            print(" ".join(ffmpeg_cmd(s["recordingUrl"], out)))
            continue
        tmp = OUT / f"{s['id']}.wav.part"
        try:
            subprocess.run(ffmpeg_cmd(s["recordingUrl"], tmp), check=True, timeout=1800)
            tmp.rename(out)
            print("ok", s["id"], f"{out.stat().st_size // 1_000_000}MB")
        except Exception as e:  # noqa: BLE001 - log and continue the batch
            tmp.unlink(missing_ok=True)
            failures.append(s["id"])
            print("FAIL", s["id"], e)
    if failures:
        print(f"{len(failures)} failures: {failures}")
        sys.exit(1)


if __name__ == "__main__":
    main(dry="--dry-run" in sys.argv)
