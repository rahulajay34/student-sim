# Indian-Accent Prosody Research
## Grounding Voice Instructions for the "Prospective Student" Role

---

## 1. Data Provenance and Sample Size

| Artifact | Source | N |
|---|---|---|
| Call transcripts | `counselling_ba_courses - Sheet1.csv` (PII-redacted; names/phones not reproduced here) | 216 calls |
| Student turn word-count stats | `server/data/seed/register-stats.json` | 16 calls, 182 student turns |
| Student line catalogue | `server/data/seed/register-lines.json` | 32 calls, 404 unique turns |
| Prosody analysis (counsellor-side; audio) | `server/data/seed/benchmarks.json` | 11 calls (5 paid, 6 unpaid) |
| Call metadata and durations | `server/data/seed/benchmarks.json` + CSV | 216 calls |
| Discourse-marker counts | Computed from CSV transcripts in this analysis | 216 calls, ~1 361 student-attributed sentences |

No audio files were fetched for this analysis. Student-side prosody numbers are derived analytically using counsellor-measured benchmarks as calibration anchors; the resulting WPM estimates are marked **[DERIVED]** below. Pitch and energy for the student side are **[LITERATURE]** (Indian English L2 conversational speech norms). All counsellor audio measurements are **[MEASURED]** from the pipeline output in `benchmarks.json`.

---

## 2. Measured and Derived Stats Table

### 2a. Call-level timing (all 216 calls)

| Metric | Value |
|---|---|
| Median call duration | 17.4 min |
| P25 call duration | 5.7 min |
| P75 call duration | 28.6 min |
| Overall conversion rate | 18.1% |
| Counsellor talk ratio (paid calls) **[MEASURED]** | 0.63 (63% of call time) |
| Counsellor talk ratio (unpaid calls) **[MEASURED]** | 0.49 |
| **Student talk ratio (paid calls) [MEASURED]** | **0.061 (6% of call time)** |
| **Student talk ratio (unpaid calls) [MEASURED]** | **0.21 (21% of call time)** |
| Combined inter-turn silence (paid) **[MEASURED]** | ~31% of call |

### 2b. Student speaking rate

| Metric | Value | Method |
|---|---|---|
| **Active speaking rate (phonation only)** | **125–155 WPM (target 140)** | [DERIVED] + [LITERATURE] |
| Effective turn rate (incl. within-turn pauses) | ~70–90 WPM | [DERIVED] |
| Within-turn pause fraction | ~50–55% of student "talk time" | [DERIVED] |
| Counsellor WPM (paid) for calibration | 208.8 WPM | [MEASURED] |
| Counsellor WPM (unpaid) | 197.4 WPM | [MEASURED] |

**Derivation note.** The student talk ratio (0.21, unpaid calls) × median call (17.4 min) = 3.65 min of student time. The register catalogue gives mean 21.6 words/turn × 11.4 turns/call = ~246 words/call. Nominal effective rate = 246 / 3.65 = 67 WPM. Assuming active phonation rate of 140 WPM → pause fraction ≈ 52% of student time, consistent with the observed 38 word-repetition stutter events per call. The literature range for L2 Indian English active speech (120–155 WPM) brackets the 140 WPM target; phone/semi-formal context trims ~10–15 WPM off L1 rates.

### 2c. Student turn lengths (register-stats.json, 182 turns)

| Phase | Median words | P25 | P75 |
|---|---|---|---|
| Opening (ph 1) | 8 | 4 | 22 |
| Discovery (ph 2) | 12 | 4 | 34 |
| Presentation (ph 3) | 15 | 7 | 55 |
| Objections/Negotiation (ph 4) | 15 | 7 | 55 |
| Close (ph 5) | 6 | 2 | 11 |

### 2d. Hesitation and pause markers (per call, 216 calls)

| Marker | Count / call |
|---|---|
| Word-repetition stutters (any speaker) | 38.4 |
| Triple-word repetition | 4.1 |
| "okay okay" double-affirm | 4.2 |
| "one minute" explicit pause | 0.7 |
| "wait" standalone | 0.9 |
| Trailing "because …," (sentence abandoned) | 0.9 |

### 2e. Discourse markers in student sentences (1 361 attributed sentences)

| Marker | % of sentences | Occurrences |
|---|---|---|
| "sir" (address) | 46.7% | 636 |
| "like" (filler/hedge) | 15.0% | 204 |
| "right" (tag/confirmation) | 10.3% | 140 |
| "you know" | 10.2% | 139 |
| "uh" (hesitation; ASR-suppressed, actual rate higher) | 7.8% | 106 |
| "okay so" (segment opener) | 7.5% | 102 |
| "actually" (emphasis/correction) | 6.8% | 93 |
| "only" (emphatic focus) | 6.0% | 82 |
| "okay okay" (double-affirm backchannel) | 5.4% | 74 |
| "basically" | 4.4% | 60 |
| "kind of" | 3.4% | 46 |
| "i mean" | 2.6% | 36 |
| "um" (ASR-suppressed) | 2.5% | 34 |
| "so basically" | 1.8% | 24 |

### 2f. Tag questions and intonation markers (per call)

| Pattern | Count / call |
|---|---|
| "right?" sentence-final tag | 6.2 |
| "okay?" sentence-final check | 4.7 |
| Sentence-initial "So," | 24.7 |
| Sentence-initial "Actually" | 0.6 |
| Sentence-initial "Like," | 2.3 |
| "yeah?" | 0.3 |
| "no?" / "na?" (Indian tag; rare in this corpus) | < 0.1 |

