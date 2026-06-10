# Plan 5: Session Experience — Focus Stage (Phase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. NO-GIT RULE: no git commands.

**Goal:** Replace the chat-style session screen with the approved call experience: a **green room** (brief + system check, session starts on Join), the **Focus Stage** (dark full-bleed canvas, audio-reactive emotion-tinted orb, subtitles, call controls), and the **collapsible glass sidebar** (Transcript / Coach tabs with live delivery + milestones). User-approved design: Focus Stage (mockup B) + collapsible glass sidebar with tabs (mockup A of round 2), coach strip at sidebar foot.

**Architecture:** `Session.jsx` becomes a state machine: `greenroom → connecting → live → wrapping → done(navigate to report)`. Sessions are now **started from the green room** (not before navigation): MyMocks/Practice navigate to `/app/session/new` with router state; `/app/session/:sessionId` still resumes existing sessions (straight to live). The voice pipeline hook is reused unchanged (plus an analyser tap for the orb). Server adds two small things: `revealPersona` on assignments and `milestones` in the `/message` response.

**Component decomposition (new files under `client/src/pages/counsellor/session/`):**
```
GreenRoom.jsx      # brief card(s) + system check strip + Join button
CallStage.jsx      # orb, subtitles, timer, status pills, controls bar
Orb.jsx            # canvas/div orb: audio-reactive scale/glow, emotion tint
CallSidebar.jsx    # glass panel: tabs, transcript stream, coach tab, text input
CoachPanel.jsx     # satisfaction sparkline, delivery read, milestone checklist
useCallAudioLevel.js # rAF loop reading an AnalyserNode → 0..1 level
```
`Session.jsx` orchestrates; old chat rendering is removed. ReportDetail and everything else untouched.

---

### Task 1: Server bits (small)

**Files:** `server/index.js`, `scripts/smoke-api.mjs`, `CONTRACT.md`.

- assignments POST: accept `revealPersona` (boolean, default true); store it; enriched GET already returns whole assignment.
- `/api/sessions/:id/message` response: add `milestones: session.milestones` (after advancePhase mutations).
- `/api/sessions/start` response: add `milestones` too (initial).
- smoke: assignment POST sends `revealPersona: false` → echo check; message response has `milestones.objectionsRaised` number ≥ 0.
- CONTRACT: note both fields.
- Verify: smoke run green (full LLM flow).

### Task 2: Audio level tap for the orb

**Files:** `client/src/voice/audioPlayer.js` (read first — surgical), `client/src/pages/counsellor/session/useCallAudioLevel.js` (new).

- audioPlayer: expose an AnalyserNode — create once in `_ensureCtx()` (`this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;`) and route output through it (`source.connect(this.analyser); this.analyser.connect(ctx.destination)` — find the actual node graph and insert before destination). Export a getter `getAnalyser()`. Must not alter timing/epoch semantics.
- `useCallAudioLevel(getAnalyser)` hook: rAF loop, `getByteTimeDomainData`, RMS → smoothed 0..1 (exponential smoothing 0.8); pauses when document hidden; returns `level`.
- Mic-side level (counsellor speaking): the existing capture path exposes PCM frames — if a trivial hook point exists (read the VAD/capture code), compute RMS there into a ref the hook can read; if not trivial, skip mic level (orb only reacts to student voice; controls bar shows a simple "recording" pulse instead). Don't force it.

### Task 3: Green room

**Files:** `client/src/pages/counsellor/session/GreenRoom.jsx` (new), `client/src/pages/counsellor/Session.jsx`, `client/src/main.jsx` (route `/app/session/new`), `client/src/pages/counsellor/MyMocks.jsx`, `client/src/pages/counsellor/Practice.jsx`.

- MyMocks "Start mock": navigate(`/app/session/new`, { state: { mode: "assigned", assignmentId } }) — no api.startSession here anymore.
- Practice "Start practice": navigate(`/app/session/new`, { state: { mode: "practice", personaId, courseId, scenario } }).
- GreenRoom renders (dark theme): left column — "You're about to join a mock counselling call" + cards: Course (name, institute, duration, fee line — from assignment enrichment or a getCourse fetch for practice), Scenario (title, difficulty Badge, situation), Student (persona name/label/description — ONLY if `revealPersona !== false`; otherwise a "Blind call — you'll discover who they are" card). Right column — System check: mic permission (navigator.mediaDevices.getUserMedia probe with explicit button "Test mic"), Voice sidecar (probeSidecar → per-capability Badges: server TTS/STT/analysis + engine name; "not running — browser voice will be used" otherwise), browser fallback status. Join call button (primary, large) + "Start without voice" ghost button (joins with voice disabled).
- On Join: status `connecting` (full-bleed dark screen, pulsing orb skeleton + "Connecting you to the student…") → api.startSession(...) → live. Assigned data: fetch assignment via api.getAssignment(assignmentId) for the brief. Errors → inline error card with retry.
- `/app/session/:sessionId` (existing sessions, e.g. refresh mid-call): skip green room, fetch session, go straight to live (current behaviour preserved). After start, replace the URL via navigate(`/app/session/${sessionId}`, { replace: true }) so refresh resumes.

