# BUILD CONTRACT — Mock Counselling Trainer

This is the single source of truth for the revamp build. Every agent MUST follow it
exactly: API shapes, data shapes, routes, design tokens, UI-kit props, and file ownership.
Do not invent new endpoints, prop names, or routes. If something is missing, match the
existing patterns and keep it minimal.

---

## 1. Design system (Tailwind, Monexa-inspired)

**Aesthetic:** light, airy, generous whitespace, soft shadows, `rounded-2xl` cards, thin
`border-slate-200` borders, one indigo accent. Calm, modern SaaS dashboard. Inter font.

**Tailwind theme tokens (already configured in `tailwind.config.js`):**

| Token | Value | Use |
|---|---|---|
| `bg-canvas` | `#F6F7F9` | app background |
| `bg-surface` / `bg-white` | `#FFFFFF` | cards, panels |
| `border-line` | `#E8EAED` | borders/dividers |
| `text-ink` | `#0F172A` (slate-900) | primary text |
| `text-muted` | `#64748B` (slate-500) | secondary text |
| `brand` (50–900) | indigo scale, `brand-600 #4F46E5` | accent, primary buttons, active nav |
| `success` | emerald-500 `#10B981` | good score |
| `warn` | amber-500 `#F59E0B` | mid score |
| `danger` | rose-500 `#F43F5E` | low score |

**Conventions:**
- Cards: `bg-white rounded-2xl border border-line shadow-sm p-5` (or `p-6`).
- Primary button: `bg-brand-600 text-white hover:bg-brand-700 rounded-xl`.
- Page padding handled by layout; pages render content directly.
- Use the UI kit (`src/ui/*`) — do NOT re-implement buttons/cards/inputs inline.
- Icons: use inline SVG or simple emoji already used in the app; do NOT add an icon library.
- Score color helper: `scoreColor(n)` in `src/lib/format.js` → returns `'success'|'warn'|'danger'`.

---

## 2. Data shapes (server JSON store)

