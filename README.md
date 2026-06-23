# Mock Counselling Training Platform

A practice gym for sales counsellors. Instead of risking real prospective students, a counsellor gets on a live call with an **AI that role-plays a realistic prospective learner** — one who has a backstory, real worries, a mood, and a decision to make. The counsellor tries to understand the student, pitch the programme, handle objections, and close. When the call ends, the platform automatically grades the conversation and hands back a detailed, coaching-style report.

Think of it as a flight simulator for counsellors: realistic, repeatable, safe to fail in, and graded by an expert that never gets tired.

> The simulated programme in this build is the **IIM Ranchi × Masai "Executive Certification in Business Analytics & AI"** (plus a wider catalog of ~15 courses). Everything — the AI student's worries, the rubric, the integrity checks — is calibrated around how real counselling calls for these programmes actually go.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Who uses it — the two roles](#2-who-uses-it--the-two-roles)
3. [End-to-end journey](#3-end-to-end-journey)
4. [The building blocks (Courses, Personas, Scenarios, Leads, Assignments)](#4-the-building-blocks)
5. [The live call experience](#5-the-live-call-experience)
6. [How the AI student works](#6-how-the-ai-student-works) ⭐
7. [How scoring works (the live score)](#7-how-scoring-works-the-live-score) ⭐
8. [The 5 phases of a call](#8-the-5-phases-of-a-call)
9. [The coaching report explained](#9-the-coaching-report-explained) ⭐
10. [The rubric — every criterion and weight](#10-the-rubric--every-criterion-and-weight) ⭐
11. [The "New Report" — 8-parameter evaluation](#11-the-new-report--8-parameter-evaluation) ⭐
12. [Integrity probes — catching misselling](#12-integrity-probes--catching-misselling) ⭐
13. [Analytics dashboards](#13-analytics-dashboards)
14. [Why we trust the grading (grounded in real calls)](#14-why-we-trust-the-grading)
15. [Glossary](#15-glossary)
16. [Technical appendix](#16-technical-appendix-for-developers)

⭐ = the sections most people ask about.

---

## 1. The big picture

A counsellor's job is hard to learn safely. Every real call is a one-shot chance with a real human lead, and mistakes have real costs. This platform removes that risk by letting counsellors practise against a believable AI student as many times as they want.

What makes it more than a chatbot:

- **The AI student feels real.** It has a name, age, occupation, a "core anxiety," a personality (chatty vs. terse, trusting vs. skeptical), a mood for the day, and a hidden willingness-to-buy that *shifts based on how well the counsellor does*. It only knows what a real prospect would know — it has *not* read the brochure, so the counsellor has to actually explain things.
- **It can be voice or text.** The counsellor can literally speak into their mic and the AI talks back in a natural Indian-English voice (gender-matched to the student), or they can practise by typing.
- **It grades like a senior coach.** After the call, the platform produces a multi-section report: an overall score, a phase-by-phase breakdown, strengths, things to improve, key moments, recommended drills, and (for admins) an integrity check on whether the counsellor over-promised or misled.
- **It's calibrated on real data.** The scoring rubric and the AI's behaviour were mined from **216 real counselling calls**, so "a good answer" means what a good answer actually looks like in the field — not a textbook ideal.

---

## 2. Who uses it — the two roles

There are two kinds of users. Login is pre-seeded (this is a training tool, not a secured product), and the app shows you a different home depending on your role.

### 👩‍💼 Admin (the trainer / manager)
The admin sets up the practice world and watches over the team.

- Builds and edits the **course catalog** (what programmes counsellors pitch).
- Builds the **persona library** (the kinds of students they'll face).
- Creates **assignments** — pairing a counsellor with a course + a persona + a scenario difficulty.
- Edits the **rubric** (what "good" is measured against).
- Manages **integrity probes** (the honesty traps).
- Views **every counsellor's report** and a **team analytics dashboard**.

### 🎧 Counsellor (the trainee)
The counsellor does the practising and reviews their feedback.

- Sees their assigned **mocks** ("My Mocks").
- **Starts a session** — joins by voice or text, talks to the AI student.
- **Gets a report** immediately after each call.
- Tracks their **personal progress** — score trend, skill radar vs. the team average, and a recommended drill targeting their weakest skill.
- Can launch a **drill** — a focused practice session aimed at a specific weakness.

> A counsellor can only see their own sessions and reports. An admin can see everyone's.

---

## 3. End-to-end journey

Here's the whole loop in plain terms.

```
ADMIN SETS UP                 COUNSELLOR PRACTISES              SYSTEM GRADES
──────────────                ────────────────────             ─────────────
Create course        ┐
Create persona       ├──►  Assignment appears in
Configure scenario   │     counsellor's "My Mocks"
Pick rubric          ┘            │
                                  ▼
                          Counsellor clicks "Start"
                                  │
                                  ▼
                          Green Room (briefing) ──►  Join by VOICE 🎙️
                                                     or by TEXT ⌨️
                                  │
                                  ▼
                          Live call with AI student
                          (live transcript + live score)
                                  │
                                  ▼
                          Counsellor clicks "End call"
                                  │
                                  ▼
                                                         Report stub returned instantly,
                                                         full grading runs in background
                                  │                              │
                                  ▼                              ▼
                          Counsellor reviews          Admin sees it in team
                          coaching report             dashboard + analytics
                                  │
                                  ▼
                          "Start drill" on weakness ──► (loops back to a new practice session)
```

---

## 4. The building blocks

Before any practice happens, the admin assembles a few reusable pieces. Understanding these five concepts unlocks the whole product.

### 📚 Course
A **course** is the programme being sold. The catalog ships with ~15 courses across tracks (Analytics & AI, Data Science, Software Development, Cybersecurity, Product Management, etc.). Each course stores everything a counsellor would need to pitch it accurately:

- Name, institute (e.g. *IIM Ranchi × Masai*), category
- Duration, format (live + recordings)
- **Pricing**: total fee, booking/seat-block fee, EMI terms
- Curriculum modules, learning outcomes, eligibility, USPs

The course matters because the AI student is told *only the course name and rough shape* — the counsellor has to supply the real facts (fee, schedule, placement details). If the counsellor gets a fact wrong, the grader notices.

### 🧑 Persona
A **persona** is a reusable *type* of student. There are 6 base categories:
1. Currently studying
2. Recent graduate
3. Working (same field)
4. Working (different field)
5. Non-working
6. Custom

Each persona carries:
- A label and description (e.g. *"Recent graduate from Delhi, anxious about the job market"*)
- A **core anxiety** — the one worry that drives them
- A **personality** measured on four 1–5 sliders (see below)
- A list of **quirks** (small behavioural tics like "keeps mentioning their parent's opinion")

**The four personality sliders (each 1–5):**

| Trait | 1 (low) | 5 (high) |
|---|---|---|
| **Talkativeness** | Very terse, one-line answers, volunteers nothing | Chatty, 3–4 sentences, reacts with feeling and detail |
| **Humour** | Completely serious | Light jokes / self-deprecating remarks now and then |
| **Skepticism** | Trusting, believes reassurances | Hard to convince, questions everything |
| **Formality** | Casual, imperfect English | Polished, correct English |

### 🎭 Scenario
A **scenario** is the specific setup for one assignment — it tunes *how hard the call is*:

- **Difficulty**: easy / medium / hard (overall resistance level)
- **Pushiness (1–5)**: how assertively the student challenges vague answers and demands specifics
- **Hesitancy (1–5)**: how reluctant they are to commit / how much they want to "think about it" or ask family
- Title, situation text, and context notes for the counsellor's briefing

### 🪪 Lead profile & lead card
The platform ships **170 real-call lead descriptions** (PII-free — built from real calls but stripped of personal data). When an admin picks a persona, the system offers 10 matching **lead profiles** to choose from. The chosen one becomes a **lead card** — giving the AI student a real-sounding name and gender. The gender even decides the AI's voice (a female student speaks in the "marin" voice, a male in "cedar").

### 📋 Assignment
An **assignment** ties it all together: *this counsellor* will practise *this course* against *this persona* under *this scenario*, graded by *this rubric*. The admin can also choose whether to **reveal the persona** to the counsellor beforehand (hidden = harder, more realistic). Once created, it shows up in the counsellor's "My Mocks" list.

---

## 5. The live call experience

When a counsellor starts a mock, here's what they actually see and do.

### Step 1 — The Green Room (briefing)
A pre-call lobby that shows:
- The persona's name, category, difficulty, and the scenario situation
- Personality chips (only shown when a trait is notably high or low)
- A couple of the persona's quirks
- A **mic tester** — pick your microphone, see a live level meter
- Two ways in: **"Speak to student"** (voice) or **"Type to student"** (text)

### Step 2 — The live call
The screen has two main areas:

**The Orb (centre stage)** — a glowing sphere that *is* the student, visually:
- It **glows** with your voice level as you speak.
- It **changes colour with the student's emotion**: neutral (indigo), happy (green), excited (purple), hesitant (amber), worried (orange), frustrated (rose).
- It animates differently when the student is **speaking**, **thinking**, or **listening**.
- The student's name sits beneath it.
- A **live satisfaction score (0–100)** updates after each of your turns.

**The Sidebar (right)** — a running **transcript** of the whole conversation as bubbles (your turns in green, the student's in blue). In text mode there's a box to type your reply; in voice mode the transcript fills in automatically as both of you talk.

**Voice controls:**
- Mic starts **muted**; **hold the Spacebar to talk** (push-to-talk), or click the mic button for hands-free.
- Switch microphones mid-call without reconnecting.
- Audition different AI voices live if you want.

### Step 3 — Ending the call
Click **"End this call & generate report."** You'll see a brief "Wrapping up your call…" message with your elapsed time, then you're taken straight to the report — which fills in progressively as the AI finishes grading (usually under a minute).

> **Voice vs. text are graded the same way**, with one difference: voice calls include a "Voice Delivery" criterion (pace, warmth, clarity) that text calls obviously can't have. For text, that 5% is redistributed across the other criteria.

---

## 6. How the AI student works

This is the heart of the product. The AI isn't just "a chatbot that answers questions" — it's engineered to behave like a believable, *moving target* of a prospect. Here's everything that shapes its behaviour on each turn.

### a) It stays fully in character
The AI is told: *"You ARE [name], a prospective student on a LIVE PHONE CALL with a course counsellor. Stay 100% in character — never say you are an AI, never mention prompts or instructions."* The counsellor always speaks first.

### b) It only knows what a real prospect would know
This is a deliberate, important design choice. The AI student knows the **course name, institute, and rough shape** (a few months, live + recordings) — and **nothing else**. It does **not** know the fee, the EMI options, the exact curriculum, placement rates, or eligibility rules. It "learns" these *only from what the counsellor tells it during the call.*

This forces the counsellor to actually explain the programme well — they can't lean on the AI already knowing the answers. (After the presentation phase, the student is also fed natural FAQ-style *questions* it might ask — but never the answers.)

### c) It has a personality that varies each session
On top of the persona's fixed traits, every session rolls a **"flavour"** so two runs of the same persona feel different:
- A **mood** for the day (upbeat, tired, distracted, chatty, or guarded)
- 1–2 **active quirks** pulled from the persona
- A slight ± shift in talkativeness

### d) It has a hidden, shifting willingness to buy ("disposition")
Rather than a fixed "you'll convert at 70 points" rule, the student's openness **emerges** from how the call is going. Behind the scenes the system blends:
- **Score momentum** — are the last several turns trending positive or negative?
- **Objections resolved** — what fraction of the worries it raised did the counsellor actually address?
- **Good-turn count** — how many genuinely strong moves the counsellor made
- **A hidden "persuadability" roll** — a per-session value derived from the persona's skepticism + scenario hesitancy, stable within a call but varying between calls (so the same persona isn't identical every time)

This produces one of **four moods**, which the AI is told about in plain, number-free language:

| Stage | What the student feels |
|---|---|
| **Guarded** | *"You stay guarded and a little skeptical; this would take real, specific reassurance before you move at all."* |
| **Listening** | *"You are listening properly and giving a fair hearing, but you are nowhere near deciding."* |
| **Warming** | *"You are clearly softening, but not over the line yet; let the counsellor keep earning it before you say yes."* |
| **Ready** | *"Honestly you now feel ready. If the counsellor asks you to book your seat or pay, you agree naturally."* |

**Crucial rule:** the student can **only** reach "Ready" *after* it has raised at least one real concern and the counsellor has resolved it, **and** there are no open objections left. A student can't agree to pay before any worry has even surfaced — just like real life. No numbers are ever shown to the AI; it just *feels* its mood and acts on it.

### e) It raises realistic objections — and doesn't loop
The student brings up genuine worries at natural moments — fees, family approval, time commitment, job/placement guarantees, trust. These are tracked by **category** (fee, EMI affordability, parents/family, time, trust/legitimacy, job guarantee, course fit, language, tech access, and more). A built-in **"pivot rule"** stops the student from nagging: once it raises a concern and the counsellor moves on, it engages the new topic instead of circling back endlessly. If the counsellor dodges, the worry stays "open."

### f) It sounds Indian and human (voice mode)
In voice calls the AI is given detailed delivery instructions, re-injected periodically so it never drifts:
- **Authentic Indian-English accent**, syllable-timed, that must sound the same at minute 20 as minute 1
- **Slower pace** (~90–115 words/min), natural pauses and the occasional "umm…" before a hard question
- A light **Hindi particle** every couple of turns (*haan, thoda, achha, matlab, na*) — particles only, never full Hindi sentences (unless the counsellor switches to Hindi)
- Calls the counsellor **"sir" or "ma'am"** every few sentences
- Keeps turns short (10–25 spoken words) — never monologues

### g) It carries one honesty "trap" (integrity probe)
Each session, the student is secretly assigned **one** loaded question to slip in naturally — e.g. *"Can you guarantee I'll get a job — like a 20 LPA package?"* The AI is told to ask it once, casually, without revealing it's a test. The counsellor's answer is later judged for honesty. (Full detail in [§12](#12-integrity-probes--catching-misselling).)

---

## 7. How scoring works (the live score)

Every counsellor turn is scored **the moment it happens**, on a scale from **−10 to +10**. These per-turn scores feed the live satisfaction meter and the student's mood, and they're summarised into the "score arc" you see in the report.

### The golden rule: 0 is normal, not bad
The scale is calibrated so that **0 means "an ordinary, competent thing to say at this moment."** Most turns score 0 — and that's fine. You only move off 0 when you do something notably good or notably weak. Crucially, **the system never penalises you for *not* doing something** (not mentioning a benefit, not setting a next step) as long as what you *did* say was sound.

### What the numbers mean

| Score | Meaning | Example |
|---|---|---|
| **+8 to +10** | Rare, textbook-perfect move | A masterful close of a genuinely difficult call |
| **+5 to +7** | Outstanding move | Breaks the fee into seat-block-now + EMI; offers to bring a parent onto the call; screen-shares live proof and lands a concrete next step |
| **+3 to +4** | Strong — directly addresses a concern with specifics + empathy | Explains the real refund terms; gives concrete placement stats with eligibility; breaks down the fee clearly |
| **+2** | Gives a concrete, correct, relevant answer to what the student just asked | A specific fee figure, the real schedule, a straight yes/no with a reason |
| **+1 to +2** | Good craft in early phases | Warm rapport-building open; a real open question that gets the student talking; tailoring a point to *this* student |
| **0** | Ordinary / expected | Plain explaining, a routine question, a normal acknowledgement. Pure filler ("ok", "hmm", "haan") auto-scores 0. |
| **−1 to −3** | Clearly weak | Vague where specifics were needed; ignores what the student just said; rambling brochure-dump |
| **−4 to −6** | Notably bad | Pressure tactics on a hesitant student; dismissing a stated concern; fake urgency on a trust objection |
| **−7 to −10** | Rare extremes | Lying, aggressive bullying, browbeating |

### What gets rewarded vs. penalised

**Rewarded (+1 to +3):**
- Decomposing the fee (small seat-block now, balance via EMI) instead of dropping the full figure as a wall
- Quoting a concrete EMI tenure + monthly figure (not a vague "EMI is available")
- Inviting a parent onto the call to discuss fees/approval
- Offering a live screen-share / dashboard as proof of curriculum, placement, or payment flow
- **Genuine** selectivity framing ("limited seats, X shortlisted from Y") — this is an honest tactic and is *approved*

**Penalised (−2 to −5):**
- **Fake urgency** — invented deadlines ("today is the last day") used to pressure rather than inform
- **Fabricated scarcity** — made-up seat counts or price hikes that aren't true
- Talking past / ignoring the specific objection the student just raised
- Repeatedly asking for payment after the student has deflected and still has open worries (the *first* payment ask is a normal, fine selling move; pushy repetition is what gets dinged)

### Fairness guardrails
- **Speech-to-text noise isn't penalised.** If the transcription garbles a name or produces gibberish, that turn is scored neutral (0) — you're judged on substance, not the microphone.
- **Wrong names/places from STT** are ignored; the grader scores what you meant.

> All of this leniency is tunable via a config file, so the platform can be made stricter or gentler without changing code.

---

## 8. The 5 phases of a call

Every call is understood as moving through **five phases**. The order is natural, not rigid — the system detects phase transitions from how the conversation actually flows (message counts + key phrases), and tracks **milestones** (discovery done, presentation done, payment asked, objections raised) independently.

| # | Phase | What should happen | What's rewarded / penalised here |
|---|---|---|---|
| **1** | **Opening** | Greeting, light agenda-setting, building rapport | Warm, personal open = small positive; hard-pitching immediately = small negative |
| **2** | **Discovery** | Asking about the student's background, goals, constraints, family situation | Real open questions that get them talking = positive; brochure-dumping before understanding them = negative |
| **3** | **Presentation** | Explaining the programme — modules, format, fees — *tied to this student* | Clear explaining = neutral/0; tailoring to what they told you = positive; a 100-word generic dump = negative |
| **4** | **Objections & Negotiation** | Student pushes back; counsellor addresses concerns | Addressing a specific objection with facts + empathy = big positive (+3/+4); dismissing it = serious fault |
| **5** | **Close** | A clear, low-pressure next step or payment ask | Concrete next step without bullying = good; badgering a student who already declined = serious fault |

The report later gives a **phase-by-phase breakdown** so the counsellor sees exactly where in the call they were strong or weak.

---

## 9. The coaching report explained

When a call ends, a **stub report** appears instantly (with the things we already know — the transcript, the live score arc, the benchmarks), and the AI grading fills in the rest in the background. The counsellor's report page polls until it's complete.

Here's everything a finished report contains:

| Section | What it tells you | Who sees it |
|---|---|---|
| **Overall** | A score out of 100, a band (**Excellent / Good / Needs Work**), an outcome (**Converted / Not Converted**) with a one-line reason, and a headline focus for next time | Everyone |
| **Rubric breakdown** | Each of the 8 skills scored 1–10 with a justification (see [§10](#10-the-rubric--every-criterion-and-weight)) | Everyone |
| **Phase breakdown** | For each of the 5 phases: a summary, what you did well, and what to improve | Everyone |
| **Strengths** | 2–3 coaching points with short quotes from your own words | Everyone |
| **Improvements** | 2–3 things to work on, each with a quote and concrete advice | Everyone |
| **Key moments** | 2–4 pivotal turns flagged as your **best** moves or **misses**, with why they mattered | Everyone |
| **Drills** | 2–3 targeted practice exercises aimed at your weakest skills — each launchable as a new mock | Everyone |
| **Persona concerns addressed** | The specific worries the student had, and whether each was **fully / partially / not** addressed, with evidence quotes | Everyone |
| **Score arc** | The live satisfaction score plotted across the whole conversation | Everyone |
| **Benchmarks** | Your call length vs. the median paid-call length; whether you made a payment ask; how often top calls do | Everyone |
| **Persona card** | A snapshot of who you were talking to (traits, scenario, difficulty) | Everyone |
| **New Report** | A second, independent 8-parameter evaluation (see [§11](#11-the-new-report--8-parameter-evaluation)) | **Admin only** |
| **Integrity check** | Did you answer the honesty trap honestly, or over-promise / mislead? (see [§12](#12-integrity-probes--catching-misselling)) | **Admin only** |

### How the overall score is computed
Each rubric criterion is scored 1–10, multiplied by its weight, and summed into a percentage:
- **≥ 75% → Excellent**
- **50–74% → Good**
- **< 50% → Needs Work**

> **Reliability note:** the report is produced by several AI calls running in parallel. If a non-essential part fails, the report is still delivered and simply marked "partial." If the core grading fails entirely, a neutral fallback is returned and flagged so it can be regenerated. The counsellor is never left with a blank page.

---

## 10. The rubric — every criterion and weight

This is the official scorecard. It was **anchored to 216 real counselling calls**, so each level describes what real counsellors actually do. The default rubric ("Grounded v2") has **8 criteria**. (Admins can create custom rubrics, but this is the shipped default.)

| Criterion | Weight | What it measures | What a 1/10 looks like | What a 10/10 looks like |
|---|---|---|---|---|
| **Rapport & Opening** | 10% | Warmth, name use, agenda-setting at the start | Breaks trust, wrong name, disjointed open | Hands the student the wheel first, shares a relatable backstory, builds connection around their profile |
| **Needs Discovery** | 15% | How well you uncover the student's goals, constraints, and context *before* pitching | Never finds out what they need; pitches blind | Probes goals, family context, and financial capacity early — deep discovery before the first pitch |
| **Programme Presentation** | 15% | Clarity, structure, and relevance of how you explain the course | Jumps straight to fees with no overview | A structured walkthrough of modules, projects, faculty, placement — tied to the learner's goal |
| **Objection Handling** | 20% | How you respond to push-back (the heaviest-weighted skill) | Dismisses or steamrolls concerns | Defuses with evidence (step-by-step placement, mentor profiles, lower-priced pivots); pre-empts objections before they're spoken |
| **Product Knowledge & Accuracy** | 15% | Whether the facts you state are correct | States false things (wrong institute, fake scholarship) | Full fee disclosed cleanly; attendance/recording/EMI policies accurate; transparent placement criteria |
| **Closing & Payment Ask** | 10% | Whether you land a clear, well-timed, low-pressure next step | Coercion — invents scarcity, threatens to close the app | Concrete next step (seat link with expiry, a callback time) that keeps momentum without bullying |
| **Communication & Empathy** | 10% | Tone, patience, and validation | Talks down to the student, judgmental | Actively validates, patiently untangles confusion, reads the human moment |
| **Voice Delivery** *(voice calls only)* | 5% | Pace, warmth, clarity of speech | Disjointed, rushed, robotic, unintelligible | Well-paced, warm, deliberate, with pauses that give the student space |

> **For text sessions**, the Voice Delivery 5% is removed and its weight is spread across the other criteria, so text and voice scores stay comparable.

---

## 11. The "New Report" — 8-parameter evaluation

This is an **additional, independent** grade that runs alongside the main rubric (admin-only). Where the main rubric scores 1–10, the New Report scores **eight parameters from 0 to 5**, then scales the total to a percentage. It exists as a second, human-calibrated opinion on the same call.

**The eight parameters:**

1. **Rapport & Opening** — greeting warmth, name usage, agenda clarity
2. **Needs Discovery** — depth of background / goal / constraint discovery
3. **Programme Presentation** — clarity, structure, relevance to the learner
4. **Objection Handling** — responsiveness to concerns with specifics + empathy
5. **Product Knowledge** — breadth and confidence on curriculum, format, placement, fee/EMI (*confidence, not perfection*)
6. **Closing & Payment Ask** — clarity, timing, and pressure level of the close
7. **Communication & Empathy** — clarity, warmth, responsiveness throughout
8. **Personalised Experience** — how well every point was tied to *this* learner's profile and goals

**What the 0–5 scale means:**

| Score | Meaning |
|---|---|
| **5** | Done well and consistently throughout (this is allowed — not "superhuman") |
| **4** | Done well, clearly above adequate |
| **3** | Handled competently — the **default for a normal call**. Minor flaws (a mispronounced name, some monologuing, a fast pace) do *not* pull you below 3 |
| **2** | Clearly below par — a real gap |
| **1** | Barely attempted or mostly wrong |
| **0** | Absent / not attempted |

**Why calibration matters:** experienced *human* graders typically score a normal good call around **3.3–3.6 per category (~65–75% overall)**. Earlier versions of the AI were too harsh (by ~25 points), so each parameter now carries a small **calibration offset** (measured against human graders) that nudges the AI's raw scores onto the human scale. For example, Product Knowledge and Communication each get a +1.2 adjustment, Objection Handling +0.9, and so on. The result lands where a fair human coach would land.

> One important nuance baked in: a **wrong fee figure alone is *not* "misselling."** Only outright false guarantees (a guaranteed job, a guaranteed refund that doesn't exist) cap the knowledge score — honest mistakes are treated as honest mistakes.

---

## 12. Integrity probes — catching misselling

Sales counselling has a real risk: over-promising to close a deal ("yes, you're guaranteed a 20 LPA job!"). The **integrity probe** system is designed to catch exactly that — automatically, on every call.

**How it works:**
1. The platform has a library of **22 active "trap" questions**, each with a documented **ground truth** (what an honest answer must be).
2. At the start of each session, **one** probe is picked (deterministically, so it's consistent for a given session) and secretly handed to the AI student.
3. The student is told to **work that one question in naturally**, once, without revealing it's a test. The student is **never** told the ground truth — only the counsellor's behaviour is being tested.
4. After the call, a dedicated grading pass reads the transcript and judges how the counsellor answered.

**The verdict scale:**

| Verdict | Meaning |
|---|---|
| **honest** | Gave the truthful, accurate answer |
| **evasive** | Dodged or deflected without lying |
| **overpromised** | Stretched the truth / over-stated |
| **lied** | Made a clearly false assurance |
| **not_raised** | The student never managed to ask it (no penalty) |

…plus a **severity** rating from 0 (none) to 3 (a clear false assurance with real liability).

**Example probes (with the honest answer):**

| The trap question | The honest truth |
|---|---|
| *"Can you guarantee I'll get a job — like a 20 LPA package?"* | Masai does **not** guarantee any job or salary — only placement *assistance*. Promising it = a lie. |
| *"If I don't like it after a few classes, I get a full refund, right?"* | Per terms, withdrawal means **no refund**. Promising one = a lie. |
| *"The ₹4,000 booking just blocks my seat and I get it back?"* | The booking amount is **non-refundable** (adjusted into the fee). |
| *"Can I just watch recordings later and still get attendance?"* | Live attendance is required; recordings don't substitute. |
| *"So this is basically an IIT/IIM degree?"* | It's a **certificate, not a degree**. Calling it a degree = a lie. |
| *"Is this scholarship only valid today — does the fee go up tomorrow?"* | Fabricated "today-only" deadlines are misselling. *(But genuine "limited seats" framing is fine.)* |
| *"Are all classes taught directly by the IIT/IIM professors?"* | It's a mix of institute faculty + Masai instructors/mentors. |
| *"The EMI is zero-interest / no-cost with no extra charges?"* | Financing carries interest; "no-cost" without proof = a lie. |

The full library covers ~22 such traps (job guarantees, placement conditions, refunds, certificates vs. degrees, alumni status, campus visits, mentorship limits, assessment retakes, and more). This gives the admin a continuous, automatic read on whether the team is selling honestly.

> Integrity results are **admin-only** — they're stripped out before a counsellor ever sees their report, so the probe stays a fair, blind test.

---

## 13. Analytics dashboards

### Counsellor dashboard (personal)
- **Your progress**: average score %, current band, and a clickable trend line of your last 5 reports
- **Recommended drill**: auto-generated from your latest report's weakest skill — one tap to start practising it
- **Skill radar**: your average on each rubric skill (1–5) drawn against the **team average**, so you can see where you lead or lag
- **Pending mocks**: how many assignments are waiting
- **Recent reports**: your last few sessions at a glance

### Admin dashboard (team)
- **KPI cards**: total mocks completed, team average score (with trend), completion rate
- **Recent reports**: the latest completed sessions across everyone
- **Team rubric heatmap**: a grid of counsellors × skills, coloured by performance — instantly shows team-wide weak spots
- **Weekly score trend**: team average over time
- **Objection hot-spots**: which objection categories get drilled most (e.g. fee > time > EMI)
- **Counsellors table**: each person's mock count, average %, recent trend, and weakest skill — sortable

> Reports still being generated are **excluded** from these averages, so the numbers never get skewed by half-finished calls.

---

## 14. Why we trust the grading

The whole platform's credibility rests on one thing: the AI isn't making up its standards. It's grounded in real evidence.

- **216 real counselling calls** were mined (with personal data stripped out) to build the reference material.
- The **rubric levels** quote real moments from those calls — so "a 10 on rapport" means what a top counsellor actually did, not a textbook ideal.
- The AI student's **voice, objections, and texture** are drawn from how real prospects actually talk (170 PII-free lead profiles, real objection patterns, real phrasing).
- The grader's **calibration** is checked against human coaches and adjusted so its scores land where a fair human would land — neither too harsh nor too generous.

The result: practice that feels real, and feedback a counsellor can actually trust and act on.

---

## 15. Glossary

| Term | Plain meaning |
|---|---|
| **Mock** | A single practice session (one call). |
| **Persona** | A reusable *type* of student (with personality + a core worry). |
| **Lead card / profile** | A real-sounding name + identity layered onto a persona for one session. |
| **Scenario** | The difficulty settings for one assignment (difficulty, pushiness, hesitancy). |
| **Assignment** | The instruction pairing a counsellor + course + persona + scenario. |
| **Disposition** | The student's hidden, shifting willingness to buy (guarded → listening → warming → ready). |
| **Objection** | A worry the student raises (fee, family, time, placement, etc.), tracked as open or resolved. |
| **Satisfaction score** | The live 0–100 meter showing how the call is going. |
| **Rubric** | The 8-skill scorecard the report grades against. |
| **Integrity probe** | A secret honesty-trap question planted in the call. |
| **Drill** | A focused practice session targeting one specific weakness. |
| **Phase** | One of the 5 stages of a call (Opening → Discovery → Presentation → Objections → Close). |

---

## 16. Technical appendix (for developers)

*Everything above is the product. This section is the short version of how it's built — see `CLAUDE.md` and `CONTRACT.md` for the authoritative, detailed engineering docs.*

### Shape of the codebase
Two independent npm packages, no root `package.json`:
- **`server/`** — an Express (ESM) API with a JSON-file data store. Holds the conversation engine, scoring, phase machine, and report generator.
- **`client/`** — a React 19 + Vite + react-router v7 SPA, styled with Tailwind v4. Provides the admin and counsellor UIs and the live-call experience.

There is also a **`supabase/`** stack (Edge Functions, Postgres, RLS) — the platform is mid-migration from the local Express+JSON server to a deployed Supabase backend; both exist in the repo.

### The AI
- The "analytics brain" (scoring, cues, objection tracking, phase, and the report) is **Claude (Sonnet 4.6)** via the official Anthropic SDK. It runs in two modes: a cheap **fast** mode (student replies, per-turn scoring) and a **reasoning** mode (the report and richer cues). Structured outputs are JSON-schema-enforced.
- **Voice** is **OpenAI's Realtime API** (speech-to-speech over WebRTC). The browser gets a short-lived ephemeral token; the real OpenAI key never reaches the client. Voices are gender-matched (marin/cedar).

### Key server modules
| File | Responsibility |
|---|---|
| `index.js` | Wires up the REST API |
| `store.js` | Atomic JSON file store under `server/data/*.json` |
| `engine.js` | Builds the student's prompt and generates replies (with a coherence + anti-loop guard) |
| `scoring.js` | Per-turn −10..+10 scoring → live satisfaction score |
| `phases.js` | The 5-phase machine + milestone tracking |
| `disposition.js` | The emergent guarded/listening/warming/ready mood model |
| `report.js` | The parallel LLM fan-out that produces the full report |
| `prompt.js` / `realtime.js` | Compose the text and voice student prompts |
| `integrityProbes.js` | The honesty-trap library and per-session picker |
| `objections.js` / `cues.js` | Objection lifecycle tracking and live steering |

### Running it locally
```bash
# Server (port 3001) — needs ANTHROPIC_API_KEY + OPENAI_API_KEY in a repo-root .env
cd server && npm install && npm start        # or: npm run dev

# Client (Vite dev server, proxies /api -> :3001)
cd client && npm install && npm run dev

# Tests / smoke checks
node --test server/tests/*.mjs               # server unit tests
node scripts/smoke-api.mjs                    # end-to-end API smoke test
```

### How a single chat turn flows (text sessions)
On `POST /api/sessions/:id/message`: advance phase → score the counsellor's message → append to the transcript → generate the student's reply → re-check phase → register any new objection → compute a live coaching cue. For **voice** sessions the equivalent runs via `POST /api/sessions/:id/observe` after each completed spoken turn-pair. On `POST /api/sessions/:id/end`, a stub report is saved instantly and the full grading runs as a background job.

> For the authoritative API shapes, data models, routes, and design tokens, see **`CONTRACT.md`**. For architecture and conventions, see **`CLAUDE.md`**.
