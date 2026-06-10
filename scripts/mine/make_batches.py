#!/usr/bin/env python3
"""Split work/calls.json into work/batches/batch-NN.json for LLM extraction agents."""
import json, shutil
from pathlib import Path

WORK = Path(__file__).resolve().parent / "work"
BATCH_SIZE = 8


def make_batches(calls, size=BATCH_SIZE):
    batches = []
    for i in range(0, len(calls), size):
        chunk = calls[i:i + size]
        batches.append({
            "batchId": f"batch-{i // size + 1:02d}",
            "calls": [{k: c[k] for k in ("id", "counselor", "durationMin", "paid", "transcript")}
                      for c in chunk],
        })
    return batches


def main():
    calls = json.loads((WORK / "calls.json").read_text())
    bdir = WORK / "batches"
    if bdir.exists():
        shutil.rmtree(bdir)  # drop stale batches from any previous, larger run
    bdir.mkdir()
    batches = make_batches(calls)
    for b in batches:
        (bdir / f"{b['batchId']}.json").write_text(json.dumps(b, ensure_ascii=False))
    print(f"wrote {len(batches)} batches to {bdir}")


if __name__ == "__main__":
    main()