```
User      { id, name, email, password, role: "admin"|"counsellor", avatarColor }
Persona   { id, name, category, label, coreAnxiety, behaviourPrompt, description,
            personality: { talkativeness:1-5, humour:1-5, skepticism:1-5, formality:1-5, quirks:[string] },
            createdAt, updatedAt }
Scenario  { title, difficulty: "easy"|"medium"|"hard", situation, contextNotes }   // embedded in assignment/session
Course    { id: "course-<8hex>", slug: "<institute>/<course>", name, category,    // one of the 9 domain keys
            institute,                       // "IIM Ranchi", "IIT Patna", ...
            partner: "Masai School",
            duration, format,                // "6 months", "Online" / "Online + campus immersion"
            feeTotal: number|null,           // ₹ total programme fee
            feeBooking: number|null,         // ₹ seat-block / booking amount
            feeNote: string,                 // free text: GST, upfront-vs-EMI nuance
            emiNote: string,
            curriculum: [string],            // module titles
            outcomes: [string], eligibility: string, usps: [string],
            batchInfo: string, sourceUrl, scrapedAt, active: true }
RubricTemplate { id, name, description,
            criteria: [{key, label, weight, anchors: {"1".."5": string}}],
            isDefault: boolean, createdAt, updatedAt }
            // weights must sum to 100 (±1e-6); at least 3 criteria required.
            // Seeded default: "Grounded v2" (id: rt-grounded-v2), 8 criteria:
            //   rapport (10), discovery (15), presentation (15), objections (20),
            //   knowledge (15), closing (10), communication (10), voice_delivery (5).
            // voice_delivery is graded only in voice sessions (has deliveryMetrics);
            //   weights are renormalized to 100 when it is excluded (text sessions → 7 graded criteria).
Assignment{ id, counsellorId, personaId, personaPromptOverride|null, scenario:Scenario,
            courseId,                        // required; references Course.id
            rubricTemplateId: string|null,   // null ⇒ use the default template at session start
            revealPersona: boolean,          // default true; false = "blind call" (GreenRoom hides persona card)
            status: "assigned"|"in_progress"|"completed", createdBy, createdAt, sessionId|null, reportId|null }
Session   { id, assignmentId|null, counsellorId, mode:"assigned"|"practice",
            sessionMode:"voice"|"text",      // resolved at start from the body `mode` field ("text" explicit → "text"; all else → "voice")
            voiceEngine:"openai"|"text",     // "openai" for voice sessions, "text" for text sessions; old sessions may carry "classic"|"elevenlabs" — read fail-soft
            openaiVoice: string,             // the auditioned/gender-matched OpenAI voice key (e.g. "marin", "cedar", "auto")
            personaSnapshot:{name,category,label,coreAnxiety,behaviourPrompt,voiceName?,voiceGender?,personality?},
            personalityFlavour: { mood, activeQuirks:[string], talkativeness, humour, skepticism, formality, notes },
            voice:{key,name,gender},         // student identity picked at start (server/voices.js); drives display name + OpenAI gender-match
                                             // NOTE: elevenLabsVoiceId is absent (removed with the classic/ElevenLabs engines)
            counsellorAddress:"sir"|"ma'am"|null,  // inferred from counsellor's first name at session start; null = ambiguous
            leadCard:{profileId,name,gender,age,occupation,education,city}|null,  // resolved from profileId at start; null for bare-persona sessions
            scenarioSnapshot:Scenario,       // Scenario may carry pushiness:1-5 and hesitancy:1-5 sliders (neutral 3)
            courseSnapshot:Course|null,      // full Course record snapshotted at session start
            rubricSnapshot:{templateId,name,criteria}|null,  // snapshotted at session start from assignment or default
            promptSnapshot:string,           // composed student system prompt at session start (phase 1, score 50, no turn hint)
            milestones:{ discoveryDone:bool, presentationDone:bool, paymentAsked:bool, objectionsRaised:number },
            objectionState:[{ category, status:"open"|"addressed", firstRaisedTurn, lastRaisedTurn, addressedTurn|null,
                              timesRaised, lastPhrasing:string|null }],
            //   objection lifecycle tracker (server/objections.js). Seeded empty at start; fail-soft to []
            //   for sessions created before it existed. category ∈ the 11 objection keys (fee, emi_affordability,
            //   parents_family, time_commitment, competing_priorities, trust_legitimacy, job_guarantee_placement,
            //   course_fit_relevance, language_english, tech_access) + "other".
            //   lastPhrasing: last verbatim text the student used for this objection; prompt bans its re-use.
            //   Loop-break nudge fires at timesRaised >= 2.
            currentPhase:1..5, satisfactionScore:0..100,
            lastTurnVerbosity:"open"|"short"|null,  // per-turn verbosity override rolled server-side each
            //   counsellor turn (probability of "open" scales with personality talkativeness; phase 3 forces
            //   "short" unless turnType==="invite"; never two "open" in a row). null on pre-roll/old sessions.
            scoreHistory:[{turn,score,adjustment,reason}],
            transcript:[{role:"counsellor"|"student", text, phase, scoreAfter, ts,
                         turnType?, scoreReason?, deliveryMetrics?,  // counsellor entries
                         emotion? }],                                  // student entries
            status:"active"|"ended", startedAt, endedAt|null }
Report    { id, sessionId, assignmentId|null, counsellorId, counsellorName, personaName, scenarioTitle,
            status:"generating"|"ready"|"fallback",  // "generating" while the background LLM job runs;
            //   "ready" on success; "fallback" when Call A failed (neutral placeholder, regenerable:true).
            //   Old reports without this field are treated as "ready".
            partial?: true,                 // set when Call B or C failed but Call A succeeded (sections default to empty arrays/"")
            overall:{ percent:0..100, band:"Needs Work"|"Good"|"Excellent", headline:string,
                      outcome:"Converted"|"Not Converted", outcomeDetail },
            //   headline: "Next session, focus on …" — one punchy sentence from Call B; "" while generating or if B failed.
            rubric:[{key,label,weight,score:1..10,level,justification}],
            // rubric length = number of graded criteria (voice_delivery excluded in text sessions);
            // weights are renormalized so they always sum to ~100.
            phaseBreakdown:[{phase:1..5,name,summary,didWell,toImprove}],
            // exactly 5 entries: Opening, Discovery, Presentation, Objections & Negotiation, Close.
            strengths:[{point,quote}], improvements:[{point,quote,suggestion}],
            keyMoments:[{turn:number, type:"best"|"miss", note:string}],
            drills:[{title, focusCriterion, objectionCategory, instruction}],
            benchmarks:{ sessionMinutes:number|null, medianPaidMinutes:number|null,
                         paymentAskSeen:boolean, paymentAskNormPct:number|null },
            scoreArc:[{turn,score}],
            transcript: (copy of session.transcript — persisted immediately in the stub),
            finalScore: number|null,        // session.satisfactionScore at end time — persisted in the stub
            generatedAt }
            // Legacy reports (pre-v2, no rubricSnapshot) use the fixed 6-criterion rubric:
            //   rapport(15), discovery(20), objections(25), knowledge(15), closing(15), communication(10).
```

