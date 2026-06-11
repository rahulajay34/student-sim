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
            personaSnapshot:{name,category,label,coreAnxiety,behaviourPrompt,voiceName?,voiceGender?,personality?},
            personalityFlavour: { mood, activeQuirks:[string], talkativeness, humour, skepticism, formality, notes },
            voice:{key,name,gender,elevenLabsVoiceId},  // student TTS voice picked at start (server/voices.js); absent on pre-voice sessions
            scenarioSnapshot:Scenario,
            courseSnapshot:Course|null,      // full Course record snapshotted at session start
            rubricSnapshot:{templateId,name,criteria}|null,  // snapshotted at session start from assignment or default
            promptSnapshot:string,           // composed student system prompt at session start (phase 1, score 50, no turn hint)
            milestones:{ discoveryDone:bool, presentationDone:bool, paymentAsked:bool, objectionsRaised:number },
            objectionState:[{ category, status:"open"|"addressed", firstRaisedTurn, lastRaisedTurn, addressedTurn|null, timesRaised }],
            //   objection lifecycle tracker (server/objections.js). Seeded empty at start; fail-soft to []
            //   for sessions created before it existed. category ∈ the 11 objection keys (fee, emi_affordability,
            //   parents_family, time_commitment, competing_priorities, trust_legitimacy, job_guarantee_placement,
            //   course_fit_relevance, language_english, tech_access) + "other".
            currentPhase:1..5, satisfactionScore:0..100,
            lastTurnVerbosity:"open"|"short"|null,  // per-turn verbosity override rolled server-side each
            //   counsellor turn (probability of "open" scales with personality talkativeness; phase 3 forces
            //   "short" unless turnType==="invite"; never two "open" in a row). null on pre-roll/old sessions.
            scoreHistory:[{turn,score,adjustment,reason}],
            transcript:[{role:"counsellor"|"student", text, phase, scoreAfter, ts,
                         turnType?, scoreReason?,   // counsellor entries
                         emotion? }],                // student entries
            status:"active"|"ended", startedAt, endedAt|null }
