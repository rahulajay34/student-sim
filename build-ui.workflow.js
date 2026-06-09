export const meta = {
  name: 'build-mct-ui',
  description: 'Fan out the Mock Counselling Trainer UI build across parallel agents (UI kit -> pages -> verify)',
  phases: [
    { title: 'UI Kit', detail: 'one agent per shared UI primitive' },
    { title: 'Pages', detail: 'one agent per page / report view' },
    { title: 'Verify', detail: 'adversarial review of the complex files' },
  ],
}

const ROOT = '/Users/rahul/Downloads/student-sim'
const SRC = `${ROOT}/client/src`

const PREAMBLE = `You are a senior frontend engineer implementing ONE file in an existing React 19 + Vite 8 + Tailwind v4 single-page app called the "Masai Mock Counselling Trainer". A counsellor practices a sales/counselling call against an LLM-roleplayed student; an admin manages personas and assigns mocks; sessions produce rubric reports.

BEFORE WRITING, read these files for the shared contract and house style (use the Read tool):
- ${ROOT}/CONTRACT.md  (FULL design system, data shapes, REST API, routes, UI-kit props, file map — authoritative)
- ${SRC}/lib/format.js  (helpers: scoreColor, bandColor, difficultyColor, rubricColor, statusColor, STATUS_LABEL, TOKEN_HEX, formatDate, relativeDate, initials)
- ${SRC}/ui/Sidebar.jsx  (reference for how custom Tailwind tokens are used)

HARD RULES:
- Edit ONLY your assigned file. NEVER create or modify any other file. Never touch main.jsx, lib/*, index.css, vite.config.js, layouts, or another component's file.
- The file currently contains a placeholder stub that returns null — REPLACE the entire file contents using the Write tool.
- Tailwind v4 is already configured (no config file needed). Use utility classes including these CUSTOM tokens: bg-canvas (#f6f7f9 page bg), bg-white/bg-surface, border-line, text-ink (primary), text-muted (secondary), bg-brand-600 / hover:bg-brand-700 / text-brand-700 / bg-brand-50 (indigo accent), text-success/warn/danger, bg-success-soft/warn-soft/danger-soft. Inter font is inherited.
- CARD RULE: the <Card> component applies "bg-white rounded-2xl border border-line shadow-sm" and NO padding. Always pass padding via className, e.g. <Card className="p-5"> or <Card className="p-6">.
- Only use UI components listed in CONTRACT section 6 and only the api methods defined in CONTRACT section 3 / ${SRC}/lib/api.js. Do NOT invent endpoints, props, or routes. Do NOT add any new npm dependency or icon library (use inline SVG or the existing kit).
- AESTHETIC: Monexa-inspired — clean, light, airy, generous whitespace, rounded-2xl cards, soft shadow-sm, subtle border-line borders, indigo accent, calm modern SaaS. Polished and consistent. Avoid generic/cramped layouts.
- Output valid JSX only. No TypeScript. No markdown fences in the file.`

function buildPrompt(o) {
  return `${PREAMBLE}

YOUR FILE: ${o.abs}
Default-export a component named exactly: ${o.name}${o.extra ? `\n${o.extra}` : ''}

IMPORT PATHS FROM THIS FILE:
${o.imports}

WHAT TO BUILD:
${o.spec}

ACCEPTANCE CRITERIA:
- Valid JSX, no syntax errors; default export named ${o.name}.
- Uses ONLY existing UI components + documented api methods (imports must resolve to real files/exports).
- If it fetches data: handle loading (Spinner) and empty (EmptyState) states, and surface errors.
- Visually polished, responsive, consistent with the design system.

Write the complete file with the Write tool, then reply with a one-line summary.`
}