**Rubric criteria:** Rubrics are now template-driven. The seeded default template "Grounded v2"
(`rt-grounded-v2`) has 8 criteria mined from 216 real counselling calls, each with
behaviour-anchored scoring levels (1 Poor · 2 Developing · 3 Competent · 4 Proficient · 5 Excellent):
`rapport` (10), `discovery` (15), `presentation` (15), `objections` (20), `knowledge` (15),
`closing` (10), `communication` (10), `voice_delivery` (5 — voice sessions only).
Band by percent: `<50` Needs Work · `50–74` Good · `≥75` Excellent.
Legacy reports without a `rubricSnapshot` use the fixed 6-criterion list noted above.

---

## 3. REST API (base `/api`, proxied by Vite to :3001)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/login` | `{email,password}` | `{user}` or 401 `{error}` |
| GET | `/counsellors` | — | `[{id,name,email,role,avatarColor}]` |
| GET | `/personas` | — | `[Persona]` |
| POST | `/personas` | `{name,category,label,coreAnxiety,behaviourPrompt,description,personality?}` | `Persona` |
| PUT | `/personas/:id` | partial Persona (incl. personality) | `Persona` |
| DELETE | `/personas/:id` | — | `{ok:true}` or 409 if active (non-completed) assignments reference this persona |
| GET | `/courses` | — | `[Course]` (supports `?active=1` to filter active only) |
| POST | `/courses` | `{name,institute,category?,duration?,format?,feeTotal?,feeBooking?,feeNote?,emiNote?,curriculum?,outcomes?,eligibility?,usps?,batchInfo?,sourceUrl?,active?}` | `Course` |
| PUT | `/courses/:id` | partial Course (name/category/institute/duration/format/feeTotal/feeBooking/feeNote/emiNote/curriculum/outcomes/eligibility/usps/batchInfo/active) | `Course` |
| DELETE | `/courses/:id` | — | `{ok:true}` |
| GET | `/rubric-templates` | — | `[RubricTemplate]` |
| POST | `/rubric-templates` | `{name,description,criteria}` (weights must sum to 100; ≥3 criteria; `isDefault` always false for created templates) | `RubricTemplate` |
| PUT | `/rubric-templates/:id` | partial RubricTemplate (name/description/criteria; `isDefault` changes ignored) | `RubricTemplate` |
| DELETE | `/rubric-templates/:id` | — | `{ok:true}` or 400 if `isDefault`; 409 if active (non-completed) assignments use this template |
| GET | `/assignments?counsellorId=` | — | `[Assignment + {personaName,counsellorName,hasReport}]` (omit query ⇒ all) |
| POST | `/assignments` | `{counsellorId,personaId,courseId,rubricTemplateId?,personaPromptOverride?,scenario,revealPersona?}` (`courseId` required; `rubricTemplateId` optional, must exist if provided; `revealPersona` boolean, default true) | `Assignment` |
| GET | `/assignments/:id` | — | enriched `Assignment` |
| DELETE | `/assignments/:id` | — | `{ok:true}` or 409 if an active (non-ended) session exists for this assignment |
| POST | `/sessions/start` | `{mode:"voice"\|"text", counsellorId, assignmentId?, personaId?, scenario?, courseId?, openaiVoice?, profileId?}` (`mode:"text"` selects the text engine; all other values (including omitted) default to `"voice"` (OpenAI Realtime). `courseId` optional; assigned sessions inherit from assignment. `openaiVoice` optional voice key. `profileId` optional lead-profile id.) | `{sessionId, firstMessage, emotion, currentPhase, satisfactionScore, milestones, voice, voiceEngine, openaiVoice, sessionMode, revealPersona, leadCard}` — 409 if an active session already exists for this assignment (duplicate-start lock per assignmentId) |
| POST | `/sessions/:id/message` | `{message, deliveryMetrics?, thinking?}` | `{reply, emotion, currentPhase, satisfactionScore, scoreReason, turnType, milestones, cue}` (409 if session ended; text sessions only; SSE when `Accept: text/event-stream` — see below) |
| POST | `/sessions/:id/cue` | — | `{cue, source}` — richer on-demand coaching cue: one deterministic LLM call (`llmCue`) over recent context, falling back to the synchronous corpus `instantCue` on any failure/timeout. `source` ∈ `"llm"\|"corpus"`. Admin/counsellor-agnostic (no auth layer). |
| POST | `/sessions/:id/end` | — | `{reportId, status:"generating"\|"ready"\|"fallback"}` — immediately returns after persisting a stub; report fills in the background. Idempotent: re-calling while `status:"generating"` returns the same `reportId`; re-calling on a `"fallback"` or stale `"generating"` stub (server restart) re-kicks generation. |
| GET | `/sessions/:id` | — | `Session` |
| GET | `/sessions/:id/prompt` | — | `{studentSystemPrompt, scoringPrompt, reportPrompt}` (composed, current; admin-only at UI layer) |
| DELETE | `/sessions/:id` | — | `{ok:true}` (test/admin cleanup) — 409 if session is still active (end it first) |
| GET | `/reports` | `?counsellorId=` and/or `?sessionId=` (both optional; omit for all) | `[Report]` sorted newest first |
| GET | `/reports/:id` | — | `Report` — 403 if requester is a non-admin counsellor who doesn't own this report (X-User-Id header; absent = back-compat allow) |
| DELETE | `/reports/:id` | — | `{ok:true}` (test/admin cleanup) |
| GET | `/config/prompts` | — | merged prompt-config (`prompt-config.json` over built-in defaults) |
| PUT | `/config/prompts` | prompt-config object | merged prompt-config (persisted; loaders fail soft to defaults) |
| GET | `/config/scoring` | — | scoring-config (`scoring-config.json` over built-in defaults) |
| PUT | `/config/scoring` | scoring-config object | persisted scoring-config (coerced) |