### 2g. Pitch and energy (student-side) **[LITERATURE]**

No student-separated audio analysis was run. Counsellor pitch variation measured at 4.25 semitones (paid) / 3.8 semitones (unpaid). For Indian English L2 conversational speech (published norms):

| Metric | Typical range | Notes |
|---|---|---|
| F0 median (young adult female) | 220–260 Hz | Higher than American/British English baseline |
| F0 median (young adult male) | 130–165 Hz | |
| F0 range within utterance | 5–9 semitones | Wider than counsellor-measured 4.25 — students more emotionally reactive |
| Energy variation (CV) | 0.65–0.85 | Comparable to counsellor benchmark (0.77) |
| Intonation pattern | Late-peak / H* rise | Characteristic of Indian English; stressed syllable comes slightly later than in Received Pronunciation |

---

## 3. Qualitative Delivery Notes

### Rhythm and timing

Indian English is predominantly **syllable-timed** (relatively equal duration per syllable) rather than stress-timed like British or American English. On a phone call this produces a characteristic even-beat cadence — the unstressed syllables are not swallowed. Phrases like "I would like to know about the program" sound more metronomic than in General American.

### Retroflex consonants and consonant clusters

The retroflex /ʈ, ɖ, ɳ/ replace the alveolar /t, d, n/ in words like "student", "data", "analytics". The /w/ and /v/ distinction is blurred in many Indian accents (interchange is common). Word-final consonant clusters are often simplified ("aks" for "ask", "ekams" for "exams").

### Vowels

The distinction between /æ/ (cat) and /ɑː/ (father) is often neutralised toward a mid /a/ — "batch" and "background" both carry a clean /a/. The /ɒ/ in "job" and "process" is often rounded toward /oː/. Vowel length distinctions are less marked than in Received Pronunciation.

### Intonation and sentence-final patterns

Questions use a **high-rise terminal** (HRT), but also declarative sentences can end with a rise when the speaker is checking whether the listener is following — this is pragmatic, not grammatical uncertainty. The corpus shows 6.2 "right?" tags per call and 4.7 "okay?" tags, both functioning as comprehension checks. Stress falls on **content words**, with prepositions and auxiliaries de-stressed to near-zero (rapid reduction).

### Sentence-level discourse structure

Openings: **"So, …"** is overwhelmingly the dominant sentence opener (24.7/call), functioning as both a topic launcher and a softener. **"Actually, …"** introduces corrections or clarifications rather than new information ("Actually I am from a non-technical background, sir"). **"Like, …"** hedges propositions ("Like, I want to check if there is placement support, sir").

Common sentence-final emphasis patterns in this corpus:
- **"only"** as intensifier: "I work in operations only", "That is the issue only"
- **"itself"** as immediacy marker: "They are starting from today itself"
- **Trailing affirmative "na?" / "right?"**: checking for shared understanding after stating something

### Filler and backchannel inventory

The corpus shows the following rough filler hierarchy (most → least frequent):
1. "like" — general hedge, especially mid-sentence
2. "actually" — correction/emphasis opener
3. "you know" — appeals to shared context
4. "okay so" / "so basically" — segment connectors
5. "um" / "uh" — planning pauses (suppressed in ASR; actual rate estimated 2–3× the transcribed count)
6. "okay okay" — double-affirm backchannel when the counsellor makes a point

Address terms: "sir" appears in 46.7% of student sentences; "ma'am" appears less frequently. Both are used mid-sentence, not just as openers: "I am interested, sir, but…"

### Emotional energy and prosodic variability

Students are **deferential but reactive**: low assertiveness in Opening and Discovery, rising pitch and tempo when anxious (fee reveal), flattening and trailing off when declining or stalling ("I need to discuss with my parents… so…"). Energy is low-to-moderate at baseline; spikes on surprise or direct disagreement. The archetype data confirms this: even the most confident student type (campus achiever) uses hedges before challenges; the hesitant types show heavy fillers and incomplete sentences.

---

## 4. VOICE DELIVERY

*(Ready-to-paste instruction block for a speech-to-speech model. Under 180 words.)*

```
VOICE DELIVERY

Speak ENGLISH with an Indian accent throughout. At most one light Hindi word (e.g., "haan", "theek hai") may appear once or twice per session — the conversation is otherwise fully in English.

Tempo: 125–155 WPM during active speech bursts (target ~140 WPM). Pause briefly — 0.4–0.8 s — roughly every 10–15 words within a turn, and 0.5–1.5 s between your turn and the counsellor's next prompt.

Intonation: syllable-timed rhythm (equal beat per syllable, not stress-timed). Use a gentle high-rise on confirmation checks ("right?", "okay?") and rising terminal on genuine questions. Stress falls on content words; prepositions are unstressed and shortened.

Fillers and address: say "sir" (or "ma'am") in roughly every second or third sentence. Sprinkle "like", "actually", "you know", "okay so" as natural hedges — about one per 6–8 sentences each, not every sentence. Use "okay okay" as a quick backchannel when the counsellor finishes a point. Occasional "um" or "uh" before a longer answer is natural.

Energy: low-to-moderate baseline; slightly higher when curious or anxious; flatter and softer when hesitant or deferring.
```

---

*Generated 2026-06-12. No PII in this document.*