// ---- Import path notes per directory --------------------------------------
const IMP_UI = `- Sibling UI components: import X from './X'  (e.g. import Card from './Card')\n- Helpers: import { scoreColor, TOKEN_HEX } from '../lib/format'`
const IMP_ROOT = `- UI kit: import X from '../ui/X'\n- Helpers: '../lib/format'  | API: import { api } from '../lib/api'  | Auth: import { useAuth, homePathFor } from '../lib/auth.jsx'`
const IMP_NESTED = `- UI kit: import X from '../../ui/X'\n- Helpers: '../../lib/format'  | API: import { api } from '../../lib/api'  | Auth: import { useAuth } from '../../lib/auth.jsx'\n- Shared report views: import X from '../shared/X'  | Voice hook: import { useVoiceConversation } from '../../voice/useVoiceConversation'\n- Routing: import { useNavigate, Link, useParams } from 'react-router-dom'`
const IMP_SHARED = `- UI kit: import X from '../../ui/X'\n- Helpers: '../../lib/format'  | API: import { api } from '../../lib/api'\n- Sibling shared views: import X from './X'\n- Routing: import { Link, useParams } from 'react-router-dom'`

// ---- UI KIT specs ---------------------------------------------------------
const UIKIT = [
  { name: 'Button', file: 'ui/Button.jsx', imports: IMP_UI, spec:
`Props: { variant="primary"|"secondary"|"ghost"|"danger", size="md"|"sm", as, className, ...props }. Render a <button> by default, or the element given by \`as\` (e.g. as="a"). Variants: primary = bg-brand-600 text-white hover:bg-brand-700; secondary = bg-white border border-line text-ink hover:bg-canvas; ghost = text-muted hover:bg-canvas hover:text-ink; danger = bg-danger text-white hover:opacity-90. Sizes: md = px-4 py-2.5 text-sm; sm = px-3 py-1.5 text-xs. Always: inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none. Append className last.` },

  { name: 'Card', file: 'ui/Card.jsx', extra: 'ALSO export a NAMED component: export function CardHeader({ title, subtitle, action }).', imports: IMP_UI, spec:
`Default Card({ className, children, ...rest }) -> <div className="bg-white rounded-2xl border border-line shadow-sm {className}" {...rest}>. NO built-in padding. CardHeader({title, subtitle, action}) -> a flex row (items-start justify-between, mb-4) with a left block (title: text-base font-semibold text-ink; subtitle: text-sm text-muted mt-0.5) and \`action\` on the right.` },

  { name: 'Input', file: 'ui/Input.jsx', imports: IMP_UI, spec:
`Input({ label, error, className, id, ...inputProps }). Wrapper div. If label, render <label className="block text-sm font-medium text-ink mb-1.5">. Input: w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100; if error add border-danger. Spread inputProps. If error, show <p className="mt-1 text-xs text-danger">{error}</p>.` },

  { name: 'Textarea', file: 'ui/Textarea.jsx', imports: IMP_UI, spec:
`Textarea({ label, error, rows=4, className, ...props }). Same look as Input but a <textarea> with resize-y and min height. Label + error handled identically to Input.` },

  { name: 'Select', file: 'ui/Select.jsx', imports: IMP_UI, spec:
`Select({ label, options=[{value,label}], placeholder, className, ...props }). Label like Input. <select> styled like Input (add pr-8, cursor-pointer). Optional placeholder as a disabled first <option value="">. Map options to <option>.` },

  { name: 'Modal', file: 'ui/Modal.jsx', imports: IMP_UI, spec:
`Modal({ open, onClose, title, children, footer }). If !open return null. Render a fixed inset-0 z-50 flex items-center justify-center p-4 overlay: a backdrop div (absolute inset-0 bg-ink/40, onClick=onClose) and a panel (relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl). Panel: header row (px-5 py-4 border-b border-line flex items-center justify-between) with title (text-base font-semibold) and a close X button (ghost, inline svg). Body: px-5 py-4 {children}. If footer: px-5 py-4 border-t border-line flex justify-end gap-2 {footer}. Close on Escape key (useEffect). Stop click propagation on panel.` },

  { name: 'Badge', file: 'ui/Badge.jsx', imports: IMP_UI, spec:
`Badge({ color="brand"|"success"|"warn"|"danger"|"slate", children, className }). span: inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium. Color map -> brand: bg-brand-50 text-brand-700; success: bg-success-soft text-success; warn: bg-warn-soft text-warn; danger: bg-danger-soft text-danger; slate: bg-canvas text-muted.` },

  { name: 'StatCard', file: 'ui/StatCard.jsx', imports: `- import Card from './Card'\n- Helpers: '../lib/format'`, spec:
`StatCard({ label, value, hint, icon }). Render <Card className="p-5"> with a flex layout: an optional icon in a h-11 w-11 rounded-xl bg-brand-50 text-brand-600 flex-center (icon is a React node, e.g. inline svg passed by caller), then a column: value (text-2xl font-bold text-ink leading-tight), label (text-sm text-muted mt-0.5), and optional hint (text-xs text-muted/70 mt-1).` },

  { name: 'Avatar', file: 'ui/Avatar.jsx', imports: `- import { initials } from '../lib/format'`, spec:
`Avatar({ name, color, size="md" }). A rounded-full flex-center with white font-semibold initials(name). Sizes: sm h-8 w-8 text-xs, md h-10 w-10 text-sm, lg h-12 w-12 text-base. Background = inline style { background: color || '#4F46E5' }.` },

  { name: 'Table', file: 'ui/Table.jsx', imports: IMP_UI, spec:
`Table({ columns=[{key, header, render, className}], rows=[], onRowClick }). Render a w-full table inside an overflow-x-auto wrapper. thead: tr with th (text-left text-xs font-medium uppercase tracking-wide text-muted px-4 py-3). tbody: each row tr (border-t border-line, if onRowClick add hover:bg-canvas cursor-pointer and onClick), cells td px-4 py-3 text-sm text-ink; use col.render(row) if provided else row[col.key].` },

  { name: 'EmptyState', file: 'ui/EmptyState.jsx', imports: IMP_UI, spec:
`EmptyState({ title, hint, action, icon }). Centered column, py-12 text-center. Optional icon in a h-12 w-12 rounded-2xl bg-canvas text-muted flex-center mx-auto mb-4. title: text-sm font-semibold text-ink. hint: text-sm text-muted mt-1 max-w-sm mx-auto. action (React node) mt-4.` },

  { name: 'Spinner', file: 'ui/Spinner.jsx', imports: IMP_UI, spec:
`Spinner({ size=20, className }). An inline SVG circle with animate-spin, text-brand-600 (currentColor), given width/height = size. A spinning ring (stroke with a transparent gap). Used for loading states.` },

  { name: 'ScoreMeter', file: 'ui/ScoreMeter.jsx', imports: `- import { scoreColor, TOKEN_HEX } from '../lib/format'`, spec:
`ScoreMeter({ score=0, showValue=true, className }). A horizontal track: div h-2.5 w-full rounded-full bg-slate-100 overflow-hidden, with a fill div styled width: score%, background: TOKEN_HEX[scoreColor(score)], rounded-full, transition-all. If showValue, a small flex row above/right showing the numeric score (text-sm font-semibold, colored with the same token via inline style).` },

  { name: 'DifficultyBadge', file: 'ui/DifficultyBadge.jsx', imports: `- import Badge from './Badge'\n- import { difficultyColor } from '../lib/format'`, spec:
`DifficultyBadge({ level }). Render <Badge color={difficultyColor(level)}> with the capitalized level text (easy/medium/hard). Default to 'medium' if missing.` },
]

