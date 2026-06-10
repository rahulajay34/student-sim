# What Is This App?

*A plain-language guide to the Masai Mock Counselling Trainer — what it is, how it was built, how it works, how to change it, and where its limits are.*

---

## 1. The one-paragraph version

This is a **flight simulator for admission counsellors**. Instead of practising sales calls on real prospective students (and losing real revenue while learning), a counsellor takes a practice call against an **AI-played student** who behaves like the students Masai actually talks to — nervous career switchers, parent-funded freshers, skeptical working professionals. The counsellor talks (voice or typing), the AI student responds in character, raises real objections about fees and parents and time, and at the end the app generates a **coaching report**: scores on 8 skills, the best and worst moments of the call, how the call compares to real converting calls, and drills to practise next.

What makes it different from a generic roleplay bot: **everything in it is grounded in 216 real counselling calls** — real transcripts and real recordings of Masai admission calls, both successful and unsuccessful. The student personalities, the objections they raise, the scoring rubric, even the "good pace" benchmarks for your voice all come from analysing that real data.

---

## 2. Who uses it, and what they see

There are two roles, with dummy logins (no real security yet — see Gaps):

**The Admin** (e.g. a sales trainer or team lead):
- Manages a library of **student personas** (who the AI pretends to be)
- Manages a catalog of **15 real Masai courses** (scraped from masaischool.com — names, fees, curricula, seat-block amounts)
- Manages **rubric templates** (the scoring criteria — editable, with a built-in default mined from real calls)
- **Assigns mocks**: picks a counsellor + course + persona + scenario + rubric, and can make a call "blind" (the counsellor doesn't know who they're talking to)
- Sees a **team dashboard**: which skills the whole team is weak on (a heatmap), score trends over weeks, which objections the team keeps fumbling, every report

**The Counsellor** (the person training):
- Sees assigned mocks and can also start free practice on any course/persona
- Joins calls through a **green room** (call brief + mic check), then a **video-call-style screen**: a glowing orb represents the student, it reacts to their voice and changes colour with their mood; replies appear as subtitles; a sidebar shows the transcript and a live "Coach" panel (satisfaction score, your speaking pace/tone, call milestones)
- Gets the **coaching report** after every call, and a personal dashboard with a skill radar (you vs. team average) and a one-click **recommended drill** generated from their weakest area

---

## 3. How a call actually works (under the hood, gently)

1. **The student's "brain" is a large language model (LLM)** — `gpt-oss:120b`, running on Ollama Cloud. Before each reply, the app assembles a detailed instruction sheet (a "system prompt") telling the model exactly who to be: the persona the admin picked, plus a matching **archetype** mined from real calls (background, anxieties, how they talk — including Hinglish patterns), plus the real **objections** that type of student raises, plus the **actual facts of the course** being sold (so the student asks accurate questions, and notices if you misquote the fee).

2. **The call moves through 5 phases**, the same shape real calls follow: Opening → Discovery → Presentation → Objections & Negotiation → Close. The app detects phase changes from what's being said (e.g. fee talk signals the Presentation phase; "I need to talk to my parents" signals an objection). It also tracks **milestones** — did you ever ask about their background? Did you actually ask for the payment? (In real converting calls, 87% of counsellors did.)

3. **A live satisfaction score (0–100)** moves after every counsellor message. A second, smaller LLM call judges each message: did you acknowledge what the student said, were you accurate, did you pressure them? The student starts at 50; above 70 by the close, they'll agree to block their seat.

4. **Voice**: speech runs fully locally. Your speech is transcribed by Whisper (a speech-recognition model); the student's replies are spoken by Kokoro (a text-to-speech model). There are two ways this runs: entirely inside the browser (zero setup), or through a small local "voice sidecar" server that's faster, transcribes better, and also **analyses your delivery** — words per minute, pitch variation, pauses, energy — and compares it against what good real calls sounded like. The student also tags each reply with an emotion (hesitant, frustrated, excited…), which tints the orb and adjusts the speaking pace.

5. **The report** is one big LLM call over the full transcript, but with guard rails: it must score each rubric criterion against **written level descriptions** ("a 2 in Discovery sounds like… a 5 sounds like…" — written from real call behaviour), the maths (weights, overall %) is computed by ordinary code rather than trusted to the LLM, and the result includes key moments tied to specific turns, benchmark comparisons (your call length vs the 25-minute median of converting calls), and 2–3 concrete drills.

