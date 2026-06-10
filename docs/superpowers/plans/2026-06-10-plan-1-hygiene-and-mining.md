# Plan 1: Hygiene + Real-Data Mining Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrub repo hygiene issues, then mine the 216 real counselling calls (all transcripts + a stratified 20-call audio sample) into five validated, PII-free seed artifacts under `server/data/seed/`.

**Architecture:** Deterministic Python scripts (stdlib-only) normalize the CSV and prepare batches under git-ignored `scripts/mine/work/`; a Claude multi-agent workflow performs LLM extraction/synthesis; Node (`node:test`, no deps) merges and validates artifacts; a separate uv-managed Python 3.11 env handles audio (faster-whisper + librosa + speaker clustering). Raw PII never leaves `scripts/mine/work/`.

**Tech Stack:** Python 3 stdlib · Node ≥20 (`node --test`) · Claude Workflow subagents (sonnet for extraction, default model for synthesis) · uv + Python 3.11 (faster-whisper, librosa, soundfile, scikit-learn, resemblyzer) · ffmpeg (installed).

**NO-GIT RULE (user instruction, overrides skill defaults):** Do not run any `git` commands. Tasks end with a **Verify** step instead of a commit. `.gitignore` edits are still made (cheap insurance).

**Spec:** `docs/superpowers/specs/2026-06-10-data-driven-platform-revamp-design.md` §4 (mining), §3 gap 8 (hygiene), Phase 0–1 rows of §10.

---

## File structure

```
scripts/mine/
  prepare.py              # CSV -> work/calls.json + work/stats.json (PII: email dropped, id = hash)
  sample.py               # work/calls.json -> work/audio-sample.json (10 paid + 10 unpaid, counsellor-diverse)
  make_batches.py         # work/calls.json -> work/batches/batch-NN.json (8 calls each, 27 batches)
  merge-extractions.mjs   # work/extractions.json -> work/merged.json (deterministic aggregation)
  validate-artifacts.mjs  # asserts shapes + PII-scan of server/data/seed/*.json; exit 1 on failure
  schemas/extraction.schema.json   # JSON schema for per-call extraction (source of truth for agent output)
  workflow-mine.js        # Workflow-tool script (extraction fan-out) — run by Claude, not node
  tests/fixture.csv
  tests/test_prepare.py  tests/test_sample.py  tests/test_batches.py    # python3 -m unittest
  tests/merge.test.mjs   tests/validate.test.mjs                        # node --test
  work/                   # GIT-IGNORED; all PII-bearing intermediates live here
  audio/
    fetch.py              # HLS -> work/audio/{id}.wav via ffmpeg (idempotent, --dry-run)
    analyze.py            # wav -> work/audio/{id}.metrics.json (diarized prosody)
    aggregate.py          # metrics -> prosody block merged into server/data/seed/benchmarks.json
    tests/test_metrics.py # pure-math helpers only (no model downloads in tests)
server/data/seed/         # OUTPUT: archetypes.json, objections.json, conversation-structure.json,
                          #         rubric-anchors.json, benchmarks.json  (PII-free, kept in repo)
```

Conventions: Python files are stdlib-only and runnable as `python3 scripts/mine/<file>.py`; audio scripts run inside the uv env. All paths below are relative to repo root `/Users/rahul/Downloads/student-sim`. The CSV filename contains a space — always quote `"counselling_ba_courses - Sheet1.csv"`.

---

### Task 1: Hygiene sweep

**Files:**
- Modify: `client/.claude/settings.local.json` (replace entirely — every PowerShell entry is stale Windows-era cruft; one embeds the live OLLAMA_API_KEY)
- Modify: `.gitignore`
- Delete: `client-err.log`, `client-out.log`, `server-err.log`, `server-out.log`, `.DS_Store`, `server/.DS_Store`

- [ ] **Step 1: Replace `client/.claude/settings.local.json`** with (amended: the original plan kept a `Bash(curl *)` wildcard, but writing wildcard Bash allow-rules is a security anti-pattern — and it was legacy cruft anyway):

```json
{
  "permissions": {
    "allow": [
      "Skill(run)"
    ]
  }
}
```

- [ ] **Step 2: Append to `.gitignore`** (after the existing `voice-smoke.wav` line):

```
.DS_Store
scripts/mine/work/
counselling_ba_courses - Sheet1.csv
```

- [ ] **Step 3: Delete stale artifacts**

Run: `rm -f client-err.log client-out.log server-err.log server-out.log .DS_Store server/.DS_Store`

- [ ] **Step 4: Verify**

Run: `grep -r "WozEV0ySR1" client/.claude/ ; ls *.log 2>/dev/null`
Expected: no output from either command (grep finds nothing, no logs remain).

---

### Task 2: `prepare.py` — normalize the CSV

**Files:**
- Create: `scripts/mine/prepare.py`, `scripts/mine/tests/fixture.csv`, `scripts/mine/tests/test_prepare.py`

- [ ] **Step 1: Write the failing test.** Create `scripts/mine/tests/fixture.csv` (exact bytes — note the quoted multiline transcript with commas):

```csv
Email,Slot Date,Slot Time,Duration,slot_over,paid,Counselor,Amount,transcript,Recording
a@x.com,01/05/2026,10:00:00,12.5,1,PAID,alpha,,"Hello, am I audible? Yes sir.
Line two, with comma.",https://example.com/a.m3u8
b@x.com,02/05/2026,11:00:00,7.07,1,,beta,,"Short call.",https://example.com/b.m3u8
c@x.com,03/05/2026,12:00:00,30,1,,alpha,,"Another call transcript.",https://example.com/c.m3u8
```

Create `scripts/mine/tests/test_prepare.py`:

```python
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare import load_calls, compute_stats

FIXTURE = Path(__file__).parent / "fixture.csv"

class TestPrepare(unittest.TestCase):
    def setUp(self):
        self.calls = load_calls(FIXTURE)

    def test_loads_all_rows(self):
        self.assertEqual(len(self.calls), 3)

    def test_paid_flag(self):
        self.assertEqual([c["paid"] for c in self.calls], [True, False, False])

    def test_multiline_transcript_preserved(self):
        self.assertIn("Line two, with comma.", self.calls[0]["transcript"])

    def test_ids_stable_unique_no_email(self):
        ids = [c["id"] for c in self.calls]
        self.assertEqual(len(set(ids)), 3)
        for c in self.calls:
            self.assertRegex(c["id"], r"^[0-9a-f]{10}$")
            self.assertNotIn("Email", c)
            self.assertNotIn("@", str(c.get("id")) + c["counselor"])
        self.assertEqual(load_calls(FIXTURE)[0]["id"], ids[0])  # stable across runs

    def test_stats(self):
        s = compute_stats(self.calls)
        self.assertEqual(s["totalCalls"], 3)
        self.assertEqual(s["paidCalls"], 1)
        self.assertEqual(s["perCounselor"]["alpha"]["calls"], 2)
        self.assertAlmostEqual(s["durationMin"]["max"], 30.0)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s scripts/mine/tests -p "test_prepare.py" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'prepare'`

- [ ] **Step 3: Implement `scripts/mine/prepare.py`:**

```python
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
        "durationMin": float(r["Duration"] or 0),
        "paid": r["paid"].strip().upper() == "PAID",
        "transcript": r["transcript"],
        "transcriptChars": len(r["transcript"]),
        "recordingUrl": r["Recording"].strip(),
    } for r in rows]


def compute_stats(calls):
    durs = sorted(c["durationMin"] for c in calls)
    chars = sorted(c["transcriptChars"] for c in calls)

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s scripts/mine/tests -p "test_prepare.py" -v`
Expected: `OK` (5 tests).

- [ ] **Step 5: Run on the real corpus and verify**

Run: `python3 scripts/mine/prepare.py && python3 -c "import json; s=json.load(open('scripts/mine/work/stats.json')); print(s['totalCalls'], s['paidCalls'], s['conversionRate'])"`
Expected: `wrote 216 calls; paid=39; median duration=17.…` then `216 39 0.181`.

---

### Task 3: `sample.py` — stratified audio sample

**Files:**
- Create: `scripts/mine/sample.py`, `scripts/mine/tests/test_sample.py`

- [ ] **Step 1: Write the failing test** (`scripts/mine/tests/test_sample.py`):

```python
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sample import pick_sample


def mk(i, counselor, paid, dur=15.0, chars=8000, url="https://x/y.m3u8"):
    return {"id": f"id{i:03d}", "counselor": counselor, "paid": paid,
            "durationMin": dur, "transcriptChars": chars, "recordingUrl": url}


class TestSample(unittest.TestCase):
    def test_strata_and_diversity(self):
        calls = ([mk(i, f"c{i % 3}", True) for i in range(15)] +
                 [mk(100 + i, f"c{i % 3}", False) for i in range(40)])
        s = pick_sample(calls)
        self.assertEqual(len(s), 20)
        self.assertEqual(sum(1 for c in s if c["paid"]), 10)
        self.assertGreaterEqual(len({c["counselor"] for c in s if c["paid"]}), 3)

    def test_eligibility_filters(self):
        calls = [mk(1, "a", True, dur=3.0),            # too short
                 mk(2, "a", True, chars=100),           # transcript too thin
                 mk(3, "a", True, url=""),              # no recording
                 mk(4, "a", True)]                      # eligible
        s = pick_sample(calls)
        self.assertEqual([c["id"] for c in s if c["paid"]], ["id004"])

    def test_small_pool_doesnt_loop_forever(self):
        s = pick_sample([mk(1, "a", True), mk(2, "b", False)])
        self.assertEqual(len(s), 2)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s scripts/mine/tests -p "test_sample.py" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sample'`

- [ ] **Step 3: Implement `scripts/mine/sample.py`:**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s scripts/mine/tests -p "test_sample.py" -v`
Expected: `OK` (3 tests).

- [ ] **Step 5: Run on real data and verify**

Run: `python3 scripts/mine/sample.py && python3 -c "import json; s=json.load(open('scripts/mine/work/audio-sample.json')); print(len(s), sum(1 for x in s if x['paid']), len({x['counselor'] for x in s}))"`
Expected: `sampled 20 calls (10 paid)` then `20 10 <≥5>` (counsellor diversity ≥5).

---

### Task 4: `make_batches.py` — extraction batches

**Files:**
- Create: `scripts/mine/make_batches.py`, `scripts/mine/tests/test_batches.py`

- [ ] **Step 1: Write the failing test** (`scripts/mine/tests/test_batches.py`):

```python
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_batches import make_batches