// ---- PAGE specs -----------------------------------------------------------
const PAGES = [
  { name: 'Login', file: 'pages/Login.jsx', imports: IMP_ROOT, spec:
`The login screen (route /login). Two-column on lg (hidden left brand panel on small screens). LEFT (lg only): a brand panel bg-brand-600 text-white with the product name "Masai Mock Counselling Trainer", a tagline like "Practice the call. Master the close.", and a tasteful abstract visual (an inline SVG soundwave/bars referencing the voice feature). RIGHT: centered card (max-w-md) with heading "Welcome back", an email Input and password Input, a primary Button "Sign in" (full width), and an error message area. On submit: const u = await login(email, password); navigate(homePathFor(u)). Use useAuth() + useNavigate(). Below the form show three "demo account" chips that pre-fill the form when clicked: Admin (admin@masai.com / admin123), Priya — Counsellor (priya@masai.com / priya123), Rohan — Counsellor (rohan@masai.com / rohan123). Manage email/password/loading/error with useState.` },

  { name: 'AdminDashboard', file: 'pages/admin/AdminDashboard.jsx', imports: IMP_NESTED, spec:
`Admin home (route /admin). On mount fetch in parallel: api.getCounsellors(), api.getPersonas(), api.getAssignments(), api.getReports(). Show a row of 4 StatCards: Counsellors (count), Personas (count), Assignments (count), Avg score (mean of reports[].overall.percent, rounded, or "—" if none). Then two columns: (1) "Recent reports" Card listing up to 5 reports (counsellorName, personaName, overall.percent + a band Badge via bandColor, relativeDate(generatedAt)) each linking to /admin/reports/:id; (2) "Recent assignments" Card listing up to 5 assignments (counsellorName, personaName, status Badge via statusColor+STATUS_LABEL). Include a primary Button "New assignment" (top-right of page header) linking to /admin/assignments/new (use Button as={Link} to=...). Page header: an <h2 className="text-xl font-bold"> "Overview" + subtitle. Loading + empty states.` },

  { name: 'Counsellors', file: 'pages/admin/Counsellors.jsx', imports: IMP_NESTED, spec:
`Route /admin/counsellors. Fetch api.getCounsellors(), api.getAssignments(), api.getReports(). Render a responsive grid (sm:grid-cols-2) of Cards (p-5), one per counsellor: Avatar(name,color) + name + email; then small stats: assignments count (filter by counsellorId), completed count (status completed), reports count, avg score (mean percent of their reports or "—"). Header h2 "Counsellors" + count subtitle. Loading + empty states.` },

  { name: 'Personas', file: 'pages/admin/Personas.jsx', imports: IMP_NESTED, spec:
`Route /admin/personas — the persona library with full CRUD. Fetch api.getPersonas(). Header h2 "Persona library" + primary Button "New persona" (opens create modal). Grid (md:grid-cols-2) of Cards (p-5): persona.name (font-semibold), a category Badge, persona.description (text-sm text-muted line-clamp-3), persona.label (text-xs text-muted), and a footer row with secondary Button "Edit" and ghost/danger Button "Delete". Use the Modal component for create/edit with fields: name (Input), category (Input or Select with options studying/graduate/same-field/diff-field/non-working/custom), label (Input, the "You are a student who is ..." phrase), description (Textarea, short), coreAnxiety (Textarea), behaviourPrompt (Textarea, larger — the phase-by-phase behaviour). Save: create -> api.createPersona(data); edit -> api.updatePersona(id, data); then refetch + close. Delete: confirm via window.confirm then api.deletePersona(id) + refetch. Manage modal open/editing/form state with useState. Loading + empty states.` },

  { name: 'AssignmentCreate', file: 'pages/admin/AssignmentCreate.jsx', imports: IMP_NESTED, spec:
`Route /admin/assignments/new — the assign-a-mock flow. Fetch api.getCounsellors() and api.getPersonas() on mount. A single Card (p-6) form with sections: (1) Counsellor — Select of counsellors (value=id, label=name). (2) Persona — Select of personas; when a persona is chosen, prefill a Textarea labelled "Persona prompt (editable for this mock)" with that persona.behaviourPrompt so the admin can tweak it for THIS assignment. (3) Scenario — Input "Scenario title", Select difficulty (easy/medium/hard), Textarea "Situation" (the student's current situation), Textarea "Extra context" (optional). Buttons: secondary "Cancel" (navigate('/admin/assignments')) and primary "Assign mock". On submit: api.createAssignment({ counsellorId, personaId, personaPromptOverride: (edited prompt if it differs from the persona's original else null), scenario: { title, difficulty, situation, contextNotes }, createdBy: user.id }) then navigate('/admin/assignments'). Use useAuth() for user.id, useNavigate(). Validate counsellor + persona selected. Loading + submitting states.` },

  { name: 'Assignments', file: 'pages/admin/Assignments.jsx', imports: IMP_NESTED, spec:
`Route /admin/assignments. Fetch api.getAssignments(). Header h2 "Assignments" + primary Button "New assignment" (as={Link} to /admin/assignments/new). Render a Card containing a Table with columns: Counsellor (counsellorName), Persona (personaName), Scenario (scenario.title), Difficulty (DifficultyBadge level=scenario.difficulty), Status (Badge via statusColor + STATUS_LABEL), Report (if hasReport a Link "View" to /admin/reports/:reportId else text-muted "—"), and a Delete action (ghost danger Button, window.confirm then api.deleteAssignment(id) + refetch). Loading + empty (EmptyState with a CTA to create one).` },

  { name: 'AdminReports', file: 'pages/admin/AdminReports.jsx', imports: IMP_NESTED, spec:
`Route /admin/reports. Fetch api.getReports() and api.getCounsellors(). Header h2 "Reports". A Select filter "All counsellors" + each counsellor (filters the list by counsellorId client-side). Card with a Table: Counsellor, Persona (personaName), Scenario (scenarioTitle), Score (overall.percent% + band Badge via bandColor), Outcome (Badge success if "Converted" else slate), Date (relativeDate(generatedAt)). Row click navigates to /admin/reports/:id (useNavigate). Loading + empty states.` },

  { name: 'Dashboard', file: 'pages/counsellor/Dashboard.jsx', imports: IMP_NESTED, spec:
`Counsellor home (route /app). Use useAuth() for user. Fetch api.getAssignments(user.id) and api.getReports(user.id). Header h2 "Welcome, {firstName}" + subtitle. Row of StatCards: Pending mocks (status assigned or in_progress), Completed, Avg score (mean percent or "—"), Best score (max percent or "—"). Then: a "Your mocks to do" Card listing pending assignments (personaName, scenario.title, DifficultyBadge) each with a primary Button "Start" that calls api.startSession({ mode:'assigned', assignmentId: a.id, counsellorId: user.id }) then navigate('/app/session/'+sessionId) — show a per-row starting spinner. A "Recent reports" Card (up to 5) linking to /app/reports/:id with percent + band Badge. Include a Button "Free practice" (as={Link} to /app/practice). Loading + empty states + start error handling.` },

  { name: 'MyMocks', file: 'pages/counsellor/MyMocks.jsx', imports: IMP_NESTED, spec:
`Route /app/mocks. useAuth() user. Fetch api.getAssignments(user.id). Header h2 "My Mocks". Responsive grid (md:grid-cols-2) of Cards (p-5): personaName (font-semibold), DifficultyBadge, status Badge, scenario.title + scenario.situation (text-sm text-muted line-clamp-2). Footer action: if status !== 'completed' a primary Button "Start"/"Resume" -> api.startSession({ mode:'assigned', assignmentId:id, counsellorId:user.id }) then navigate('/app/session/'+sessionId) (with a starting state + error); if completed a secondary Button "View report" (as={Link} to /app/reports/:reportId). Loading + EmptyState ("No mocks assigned yet").` },

  { name: 'Practice', file: 'pages/counsellor/Practice.jsx', imports: IMP_NESTED, spec:
`Route /app/practice — free practice setup. useAuth() user. Fetch api.getPersonas(). A Card (p-6) form: heading "Free practice" + helper text. Select persona (value=id label=name); show selected persona.description (text-sm text-muted) when chosen. Scenario fields: Input title (default "Free practice"), Select difficulty (easy/medium/hard, default medium), Textarea "Situation" (optional), Textarea "Extra context" (optional). Primary Button "Start practice": api.startSession({ mode:'practice', counsellorId:user.id, personaId, scenario:{title,difficulty,situation,contextNotes} }) then navigate('/app/session/'+sessionId). Validate persona selected. Submitting + error states.` },

  { name: 'Session', file: 'pages/counsellor/Session.jsx', imports: IMP_NESTED, spec:
`Route /app/session/:sessionId — THE LIVE CHAT (revamp of the old chat). This is the most important page; make it excellent.
Data: read sessionId via useParams. On mount, api.getSession(sessionId) -> set messages from session.transcript (map each {role,text} to a display message; role is 'counsellor' or 'student'), set phase=session.currentPhase, score=session.satisfactionScore, persona=session.personaSnapshot, scenario=session.scenarioSnapshot. Handle not-found/error.
Layout: a full-height column (h-screen flex flex-col, bg-canvas). HEADER bar (bg-white border-b border-line px-4/6 py-3): left = student persona name (personaSnapshot.name) + scenario title (text-xs text-muted); center/under = <PhaseStepper current={phase} /> (import from '../shared/PhaseStepper'); right = a live <ScoreMeter score={score} /> labelled "Student satisfaction" + a danger/secondary Button "End session".
MESSAGES: a flex-1 overflow-y-auto area; render student bubbles on the LEFT (bg-white border border-line text-ink rounded-2xl) and counsellor bubbles on the RIGHT (bg-brand-600 text-white rounded-2xl), max-w-[75%], with smooth autoscroll to bottom (ref + useEffect on messages). Show a typing indicator bubble while awaiting a reply.
INPUT BAR (bg-white border-t border-line p-3): a textarea (Enter to send, Shift+Enter newline) + a primary send Button.
SENDING: on send -> append {role:'counsellor',text} optimistically, set loading; await api.sendMessage(sessionId, text); append {role:'student', text: reply}; setPhase(currentPhase); setScore(satisfactionScore). Disable input while loading. Guard against empty/duplicate sends with a ref.
VOICE: integrate the existing hook: const voice = useVoiceConversation({ onUserUtterance: (t) => submitRef.current?.(t) }). Keep a submitRef pointing at the latest submit function. Add a "Voice mode" toggle button in the header (voice.enable / voice.disable). When voice.enabled: show a status pill from voice.status (loading shows voice.loadPct%, plus idle/recording/transcribing/speaking) and a small Monexa-style animated WAVEFORM (a row of bars that animate via CSS when status is 'recording' or 'speaking', static otherwise — use inline style/keyframes or tailwind animate-pulse with staggered delays). Hold SPACE to talk (keydown/keyup window listeners, ignored when focus is in the textarea/input, e.repeat guarded, e.preventDefault) -> voice.startListening()/voice.stopListening(). After receiving a student reply, if voice.enabled call voice.speak(reply). When voice mode is first enabled, speak the last student message. (Mirror the patterns: server now owns history, so DO NOT send any history — api.sendMessage takes only the text.)
END: "End session" -> set ending state, await api.endSession(sessionId) -> navigate('/app/reports/'+reportId).
Use useNavigate, useParams, useState, useRef, useEffect. Reuse ScoreMeter + PhaseStepper from the kit. Keep it clean and focused.` },

  { name: 'Reports', file: 'pages/counsellor/Reports.jsx', imports: IMP_NESTED, spec:
`Route /app/reports. useAuth() user. Fetch api.getReports(user.id). Header h2 "My Reports". Card with a Table (or card grid): Persona (personaName), Scenario (scenarioTitle), Score (overall.percent% + band Badge via bandColor), Outcome (Badge), Date (relativeDate). Row/card click -> navigate('/app/reports/'+id). Loading + EmptyState ("No reports yet — complete a mock to get coached.").` },

  // ---- shared report views ----
  { name: 'ReportDetail', file: 'pages/shared/ReportDetail.jsx', imports: IMP_SHARED, spec:
`Shared report page used by BOTH admin (/admin/reports/:id) and counsellor (/app/reports/:id). Props: { backTo } (a route string). Read id via useParams, api.getReport(id).
Compose these sibling views (import from './'): RubricBar, ScoreArcChart, TranscriptView, PhaseStepper.
Layout (max-w-4xl mx-auto space-y-6):
- A back Link to backTo ("← Back to reports").
- HERO Card (p-6): a big overall.percent with "%" (text-4xl font-bold), a band Badge (bandColor(overall.band)) + an outcome Badge (success if overall.outcome==='Converted' else slate) and overall.outcomeDetail (text-sm text-muted). Meta line: counsellorName · personaName · scenarioTitle · formatDate(generatedAt). Optionally a compact ScoreMeter of the final score (last scoreArc point).
- RUBRIC Card (p-6): CardHeader title "Rubric breakdown"; map report.rubric -> <RubricBar item={r} /> stacked with spacing.
- PHASE BREAKDOWN Card (p-6): title "Phase-by-phase"; for each report.phaseBreakdown entry show phase name, summary, a green "Did well" line and an amber "To improve" line.
- STRENGTHS / IMPROVEMENTS: two Cards side by side on lg. Strengths: list report.strengths ({point, quote}) with a success accent; Improvements: report.improvements ({point, quote, suggestion}) with a warn accent and the suggestion shown.
- SCORE ARC Card (p-6): title "Satisfaction over the call" + <ScoreArcChart data={report.scoreArc} />.
- TRANSCRIPT Card (p-6 or p-0): title "Transcript" + <TranscriptView transcript={report.transcript} />.
Loading (Spinner) + not-found states.` },

  { name: 'RubricBar', file: 'pages/shared/RubricBar.jsx', imports: IMP_SHARED, spec:
`RubricBar({ item }) where item = { key, label, weight, score (1-5), level, justification }. Render a block: top row with item.label (text-sm font-medium text-ink) + a small "weight {weight}%" (text-xs text-muted) on the left, and the level (e.g. "Proficient") as text + score "{score}/5" on the right colored via rubricColor(score). A bar: a track (h-2 rounded-full bg-slate-100) with a fill width = (score/5*100)% and background TOKEN_HEX[rubricColor(score)] (inline style). Below: justification (text-sm text-muted). Import { rubricColor, TOKEN_HEX } from '../../lib/format'.` },

  { name: 'ScoreArcChart', file: 'pages/shared/ScoreArcChart.jsx', imports: IMP_SHARED, spec:
`ScoreArcChart({ data }) where data = [{turn, score}] (0-100). Pure inline SVG, no chart library. Responsive: svg width="100%" viewBox="0 0 320 120" preserveAspectRatio="none"-ish (keep simple). Draw: a light horizontal gridline + a dashed threshold line at score=70 (label "70"). Plot the score series as a polyline (stroke brand-600, width 2) with small circles at each point; optionally a soft area fill under the line (brand at low opacity). Map score 0..100 to y (inverted) and index to x across the width with padding. If data has <2 points, show a centered text-muted "Not enough data". Handle empty gracefully.` },

  { name: 'TranscriptView', file: 'pages/shared/TranscriptView.jsx', imports: IMP_SHARED, spec:
`TranscriptView({ transcript }) where transcript = [{role:'counsellor'|'student', text, phase, scoreAfter, ts}]. Render a vertical list of chat bubbles in a max-h-[480px] overflow-y-auto container: student on the LEFT (bg-canvas text-ink rounded-2xl), counsellor on the RIGHT (bg-brand-600 text-white rounded-2xl), max-w-[78%], with a tiny role label above each (text-xs text-muted: "Student" / "Counsellor"). Empty -> a muted "No transcript".` },

  { name: 'PhaseStepper', file: 'pages/shared/PhaseStepper.jsx', imports: IMP_SHARED, spec:
`PhaseStepper({ current = 1 }). A horizontal 4-step indicator for phases: 1 "Intro", 2 "Course Info", 3 "Concerns", 4 "Closing". Render steps connected by short lines. A step is: a numbered circle (h-7 w-7 rounded-full text-xs font-semibold) + label (text-xs). Completed/current steps (index <= current) use bg-brand-600 text-white (current) / bg-brand-100 text-brand-700 (done) and brand connector; upcoming steps use bg-slate-100 text-muted and slate connector. Keep compact; wrap labels hidden on very small screens (hidden sm:block) is fine.` },
]

