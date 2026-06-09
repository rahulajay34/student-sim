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
Persona   { id, name, category, label, coreAnxiety, behaviourPrompt, description, createdAt, updatedAt }
Scenario  { title, difficulty: "easy"|"medium"|"hard", situation, contextNotes }   // embedded in assignment/session
Assignment{ id, counsellorId, personaId, personaPromptOverride|null, scenario:Scenario,
            status: "assigned"|"in_progress"|"completed", createdBy, createdAt, sessionId|null, reportId|null }
Session   { id, assignmentId|null, counsellorId, mode:"assigned"|"practice",
            personaSnapshot:{name,category,label,coreAnxiety,behaviourPrompt},
            scenarioSnapshot:Scenario, currentPhase:1..4, satisfactionScore:0..100,
            scoreHistory:[{turn,score,adjustment,reason}],
            transcript:[{role:"counsellor"|"student", text, phase, scoreAfter, ts}],
            status:"active"|"ended", startedAt, endedAt|null }
Report    { id, sessionId, assignmentId|null, counsellorId, counsellorName, personaName, scenarioTitle,
            overall:{ percent:0..100, band:"Needs Work"|"Good"|"Excellent", outcome:"Converted"|"Not Converted", outcomeDetail },
            rubric:[{key,label,weight,score:1..5,level,justification}],
            phaseBreakdown:[{phase:1..4,name,summary,didWell,toImprove}],
            strengths:[{point,quote}], improvements:[{point,quote,suggestion}],
            scoreArc:[{turn,score}], generatedAt }
```

**Rubric criteria (fixed):** keys/labels/weights —
`rapport` Rapport & Opening (15), `discovery` Needs Discovery (20), `objections` Objection Handling (25),
`knowledge` Product Knowledge & Accuracy (15), `closing` Closing & Next Steps (15), `communication` Communication & Empathy (10).
Level labels by score: 1 Poor · 2 Developing · 3 Competent · 4 Proficient · 5 Excellent.
Band by percent: `<50` Needs Work · `50–74` Good · `≥75` Excellent.

---

## 3. REST API (base `/api`, proxied by Vite to :3001)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/login` | `{email,password}` | `{user}` or 401 `{error}` |
| GET | `/counsellors` | — | `[{id,name,email,role,avatarColor}]` |
| GET | `/personas` | — | `[Persona]` |
| POST | `/personas` | `{name,category,label,coreAnxiety,behaviourPrompt,description}` | `Persona` |
| PUT | `/personas/:id` | partial Persona | `Persona` |
| DELETE | `/personas/:id` | — | `{ok:true}` |
| GET | `/assignments?counsellorId=` | — | `[Assignment + {personaName,counsellorName,hasReport}]` (omit query ⇒ all) |
| POST | `/assignments` | `{counsellorId,personaId,personaPromptOverride?,scenario}` | `Assignment` |
| GET | `/assignments/:id` | — | enriched `Assignment` |
| DELETE | `/assignments/:id` | — | `{ok:true}` |
| POST | `/sessions/start` | `{mode,counsellorId,assignmentId?,personaId?,scenario?}` | `{sessionId,firstMessage,currentPhase,satisfactionScore}` |
| POST | `/sessions/:id/message` | `{message}` | `{reply,currentPhase,satisfactionScore,scoreReason}` |
| POST | `/sessions/:id/end` | — | `{reportId}` |
| GET | `/sessions/:id` | — | `Session` |
| GET | `/reports?counsellorId=` | — | `[Report]` (summaries ok; omit query ⇒ all) |
| GET | `/reports/:id` | — | `Report` |

Server owns the transcript: `/sessions/:id/message` appends to the stored session; the client
does NOT send history. `start` for `mode:"assigned"` derives persona+scenario from the assignment
and flips assignment status to `in_progress`; `end` generates the report and sets `reportId` +
status `completed`.

**Client API client:** `src/lib/api.js` exports a flat object `api` with one async method per
endpoint, e.g. `api.login(email,password)`, `api.getPersonas()`, `api.createPersona(data)`,
`api.updatePersona(id,data)`, `api.deletePersona(id)`, `api.getCounsellors()`,
`api.getAssignments(counsellorId?)`, `api.createAssignment(data)`, `api.getAssignment(id)`,
`api.deleteAssignment(id)`, `api.startSession(payload)`, `api.sendMessage(id,message)`,
`api.endSession(id)`, `api.getSession(id)`, `api.getReports(counsellorId?)`, `api.getReport(id)`.
Each throws `Error(data.error)` on non-2xx.

---

## 4. Routing (`src/main.jsx`, react-router-dom v6)

Public: `/login`.
Admin (role `admin`, `AdminLayout`): `/admin` dashboard, `/admin/counsellors`, `/admin/personas`,
`/admin/assignments`, `/admin/assignments/new`, `/admin/reports`, `/admin/reports/:id`.
Counsellor (role `counsellor`, `CounsellorLayout`): `/app` dashboard, `/app/mocks`, `/app/practice`,
`/app/session/:sessionId`, `/app/reports`, `/app/reports/:id`.
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