Server owns the transcript: `/sessions/:id/message` appends to the stored session; the client
does NOT send history. `start` for `mode:"assigned"` derives persona+scenario from the assignment
and flips assignment status to `in_progress`; `end` generates the report and sets `reportId` +
status `completed`.

**Ownership guard** (dummy-auth grade): session routes (`GET /sessions/:id`, `/message`, `/observe`, `/end`, `/realtime/openai-token`) and `GET /reports/:id` check the `X-User-Id` request header. Non-admin counsellors are 403'd if the resource belongs to another counsellor. Absent header → back-compat allow (curl/smoke/old clients). `hasReport` on enriched assignments verifies the report record still exists (stale `reportId` after a delete would show a broken link).

**Per-turn pipeline** (`/sessions/:id/message`): 409 ended-session guard FIRST → classify the
counsellor message into `turnType` (`statement`|`question`|`invite`) → push the counsellor
transcript entry (with `turnType` + sanitized `deliveryMetrics`) → roll this turn's
`lastTurnVerbosity` (`open`/`short`; talkativeness-scaled, phase-3 short unless `invite`, never two
`open` in a row) and persist it on the session BEFORE the reply path → run scoring (last-6-turns
window, phase, turnType, courseName) and the student reply CONCURRENTLY (the reply prompt sees the
PRE-message score and the previous turn's `adjustment` as the `lastAdjustment` momentum input — one
turn of satisfaction-band lag in exchange for the reply starting sooner) →
backfill `scoreAfter` + `scoreReason` onto the counsellor entry → resolve the addressed objection
(`scoreMessage.addressedObjection` → `resolveObjection`) → milestone/phase advancement → raise the
student's new objection (`advancePhase` category / `detectObjectionCategory` → `raiseObjection`) →
persist `objectionState` → compute the instant counsellor `cue` (`instantCue`, zero-LLM; receives
the cue v2 context `lastCounsellorAdjustment` + `lastCounsellorScoreReason` + live `objectionState`).
Backchannel acknowledgements (`isBackchannel`) skip the scoring LLM (adjustment 0). The student
reply passes a coherence gate (structural screen + near-deterministic VALID/INVALID check, fails
OPEN): incoherent question/invite turns are regenerated once; incoherent statement turns get a
canned Hinglish acknowledgement. An **anti-loop guard** then rejects a coherent reply that is >0.8
token-overlap similar to any of the last 6 student turns: it regenerates once with a "do not repeat
yourself" note, and on a second loop falls back to a short move-forward acknowledgement. The
trailing `[emotion:X]` tag is always preserved (canned/regen/loop-fallback default to `neutral`).