class TestBatches(unittest.TestCase):
    def test_chunking(self):
        calls = [{"id": f"i{n}", "counselor": "a", "durationMin": 10.0,
                  "paid": False, "transcript": "t", "transcriptChars": 1,
                  "slotDate": "x", "recordingUrl": "u"} for n in range(17)]
        batches = make_batches(calls, size=8)
        self.assertEqual([len(b["calls"]) for b in batches], [8, 8, 1])
        self.assertEqual(batches[0]["batchId"], "batch-01")
        self.assertEqual(batches[2]["batchId"], "batch-03")
        ids = [c["id"] for b in batches for c in b["calls"]]
        self.assertEqual(ids, [f"i{n}" for n in range(17)])
        self.assertNotIn("recordingUrl", batches[0]["calls"][0])  # slim payload

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s scripts/mine/tests -p "test_batches.py" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'make_batches'`

- [ ] **Step 3: Implement `scripts/mine/make_batches.py`:**

```python
#!/usr/bin/env python3
"""Split work/calls.json into work/batches/batch-NN.json for LLM extraction agents."""
import json
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
    bdir.mkdir(exist_ok=True)
    batches = make_batches(calls)
    for b in batches:
        (bdir / f"{b['batchId']}.json").write_text(json.dumps(b, ensure_ascii=False))
    print(f"wrote {len(batches)} batches to {bdir}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s scripts/mine/tests -p "test_batches.py" -v`
Expected: `OK` (1 test).

- [ ] **Step 5: Run on real data and verify**

Run: `python3 scripts/mine/make_batches.py && ls scripts/mine/work/batches/ | wc -l`
Expected: `wrote 27 batches …` then `27`.

---

### Task 5: Extraction schema, merge script, artifact validator

**Files:**
- Create: `scripts/mine/schemas/extraction.schema.json`, `scripts/mine/merge-extractions.mjs`, `scripts/mine/validate-artifacts.mjs`, `scripts/mine/tests/merge.test.mjs`, `scripts/mine/tests/validate.test.mjs`

- [ ] **Step 1: Create `scripts/mine/schemas/extraction.schema.json`** (source of truth for what extraction agents must emit per batch):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "BatchExtraction",
  "type": "object",
  "required": ["extractions"],
  "properties": {
    "extractions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["callId", "paid", "archetypeHint", "objections", "structure", "bestMoves", "worstMoves", "notableQuotes"],
        "properties": {
          "callId": {"type": "string"},
          "paid": {"type": "boolean"},
          "archetypeHint": {
            "type": "object",
            "required": ["background", "goal", "anxiety", "decisionDynamics", "languageTexture"],
            "properties": {
              "background": {"type": "string"},
              "goal": {"type": "string"},
              "anxiety": {"type": "string"},
              "decisionDynamics": {"type": "string"},
              "languageTexture": {"type": "string"}
            }
          },
          "objections": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["category", "phrasing", "counsellorMove", "moveOutcome"],
              "properties": {
                "category": {"enum": ["fee", "emi_affordability", "parents_family", "time_commitment", "competing_priorities", "trust_legitimacy", "job_guarantee_placement", "course_fit_relevance", "language_english", "tech_access", "other"]},
                "phrasing": {"type": "string"},
                "counsellorMove": {"type": "string"},
                "moveOutcome": {"enum": ["defused", "escalated", "unresolved"]}
              }
            }
          },
          "structure": {
            "type": "object",
            "required": ["opening", "presentationStartsAtPct", "paymentAskAtPct", "closeType"],
            "properties": {
              "opening": {"type": "string"},
              "presentationStartsAtPct": {"type": ["number", "null"]},
              "paymentAskAtPct": {"type": ["number", "null"]},
              "closeType": {"type": "string"}
            }
          },
          "bestMoves": {"type": "array", "items": {"type": "string"}},
          "worstMoves": {"type": "array", "items": {"type": "string"}},
          "notableQuotes": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["speaker", "quote", "why"],
              "properties": {
                "speaker": {"enum": ["student", "counsellor"]},
                "quote": {"type": "string"},
                "why": {"type": "string"}
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing merge test** (`scripts/mine/tests/merge.test.mjs`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeExtractions, OBJECTION_CATEGORIES } from '../merge-extractions.mjs';

const ex = (callId, paid, objections = [], extra = {}) => ({
  callId, paid,
  archetypeHint: { background: 'b', goal: 'g', anxiety: 'a', decisionDynamics: 'd', languageTexture: 'l' },
  objections,
  structure: { opening: 'o', presentationStartsAtPct: 30, paymentAskAtPct: 80, closeType: 'soft' },
  bestMoves: ['empathised'], worstMoves: ['rushed'],
  notableQuotes: [{ speaker: 'student', quote: 'q', why: 'w' }],
  ...extra,
});

test('aggregates objections by category with paid split', () => {
  const merged = mergeExtractions([
    ex('c1', true, [{ category: 'fee', phrasing: 'p1', counsellorMove: 'm1', moveOutcome: 'defused' }]),
    ex('c2', false, [{ category: 'fee', phrasing: 'p2', counsellorMove: 'm2', moveOutcome: 'escalated' },
                     { category: 'bogus', phrasing: 'p3', counsellorMove: 'm3', moveOutcome: 'unresolved' }]),
  ]);
  assert.equal(merged.totalCalls, 2);
  assert.equal(merged.paidCalls, 1);
  assert.equal(merged.objections.fee.count, 2);
  assert.equal(merged.objections.fee.paidCount, 1);
  assert.equal(merged.objections.other.count, 1);          // unknown category folded into 'other'
  assert.equal(merged.objections.fee.phrasings.length, 2);
  assert.equal(merged.objections.fee.moves[1].outcome, 'escalated');
});

test('pools archetype hints, structures, moves, quotes', () => {
  const merged = mergeExtractions([ex('c1', true), ex('c2', false)]);
  assert.equal(merged.archetypeHints.length, 2);
  assert.equal(merged.structures.length, 2);
  assert.equal(merged.bestMoves.length, 2);
  assert.equal(merged.worstMoves.length, 2);
  assert.equal(merged.quotes.length, 2);
  assert.ok(OBJECTION_CATEGORIES.includes('parents_family'));
});
```

- [ ] **Step 3: Run merge test to verify it fails**

Run: `node --test scripts/mine/tests/merge.test.mjs`
Expected: FAIL — cannot find module `merge-extractions.mjs`.

- [ ] **Step 4: Implement `scripts/mine/merge-extractions.mjs`:**

```js
#!/usr/bin/env node
// Deterministic aggregation of per-call LLM extractions -> work/merged.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const OBJECTION_CATEGORIES = [
  'fee', 'emi_affordability', 'parents_family', 'time_commitment',
  'competing_priorities', 'trust_legitimacy', 'job_guarantee_placement',
  'course_fit_relevance', 'language_english', 'tech_access', 'other',
];

export function mergeExtractions(extractions) {
  const objections = {};
  for (const cat of OBJECTION_CATEGORIES) {
    objections[cat] = { count: 0, paidCount: 0, phrasings: [], moves: [] };
  }
  const archetypeHints = [], structures = [], bestMoves = [], worstMoves = [], quotes = [];
  for (const ex of extractions) {
    for (const o of ex.objections || []) {
      const cat = OBJECTION_CATEGORIES.includes(o.category) ? o.category : 'other';
      const slot = objections[cat];
      slot.count += 1;
      if (ex.paid) slot.paidCount += 1;
      slot.phrasings.push({ callId: ex.callId, paid: ex.paid, phrasing: o.phrasing });
      slot.moves.push({ callId: ex.callId, paid: ex.paid, move: o.counsellorMove, outcome: o.moveOutcome || 'unresolved' });
    }
    if (ex.archetypeHint) archetypeHints.push({ callId: ex.callId, paid: ex.paid, ...ex.archetypeHint });
    if (ex.structure) structures.push({ callId: ex.callId, paid: ex.paid, ...ex.structure });
    bestMoves.push(...(ex.bestMoves || []).map((m) => ({ callId: ex.callId, paid: ex.paid, move: m })));
    worstMoves.push(...(ex.worstMoves || []).map((m) => ({ callId: ex.callId, paid: ex.paid, move: m })));
    quotes.push(...(ex.notableQuotes || []).map((q) => ({ callId: ex.callId, paid: ex.paid, ...q })));
  }
  return {
    totalCalls: extractions.length,
    paidCalls: extractions.filter((e) => e.paid).length,
    objections, archetypeHints, structures, bestMoves, worstMoves, quotes,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const work = join(dirname(fileURLToPath(import.meta.url)), 'work');
  const extractions = JSON.parse(readFileSync(join(work, 'extractions.json'), 'utf8'));
  const merged = mergeExtractions(extractions);
  writeFileSync(join(work, 'merged.json'), JSON.stringify(merged));
  console.log(`merged ${merged.totalCalls} calls (${merged.paidCalls} paid); ` +
    `objection volume=${Object.values(merged.objections).reduce((n, o) => n + o.count, 0)}`);
}
```

- [ ] **Step 5: Run merge test to verify it passes**

Run: `node --test scripts/mine/tests/merge.test.mjs`
Expected: 2 passing tests.

- [ ] **Step 6: Write the failing validator test** (`scripts/mine/tests/validate.test.mjs`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArtifact, piiScan } from '../validate-artifacts.mjs';

const goodAnchors = {
  criteria: ['rapport', 'discovery', 'presentation', 'objections', 'knowledge', 'closing', 'communication', 'voice_delivery']
    .map((key, i) => ({
      key, label: key, weight: [10, 15, 15, 20, 15, 10, 10, 5][i],
      anchors: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' },
    })),
};

test('accepts valid rubric-anchors', () => {
  assert.deepEqual(validateArtifact('rubric-anchors.json', goodAnchors), []);
});

test('rejects weights not summing to 100', () => {
  const bad = structuredClone(goodAnchors);
  bad.criteria[0].weight = 50;
  assert.ok(validateArtifact('rubric-anchors.json', bad).length > 0);
});

test('rejects archetypes outside 6-10 range', () => {
  const errs = validateArtifact('archetypes.json', { archetypes: [] });
  assert.ok(errs.length > 0);
});

test('pii scan catches emails', () => {
  assert.ok(piiScan({ a: 'reach me at foo.bar@gmail.com' }).length > 0);
  assert.equal(piiScan({ a: 'fee is 50,000 plus GST' }).length, 0);
});
```

- [ ] **Step 7: Run validator test to verify it fails**

Run: `node --test scripts/mine/tests/validate.test.mjs`
Expected: FAIL — cannot find module `validate-artifacts.mjs`.

- [ ] **Step 8: Implement `scripts/mine/validate-artifacts.mjs`:**

```js
#!/usr/bin/env node
// Shape + PII validation for server/data/seed/*.json. Exit 1 on any failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EMAIL_RE = /[\w.+-]+@[\w-]+\.\w{2,}/g;

export function piiScan(artifact) {
  const hits = JSON.stringify(artifact).match(EMAIL_RE) || [];
  return hits.map((h) => `PII email found: ${h}`);
}

function req(obj, key, type, errs, ctx) {
  const v = obj?.[key];
  const ok = type === 'array' ? Array.isArray(v)
    : type === 'number' ? typeof v === 'number'
    : type === 'string' ? typeof v === 'string' && v.length > 0
    : typeof v === 'object' && v !== null;
  if (!ok) errs.push(`${ctx}: missing/invalid ${key} (${type})`);
  return ok;
}

const CHECKS = {
  'archetypes.json': (a, errs) => {
    if (!req(a, 'archetypes', 'array', errs, 'root')) return;
    if (a.archetypes.length < 6 || a.archetypes.length > 10) {
      errs.push(`archetypes count ${a.archetypes.length}, want 6-10`);
    }
    a.archetypes.forEach((x, i) => {
      for (const k of ['key', 'name', 'background', 'goals', 'coreAnxiety', 'decisionDynamics', 'languageTexture']) {
        req(x, k, 'string', errs, `archetypes[${i}]`);
      }
      req(x, 'typicalQuestions', 'array', errs, `archetypes[${i}]`);
      if (req(x, 'evidence', 'object', errs, `archetypes[${i}]`)) {
        req(x.evidence, 'corpusSharePct', 'number', errs, `archetypes[${i}].evidence`);
        req(x.evidence, 'conversionRatePct', 'number', errs, `archetypes[${i}].evidence`);
      }
    });
  },
  'objections.json': (a, errs) => {
    if (!req(a, 'categories', 'array', errs, 'root')) return;
    if (a.categories.length < 6) errs.push(`only ${a.categories.length} objection categories, want >=6`);
    a.categories.forEach((c, i) => {
      for (const k of ['key', 'label']) req(c, k, 'string', errs, `categories[${i}]`);
      req(c, 'frequencyPct', 'number', errs, `categories[${i}]`);
      for (const k of ['phrasings', 'counterMovesThatWorked', 'movesThatFailed']) {
        if (req(c, k, 'array', errs, `categories[${i}]`) && c[k].length === 0) {
          errs.push(`categories[${i}].${k} is empty`);
        }
      }
    });
  },
  'conversation-structure.json': (a, errs) => {
    if (req(a, 'phases', 'array', errs, 'root') && a.phases.length !== 5) {
      errs.push(`phases length ${a.phases.length}, want 5`);
    }
    (a.phases || []).forEach((p, i) => {
      req(p, 'name', 'string', errs, `phases[${i}]`);
      req(p, 'typicalSharePct', 'number', errs, `phases[${i}]`);
      req(p, 'markers', 'array', errs, `phases[${i}]`);
    });
    req(a, 'openingPatterns', 'array', errs, 'root');
    req(a, 'paymentAskNorms', 'object', errs, 'root');
  },
  'rubric-anchors.json': (a, errs) => {
    if (!req(a, 'criteria', 'array', errs, 'root')) return;
    if (a.criteria.length !== 8) errs.push(`criteria length ${a.criteria.length}, want 8`);
    let sum = 0;
    a.criteria.forEach((c, i) => {
      for (const k of ['key', 'label']) req(c, k, 'string', errs, `criteria[${i}]`);
      if (req(c, 'weight', 'number', errs, `criteria[${i}]`)) sum += c.weight;
      if (req(c, 'anchors', 'object', errs, `criteria[${i}]`)) {
        for (const lvl of ['1', '2', '3', '4', '5']) {
          req(c.anchors, lvl, 'string', errs, `criteria[${i}].anchors`);
        }
      }
    });
    if (sum !== 100) errs.push(`weights sum ${sum}, want 100`);
  },
  'benchmarks.json': (a, errs) => {
    if (req(a, 'text', 'object', errs, 'root')) {
      req(a.text, 'durationMin', 'object', errs, 'text');
      req(a.text, 'paidVsUnpaid', 'object', errs, 'text');
    }
    // prosody block is added by the audio pipeline later; validate shape only if present
    if (a.prosody) {
      for (const grp of ['paid', 'unpaid']) {
        if (req(a.prosody, grp, 'object', errs, 'prosody')) {
          for (const k of ['counsellorWpm', 'counsellorTalkRatio', 'counsellorPauseRatio', 'counsellorPitchVarSemitones']) {
            req(a.prosody[grp], k, 'number', errs, `prosody.${grp}`);
          }
        }
      }
    }
  },
};

export function validateArtifact(name, artifact) {
  const errs = [];
  CHECKS[name]?.(artifact, errs);
  errs.push(...piiScan(artifact));
  return errs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'data', 'seed');
  let failed = false;
  for (const name of Object.keys(CHECKS)) {
    const path = join(seedDir, name);
    if (!existsSync(path)) { console.error(`MISSING ${name}`); failed = true; continue; }
    const errs = validateArtifact(name, JSON.parse(readFileSync(path, 'utf8')));
    if (errs.length) { failed = true; console.error(`FAIL ${name}\n  - ${errs.join('\n  - ')}`); }
    else console.log(`OK   ${name}`);
  }
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 9: Run all node tests to verify they pass**

Run: `node --test scripts/mine/tests/`
Expected: 6 passing tests (2 merge + 4 validate), 0 failing.

---

### Task 6: Run the transcript-mining workflow (Claude-executed)

This task is performed by Claude with the Workflow tool — there is no checked-in runnable for the LLM stages; the deterministic stages (merge, validate) are the scripts from Tasks 2–5. Save the workflow script below as `scripts/mine/workflow-mine.js` for reproducibility (it is documentation of the run, consumed by the Workflow tool, not by node).

- [ ] **Step 1: Save `scripts/mine/workflow-mine.js`** (content = the Workflow script below).

- [ ] **Step 2: Run extraction workflow.** Invoke the Workflow tool with `args: { batchFiles: [...all 27 absolute batch paths...] }` and this script:

```js
export const meta = {
  name: 'mine-transcripts',
  description: 'Extract structured patterns from real counselling call batches',
  phases: [{ title: 'Extract', detail: 'one sonnet agent per 8-call batch' }],
}
const SCHEMA = { /* paste full contents of scripts/mine/schemas/extraction.schema.json */ }
phase('Extract')
const results = await parallel(args.batchFiles.map((f) => () => agent(
  `Read the JSON file at ${f}. It contains real counselling-call transcripts (field "calls": id, counselor, durationMin, paid, transcript). For EACH call produce one extraction object per the output schema. Rules:
  - REDACT names: replace student/counsellor names inside any quote or phrasing with [Student]/[Counsellor]. Never output emails or phone numbers.
  - objections: every distinct objection the student raises; category from the enum; phrasing = short redacted near-verbatim quote; counsellorMove = what the counsellor did in response; moveOutcome judged from what followed.
  - structure: presentationStartsAtPct/paymentAskAtPct = position in the call as % (0-100) where the fee/curriculum presentation and the payment ask begin, null if absent.
  - archetypeHint: who this student is (background, goal, anxiety, decisionDynamics e.g. parents/employer, languageTexture e.g. Hinglish phrases, fillers).
  - bestMoves/worstMoves: counsellor behaviours that visibly helped/hurt.
  - notableQuotes: 1-3 per call, redacted, with why they matter.
  Transcripts are unlabelled (no speaker tags) — infer speakers from content. Return ONLY the structured output.`,
  { model: 'sonnet', schema: SCHEMA, label: f.split('/').pop(), phase: 'Extract' }
)))
const ok = results.filter(Boolean)
log(`${ok.length}/${args.batchFiles.length} batches extracted`)
return { batches: ok }
```

- [ ] **Step 3: Persist + merge.** Flatten `batches[].extractions` into `scripts/mine/work/extractions.json` (Claude writes the file from the workflow result), then:

Run: `node scripts/mine/merge-extractions.mjs`
Expected: `merged 216 calls (39 paid); objection volume=<several hundred>`. If any batch returned null in Step 2, re-run just those batch files through the same workflow before merging (resume with the same runId; cached batches return instantly).

- [ ] **Step 4: Synthesis (5 agents, default model, run as a second Workflow or sequential Agent calls).** Each agent reads `scripts/mine/work/merged.json` + `scripts/mine/work/stats.json` and writes one artifact to `server/data/seed/`. Prompts:

1. **archetypes.json** — "Cluster the `archetypeHints` pool into 6–10 distinct student archetypes. For each: key (snake_case), name (e.g. 'The UPSC Switcher'), background, goals, coreAnxiety, decisionDynamics, languageTexture, typicalQuestions (array of 4-8 redacted real-flavoured questions), evidence: {corpusSharePct, conversionRatePct} computed from the hint counts and paid flags. Output JSON: {archetypes: [...]}. No names/emails."
2. **objections.json** — "From `objections` build {categories: [{key, label, frequencyPct (of all objection events), conversionGapNote, phrasings (5-10 redacted), counterMovesThatWorked (moves with outcome=defused, paid-weighted, deduped, 4-8), movesThatFailed (escalated/unresolved, 3-6)}]}. Keep every category with count>0."
3. **conversation-structure.json** — "From `structures` produce {phases: [exactly 5: Opening, Discovery, Presentation, Objections & Negotiation, Close — each {name, typicalSharePct, markers (array of vocabulary/behaviour markers from the corpus)}], openingPatterns (4-6 strings), paymentAskNorms: {typicalAtPct, inCallPaymentPushPct, notes}}."
4. **rubric-anchors.json** — "Produce {criteria: [exactly these 8 with these weights: rapport/10 'Rapport & Opening', discovery/15 'Needs Discovery', presentation/15 'Programme Presentation', objections/20 'Objection Handling', knowledge/15 'Product Knowledge & Accuracy', closing/10 'Closing & Payment Ask', communication/10 'Communication & Empathy', voice_delivery/5 'Voice Delivery']. For each: anchors {1..5} = one-sentence behaviour descriptions of what that level sounds like, grounded in bestMoves/worstMoves/quotes; where natural, embed a short redacted corpus quote."
5. **benchmarks.json** — "Produce {text: {durationMin: stats quartiles, transcriptChars: stats, conversionRate, paidVsUnpaid: {durationMedianPaid, durationMedianUnpaid, presentationStartPctMedian, paymentAskPctMedian — computed from structures split by paid}}}. Numbers only from the provided data; no prosody block (audio adds it later)."

- [ ] **Step 5: Reviewer pass.** One agent: "Read the five artifacts in `server/data/seed/`, plus `scripts/mine/work/stats.json` and 3 random raw transcripts from `scripts/mine/work/calls.json`. Verify: claims are plausible against the raw calls, no PII (emails/full names) anywhere, archetype evidence percentages roughly sum near 100, objection frequencies sum near 100. Return a list of defects or 'CLEAN'." Fix any defects by re-prompting the offending synthesis agent.

- [ ] **Step 6: Validate**

Run: `node scripts/mine/validate-artifacts.mjs`
Expected: `OK` for all 5 artifacts, exit 0. (benchmarks has no prosody yet — validator treats it as optional.)

---

### Task 7: Audio fetch

**Files:**
- Create: `scripts/mine/audio/fetch.py`, `scripts/mine/audio/tests/test_fetch.py`

- [ ] **Step 1: Write the failing test** (`scripts/mine/audio/tests/test_fetch.py`):

```python
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fetch import ffmpeg_cmd


class TestFetch(unittest.TestCase):
    def test_ffmpeg_cmd(self):
        cmd = ffmpeg_cmd("https://x/m.m3u8", Path("/tmp/a.wav"))
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("-ac", cmd); self.assertEqual(cmd[cmd.index("-ac") + 1], "1")
        self.assertIn("-ar", cmd); self.assertEqual(cmd[cmd.index("-ar") + 1], "16000")
        self.assertEqual(cmd[-1], "/tmp/a.wav")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s scripts/mine/audio/tests -p "test_fetch.py" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fetch'`

- [ ] **Step 3: Implement `scripts/mine/audio/fetch.py`:**

```python
#!/usr/bin/env python3
"""Download sampled call recordings (HLS) as 16 kHz mono wav via ffmpeg. Idempotent."""
import json, subprocess, sys
from pathlib import Path

WORK = Path(__file__).resolve().parents[1] / "work"
OUT = WORK / "audio"
MIN_VALID_BYTES = 100_000


def ffmpeg_cmd(url, out_path):
    return ["ffmpeg", "-y", "-loglevel", "error", "-i", url,
            "-ac", "1", "-ar", "16000", str(out_path)]


def main(dry=False):
    OUT.mkdir(parents=True, exist_ok=True)
    sample = json.loads((WORK / "audio-sample.json").read_text())
    failures = []
    for s in sample:
        out = OUT / f"{s['id']}.wav"
        if out.exists() and out.stat().st_size > MIN_VALID_BYTES:
            print("skip (exists)", s["id"])
            continue
        cmd = ffmpeg_cmd(s["recordingUrl"], out)
        if dry:
            print(" ".join(cmd))
            continue
        try:
            subprocess.run(cmd, check=True, timeout=1800)
            print("ok", s["id"], f"{out.stat().st_size // 1_000_000}MB")
        except Exception as e:  # noqa: BLE001 - log and continue the batch
            failures.append(s["id"])
            print("FAIL", s["id"], e)
    if failures:
        print(f"{len(failures)} failures: {failures}")
        sys.exit(1)


if __name__ == "__main__":
    main(dry="--dry-run" in sys.argv)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s scripts/mine/audio/tests -p "test_fetch.py" -v`
Expected: `OK` (1 test).

- [ ] **Step 5: Dry-run, then real download (background — ~20 files, minutes not hours)**

Run: `python3 scripts/mine/audio/fetch.py --dry-run` → 20 ffmpeg command lines.
Then run `python3 scripts/mine/audio/fetch.py` in the background; on completion: `ls scripts/mine/work/audio/*.wav | wc -l` → `20` (any failures are listed; a couple of dead URLs is acceptable — note them and continue with ≥16 files).

---

### Task 8: Audio analysis env + analyze.py + aggregate.py

**Files:**
- Create: `scripts/mine/audio/pyproject.toml`, `scripts/mine/audio/analyze.py`, `scripts/mine/audio/aggregate.py`, `scripts/mine/audio/tests/test_metrics.py`

- [ ] **Step 1: Create `scripts/mine/audio/pyproject.toml`:**

```toml
[project]
name = "mine-audio"
version = "0.1.0"
requires-python = ">=3.11,<3.12"
dependencies = [
  "faster-whisper>=1.0",
  "librosa>=0.10",
  "soundfile>=0.12",
  "scikit-learn>=1.4",
  "numpy>=1.26",
  "resemblyzer>=0.1.4",
]
```

- [ ] **Step 2: Create the env**

Run: `cd scripts/mine/audio && uv venv --python 3.11 && uv pip install -e . 2>&1 | tail -2`
Expected: env created at `scripts/mine/audio/.venv`, install succeeds (torch wheel for resemblyzer is large; one-time). If `resemblyzer` install fails, remove it from dependencies and rely on the built-in MFCC fallback in `analyze.py` (Step 4 code handles its absence).

- [ ] **Step 3: Write the failing metrics test** (`scripts/mine/audio/tests/test_metrics.py`) — pure math only, runs with system python, no models:

```python
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyze import wpm, pause_ratio, semitone_std, group_spans

W = lambda s, e: {"start": s, "end": e, "word": "w"}


class TestMetrics(unittest.TestCase):
    def test_wpm(self):
        self.assertAlmostEqual(wpm(words=150, speech_seconds=60.0), 150.0)
        self.assertEqual(wpm(words=10, speech_seconds=0.0), 0.0)

    def test_group_spans_splits_on_gap(self):
        words = [W(0, 1), W(1.2, 2), W(4.0, 5)]  # 2s gap before third word
        spans = group_spans(words, gap=1.0)
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[0]["start"], 0)
        self.assertEqual(spans[1]["start"], 4.0)
        self.assertEqual(spans[0]["words"], 2)

    def test_pause_ratio(self):
        spans = [{"start": 0, "end": 4, "words": 8}, {"start": 6, "end": 8, "words": 4}]
        # speech 6s of 0..8 window -> pauses 2s -> ratio 0.25
        self.assertAlmostEqual(pause_ratio(spans, total_seconds=8.0), 0.25)

    def test_semitone_std(self):
        self.assertAlmostEqual(semitone_std([100.0, 100.0, 100.0]), 0.0)
        self.assertGreater(semitone_std([100.0, 200.0, 100.0, 200.0]), 5.0)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Implement `scripts/mine/audio/analyze.py`:**

```python
#!/usr/bin/env python3
"""Diarized prosody metrics for one sampled call wav.

Usage (inside scripts/mine/audio/.venv):  python analyze.py <id>   or  --all
Output: ../work/audio/<id>.metrics.json
Pure-math helpers (wpm, pause_ratio, semitone_std, group_spans) are import-safe
without heavy deps so tests run on system python.
"""
import json, math, sys
from pathlib import Path

WORK = Path(__file__).resolve().parents[1] / "work"
AUDIO = WORK / "audio"
FIRST_WINDOW_S = 60.0   # counsellor = dominant speaker of the first minute
SPAN_GAP_S = 1.0


# ---------- pure math (unit-tested, no heavy imports) ----------

def wpm(words, speech_seconds):
    return 0.0 if speech_seconds <= 0 else words / (speech_seconds / 60.0)


def group_spans(word_list, gap=SPAN_GAP_S):
    spans = []
    for w in word_list:
        if spans and w["start"] - spans[-1]["end"] <= gap:
            spans[-1]["end"] = w["end"]
            spans[-1]["words"] += 1
        else:
            spans.append({"start": w["start"], "end": w["end"], "words": 1})
    return spans


def pause_ratio(spans, total_seconds):
    if total_seconds <= 0:
        return 0.0
    speech = sum(s["end"] - s["start"] for s in spans)
    return max(0.0, min(1.0, (total_seconds - speech) / total_seconds))


def semitone_std(f0_values):
    vals = [v for v in f0_values if v and v > 0]
    if len(vals) < 2:
        return 0.0
    ref = sum(vals) / len(vals)
    semis = [12.0 * math.log2(v / ref) for v in vals]
    mean = sum(semis) / len(semis)
    return math.sqrt(sum((s - mean) ** 2 for s in semis) / len(semis))


# ---------- heavy pipeline ----------

def transcribe(wav_path):
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(wav_path), word_timestamps=True, language="en")
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"start": w.start, "end": w.end, "word": w.word})
    return words


