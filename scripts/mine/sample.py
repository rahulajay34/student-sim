#!/usr/bin/env python3
"""Pick a stratified ~20-call sample (10 paid / 10 unpaid, counsellor-diverse) for audio mining."""
import json
from pathlib import Path

WORK = Path(__file__).resolve().parent / "work"
ELIGIBLE_MIN_DURATION = 8.0
ELIGIBLE_MIN_CHARS = 5000
PER_GROUP = 10


def pick_sample(calls, per_group=PER_GROUP):
    def eligible(c):
        return (c["durationMin"] >= ELIGIBLE_MIN_DURATION
                and c["transcriptChars"] >= ELIGIBLE_MIN_CHARS
                and c["recordingUrl"])

    out = []
    for want_paid in (True, False):
        pool = [c for c in calls if c["paid"] == want_paid and eligible(c)]
        by_counselor = {}
        for c in sorted(pool, key=lambda c: -c["durationMin"]):
            by_counselor.setdefault(c["counselor"], []).append(c)
        queues = sorted(by_counselor.values(), key=len, reverse=True)
        picked, i = [], 0
        while len(picked) < per_group and any(queues):
            q = queues[i % len(queues)]
            if q:
                picked.append(q.pop(0))
            i += 1
        out.extend(picked)
    return out


def main():
    calls = json.loads((WORK / "calls.json").read_text())
    sample = pick_sample(calls)
    slim = [{k: c[k] for k in ("id", "counselor", "durationMin", "paid", "recordingUrl")}
            for c in sample]
    (WORK / "audio-sample.json").write_text(json.dumps(slim, indent=2))
    print(f"sampled {len(slim)} calls ({sum(1 for s in slim if s['paid'])} paid)")


if __name__ == "__main__":
    main()