**Disposition** (replaces the old score-threshold convincement model): before each text reply, and injected into every voice-session realtime instruction via `/observe`, the server calls `computeDisposition(session)` → `{ stage: "guarded"|"listening"|"warming"|"ready", narrative, persuadability }`. Stage emerges from score momentum (last ~6 `scoreHistory` adjustments), objection-addressed ratio, good/bad turn counts, and a hidden per-session `persuadability` (FNV-1a hash of session id blended with persona skepticism + scenario hesitancy). The student prompt receives only the natural-language narrative — NO numbers, no score, no threshold is exposed. `"ready"` demands both a high readiness signal AND no open objections. The old `resistant`/`warming`/`ready` hint strings are still usable via `stageToLegacyHint` for backward compatibility.

**SSE protocol** — `POST /sessions/:id/message` with `Accept: text/event-stream` streams the reply:
- `event: token` / `data: {text}` — raw reply tokens as the model generates them (perceived latency).
- `event: done` / `data: <JSON>` — the canonical result; `data` is **byte-for-byte the same JSON
  object** as the non-SSE response (`reply, emotion, currentPhase, satisfactionScore, scoreReason,
  turnType, milestones, cue`). The coherence/anti-loop gate may have replaced the streamed tokens —
  clients MUST swap in the `done` payload's `reply`/`emotion`.
- `event: error` / `data: {error}` — on failure (includes `LLM_TIMEOUT`).
Non-SSE requests keep today's JSON response shape exactly.

### Voice engine (addendum to §3)

There is now **one voice engine**: OpenAI Realtime speech-to-speech over WebRTC. `session.voiceEngine` = `"openai"` for voice sessions, `"text"` for text sessions. (Old stored sessions may carry `"classic"` or `"elevenlabs"` — read fail-soft; the Session page resumes them as text.)

In voice sessions the live voice/conversation runs browser↔OpenAI for minimal latency (no STT→LLM→TTS hops). Claude Sonnet 4.6 remains the analytics brain: every completed turn pair is POSTed to `/observe`, which runs the same scoring/objection/phase/cue pipeline as `/message` minus reply generation.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/sessions/:id/realtime/openai-token` | `{voice?}` (any valid OpenAI realtime voice key, or `"auto"` for gender-matched default; re-mint to audition live) | `{value, model, voice, expiresAt}` — `value` is an ephemeral `ek_…` client secret for the browser WebRTC peer connection (`POST https://api.openai.com/v1/realtime/calls`, `Content-Type: application/sdp`). The token is pre-loaded with the persona instructions, voice, `input_audio_transcription` (`gpt-4o-mini-transcribe` by default), and `semantic_vad`. |
| POST | `/sessions/:id/observe` | `{counsellorText?, studentText?, deliveryMetrics?}` | `{currentPhase, satisfactionScore, scoreReason, turnType, milestones, cue, steering}` — runs classify+phase+**LLM scoring** on the counsellor text and objection/phase tracking on the student text, appends both to the server-owned transcript. `steering` is a compact plain-text block (disposition narrative + open/answered objections with banned phrasings + current phase + turn-length reminder, ≤~120 words) injected mid-call over the data channel. 409 if ended; serialized per session. |

`deliveryMetrics` in `/observe` arrives with the counsellor turn only and carries the in-browser computed `{ wpm, pauses, energyVar, durationMs }` (+ derived `paceVerdict`/`energyVerdict`/`tone` where available). Stored on the counsellor transcript entry under the same `deliveryMetrics` field as `/message`. `voice_delivery` is excluded and weights renormalized for text sessions (no delivery metrics). OpenAI voices are American-base, instructed to speak natural Indian English; `"auto"` gender-matches (female→`marin`, male→`cedar`) from the session's student profile/persona.