def embed_spans(y, sr, spans):
    """One voice embedding per span; resemblyzer if available, else MFCC means."""
    import numpy as np
    clips = []
    for s in spans:
        a, b = int(s["start"] * sr), int(s["end"] * sr)
        clips.append(y[a:b] if b > a else y[a:a + sr])
    try:
        from resemblyzer import VoiceEncoder
        enc = VoiceEncoder()
        return np.array([enc.embed_utterance(c.astype("float32")) for c in clips])
    except ImportError:
        import librosa
        return np.array([librosa.feature.mfcc(y=c.astype("float32"), sr=sr, n_mfcc=20).mean(axis=1)
                         for c in clips])


def diarize(y, sr, spans):
    """Label each span 0/1; speaker dominating the first minute = counsellor."""
    import numpy as np
    from sklearn.cluster import AgglomerativeClustering
    if len(spans) < 4:
        return [0] * len(spans), 0
    emb = embed_spans(y, sr, spans)
    labels = AgglomerativeClustering(n_clusters=2).fit_predict(emb)
    early = {0: 0.0, 1: 0.0}
    for s, lab in zip(spans, labels):
        if s["start"] < FIRST_WINDOW_S:
            early[int(lab)] += min(s["end"], FIRST_WINDOW_S) - s["start"]
    counsellor = 0 if early[0] >= early[1] else 1
    return [int(l) for l in labels], counsellor