// ---- Verify schema --------------------------------------------------------
const REVIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string' },
    ok: { type: 'boolean', description: 'true if the file is correct and integrates cleanly' },
    issues: { type: 'array', items: { type: 'string' }, description: 'concrete problems found (empty if none)' },
  },
  required: ['file', 'ok', 'issues'],
}

const CRITICAL = [
  'pages/counsellor/Session.jsx',
  'pages/shared/ReportDetail.jsx',
  'pages/admin/AssignmentCreate.jsx',
  'pages/admin/Personas.jsx',
  'pages/Login.jsx',
  'pages/counsellor/Dashboard.jsx',
  'pages/counsellor/MyMocks.jsx',
  'pages/admin/Assignments.jsx',
]

function reviewPrompt(rel) {
  return `You are reviewing one freshly-written file in the Mock Counselling Trainer app for INTEGRATION correctness. Read these with the Read tool:
- ${SRC}/${rel}  (the file under review)
- ${ROOT}/CONTRACT.md  (authoritative API/props/routes/design contract)
- ${SRC}/lib/api.js  and  ${SRC}/lib/format.js  (available methods/helpers)
- Any UI components it imports from ${SRC}/ui/  (confirm the default export + props exist)

Check for CONCRETE, build-or-runtime-breaking problems ONLY:
1. Imports that won't resolve (wrong relative path, importing a named export that doesn't exist, default vs named mismatch).
2. Calls to api methods that don't exist in api.js, or wrong arguments.
3. Use of props/fields not present in the documented data shapes (CONTRACT section 2).
4. React bugs: missing key, calling hooks conditionally, obvious infinite-render/effect loops, using a value before it's defined.
5. JSX/syntax errors.
Do NOT nitpick styling or subjective design. Be precise. If the file is correct, set ok=true and issues=[].
Return the structured object { file, ok, issues }.`
}

// ===========================================================================
log(`Building ${UIKIT.length} UI primitives, then ${PAGES.length} pages, then verifying ${CRITICAL.length} critical files.`)

phase('UI Kit')
await parallel(UIKIT.map((o) => () =>
  agent(buildPrompt({ ...o, abs: `${SRC}/${o.file}` }), { label: `ui:${o.name}`, phase: 'UI Kit' })
))

phase('Pages')
await parallel(PAGES.map((o) => () =>
  agent(buildPrompt({ ...o, abs: `${SRC}/${o.file}` }), { label: `page:${o.name}`, phase: 'Pages' })
))

phase('Verify')
const reviews = await parallel(CRITICAL.map((rel) => () =>
  agent(reviewPrompt(rel), { label: `verify:${rel.split('/').pop()}`, phase: 'Verify', schema: REVIEW })
))

const problems = reviews.filter(Boolean).filter((r) => !r.ok)
log(`Verify complete: ${problems.length} file(s) flagged.`)
return { built: UIKIT.length + PAGES.length, reviews: reviews.filter(Boolean), problems }