S2S transcript events are POSTed to `/observe` in arrival order through a client-side sequential queue. Server env: `OPENAI_API_KEY` (required), `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE` (female default), `OPENAI_REALTIME_VOICE_MALE`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_VAD_EAGERNESS`.

### Analytics (addendum to §3)

| Method | Path | Returns |
|---|---|---|
| GET | `/analytics/admin` | Admin analytics payload (see shape below) |
| GET | `/analytics/counsellor/:id` | Counsellor analytics payload (see shape below); 404 for unknown user id |

```
GET /api/analytics/admin ->
{ kpis: { mocksCompleted, avgScore, completionRatePct, trendDelta },
  // trendDelta: delta of the trailing window vs the preceding equal-size window (window = min(5, floor(n/2))); null when fewer than 2 reports
  teamHeatmap: { criteria: [{key,label}], rows: [{ counsellorId, counsellorName, cells: {<critKey>: avgScore1to5|null}, reportCount }] },
  // cell null when counsellor has 0 reports containing that rubric key
  weeklyTrend: [{ weekStart: "YYYY-MM-DD", avgPercent, count }],
  // ISO weeks (Monday start) from report.generatedAt; last 8 buckets that have data only
  counsellors: [{ counsellorId, name, mocks, avgPercent, lastFiveDelta, weakestCriterion: {key,label,avg}|null }],
  // lastFiveDelta: delta of the trailing window vs the preceding equal-size window (window = min(5, floor(n/2))); null when fewer than 2 reports
  objectionPerformance: [{ category, label, drillCount }],
  // frequency of drills[].objectionCategory across all reports (descending); label is humanized
  recentReports: [{ id, counsellorName, personaName, percent, band, outcome, generatedAt }] }
  // last 6 by generatedAt

GET /api/analytics/counsellor/:id ->
{ trend: [{ turn: n, percent, generatedAt, reportId }],       // chronological, all own reports
  radar: { criteria: [{key,label}], mine: {<key>: avg1to5|null}, team: {<key>: avg1to5|null} },
  // team = all counsellors avg (anonymous); keys union legacy (6) + v2 (7/8) rubrics
  pendingMocks: n, completedMocks: n, avgPercent,
  recommendedDrill: { title, focusCriterion, objectionCategory, instruction, fromReportId } | null }
  // from the latest report with drills (drills[0]); null if none