### Task 4: Call stage + orb

**Files:** `CallStage.jsx`, `Orb.jsx` (new), `Session.jsx` wiring, `client/src/index.css` (@theme additions).

- index.css `@theme` additions: `--color-stage: #0f1117; --color-stage-raised: #161a26; --color-stage-line: #262a36; --color-stage-text: #e7e9f4; --color-stage-muted: #8b90a8;` (usable as bg-stage, text-stage-text, etc.).
- Stage layout: full-bleed dark (`bg-stage`), session UI already renders outside the normal layout (verify — the route is full-bleed per CLAUDE.md). Top-left pills: phase (PHASE label from the 5 names), student mood pill (emotion → label+tint), call timer (mm:ss from startedAt/local start). Top-right: satisfaction pill TOGGLEABLE (eye icon) — visible by default.
- Orb (center): div-based with layered radial gradients + box-shadow glow; scale = 1 + 0.18×level (CSS transform, ease); emotion tint map: neutral #6366f1 (indigo), happy #10b981, excited #8b5cf6, hesitant #f59e0b, worried #f97316, frustrated #f43f5e. States: speaking (reactive), thinking (slow pulse animation while awaiting reply), listening (subtle ring when mic open/PTT held), idle. Student name + state caption under the orb.
- Subtitles: latest student line, centered under orb, max-w-prose, fades in; while waiting for reply show animated "…" dots.
- Controls bar (bottom center): mic button (hold-Space hint tooltip; latch toggle on click — wire to existing startListening/stopListening + PTT which already exists), keyboard button (toggles sidebar open with Transcript tab + focuses text input), End call (danger, confirm Modal "End this call and generate your report?"). Voice enable/disable + status (model loading %) integrated where the old header had them.
- Barge-in/PTT semantics preserved — reuse the existing handlers from current Session.jsx; this is a re-skin, not a logic rewrite. Keep all existing voice logic intact while moving JSX.

### Task 5: Glass sidebar (Transcript + Coach)

**Files:** `CallSidebar.jsx`, `CoachPanel.jsx` (new), `Session.jsx`.

- Sidebar: fixed right, `w-[380px]`, `bg-stage-raised/80 backdrop-blur border-l border-stage-line`, collapse button (⟩⟩ / ⟨⟨) animating width to 0; tabs Transcript | Coach.
- Transcript tab: message stream (student left bubbles indigo-tinted, counsellor right emerald-tinted, dark-theme styled), typing indicator while awaiting reply, auto-scroll (respect user scroll-up), text input + send at bottom (always available — voice optional).
- Coach tab (CoachPanel): (1) Satisfaction sparkline — tiny inline SVG polyline from scoreHistory (the session GET has scoreHistory; /message responses carry satisfactionScore — accumulate client-side), threshold line at 70, current value + trend arrow. (2) Delivery read — last deliveryMetrics: tone Badge, wpm with verdict color (pace), energy verdict, pause ratio ("speak less/more" microcopy from verdicts); "no voice metrics yet" empty state. (3) Milestones checklist — discoveryDone/presentationDone/paymentAsked checkmarks + objectionsRaised counter (from /message milestones). (4) Objection flash — when objectionsRaised increments, show an amber "Objection raised" pill for 4s.
- Sidebar foot strip (always visible when open, both tabs): `sat 62 · tone warm · pace fast↑` compact line.

### Task 6: End flow + e2e verification

**Files:** `Session.jsx`, then verification only.

- End call → confirm → `wrapping` state: full-stage overlay "Wrapping up — generating your coaching report…" with skeleton shimmer; api.endSession; on success navigate to report; on 502 → toast/error card with "Try again" (re-call endSession; session stays active server-side).
- lint + build green.
- Playwright walkthrough (controller runs): admin assigns a mock (PwC course) → counsellor logs in → MyMocks → Start → green room renders (course card, system check; persona card per revealPersona) → Join → live stage (orb, pills, sidebar) → type 2 messages via Transcript tab (voice not testable headless) → Coach tab shows milestones/sparkline → End call → wrapping → report renders with v2 sections. Screenshots at green room, live stage, coach tab, report.
- Phase-wide quality review (controller dispatches; fixes applied).

## Self-review notes
- Voice pipeline untouched except the analyser tap + existing hook reuse; vite optimizeDeps untouched.
- Old sessions/refresh: `/app/session/:sessionId` resumes straight to live; sessions started pre-Phase-5 still open.
- revealPersona default true keeps existing assignments unchanged.
- Satisfaction visibility toggle addresses score-gaming concern without removing the meter.