---

## 4. How it was built

The build happened in six phases, each planned, implemented, tested, and then **adversarially reviewed** (a separate AI reviewer tried to find real bugs — and did, repeatedly; everything it confirmed was fixed before moving on).

**Phase 1 — Mining the real calls.** The 216 real call transcripts were split into batches and read by 27 parallel AI analysts, each extracting: who the student was, every objection raised and how the counsellor responded, how the call was structured, and notable quotes (with names and contact details scrubbed). The results were merged and distilled into five "seed" files: student archetypes, an objection playbook, the real call structure, scoring anchors, and numeric benchmarks. Twenty call **recordings** were also downloaded and acoustically analysed (who talked how much, how fast, with how much pitch variation) to calibrate the voice feedback. A reviewer then spot-checked the distilled files against the raw transcripts — quote by quote — before they were accepted.

**Phase 2 — The course catalog.** Fifteen diverse course pages were scraped from masaischool.com and turned into structured records (fees, curriculum modules, eligibility, batch info). The admin can edit these, hide them, or add new ones.

**Phase 3 — The scoring engine.** The fixed 6-criterion rubric became **editable rubric templates**, with a default 8-criterion rubric whose level descriptions quote real calls. The phase machine was rebuilt around the real 5-phase shape, and the student prompt gained the archetype/objection grounding.

**Phase 4 — Voice.** The Python voice sidecar was built (text-to-speech, speech-to-text, delivery analysis), the emotion tag system was added, and the browser keeps working as an automatic fallback if the sidecar isn't running.

**Phase 5 — The call experience.** The old chat screen was replaced with the green room → call stage → wrap-up → report flow.

**Phase 6 — Dashboards.** Analytics endpoints compute everything (heatmaps, trends, radar, drills) from the stored reports each time they're requested — no separate database needed at this scale.

---

## 5. The technology, in plain terms

| Piece | What it is | Why it's here |
|---|---|---|
| **React (+ Vite + Tailwind)** | The user interface framework | Everything you see in the browser |
| **Express (Node.js)** | A small web server | The "brain stem": stores data, talks to the LLM, computes scores and reports |
| **JSON files** (`server/data/*.json`) | Plain text files instead of a database | Simple, inspectable, fine for hundreds of sessions; everything is local |
| **Ollama Cloud — `gpt-oss:120b`** | The large language model | Plays the student, scores messages, writes reports. The only piece that isn't local (needs the API key in `.env`) |
| **Whisper** (tiny in browser / small in sidecar) | Speech-to-text model | Turns your voice into text |
| **Kokoro** (browser and sidecar) | Text-to-speech model | The student's voice |
| **FastAPI (Python) voice sidecar** | A second small local server (port 3002) | Faster/better voice + analyses your tone, pace, energy against real-call benchmarks |
| **librosa / faster-whisper** (Python) | Audio analysis libraries | Used both live (sidecar) and offline (mining the 20 real recordings) |
| **Seed files** (`server/data/seed/*.json`) | The distilled real-call knowledge | Archetypes, objections, call structure, rubric anchors, benchmarks — the app's "experience" |

How to run it (three terminals, or just the first two):

```bash
cd server && npm start        # the API (port 3001) — needs OLLAMA_API_KEY in the repo-root .env
cd client && npm run dev      # the app (port 5173) — open http://localhost:5173
bash voice-server/run.sh      # optional: the voice sidecar (port 3002)
```

Logins: `admin@masai.com / admin123` · `priya@masai.com / priya123` · `rohan@masai.com / rohan123`.

---

## 6. How to customize it

**Things you can change in the app itself (no code):**
- **Personas** — Admin → Personas. Each persona has a "behaviour prompt": literally the instructions the AI student follows, phase by phase. Edit freely; new calls pick up changes immediately (old calls keep their snapshot).
- **Courses** — Admin → Courses. Fix a fee, hide a course, add one manually. The student and the report grader use whatever is stored here.
- **Rubrics** — Admin → Rubrics. Duplicate the default "Grounded v2" template and edit criteria, weights (must total 100), and the level descriptions. Attach any template to an assignment.
- **Scenarios** — written per assignment (situation, difficulty, extra context). Difficulty changes how many objections the student brings.
- **Blind calls** — when assigning, untick "reveal persona" so the counsellor must discover who they're talking to.