```

Computed entirely in-memory from `reports`/`assignments`/`users` stores. No NaN or Infinity in output;
empty store → zeros/nulls/[] per field. Criterion averaging unions rubric keys across all template
versions by key.

**Client API client:** `src/lib/api.js` exports a flat object `api` with one async method per
endpoint, e.g. `api.login(email,password)`, `api.getPersonas()`, `api.createPersona(data)`,
`api.updatePersona(id,data)`, `api.deletePersona(id)`, `api.getCounsellors()`,
`api.getCourses(activeOnly?)`, `api.createCourse(data)`, `api.updateCourse(id,data)`, `api.deleteCourse(id)`,
`api.getRubricTemplates()`, `api.createRubricTemplate(data)`, `api.updateRubricTemplate(id,data)`, `api.deleteRubricTemplate(id)`,
`api.getAssignments(counsellorId?)`, `api.createAssignment(data)`, `api.getAssignment(id)`,
`api.deleteAssignment(id)`, `api.startSession(payload)`, `api.sendMessage(id,message,deliveryMetrics?,thinking?)`,
`api.endSession(id)`, `api.regenerateReport(sessionId)` (re-calls `/end` on a fallback), `api.getSession(id)`,
`api.getOpenAIRealtimeToken(id,voice?)`, `api.observeTurn(id,{counsellorText?,studentText?,deliveryMetrics?})`,
`api.getReports(counsellorId?,sessionId?)`, `api.getReport(id)`, `api.getLeadProfiles(category?)`,
`api.getAdminAnalytics()`, `api.getCounsellorAnalytics(id)`,
`api.getPromptConfig()`, `api.updatePromptConfig(data)`, `api.getScoringConfig()`, `api.updateScoringConfig(data)`,
`api.getSessionPrompts(id)`.
Each throws `Error(data.error)` on non-2xx.

---

## 4. Routing (`src/main.jsx`, react-router-dom v6)

Public: `/login`.
Admin (role `admin`, `AdminLayout`): `/admin` dashboard, `/admin/counsellors`, `/admin/personas`,
`/admin/courses`, `/admin/rubrics`, `/admin/assignments`, `/admin/assignments/new`, `/admin/reports`, `/admin/reports/:id`.
Counsellor (role `counsellor`, `CounsellorLayout`): `/app` dashboard, `/app/mocks`, `/app/practice`,
`/app/session/new` (green room — expects router state `{mode,assignmentId?,...}`), `/app/session/:sessionId`, `/app/reports`, `/app/reports/:id`.
`/` redirects by role. Unauthenticated ⇒ `/login`. `ProtectedRoute` + `useAuth()` live in `src/lib/auth.jsx`.

---

## 5. Auth (`src/lib/auth.jsx`)

`AuthProvider` (wraps app), `useAuth()` → `{user, login(email,password), logout()}`.
`user` persisted in `localStorage` under key `mct_user`. `login` calls `api.login`, stores user,
returns it (throws on failure). `ProtectedRoute({role, children})` redirects to `/login` if no user,
or to the user's home if role mismatches.

---

## 6. UI kit (`src/ui/`) — props contract

All default-exported. Keep them small, presentational, Tailwind-styled per §1.

- `Button({variant="primary"|"secondary"|"ghost"|"danger", size="md"|"sm", as, ...props})`
- `Card({className, children})` and `CardHeader({title, subtitle, action})`
- `Input({label, error, ...input})`, `Textarea({label, rows, ...})`, `Select({label, options:[{value,label}], ...})`
- `Modal({open, onClose, title, children, footer})`
- `Badge({color="brand"|"success"|"warn"|"danger"|"slate", children})`
- `StatCard({label, value, hint, icon})`
- `Avatar({name, color, size})` (initials)
- `Table({columns:[{key,header,render?,className?,sortable?,sortValue?}], rows, onRowClick?})` — columns may be `sortable:true` for click-to-sort with `aria-sort`; uses `sortValue(row)` or cell value for comparison
- `EmptyState({title, hint, action})`
- `Spinner({size})`
- `Sidebar({items:[{to,label,icon}], footer})` (collapsible, active highlight via NavLink)
- `Topbar({title, right})`
- `ScoreMeter({score})` (0–100 horizontal bar, color via scoreColor)
- `DifficultyBadge({level})` (easy/medium/hard → success/warn/danger Badge)
- `ConfirmDialog({open, onClose, onConfirm, title, message, confirmLabel?, variant?})` — confirmation modal with primary/danger variant
- `SearchInput({value, onChange, placeholder?, ...})` — debounced search text input
- `CountUp({value, duration?, decimals?, format?, className})` — animated number counter
- `Modal` now has a **focus trap** (Tab / Shift-Tab cycle within the dialog)
- `useCreateShortcut(onTrigger, {key?, enabled?})` hook — keyboard shortcut (default key `"n"`) for triggering create actions; in `src/ui/useCreateShortcut.js`

---

## 7. File ownership map (`client/src/`)

Foundation (already created): `main.jsx`, `index.css`, `lib/api.js`, `lib/auth.jsx`, `lib/format.js`,
`layouts/AdminLayout.jsx`, `layouts/CounsellorLayout.jsx`, and **stubs** for every file below.
Build agents REPLACE the stub for their assigned file(s) only. Never edit a file you don't own.
Never edit `main.jsx`, `index.css`, `lib/*`, `vite.config.js`, or another agent's file.

```
ui/Button.jsx Card.jsx Input.jsx Textarea.jsx Select.jsx Modal.jsx Badge.jsx
  StatCard.jsx Avatar.jsx Table.jsx EmptyState.jsx Spinner.jsx Sidebar.jsx Topbar.jsx
  ScoreMeter.jsx DifficultyBadge.jsx
pages/Login.jsx
pages/admin/AdminDashboard.jsx Counsellors.jsx Personas.jsx AssignmentCreate.jsx
  Assignments.jsx AdminReports.jsx
pages/counsellor/Dashboard.jsx MyMocks.jsx Practice.jsx Session.jsx Reports.jsx
pages/shared/ReportDetail.jsx
pages/shared/RubricBar.jsx ScoreArcChart.jsx TranscriptView.jsx PhaseStepper.jsx
```

Voice pipeline (`src/voice/*`): now only `useOpenAIRealtime.js` + `engines.js` (the classic pipeline is deleted — see §8).

---

## 8. Voice pipeline (`src/voice/`)

**One engine: OpenAI Realtime speech-to-speech over WebRTC.** The classic browser pipeline
(`useVoiceConversation`, Kokoro-82M TTS, browser whisper-tiny STT, `@huggingface/transformers`,
`@ricky0123/vad-web`) and the ElevenLabs conversational AI pipeline are **deleted**.
The Python voice sidecar (`voice-server/`) is **deleted**; there is no `/tts`, `/stt`, or `/analyze`
endpoint anymore.

`Session.jsx` uses `useOpenAIRealtime` from `src/voice/useOpenAIRealtime.js`. The hook exposes a
`voice`-compatible surface: `{enabled, status, loadPct, error, enable, disable, getAnalyser,
changeVoice, muted, setMuted, sendText, sendSteering}`.

`src/voice/engines.js` holds the OpenAI voice catalog (11 options including `"auto"`) and the
`localStorage` storage key for the preferred voice. No 3-way engine toggle exists.

Delivery metrics computed in-browser: `{ wpm, pauses, energyVar, durationMs }` from VAD speech events
and a mic `AnalyserNode`; forwarded to `/observe` for `voice_delivery` grading.

### Transcript entry fields (addendum to §2 Session shape)

- Student entries: `{ role:"student", text, phase, scoreAfter, ts, emotion?: string }`
- Counsellor entries: `{ role:"counsellor", text, phase, scoreAfter, ts, turnType?: string, scoreReason?: string, deliveryMetrics?: object }`

The `deliveryMetrics` field on counsellor entries (shape: `{ wpm?, pauses?, energyVar?, durationMs?, tone?, paceVerdict?, energyVerdict? }`)
is used by `report.js` to grade the `voice_delivery` rubric criterion (criterion is excluded and
weights renormalized for text sessions or when no metrics are present).
`turnType` (set at append time) and `scoreReason` (backfilled after scoring) are stored on
counsellor entries for transparency and the coach view.

### Real-time counsellor cue (addendum to §3)

`POST /api/sessions/:id/message` response (and the SSE `done` payload) gains `cue:
{ source:"corpus"|"llm", headline:string, points:string[], example:string|null }` — a real-time
counsellor coaching card (synchronous `instantCue`). `POST /api/sessions/:id/cue` returns
`{cue, source}` for a richer on-demand `llmCue` (one deterministic LLM call) with `instantCue`
fallback. The `/observe` response carries the same `cue` field.

### Config files (`server/data/`)

Two admin-editable JSON config files, loaded fail-soft to built-in defaults if missing/corrupt:

- `prompt-config.json` — student-prompt scaffolding: `generalProfile`, `knowledgeBoundsTemplate`,
  `phaseInstructions` (keyed by the 5 phases), `phaseLadder`, `behaviourRules`, `registerNote`,
  `faqIntro`/`faqUsage`, `turnDiscipline`, plus naturalness knobs: `naturalSpeech` + `naturalSpeechCarveOut`,
  `verbosityIntro` + `verbosityFallback`, `registerRefIntro` + `registerRefBackchannelIntro`, `tangentRule`,
  the `convincement` block (`thresholds {easy,medium,hard}`, `effortTurns {easy,medium,hard}`, `readyText`,
  `warmingText`) and `objectionStateHeader` (persistence-pays-off / anti-loop steering),
  and a `guidelines[]` array of plain-English editing guidance shown in the admin UI.
  Served/persisted via `GET/PUT /api/config/prompts`.
- `scoring-config.json` — leniency knobs: `severityBands`, `phaseExpectations` (keyed by the 5
  phases), `backchannelWords`, `neverPenalizeAbsence:true`, `counterMoves`, `recentTurnsWindow`,
  plus `guidelines[]`. Served/persisted via `GET/PUT /api/config/scoring`.

### Single-model note

All LLM calls (chat, scoring, coherence gate, cues, report) use **Claude Sonnet 4.6**
(`claude-sonnet-4-6`) via the official `@anthropic-ai/sdk`; env `ANTHROPIC_API_KEY`, override
`ANTHROPIC_MODEL`. The client lives in `server/llm.js`; `server/ollama.js` is a thin re-export shim
kept so legacy import paths keep working. Two latency modes drive thinking + effort:
`mode:"fast"` (thinking disabled, effort low — student replies, coherence gate, per-turn scoring)
and `mode:"reasoning"` (adaptive thinking, effort high — report calls A/B/C and the `/cue` coaching
card). `temperature` is honoured in fast mode only (it is incompatible with adaptive thinking);
legacy sampling knobs `top_p`/`repeat_penalty` are accepted and silently dropped. Structured output:
scoring, breakdown, cue, and report calls pass a `jsonSchema` option that maps to
`output_config.format` (schema-enforced JSON; `extractJson` remains as the parse step). `chat()`
accepts an options object (`timeoutMs`, `maxRetries`, `mode`, `jsonSchema`, `model` override) and
throws `Error{code:'LLM_TIMEOUT'}` on timeout (45 s chat/scoring, 8 s coherence, 30 s cue, 60 s per
report call attempt); `chatStream()` is the async-generator streaming variant (yields plain text
tokens; thinking deltas are never yielded). `stripThink` survives as a legacy no-op shim for old
`<think>`-format text. In voice sessions Claude is NOT used for the student's spoken replies
(OpenAI Realtime owns those); it remains the analytics brain via `/observe`.