Report    { id, sessionId, assignmentId|null, counsellorId, counsellorName, personaName, scenarioTitle,
            overall:{ percent:0..100, band:"Needs Work"|"Good"|"Excellent", outcome:"Converted"|"Not Converted", outcomeDetail },
            rubric:[{key,label,weight,score:1..5,level,justification}],
            // rubric length = number of graded criteria (voice_delivery excluded in text sessions);
            // weights are renormalized so they always sum to ~100.
            phaseBreakdown:[{phase:1..5,name,summary,didWell,toImprove}],
            // exactly 5 entries: Opening, Discovery, Presentation, Objections & Negotiation, Close.
            strengths:[{point,quote}], improvements:[{point,quote,suggestion}],
            keyMoments:[{turn:number, type:"best"|"miss", note:string}],
            drills:[{title, focusCriterion, objectionCategory, instruction}],
            benchmarks:{ sessionMinutes:number|null, medianPaidMinutes:number|null,
                         paymentAskSeen:boolean, paymentAskNormPct:number|null },
            scoreArc:[{turn,score}], generatedAt }
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
| DELETE | `/personas/:id` | — | `{ok:true}` |
| GET | `/courses` | — | `[Course]` (supports `?active=1` to filter active only) |
| POST | `/courses` | `{name,institute,category?,duration?,format?,feeTotal?,feeBooking?,feeNote?,emiNote?,curriculum?,outcomes?,eligibility?,usps?,batchInfo?,sourceUrl?,active?}` | `Course` |
| PUT | `/courses/:id` | partial Course (name/category/institute/duration/format/feeTotal/feeBooking/feeNote/emiNote/curriculum/outcomes/eligibility/usps/batchInfo/active) | `Course` |
| DELETE | `/courses/:id` | — | `{ok:true}` |
| GET | `/rubric-templates` | — | `[RubricTemplate]` |
| POST | `/rubric-templates` | `{name,description,criteria}` (weights must sum to 100; ≥3 criteria; `isDefault` always false for created templates) | `RubricTemplate` |
| PUT | `/rubric-templates/:id` | partial RubricTemplate (name/description/criteria; `isDefault` changes ignored) | `RubricTemplate` |
| DELETE | `/rubric-templates/:id` | — | `{ok:true}` or 400 `{error:"Cannot delete the default template"}` if `isDefault` |
| GET | `/assignments?counsellorId=` | — | `[Assignment + {personaName,counsellorName,hasReport}]` (omit query ⇒ all) |
| POST | `/assignments` | `{counsellorId,personaId,courseId,rubricTemplateId?,personaPromptOverride?,scenario,revealPersona?}` (`courseId` required; `rubricTemplateId` optional, must exist if provided; `revealPersona` boolean, default true) | `Assignment` |
| GET | `/assignments/:id` | — | enriched `Assignment` |
| DELETE | `/assignments/:id` | — | `{ok:true}` |
| POST | `/sessions/start` | `{mode,counsellorId,assignmentId?,personaId?,scenario?,courseId?}` (`courseId` optional; assigned sessions inherit from assignment; fallback to IIM Ranchi BA course) | `{sessionId,firstMessage,emotion,currentPhase,satisfactionScore,milestones,voice}` |
| POST | `/sessions/:id/message` | `{message,deliveryMetrics?}` | `{reply,emotion,currentPhase,satisfactionScore,scoreReason,turnType,milestones,cue}` (409 if session ended; SSE when `Accept: text/event-stream` — see below) |
| POST | `/sessions/:id/cue` | — | `{cue,source}` — richer on-demand coaching cue: one deterministic LLM call (`llmCue`) over recent context, falling back to the synchronous corpus `instantCue` on any failure/timeout. `source` ∈ `"llm"\|"corpus"`. Admin/counsellor-agnostic (no auth layer). |
| POST | `/sessions/:id/end` | — | `{reportId}` (idempotent; regenerates in place when the existing report is a neutral fallback) |
| GET | `/sessions/:id` | — | `Session` |
| GET | `/sessions/:id/prompt` | — | `{studentSystemPrompt, scoringPrompt, reportPrompt}` (composed, current; admin-only at UI layer) |
| DELETE | `/sessions/:id` | — | `{ok:true}` (test/admin cleanup) |
| GET | `/reports?counsellorId=` | — | `[Report]` (summaries ok; omit query ⇒ all) |
| GET | `/reports/:id` | — | `Report` |
| DELETE | `/reports/:id` | — | `{ok:true}` (test/admin cleanup) |
| GET | `/config/prompts` | — | merged prompt-config (`prompt-config.json` over built-in defaults) |
| PUT | `/config/prompts` | prompt-config object | merged prompt-config (persisted; loaders fail soft to defaults) |
| GET | `/config/scoring` | — | scoring-config (`scoring-config.json` over built-in defaults) |
| PUT | `/config/scoring` | scoring-config object | persisted scoring-config (coerced) |

Server owns the transcript: `/sessions/:id/message` appends to the stored session; the client
does NOT send history. `start` for `mode:"assigned"` derives persona+scenario from the assignment
and flips assignment status to `in_progress`; `end` generates the report and sets `reportId` +
status `completed`.

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

**Convincement** (persistence-pays-off): before each reply the server computes a hint
(`resistant`|`warming`|`ready`) from the live score, the per-difficulty `convincement` thresholds
(lowered defaults: easy 55 / medium 60 / hard 70 — so a well-run call can actually close instead of
pinning near 50) / `effortTurns` (in `prompt-config.json`), and the objection state — `ready` when `score >= threshold`
OR (no open objections AND `>= effortTurns` counsellor turns scored `>= +2` AND `score >= threshold-10`);
`warming` when within 10 of threshold or half the raised objections are addressed. The hint plus the
objection-state summary (which concerns are ANSWERED vs open) are injected into the student prompt so
addressing concerns and persistence actually move the student toward "yes" and stop verbatim loops.

**SSE protocol** — `POST /sessions/:id/message` with `Accept: text/event-stream` streams the reply:
- `event: token` / `data: {text}` — raw reply tokens as the model generates them (perceived latency).
- `event: done` / `data: <JSON>` — the canonical result; `data` is **byte-for-byte the same JSON
  object** as the non-SSE response (`reply, emotion, currentPhase, satisfactionScore, scoreReason,
  turnType, milestones, cue`). The coherence/anti-loop gate may have replaced the streamed tokens —
  clients MUST swap in the `done` payload's `reply`/`emotion`.
- `event: error` / `data: {error}` — on failure (includes `LLM_TIMEOUT`).
Non-SSE requests keep today's JSON response shape exactly.

### Speech-to-speech engines (addendum to §3)