**Things you change in files (light technical):**
- **Seed knowledge** — `server/data/seed/*.json`. E.g. add phrasings to an objection category in `objections.json`, or tweak a rubric anchor. The validator `node scripts/mine/validate-artifacts.mjs` checks you didn't break the format.
- **Persona ↔ archetype mapping** — `server/grounding.js` (which mined archetype backs which persona category, and which objections each archetype prefers).
- **The student's core instructions** — `server/prompt.js` (general behaviour, phase instructions, score bands).
- **Report shape/prompt** — `server/report.js`.
- **Voice** — `voice-server/main.py` (emotion → voice-pace mapping, analysis thresholds). Env switches `VOICE_TTS/VOICE_STT/VOICE_ANALYZE=off` disable parts.
- **Refresh the course catalog** — `node scripts/scrape-courses.mjs` re-downloads the 15 pages (edit the slug list inside to change which courses), then re-run the extraction + assembly step.
- **Re-run the mining** — the whole pipeline is documented in `CLAUDE.md` ("Real-data mining") and is repeatable if you get a bigger/fresher CSV of real calls.

---

## 7. Honest gaps and limitations

- **No real security.** Logins are pre-seeded dummies; passwords sit in a JSON file; there's no session/token system. Fine for a local demo, not for deployment.
- **Local JSON storage.** Great until you have thousands of sessions or multiple machines; then it needs a real database.
- **The LLM is the one cloud dependency.** No internet (or no Ollama credit) = no student, no scoring, no reports. Voice, by contrast, is fully local.
- **The expressive-voice goal is only half-landed.** The plan was Chatterbox (a genuinely expressive TTS with emotion control). Its audio decoder turns out to be broken on CPU-only Apple Silicon, so the sidecar auto-falls back to Kokoro — pleasant, but emotion only changes pace, not real vocal emotion. Paths forward: the `mlx-audio` port (Apple-Silicon-optimized) or any machine with an NVIDIA GPU.
- **Voice needs a human shakedown.** Every part around the mic (transcription, analysis, playback, interruption) is code-verified, but no human has yet held Space and talked through a full call.
- **Delivery benchmarks rest on 11 calls.** Of 20 analysed recordings, 9 were dropped because separating the two speakers in a single mixed audio track wasn't reliable enough. The numbers used are honest but thin; more/cleaner recordings would firm them up.
- **Phase detection is keyword-based.** It was tuned on real-call vocabulary and reviewed hard, but a sufficiently unusual conversation can still confuse it. The report grades milestone coverage too, which softens the impact.
- **LLM variability.** The student is convincingly human most turns, but like any LLM it can occasionally break character, repeat itself, or mis-time an objection. The grounding (archetypes, objections, course facts) narrows this a lot; it doesn't eliminate it.
- **Old data noise.** Reports generated before the final fixes carry some free-text drill categories (visible as odd labels in the admin "objection hot-spots" panel); they wash out as new reports come in.
- **The student has no face.** A deliberate scope cut: generated talking-head video isn't feasible on this hardware, so the student is a voice + reactive orb.

---

## 8. Where it could go next

- **Real expressive voice** via mlx-audio/Chatterbox on capable hardware — the emotion plumbing is already in place end to end.
- **A real user system** (signup, roles, password hashing) and a database, when it leaves one laptop.
- **More mining** — the pipeline is reusable: feed it next quarter's calls and the archetypes, objections, and benchmarks refresh.
- **Hindi / Hinglish voice** — the real students code-switch constantly; the text simulation already does, the voices don't.
- **Manager review flow** — let admins annotate reports with their own comments next to the AI's.
- **Curriculum of drills** — chain the recommended drills into a structured improvement program per counsellor.

---

## 9. Where everything lives

```
server/            the API + the simulation/scoring/report engine
server/data/       all stored data (users, personas, courses, rubrics, sessions, reports)
server/data/seed/  the distilled real-call knowledge (the app's "experience")
client/            the React app (admin console, counsellor app, the call screen)
voice-server/      the Python voice sidecar (TTS, STT, delivery analysis)
scripts/           mining pipeline, course scraper, validators, API smoke test
docs/superpowers/  the design spec and the six build plans (the full paper trail)
CLAUDE.md          the technical orientation file (commands, architecture, conventions)
CONTRACT.md        the precise API/data-shape reference
```

*Built June 2026, locally, on top of 216 real counselling calls.*
