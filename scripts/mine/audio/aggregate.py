#!/usr/bin/env python3
"""Aggregate per-call metrics into the prosody block of server/data/seed/benchmarks.json."""
import json, statistics
from pathlib import Path

WORK = Path(__file__).resolve().parents[1] / "work"
AUDIO = WORK / "audio"
SEED = Path(__file__).resolve().parents[3] / "server" / "data" / "seed"


def median_of(rows, speaker, key):
    vals = [r[speaker][key] for r in rows]
    return round(statistics.median(vals), 3) if vals else None


def build_prosody(rows_by_group):
    prosody = {}
    for group, rows in rows_by_group.items():
        if not rows:
            continue
        prosody[group] = {
            "calls": len(rows),
            "counsellorWpm": median_of(rows, "counsellor", "wpm"),
            "counsellorTalkRatio": median_of(rows, "counsellor", "talkRatio"),
            "counsellorPauseRatio": median_of(rows, "counsellor", "pauseRatio"),
            "counsellorPitchVarSemitones": median_of(rows, "counsellor", "pitchVarSemitones"),
            "counsellorEnergyCv": median_of(rows, "counsellor", "energyCv"),
            "studentTalkRatio": median_of(rows, "student", "talkRatio"),
        }
    return prosody


def main():
    sample = {s["id"]: s for s in json.loads((WORK / "audio-sample.json").read_text())}
    groups = {"paid": [], "unpaid": []}
    for mf in sorted(AUDIO.glob("*.metrics.json")):
        m = json.loads(mf.read_text())
        s = sample.get(m["id"])
        if not s:
            continue
        ratios = (m["counsellor"]["talkRatio"], m["student"]["talkRatio"])
        if min(ratios) < 0.05 or not 0.5 <= sum(ratios) <= 1.1:
            print(f"skip {m['id']}: implausible diarization talkRatios {ratios}")
            continue
        groups["paid" if s["paid"] else "unpaid"].append(m)
    bench_path = SEED / "benchmarks.json"
    bench = json.loads(bench_path.read_text())
    bench["prosody"] = build_prosody(groups)
    bench_path.write_text(json.dumps(bench, indent=2))
    print("prosody:", json.dumps(bench["prosody"], indent=2))


if __name__ == "__main__":
    main()