A session has a **`voiceEngine`**: `"classic"` (default; STT→MiniMax→TTS, unchanged) | `"openai"` (OpenAI Realtime) | `"elevenlabs"` (ElevenLabs Conversational AI). Set at `POST /sessions/start` via body `{ voiceEngine?, openaiVoice? }` (both echoed in the response and stored on the session). In the two S2S engines the provider owns the live voice/conversation; MiniMax grades each turn via `/observe`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/sessions/:id/realtime/openai-token` | `{voice?}` (any of the 10 realtime voices; re-mint to audition live) | `{value, model, voice, expiresAt}` — `value` is an ephemeral `ek_…` client secret for the browser WebRTC peer connection (`POST https://api.openai.com/v1/realtime/calls?model=…`, `Content-Type: application/sdp`) |
| POST | `/sessions/:id/realtime/elevenlabs-token` | — | `{token, agentId, overrides}` — WebRTC conversation token + per-session overrides (`{agent:{prompt:{prompt},firstMessage,language}, tts:{voiceId}}`) for `@elevenlabs/react` `startSession({conversationToken, connectionType:"webrtc", overrides})` |
| POST | `/sessions/:id/observe` | `{counsellorText?, studentText?}` | `{currentPhase, satisfactionScore, scoreReason, turnType, milestones, cue}` — runs classify+phase+**MiniMax scoring** on the counsellor text and objection/phase tracking on the student text, appends both to the server-owned transcript, returns the same coaching fields as `/message` (no reply — the provider already spoke it). 409 if ended; serialized per session. |

S2S transcript events are POSTed to `/observe` in arrival order through a client-side sequential queue. The OpenAI voice is American-base (instructed to speak Indian English + Hinglish); ElevenLabs reuses the session's authentic Indian `voice.elevenLabsVoiceId`. `voice_delivery` is excluded (no sidecar `/analyze` in S2S), weights renormalized as for text sessions. Server config: §3 env vars `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_CONVAI_LLM`.

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
`api.deleteAssignment(id)`, `api.startSession(payload)`, `api.sendMessage(id,message)`,
`api.endSession(id)`, `api.getSession(id)`, `api.getReports(counsellorId?)`, `api.getReport(id)`,
`api.getAdminAnalytics()`, `api.getCounsellorAnalytics(id)`.
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
- `Table({columns:[{key,header,render?}], rows, onRowClick?})`
- `EmptyState({title, hint, action})`
- `Spinner({size})`
- `Sidebar({items:[{to,label,icon}], footer})` (collapsible, active highlight via NavLink)
- `Topbar({title, right})`
- `ScoreMeter({score})` (0–100 horizontal bar, color via scoreColor)
- `DifficultyBadge({level})` (easy/medium/hard → success/warn/danger Badge)

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

Voice pipeline (`src/voice/*`) is unchanged and reused by `Session.jsx`.

---

## 8. Existing voice pipeline (reuse, do not rewrite)

`Session.jsx` reuses `useVoiceConversation({onUserUtterance})` from `src/voice/useVoiceConversation.js`.
Returns `{enabled,status,loadPct,error,enable,disable,speak,stopSpeaking,startListening,stopListening}`.
Push-to-talk = hold Space (interrupt while speaking). Speak the student's reply when voice is enabled.
Keep this behaviour; just restyle the chat to the new design and add a Monexa-style waveform/visual when recording/speaking.

---

## 9. Voice sidecar (port 3002)

Local FastAPI server (`voice-server/`, Python 3.11 via uv). The browser voice pipeline is the automatic
fallback; the sidecar is probed once per session and each capability is used independently.

### Endpoints

| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok:true, capabilities:{tts,stt,analyze}, ttsEngine, sttEngine}` |
| POST | `/tts` | JSON `{text, emotion?, intensity?, voice?}` (`voice` = ElevenLabs voice ID override; ignored by chatterbox/kokoro fallbacks) | `audio/wav` bytes |
| POST | `/stt` | multipart `audio` (wav) | `{text, words:[{word,start,end}], durationSec}` — routed by client only when sttEngine is "scribe"; kept as fallback and for smoke test |
| POST | `/analyze` | multipart `audio` (wav) + form field `transcript` (optional) | prosody metrics + verdicts |

**`/health` capability status values:** `"ready" | "loading" | "unloaded" | "off" | "error:<msg>"`

**`/health` `ttsEngine`:** `"elevenlabs" | "chatterbox" | "kokoro" | null`. TTS engine chain is
`elevenlabs → chatterbox → kokoro`: ElevenLabs is tried first when `ELEVENLABS_API_KEY` is present
in the repo-root `.env` (optional `VOICE_ELEVENLABS_VOICE_ID`); on a missing key or any failure the
sidecar degrades silently to the next engine. Per-request ElevenLabs failures fall back at request
time without permanently changing the global engine selection.

**`/health` `sttEngine`:** `"scribe" | "whisper" | null`. STT engine chain is `scribe → whisper`:
ElevenLabs Scribe is used when `ELEVENLABS_API_KEY` is present; auto-detects language (Hinglish
supported). The client routes counsellor STT to the sidecar only when `sttEngine === "scribe"`;
otherwise uses browser whisper-tiny to avoid stalling on the first-request faster-whisper download.

**`/tts` emotion enum:** `"neutral" | "happy" | "hesitant" | "worried" | "frustrated" | "excited"`

**`/tts` intensity:** `0.0..1.0` (default `0.5`). Scales Chatterbox exaggeration ±0.15 around the
emotion base. Kokoro ignores intensity but uses speed: neutral 1.0 · happy 1.05 · excited 1.12 ·
hesitant 0.88 · worried 0.94 · frustrated 1.06.

**`/analyze` response shape:**
```
{
  tone: "warm" | "neutral" | "flat" | "tense",
  energy: "low" | "medium" | "high",
  wpm: number | null,
  pitchVarSemitones: number,
  pauseRatio: number,
  energyCv: number,
  verdicts: {
    pace: "slow" | "good" | "fast" | null,
    energy: "flat" | "good" | "hot",
    pitchVariation: "monotone" | "good"
  }
}
```

### REST API changes (addendum to §3)

- `POST /api/sessions/:id/message` body gains optional `deliveryMetrics?` (the `/analyze` response
  object; validated strictly — numeric fields must be finite, string fields capped at 32 chars,
  verdicts must be a `{pace, energy, pitchVariation}` object with string values ≤16 chars).
  Stored on the counsellor transcript entry.
- `POST /api/sessions/start` response gains `emotion: string` (default `"neutral"`).
- `POST /api/sessions/:id/message` response gains `emotion: string` (the student's current emotion)
  and `turnType: "statement"|"question"|"invite"` (the classified counsellor turn).
- `POST /api/sessions/:id/message` response (and the SSE `done` payload) gains `cue:
  { source:"corpus"|"llm", headline:string, points:string[], example:string|null }` — a real-time
  counsellor coaching card derived from the student's just-raised objection + session state
  (synchronous `instantCue`). The cue v2 context passed to `instantCue` (both here and on the
  `/cue` fallback) is `{ session, lastStudentText, objectionCategory, lastCounsellorAdjustment,
  lastCounsellorScoreReason, objectionState }` — the last scoring adjustment/reason and live
  objection state let the card react to a good/bad move and surface still-open concerns.
  `POST /api/sessions/:id/cue` returns `{cue, source}` for a richer
  on-demand `llmCue` (one deterministic LLM call) that falls back to `instantCue` on any failure.

### Transcript entry fields (addendum to §2 Session shape)

- Student entries: `{ role:"student", text, phase, scoreAfter, ts, emotion?: string }`
- Counsellor entries: `{ role:"counsellor", text, phase, scoreAfter, ts, turnType?: string, scoreReason?: string, deliveryMetrics?: object }`

The `emotion` field on student entries drives the sidecar TTS call for that reply.
The `deliveryMetrics` field on counsellor entries is used by `report.js` to grade the
`voice_delivery` rubric criterion (criterion is excluded and weights renormalized for text sessions).
`turnType` (set at append time) and `scoreReason` (backfilled after scoring) are stored on
counsellor entries for transparency and the coach view.

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

All LLM calls (chat, scoring, coherence gate, report) use a **single model**
`nemotron-3-nano:30b` (env override `OLLAMA_MODEL`). Sampling presets in `server/ollama.js`:
`STUDENT_SAMPLING {temperature:0.9, top_p:0.95, repeat_penalty:1.3}` for roleplay;
`DETERMINISTIC_SAMPLING {temperature:0.2}` for scoring/coherence/report. `chat()` accepts an
options object (`timeoutMs`, `model` override, sampling knobs) and throws `Error{code:'LLM_TIMEOUT'}`
on timeout (45s chat/scoring, 120s report); `chatStream()` is the async-generator streaming variant.