def speaker_metrics(y, sr, spans, total_seconds):
    import librosa
    import numpy as np
    words = sum(s["words"] for s in spans)
    speech = sum(s["end"] - s["start"] for s in spans)
    f0_all, rms_all = [], []
    for s in spans:
        a, b = int(s["start"] * sr), int(s["end"] * sr)
        clip = y[a:b]
        if len(clip) < sr // 2:
            continue
        f0, _, _ = librosa.pyin(clip.astype("float32"), sr=sr,
                                fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"))
        f0_all.extend([float(v) for v in f0 if v == v])  # drop NaN
        rms_all.extend(librosa.feature.rms(y=clip.astype("float32"))[0].tolist())
    rms = np.array(rms_all) if rms_all else np.array([0.0])
    return {
        "wpm": round(wpm(words, speech), 1),
        "talkRatio": round(speech / total_seconds, 3) if total_seconds else 0.0,
        "pauseRatio": round(pause_ratio(spans, total_seconds), 3),
        "pitchVarSemitones": round(semitone_std(f0_all), 2),
        "energyCv": round(float(rms.std() / rms.mean()), 3) if rms.mean() > 0 else 0.0,
        "speechSeconds": round(speech, 1),
    }


def analyze_one(call_id):
    import librosa
    wav = AUDIO / f"{call_id}.wav"
    y, sr = librosa.load(str(wav), sr=16000, mono=True)
    total = len(y) / sr
    words = transcribe(wav)
    spans = group_spans(words)
    labels, counsellor = diarize(y, sr, spans)
    by_speaker = {"counsellor": [], "student": []}
    for s, lab in zip(spans, labels):
        by_speaker["counsellor" if lab == counsellor else "student"].append(s)
    metrics = {
        "id": call_id,
        "totalSeconds": round(total, 1),
        "counsellor": speaker_metrics(y, sr, by_speaker["counsellor"], total),
        "student": speaker_metrics(y, sr, by_speaker["student"], total),
        "diarizationSpans": len(spans),
    }
    out = AUDIO / f"{call_id}.metrics.json"
    out.write_text(json.dumps(metrics, indent=2))
    print("wrote", out.name)


def main():
    if "--all" in sys.argv:
        sample = json.loads((WORK / "audio-sample.json").read_text())
        for s in sample:
            if (AUDIO / f"{s['id']}.wav").exists() and not (AUDIO / f"{s['id']}.metrics.json").exists():
                try:
                    analyze_one(s["id"])
                except Exception as e:  # noqa: BLE001 - skip bad files, keep the batch going
                    print("FAIL", s["id"], e)
    else:
        analyze_one(sys.argv[1])


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run metrics test (system python — heavy imports are function-local)**

Run: `python3 -m unittest discover -s scripts/mine/audio/tests -p "test_metrics.py" -v`
Expected: `OK` (4 tests).

- [ ] **Step 6: Smoke one real call, then run all (background; ~10-20 min/call on M2 CPU)**

Run: `cd scripts/mine/audio && .venv/bin/python analyze.py <first id from audio-sample.json>` → one `.metrics.json` with plausible numbers (counsellor wpm 120–190, talkRatio 0.35–0.75). Then `.venv/bin/python analyze.py --all` in background. Sanity-gate: a call whose counsellor+student talkRatio sum is < 0.5 or > 1.1 indicates diarization failure — delete that metrics file (aggregate skips missing).

- [ ] **Step 7: Implement `scripts/mine/audio/aggregate.py`:**

```python
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
        if s:
            groups["paid" if s["paid"] else "unpaid"].append(m)
    bench_path = SEED / "benchmarks.json"
    bench = json.loads(bench_path.read_text())
    bench["prosody"] = build_prosody(groups)
    bench_path.write_text(json.dumps(bench, indent=2))
    print("prosody:", json.dumps(bench["prosody"], indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 8: Aggregate and validate**

Run: `python3 scripts/mine/audio/aggregate.py && node scripts/mine/validate-artifacts.mjs`
Expected: prosody block printed with both groups; validator `OK` × 5, exit 0.

---

### Task 9: Document the pipeline

**Files:**
- Modify: `CLAUDE.md` (add after the "Server architecture" section)

- [ ] **Step 1: Add this section to `CLAUDE.md`:**

```markdown
## Real-data mining (`scripts/mine/`)

Offline pipeline that grounds the simulation in 216 real counselling calls
(`counselling_ba_courses - Sheet1.csv`, git-ignored, PII — never import into the app).
Deterministic stages are scripts; LLM stages run as Claude workflows (see
`scripts/mine/workflow-mine.js`). Outputs are the five PII-free artifacts in
`server/data/seed/` (archetypes, objections, conversation-structure, rubric-anchors,
benchmarks) — validated by `node scripts/mine/validate-artifacts.mjs`.

Re-run order: `prepare.py` → `sample.py` → `make_batches.py` → extraction workflow →
`merge-extractions.mjs` → synthesis agents → validator. Audio: `audio/fetch.py` →
`audio/analyze.py --all` (uv env in `scripts/mine/audio/`) → `audio/aggregate.py`.
Tests: `python3 -m unittest discover -s scripts/mine/tests` ·
`python3 -m unittest discover -s scripts/mine/audio/tests` · `node --test scripts/mine/tests/`.
```

- [ ] **Step 2: Verify**

Run: `grep -c "Real-data mining" CLAUDE.md`
Expected: `1`.

---

### Task 10: Final phase verification

- [ ] **Step 1: All unit tests**

Run: `python3 -m unittest discover -s scripts/mine/tests -v && python3 -m unittest discover -s scripts/mine/audio/tests -v && node --test scripts/mine/tests/`
Expected: all pass (9 python mine tests + 5 python audio tests + 6 node tests).

- [ ] **Step 2: Artifacts + PII gate**

Run: `node scripts/mine/validate-artifacts.mjs && grep -rlE "[[:alnum:]_.+-]+@[[:alnum:]-]+\.[[:alpha:]]{2,}" server/data/seed/ ; echo "exit=$?"`
Expected: validator OK × 5; grep finds nothing (`exit=1` from grep means no matches — that is the PASS condition).

- [ ] **Step 3: Spot-check quality (human + Claude review)**

Read `server/data/seed/archetypes.json` and `objections.json`; confirm archetypes match recognizable patterns from the corpus (e.g. UPSC/govt-exam switchers, parent-funded fresh graduates, working upskillers) and objection categories include fee/parents/competing_priorities with real-flavoured phrasings. Present a summary of all five artifacts to Rahul.

---

## Self-review notes

- **Spec coverage (Phase 0–1):** hygiene (Task 1) · transcript mining incl. batching, schema-forced extraction, deterministic merge, synthesis, reviewer (Tasks 2,4,5,6) · stratified audio sample (Task 3) · audio prosody pipeline (Tasks 7,8) · PII rules enforced by gitignore + redaction prompts + validator scan (Tasks 1,5,6,10) · docs (Task 9).
- **Type consistency:** extraction fields in schema = fields consumed by `mergeExtractions` = fields referenced in synthesis prompts; `benchmarks.json` prosody keys in `aggregate.py` = keys checked by `validate-artifacts.mjs`.
- **Known judgment calls:** counsellor identification = dominant speaker of first 60 s (real calls open with the counsellor's audibility check); batch size 8 ≈ 25k tokens fits comfortably in a sonnet agent's context; `voice_delivery` anchors are mined from transcripts only (delivery wording) — prosody numbers arrive separately in benchmarks.
