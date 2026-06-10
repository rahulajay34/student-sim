#!/usr/bin/env python3
"""Normalize the raw counselling CSV into work/calls.json + work/stats.json.

PII: emails are dropped (call id = sha1 hash prefix); transcripts still contain
names, so work/ is git-ignored and nothing here may be copied to server/data/seed/.
"""
import csv, hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "counselling_ba_courses - Sheet1.csv"
WORK = Path(__file__).resolve().parent / "work"


def call_id(row):
    key = f"{row['Email']}|{row['Slot Date']}|{row['Slot Time']}"
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def load_calls(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [{
        "id": call_id(r),
        "counselor": r["Counselor"].strip(),
        "slotDate": r["Slot Date"].strip(),
        "durationMin": float(r["Duration"].strip() or 0),
        "paid": r["paid"].strip().upper() == "PAID",
        "transcript": r["transcript"],
        "transcriptChars": len(r["transcript"]),
        "recordingUrl": r["Recording"].strip(),
    } for r in rows]


def compute_stats(calls):
    durs = sorted(c["durationMin"] for c in calls)
    chars = sorted(c["transcriptChars"] for c in calls)

    # floor-rank quantile: index = int(p * N), clamped (no interpolation)
    def q(xs, p):
        return xs[min(len(xs) - 1, int(p * len(xs)))]

    per_counselor = {}
    for c in calls:
        d = per_counselor.setdefault(c["counselor"], {"calls": 0, "paid": 0})
        d["calls"] += 1
        d["paid"] += 1 if c["paid"] else 0
    paid = sum(1 for c in calls if c["paid"])
    return {
        "totalCalls": len(calls),
        "paidCalls": paid,
        "conversionRate": round(paid / len(calls), 3),
        "durationMin": {"min": durs[0], "p25": q(durs, .25), "median": q(durs, .5),
                        "p75": q(durs, .75), "max": durs[-1]},
        "transcriptChars": {"min": chars[0], "median": q(chars, .5), "max": chars[-1]},
        "perCounselor": per_counselor,
    }


def main():
    WORK.mkdir(exist_ok=True)
    calls = load_calls(CSV_PATH)
    (WORK / "calls.json").write_text(json.dumps(calls, ensure_ascii=False))
    stats = compute_stats(calls)
    (WORK / "stats.json").write_text(json.dumps(stats, indent=2))
    print(f"wrote {len(calls)} calls; paid={stats['paidCalls']}; "
          f"median duration={stats['durationMin']['median']}")


if __name__ == "__main__":
    main()
