import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

import express from "express";
import cors from "cors";

import * as store from "./store.js";
import { advancePhase, initPhaseCounters, initMilestones, PHASE_NAMES } from "./phases.js";
import { initObjectionState, raiseObjection, resolveObjection, detectObjectionCategory, openObjections } from "./objections.js";
import { instantCue, llmCue } from "./cues.js";
import { getFirstMessage, getStudentReply, getStudentReplyStream } from "./engine.js";
import { scoreMessage, isBackchannel, loadScoringConfig, saveScoringConfig, scoringPromptForInspection } from "./scoring.js";
import { generateReport, needsRegeneration, reportPromptForInspection, stubReportSections, buildFallbackReport } from "./report.js";
import { buildAdminAnalytics, buildCounsellorAnalytics } from "./analytics.js";
import { classifyCounsellorTurn } from "./classify.js";
import { getPromptConfig, invalidatePromptConfigCache } from "./promptConfig.js";
import { composeForInspection } from "./prompt.js";
import { pickStudentVoice, inferGenderFromName } from "./voices.js";
import { rollSessionFlavour, DEFAULT_PERSONALITY } from "./personality.js";
import {
  mintOpenAIClientSecret, buildRealtimeInstructions, normalizeOpenAIVoice, openAIVoiceForSession, OPENAI_REALTIME_MODEL,
} from "./realtime.js";
import { computeDisposition } from "./disposition.js";
import { steeringSummary } from "./objections.js";
import { exemplarsFor, renderAddress } from "./styleExemplars.js";
import { writeFileSync, readFileSync } from "fs";

// Voice/text session mode (contract C5). A session is either a VOICE call (OpenAI
// Realtime S2S — the provider owns the live voice/conversation, MiniMax grades each
// turn via POST /sessions/:id/observe) or a TEXT chat (the MiniMax /message SSE
// path). The request `mode` field selects this; `session.voiceEngine` records it
// ("openai" for voice, "text" for text). Default is "voice".
// (Old stored sessions may carry "classic"/"elevenlabs" — read them fail-soft.)
const normalizeSessionMode = (v) => (String(v || "").toLowerCase() === "text" ? "text" : "voice");
const voiceEngineForMode = (m) => (m === "text" ? "text" : "openai");

const PROMPT_CONFIG_PATH = join(__dirname, "data", "prompt-config.json");

console.log("Ollama API key loaded:", process.env.OLLAMA_API_KEY ? "YES" : "NO - KEY MISSING");

const app = express();
app.use(cors());
app.use(express.json());

const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor };

// --- Per-session serialization lock (#7 data-loss) -------------------------
// The store does a full-object write at the end of each turn, so two overlapping
// POST /message (or /end vs /message) for the SAME session would have the slower
// ~45s turn clobber the other's transcript/scoreHistory/objectionState. Chain
// work per session id through a promise so same-session writes run sequentially.
// try/finally releases on error so a failed turn never deadlocks the next one.
const sessionLocks = new Map();
function withSessionLock(sessionId, fn) {
  const prev = sessionLocks.get(sessionId) || Promise.resolve();
  // Swallow the previous turn's rejection here so one failure doesn't reject the
  // whole chain; the previous caller already handled its own error.
  const run = prev.catch(() => {}).then(() => fn());
  // Keep the chain pointer alive until this unit settles, then prune if we're last.
  const tail = run.catch(() => {}).finally(() => {
    if (sessionLocks.get(sessionId) === tail) sessionLocks.delete(sessionId);
  });
  sessionLocks.set(sessionId, tail);
  return run;
}

// Wrap a locked async handler for Express: serialize per session id and ensure an
// unexpected throw outside the handler's own try/catch still yields a 500 instead
// of an unhandled rejection / hung request.
function lockedHandler(fn) {
  return (req, res) => {
    withSessionLock(req.params.id, () => fn(req, res)).catch((err) => {
      console.error("Error in locked session handler:", err?.message);
      if (!res.headersSent) res.status(500).json({ error: err?.message || "internal error" });
    });
  };
}

// --- Per-turn verbosity roll -----------------------------------------------
// Rolls turnVerbosity ('open' | 'short') so consecutive student turns vary in
// length instead of being uniformly terse. Probability of 'open' scales with the
// session's personality talkativeness (1 -> 0.30 ... 5 -> 0.65; ~0.50 default).
// Hard rules: phase 3 (Presentation) is listen-and-acknowledge, so force 'short'
// unless the counsellor explicitly invited a question (turnType 'invite'); and
// never roll 'open' twice in a row (tracked via the prior session.lastTurnVerbosity).
// Returns 'open' | 'short'. Uses the standard JS RNG — this is application code.
function rollTurnVerbosity({ talkativeness, currentPhase, turnType, lastTurnVerbosity }) {
  // Phase 3 stays terse unless the counsellor invited a question.
  if (currentPhase === 3 && turnType !== "invite") return "short";

  const talk = typeof talkativeness === "number" ? Math.min(5, Math.max(1, talkativeness)) : 3;
  // Linear map 1 -> 0.30, 5 -> 0.65.
  const pOpen = 0.30 + (talk - 1) * ((0.65 - 0.30) / 4);

  // Never two 'open' in a row.
  if (lastTurnVerbosity === "open") return "short";

  return Math.random() < pOpen ? "open" : "short";
}

// --- Ownership helpers (dummy-auth grade, matching the app's pre-seeded login) ---
// Resolves the caller from the X-User-Id header. Returns the user record or null.
// Absence of the header (curl / smoke / old clients) returns null → guards bypass.
function requesterFor(req) {
  const uid = req.get("x-user-id");
  if (!uid) return null;
  return store.getById("users", uid) || null;
}

// Returns true (and sends a 403) when a non-admin requester tries to access a
// session that belongs to another counsellor. Returns false when access is allowed.
// A missing header (null requester) always allows — back-compat with curl/smoke.
function deniedForSession(req, res, session) {
  const requester = requesterFor(req);
  if (!requester) return false;
  if (requester.role === "admin") return false;
  if (session.counsellorId === requester.id) return false;
  res.status(403).json({ error: "This session belongs to another counsellor." });
  return true;
}

// Same pattern for reports.
function deniedForReport(req, res, report) {
  const requester = requesterFor(req);
  if (!requester) return false;
  if (requester.role === "admin") return false;
  if (report.counsellorId === requester.id) return false;
  res.status(403).json({ error: "This report belongs to another counsellor." });
  return true;
}

// --- Auth ------------------------------------------------------------------
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = store.findUserByEmail(email);
  if (!user || user.password !== password) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ user: publicUser(user) });
});

// --- Counsellors -----------------------------------------------------------
app.get("/api/counsellors", (_req, res) => res.json(store.getCounsellors().map(publicUser)));

// --- Personas (admin CRUD) -------------------------------------------------
app.get("/api/personas", (_req, res) => res.json(store.getAll("personas")));

app.post("/api/personas", (req, res) => {
  const { name, category, label, coreAnxiety, behaviourPrompt, description, personality } = req.body || {};
  if (!name || !label) return res.status(400).json({ error: "name and label are required" });
  const now = new Date().toISOString();
  const persona = {
    id: store.newId("persona"),
    name, category: category || "custom", label,
    coreAnxiety: coreAnxiety || "", behaviourPrompt: behaviourPrompt || "", description: description || "",
    // personality is optional; callers that omit it get DEFAULT_PERSONALITY at session-start time
    personality: (personality && typeof personality === "object") ? personality : undefined,
    createdAt: now, updatedAt: now,
  };
  // strip undefined keys so JSON.stringify stays clean
  if (persona.personality === undefined) delete persona.personality;
  res.json(store.insert("personas", persona));
});

app.put("/api/personas/:id", (req, res) => {
  const { name, category, label, coreAnxiety, behaviourPrompt, description, personality } = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries({ name, category, label, coreAnxiety, behaviourPrompt, description })) {
    if (v !== undefined) patch[k] = v;
  }
  // personality is optional; persist as-is if provided (callers may send a partial object)
  if (personality !== undefined) patch.personality = personality;
  const updated = store.update("personas", req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Persona not found" });
  res.json(updated);
});

app.delete("/api/personas/:id", (req, res) => {
  const active = store.getAll("assignments").filter(
    (a) => a.personaId === req.params.id && a.status !== "completed",
  );
  if (active.length > 0) {
    return res.status(409).json({
      error: `Cannot delete: ${active.length} active assignment(s) reference this persona. Complete or delete those assignments first.`,
    });
  }
  store.remove("personas", req.params.id);
  res.json({ ok: true });
});

// --- Courses (admin CRUD; catalog ships scraped, admin can edit) -----------
app.get("/api/courses", (req, res) => {
  const all = store.getAll("courses");
  res.json(req.query.active === "1" ? all.filter((c) => c.active) : all);
});

function isValidFee(v) {
  return v === null || v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0);
}
function isValidStringArray(arr) {
  return Array.isArray(arr) && arr.every((x) => typeof x === "string" && x.trim().length > 0);
}

app.post("/api/courses", (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== "string" || !b.name.trim()) return res.status(400).json({ error: "name and institute are required" });
  if (!b.institute || typeof b.institute !== "string" || !b.institute.trim()) return res.status(400).json({ error: "name and institute are required" });
  if (b.feeTotal !== undefined && b.feeTotal !== null && !isValidFee(b.feeTotal)) return res.status(400).json({ error: "invalid feeTotal" });
  if (b.feeBooking !== undefined && b.feeBooking !== null && !isValidFee(b.feeBooking)) return res.status(400).json({ error: "invalid feeBooking" });
  if (b.curriculum !== undefined && !isValidStringArray(b.curriculum)) return res.status(400).json({ error: "invalid curriculum" });
  if (b.outcomes !== undefined && !isValidStringArray(b.outcomes)) return res.status(400).json({ error: "invalid outcomes" });
  if (b.usps !== undefined && !isValidStringArray(b.usps)) return res.status(400).json({ error: "invalid usps" });
  const course = {
    id: store.newId("course"),
    slug: b.slug || `manual/${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: b.name, category: b.category || "business-management", institute: b.institute,
    partner: "Masai School", duration: b.duration || "", format: b.format || "Online",
    feeTotal: b.feeTotal ?? null, feeBooking: b.feeBooking ?? null,
    feeNote: b.feeNote || "", emiNote: b.emiNote || "",
    curriculum: b.curriculum || [], outcomes: b.outcomes || [], eligibility: b.eligibility || "",
    usps: b.usps || [], batchInfo: b.batchInfo || "",
    sourceUrl: b.sourceUrl || "", scrapedAt: new Date().toISOString(), active: b.active !== false,
  };
  res.json(store.insert("courses", course));
});

app.put("/api/courses/:id", (req, res) => {
  const b = req.body || {};
  // Validate fields if present
  if (b.name !== undefined && (typeof b.name !== "string" || !b.name.trim())) return res.status(400).json({ error: "invalid name" });
  if (b.institute !== undefined && (typeof b.institute !== "string" || !b.institute.trim())) return res.status(400).json({ error: "invalid institute" });
  if (b.feeTotal !== undefined && b.feeTotal !== null && !isValidFee(b.feeTotal)) return res.status(400).json({ error: "invalid feeTotal" });
  if (b.feeBooking !== undefined && b.feeBooking !== null && !isValidFee(b.feeBooking)) return res.status(400).json({ error: "invalid feeBooking" });
  if (b.curriculum !== undefined && !isValidStringArray(b.curriculum)) return res.status(400).json({ error: "invalid curriculum" });
  if (b.outcomes !== undefined && !isValidStringArray(b.outcomes)) return res.status(400).json({ error: "invalid outcomes" });
  if (b.usps !== undefined && !isValidStringArray(b.usps)) return res.status(400).json({ error: "invalid usps" });
  if (b.active !== undefined && typeof b.active !== "boolean") return res.status(400).json({ error: "invalid active" });
  const allowed = ["name", "category", "institute", "duration", "format", "feeTotal", "feeBooking",
    "feeNote", "emiNote", "curriculum", "outcomes", "eligibility", "usps", "batchInfo", "active"];
  const patch = {};
  for (const k of allowed) if (b[k] !== undefined) patch[k] = b[k];
  const updated = store.update("courses", req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Course not found" });
  res.json(updated);
});

app.delete("/api/courses/:id", (req, res) => {
  store.remove("courses", req.params.id);
  res.json({ ok: true });
});

// --- Rubric Templates (admin CRUD) ----------------------------------------
function validateRubricCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length < 3) return "criteria must be an array of at least 3";
  const keys = new Set();
  let sum = 0;
  for (const c of criteria) {
    if (!c || typeof c.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(c.key)) return `bad criterion key: ${c?.key}`;
    if (typeof c.label !== "string" || !c.label) return `criterion ${c.key}: label required`;
    if (typeof c.weight !== "number" || c.weight <= 0) return `criterion ${c.key}: weight must be positive`;
    for (const lvl of ["1", "2", "3", "4", "5"]) {
      if (typeof c.anchors?.[lvl] !== "string" || !c.anchors[lvl]) return `criterion ${c.key}: anchor ${lvl} required`;
    }
    if (keys.has(c.key)) return `duplicate criterion key: ${c.key}`;
    keys.add(c.key);
    sum += c.weight;
  }
  if (Math.abs(sum - 100) > 1e-6) return `weights sum to ${sum}, must be 100`;
  return null;
}

app.get("/api/rubric-templates", (_req, res) => res.json(store.getAll("rubric-templates")));

app.post("/api/rubric-templates", (req, res) => {
  const { name, description, criteria } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required" });
  const criteriaErr = validateRubricCriteria(criteria);
  if (criteriaErr) return res.status(400).json({ error: criteriaErr });
  const now = new Date().toISOString();
  const template = {
    id: store.newId("rt"),
    name: name.trim(),
    description: description || "",
    criteria,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  res.json(store.insert("rubric-templates", template));
});

app.put("/api/rubric-templates/:id", (req, res) => {
  const existing = store.getById("rubric-templates", req.params.id);
  if (!existing) return res.status(404).json({ error: "Rubric template not found" });
  const { name, description, criteria } = req.body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) return res.status(400).json({ error: "name is required" });
  if (criteria !== undefined) {
    const criteriaErr = validateRubricCriteria(criteria);
    if (criteriaErr) return res.status(400).json({ error: criteriaErr });
  }
  const patch = { updatedAt: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (description !== undefined) patch.description = description;
  if (criteria !== undefined) patch.criteria = criteria;
  // Never allow isDefault changes — strip it from patch (already excluded above)
  const updated = store.update("rubric-templates", req.params.id, patch);
  res.json(updated);
});

app.delete("/api/rubric-templates/:id", (req, res) => {
  const existing = store.getById("rubric-templates", req.params.id);
  if (!existing) return res.status(404).json({ error: "Rubric template not found" });
  if (existing.isDefault) return res.status(400).json({ error: "Cannot delete the default template" });
  const active = store.getAll("assignments").filter(
    (a) => a.rubricTemplateId === req.params.id && a.status !== "completed",
  );
  if (active.length > 0) {
    return res.status(409).json({
      error: `Cannot delete: ${active.length} active assignment(s) use this rubric template. Complete or delete those assignments first.`,
    });
  }
  store.remove("rubric-templates", req.params.id);
  res.json({ ok: true });
});

// --- Lead profiles (read-only; used by the profile dropdown in Practice + AssignmentCreate) ---
// Loads the full v2 records (id, category, name, gender, age, occupation,
// education, city, label, description). Returns [] fail-soft if the file is
// missing/corrupt so callers can degrade gracefully.
function loadLeadProfiles() {
  try {
    const data = JSON.parse(readFileSync(join(__dirname, "data", "leadProfiles.json"), "utf-8"));
    return Array.isArray(data?.profiles) ? data.profiles : [];
  } catch (err) {
    console.error("Error reading leadProfiles.json:", err.message);
    return null;
  }
}
function loadLeadProfile(id) {
  if (!id) return null;
  const profiles = loadLeadProfiles();
  return Array.isArray(profiles) ? profiles.find((p) => p.id === id) || null : null;
}

// Clamp a 1-5 tuning slider, defaulting to the neutral middle (3) for anything
// missing or out of range.
function clampTuning(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

// Normalize an incoming scenario object: preserve the text fields and coerce the
// two student-tuning sliders (pushiness, hesitancy) to integers in 1-5 (default
// 3). Used at both assignment-create and session-start so the snapshot is always
// well-formed regardless of client version.
function normalizeScenario(scenario) {
  const s = scenario && typeof scenario === "object" ? scenario : {};
  return {
    title: s.title || "",
    difficulty: s.difficulty || "medium",
    situation: s.situation || "",
    contextNotes: s.contextNotes || "",
    pushiness: clampTuning(s.pushiness),
    hesitancy: clampTuning(s.hesitancy),
  };
}

app.get("/api/lead-profiles", (req, res) => {
  const profiles = loadLeadProfiles();
  if (profiles === null) return res.status(500).json({ error: "Could not load lead profiles" });
  let out = profiles.map(({ id, category, name, gender, age, occupation, education, city, label, description }) => ({
    id, category, name, gender, age, occupation, education, city, label, description,
  }));
  if (req.query.category) out = out.filter((p) => p.category === req.query.category);
  res.json(out);
});

// --- Assignments -----------------------------------------------------------
function enrichAssignment(a) {
  const persona = store.getById("personas", a.personaId);
  const counsellor = store.getById("users", a.counsellorId);
  return { ...a, personaName: persona?.name || "(deleted persona)", counsellorName: counsellor?.name || "(unknown)", hasReport: !!a.reportId };
}

app.get("/api/assignments", (req, res) => {
  const { counsellorId } = req.query;
  let all = store.getAll("assignments");
  if (counsellorId) all = all.filter((a) => a.counsellorId === counsellorId);
  res.json(all.map(enrichAssignment));
});

app.post("/api/assignments", (req, res) => {
  const { counsellorId, personaId, courseId, personaPromptOverride, scenario, createdBy, rubricTemplateId, profileId } = req.body || {};
  if (!counsellorId || !personaId) return res.status(400).json({ error: "counsellorId and personaId are required" });
  const course = store.getById("courses", courseId);
  if (!course) return res.status(400).json({ error: "courseId is required and must exist" });
  if (rubricTemplateId) {
    const tpl = store.getById("rubric-templates", rubricTemplateId);
    if (!tpl) return res.status(400).json({ error: "rubricTemplateId not found" });
  }
  const { revealPersona } = req.body || {};
  const assignment = {
    id: store.newId("asn"),
    counsellorId, personaId, courseId,
    personaPromptOverride: personaPromptOverride || null,
    // The lead profile chosen at assignment time, so the session can resolve the
    // student's real name + structured lead card at start. null = bare persona.
    profileId: profileId || null,
    scenario: normalizeScenario(scenario),
    rubricTemplateId: rubricTemplateId || null,
    revealPersona: revealPersona !== false,
    status: "assigned",
    createdBy: createdBy || "admin-1",
    createdAt: new Date().toISOString(),
    sessionId: null, reportId: null,
  };
  res.json(store.insert("assignments", assignment));
});

app.get("/api/assignments/:id", (req, res) => {
  const a = store.getById("assignments", req.params.id);
  if (!a) return res.status(404).json({ error: "Assignment not found" });
  res.json(enrichAssignment(a));
});

app.delete("/api/assignments/:id", (req, res) => {
  const activeSession = store.getAll("sessions").find(
    (s) => s.assignmentId === req.params.id && s.status !== "ended",
  );
  if (activeSession) {
    return res.status(409).json({
      error: "Cannot delete: this assignment has an active session in progress. End the session first.",
    });
  }
  store.remove("assignments", req.params.id);
  res.json({ ok: true });
});

// --- Sessions --------------------------------------------------------------
app.post("/api/sessions/start", async (req, res) => {
  // Serialize starts per assignment: the duplicate-session 409 guard and the
  // store.insert sit either side of an LLM await on the legacy student-opening
  // path, so two concurrent starts could both pass the guard and orphan the
  // first session. Practice starts (no assignmentId) need no lock.
  const startKey = req.body?.assignmentId ? `start:${req.body.assignmentId}` : null;
  const run = () => startSessionHandler(req, res);
  if (!startKey) return run();
  return withSessionLock(startKey, run).catch((err) => {
    console.error("Error in locked session start:", err?.message);
    if (!res.headersSent) res.status(500).json({ error: err?.message || "internal error" });
  });
});

async function startSessionHandler(req, res) {
  try {
    const { mode, counsellorId, assignmentId, personaId, scenario, courseId, rubricTemplateId: bodyRubricTemplateId, profileId } = req.body || {};
    if (!counsellorId) return res.status(400).json({ error: "counsellorId is required" });

    // Counsellor-first (default): the counsellor opens the call (typed/spoken) and
    // the student replies as normal. When false, keep the legacy student-opening flow.
    const counsellorFirst = req.body?.counsellorFirst !== false;
    // Thinking mode for the live conversation: default 'off' (faster). The in-call
    // toggle flips this per turn on POST /message.
    const thinkingMode = req.body?.thinkingMode === "on" ? "on" : "off";
    // Session mode (contract C5): "voice" (OpenAI Realtime S2S, default) or "text"
    // (MiniMax /message chat). `session.voiceEngine` records "openai" | "text".
    const sessionMode = normalizeSessionMode(mode);
    const voiceEngine = voiceEngineForMode(sessionMode);
    const openaiVoice = normalizeOpenAIVoice(req.body?.openaiVoice);

    // Assigned-vs-practice ORIGIN is independent of voice/text mode: a session is
    // "assigned" when it carries an assignmentId (legacy callers may also pass the
    // now-overloaded mode === "assigned" string).
    const isAssigned = Boolean(assignmentId) || mode === "assigned";

    let personaId2 = personaId;
    let scenario2 = scenario || { title: "Free practice", difficulty: "medium", situation: "", contextNotes: "" };
    let override = null;
    let assignment = null;
    let profileId2 = profileId || null;

    if (isAssigned) {
      assignment = store.getById("assignments", assignmentId);
      if (!assignment) return res.status(404).json({ error: "Assignment not found" });
      // One live session per assignment: a double-click race or second tab would
      // otherwise create a duplicate and orphan the first (assignment.sessionId
      // gets overwritten, so the original could never be resumed or reported).
      if (assignment.sessionId) {
        const live = store.getById("sessions", assignment.sessionId);
        if (live && live.status !== "ended") {
          return res.status(409).json({
            error: "An active session already exists for this assignment.",
            sessionId: assignment.sessionId,
          });
        }
      }
      personaId2 = assignment.personaId;
      scenario2 = assignment.scenario;
      override = assignment.personaPromptOverride;
      // The profile chosen at assignment time wins over anything in the body.
      if (assignment.profileId) profileId2 = assignment.profileId;
    }

    // Normalize the scenario (coerces pushiness/hesitancy sliders to 1-5).
    scenario2 = normalizeScenario(scenario2);

    const persona = store.getById("personas", personaId2);
    if (!persona) return res.status(404).json({ error: "Persona not found" });

    // Address term — how the student addresses the counsellor on this call. Inferred
    // from the counsellor's first name (inferGenderFromName takes the first token of
    // a full name). female -> "ma'am", male -> "sir", ambiguous/unknown -> null (the
    // student then listens for how the counsellor sounds). Persisted so the call and
    // resumes stay consistent.
    const counsellorUser = store.getById("users", counsellorId);
    const counsellorGender = inferGenderFromName(counsellorUser?.name);
    const counsellorAddress = counsellorGender === "female" ? "ma'am"
      : counsellorGender === "male" ? "sir"
      : null;

    // Resolve the chosen lead profile (if any) into a CRM-style "lead card": the
    // real name + structured background the counsellor would actually have. This
    // drives the student's display name, gender (hence the voice), and the brief
    // panel. Bare-persona sessions (no profile) leave leadCard null.
    const sessionId = store.newId("ses");
    const profile = loadLeadProfile(profileId2);
    const leadCard = profile
      ? {
          profileId: profile.id,
          name: profile.name || null,
          gender: profile.gender || inferGenderFromName(profile.name) || null,
          age: typeof profile.age === "number" ? profile.age : null,
          occupation: profile.occupation || null,
          education: profile.education || null,
          city: profile.city || null,
        }
      : null;

    // Pick a voice whose gender matches the student's name/identity when we know
    // it, so the prospect sounds like who they are. Falls back to the full
    // rotation when there is no lead profile.
    const studentGender = leadCard?.gender || null;
    const voice = pickStudentVoice(sessionId, studentGender);

    // Roll per-session personality flavour. Fails soft to DEFAULT_PERSONALITY when
    // the persona predates the personality field or has a malformed value.
    // Note: personaPromptOverride replaces behaviourPrompt only — it does NOT
    // override personality; each session still gets its own flavour roll.
    const resolvedPersonality = (persona.personality && typeof persona.personality === "object")
      ? persona.personality
      : DEFAULT_PERSONALITY;
    const personalityFlavour = rollSessionFlavour(resolvedPersonality);

    const personaSnapshot = {
      name: persona.name, category: persona.category, label: persona.label,
      coreAnxiety: persona.coreAnxiety, behaviourPrompt: override || persona.behaviourPrompt,
      // The student goes by their lead-profile name when one was chosen; the
      // voice matches that name's gender. Bare personas fall back to the voice's
      // own name/gender so older flows are unchanged.
      voiceName: leadCard?.name || voice.name,
      voiceGender: studentGender || voice.gender,
      personality: resolvedPersonality,
    };

    let courseId2 = courseId;
    if (assignment) courseId2 = assignment.courseId ?? courseId2;
    let course = courseId2 ? store.getById("courses", courseId2) : null;
    if (!course && assignment && assignment.courseId) {
      // Assigned session with a specific courseId that no longer exists — hard error.
      return res.status(404).json({ error: "Course not found for this assignment" });
    }
    if (!course) {
      // Practice mode with no courseId, or legacy assigned record that predates the courseId field.
      course = store.getAll("courses").find((c) => c.slug === "iim-ranchi/business-analytics-ai-sop") || null;
    }
    const courseSnapshot = course ? { ...course } : null;

    // Resolve rubric template: assignment's rubricTemplateId → body's rubricTemplateId (practice) →
    // the isDefault template → null.
    const allTemplates = store.getAll("rubric-templates");
    const resolvedTemplateId = (assignment && assignment.rubricTemplateId) || bodyRubricTemplateId || null;
    let tpl = resolvedTemplateId ? allTemplates.find((t) => t.id === resolvedTemplateId) || null : null;
    if (!tpl) tpl = allTemplates.find((t) => t.isDefault) || null;
    const rubricSnapshot = tpl ? { templateId: tpl.id, name: tpl.name, criteria: tpl.criteria } : null;

    // Whether the counsellor may see the masked student identity. Snapshot at start
    // so later assignment edits don't rewrite history; practice mode (no assignment)
    // reveals by default.
    const revealPersona = assignment ? (assignment.revealPersona !== false) : true;

    // Counsellor-first: skip the student opening entirely (empty transcript, null
    // firstMessage). Legacy student-first path keeps today's behaviour.
    const firstTurn = counsellorFirst
      ? { text: null, emotion: null }
      : await getFirstMessage(personaSnapshot, scenario2, courseSnapshot, personalityFlavour);
    const firstMessage = firstTurn.text;
    const firstEmotion = firstTurn.emotion;
    const now = new Date().toISOString();
    // Composed student system prompt at session start, for transparency/auditing.
    const promptSnapshot = composeForInspection({
      personaSnapshot, scenarioSnapshot: scenario2, courseSnapshot, currentPhase: 1, satisfactionScore: 50,
      personalityFlavour,
    });
    const session = {
      id: sessionId,
      assignmentId: assignment ? assignment.id : null,
      counsellorId,
      mode: assignment ? "assigned" : "practice",
      sessionMode,
      personaSnapshot,
      scenarioSnapshot: scenario2,
      courseSnapshot,
      rubricSnapshot,
      promptSnapshot,
      personalityFlavour,
      leadCard,
      counsellorAddress,
      revealPersona,
      thinkingMode,
      voiceEngine,
      openaiVoice,
      voice,
      currentPhase: 1,
      satisfactionScore: 50,
      phaseCounters: initPhaseCounters(),
      milestones: initMilestones(),
      objectionState: initObjectionState(),
      scoreHistory: [{ turn: 0, score: 50, adjustment: 0, reason: "start" }],
      // Counsellor-first → empty transcript (no student bubble); the counsellor's
      // first message opens the call. Student-first → seed the opening student turn.
      transcript: counsellorFirst
        ? []
        : [{ role: "student", text: firstMessage, emotion: firstEmotion, phase: 1, scoreAfter: 50, ts: now }],
      status: "active",
      startedAt: now, endedAt: null,
    };
    store.insert("sessions", session);

    if (assignment) store.update("assignments", assignment.id, { status: "in_progress", sessionId: session.id });

    res.json({
      sessionId: session.id, firstMessage, emotion: firstEmotion,
      currentPhase: 1, satisfactionScore: 50, milestones: session.milestones, voice, revealPersona, leadCard,
      voiceEngine, openaiVoice, sessionMode,
    });
  } catch (err) {
    console.error("Error in /sessions/start:", err.message);
    res.status(500).json({ error: err.message });
  }
}

function sanitizeDeliveryMetrics(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out = {};

  // tone / energy: strings, max 32 chars
  for (const key of ["tone", "energy"]) {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, 32);
  }

  // numeric fields: must be Number.isFinite, else drop
  for (const key of ["wpm", "pitchVarSemitones", "pauseRatio", "energyCv"]) {
    if (key in raw && Number.isFinite(raw[key])) out[key] = raw[key];
  }

  // verdicts: must be a plain object; allowed keys pace/energy/pitchVariation with string values ≤16 chars
  if (raw.verdicts !== null && typeof raw.verdicts === "object" && !Array.isArray(raw.verdicts)) {
    const VERDICT_KEYS = new Set(["pace", "energy", "pitchVariation"]);
    const v = {};
    for (const k of VERDICT_KEYS) {
      if (typeof raw.verdicts[k] === "string") v[k] = raw.verdicts[k].slice(0, 16);
    }
    if (Object.keys(v).length > 0) out.verdicts = v;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// Per turn: 409 ended-session guard FIRST (before any SSE headers) → classify the
// counsellor message into a turnType → push the counsellor transcript entry (with
// sanitized deliveryMetrics + turnType) → run scoring and the student reply
// CONCURRENTLY (the reply prompt sees the PRE-message score; one turn of lag in the
// satisfaction bands, in exchange for the reply starting sooner). Backchannel
// acknowledgements skip the scoring LLM (isBackchannel). scoreAfter + scoreReason
// are backfilled onto the counsellor entry once scoring resolves. Milestone/phase
// advancement is preserved exactly.
//
// Dual-mode: with `Accept: text/event-stream` the reply streams as SSE `token`
// events and ends with a `done` event whose data is BYTE-FOR-BYTE the same JSON
// object as the non-SSE response (reply, emotion, currentPhase, satisfactionScore,
// scoreReason, turnType, milestones). `error` events carry { error } (incl.
// LLM_TIMEOUT). Plain requests keep today's JSON response shape exactly.
app.post("/api/sessions/:id/message", lockedHandler(async (req, res) => {
  // Read the session INSIDE the lock so we see the latest persisted state after any
  // prior same-session turn's full-object write (prevents the #7 data-loss clobber).
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found. Please start a new session." });
  // 409 ended-session guard FIRST — before any SSE headers are written.
  if (session.status === "ended") return res.status(409).json({ error: "This session has ended." });
  if (deniedForSession(req, res, session)) return;
  const { message, deliveryMetrics: rawDeliveryMetrics } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });

  // Per-turn thinking toggle: if the client sent body.thinking ('on'|'off'),
  // update session.thinkingMode BEFORE the reply is generated so the student
  // reply call uses it. Persisted with the rest of the turn's store.update below.
  if (req.body?.thinking === "on" || req.body?.thinking === "off") {
    session.thinkingMode = req.body.thinking;
  }

  // Fail-soft: sessions started before objection tracking existed have no
  // objectionState. Seed an empty one so the lifecycle calls below are safe.
  if (!Array.isArray(session.objectionState)) session.objectionState = initObjectionState();

  const wantsSSE = (req.headers.accept || "").includes("text/event-stream");
  let send = null; // non-null once SSE headers are out
  try {
    // Classify the counsellor turn (statement | question | invite).
    const turnType = classifyCounsellorTurn(message);

    // Advance phase on the counsellor's message, then push the entry. scoreAfter is
    // the PRE-message score for now; it is backfilled once scoring resolves.
    advancePhase(session, "counsellor", message);
    const preScore = session.satisfactionScore;
    const now = new Date().toISOString();
    const counsellorEntry = {
      role: "counsellor", text: message, phase: session.currentPhase,
      turnType, scoreAfter: preScore, ts: now,
    };
    const sanitized = sanitizeDeliveryMetrics(rawDeliveryMetrics);
    if (sanitized) counsellorEntry.deliveryMetrics = sanitized;
    session.transcript.push(counsellorEntry);

    // Roll this turn's verbosity override (scaled by talkativeness, phase-3 short,
    // never two 'open' in a row) and persist it on the session BEFORE the reply
    // path runs — prepareReply reads session.lastTurnVerbosity to set the override.
    session.lastTurnVerbosity = rollTurnVerbosity({
      talkativeness: session.personalityFlavour?.talkativeness,
      currentPhase: session.currentPhase,
      turnType,
      lastTurnVerbosity: session.lastTurnVerbosity ?? null,
    });

    // Momentum: the counsellor's LAST scoring adjustment (one-turn lag — scoring
    // for THIS turn runs concurrently with the reply, so scoreHistory's last entry
    // is the previous turn's value). Threaded into the cue context below; the reply
    // path reads the same value from scoreHistory inside prepareReply.
    const lastHistEntry = session.scoreHistory[session.scoreHistory.length - 1] || null;
    const lastCounsellorAdjustment = (lastHistEntry && typeof lastHistEntry.adjustment === "number")
      ? lastHistEntry.adjustment
      : null;
    const lastCounsellorScoreReason = lastHistEntry?.reason ?? null;

    // Recent context window for scoring: last N turns BEFORE this counsellor turn (admin-tunable).
    const windowSize = loadScoringConfig().recentTurnsWindow;
    const recentTurns = session.transcript.slice(-(windowSize + 1), -1).map(({ role, text }) => ({ role, text }));
    // Open objections THIS session is tracking, so the scorer resolves the same key.
    const openObjForScore = openObjections(session.objectionState).map(({ category }) => ({ key: category }));

    let heartbeat = null;
    if (wantsSSE) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      send = (event, data) => {
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      // Comment-frame heartbeat until the first real event: with thinking mode on,
      // MiniMax can be silent for 30s+ before the first token, and idle proxies
      // (nginx/ALB default 60s) would cut the connection. The client parser skips
      // comment frames. Cleared on first send; also cleared in the catch below.
      heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 15000);
    }

    // Backchannel acks skip the scoring LLM entirely (no penalty, no call).
    const scorePromise = isBackchannel(message)
      ? Promise.resolve({ adjustment: 0, reason: "Backchannel acknowledgement", addressedObjection: null })
      : scoreMessage(message, {
          recentTurns, phase: session.currentPhase, turnType, courseName: session.courseSnapshot?.name,
          openObjections: openObjForScore,
        });

    // Reply: streaming generator for SSE, plain await otherwise. Both go through
    // the coherence gate and return the canonical { text, emotion }.
    let replyResult;
    const replyPromise = (async () => {
      if (send) {
        const gen = getStudentReplyStream(session);
        let step = await gen.next();
        while (!step.done) {
          send("token", { text: step.value });
          step = await gen.next();
        }
        return step.value; // { text, emotion, raw }
      }
      return getStudentReply(session); // { text, emotion }
    })();

    // Scoring and reply run CONCURRENTLY (reply sees the pre-message score).
    const [{ adjustment, reason, addressedObjection }, reply] = await Promise.all([scorePromise, replyPromise]);
    replyResult = reply;

    // Apply the score and backfill scoreAfter + scoreReason onto the counsellor entry.
    session.satisfactionScore = Math.max(0, Math.min(100, preScore + adjustment));
    counsellorEntry.scoreAfter = session.satisfactionScore;
    counsellorEntry.scoreReason = reason;
    session.scoreHistory.push({ turn: session.scoreHistory.length, score: session.satisfactionScore, adjustment, reason });

    // OBJECTION LIFECYCLE — resolve first (the counsellor's just-scored turn), then
    // raise on the student's reply. The turn index is the transcript position the
    // entry will occupy. Resolving uses the counsellor entry's index.
    if (addressedObjection) {
      const counsellorTurnIdx = session.transcript.indexOf(counsellorEntry);
      resolveObjection(session.objectionState, addressedObjection, counsellorTurnIdx);
    }

    const { text: replyText, emotion } = replyResult;
    // advancePhase returns the detected objection category (or null) and bumps
    // milestones.objectionsRaised via the broad OBJECTION_RE gate (phase >= 3).
    const gateCategory = advancePhase(session, "student", replyText);

    // Record the objection in the lifecycle tracker. Prefer the phase gate's
    // category; fall back to a direct detect so concerns raised before phase 3
    // (which the gate ignores) are still tracked. The objectionsRaised counter is
    // owned by advancePhase; we do not double-count here.
    const studentTurnIdx = session.transcript.length; // position the student entry will take
    const raisedCategory = gateCategory || detectObjectionCategory(replyText);
    if (raisedCategory) raiseObjection(session.objectionState, raisedCategory, studentTurnIdx, replyText);

    session.transcript.push({
      role: "student", text: replyText, emotion, phase: session.currentPhase,
      scoreAfter: session.satisfactionScore, ts: new Date().toISOString(),
    });

    store.update("sessions", session.id, session);

    // Instant counsellor cue (synchronous, zero-LLM) from the just-raised
    // objection + live session state. Additive field on the same payload object.
    // Cue v2 context: the counsellor's last scoring adjustment + reason and the
    // live objection state, so the cue can react to a good/bad move and open concerns.
    const cue = instantCue({
      session, lastStudentText: replyText, objectionCategory: raisedCategory,
      lastCounsellorAdjustment, lastCounsellorScoreReason, objectionState: session.objectionState,
    });

    const payload = {
      reply: replyText, emotion,
      currentPhase: session.currentPhase, satisfactionScore: session.satisfactionScore,
      scoreReason: reason, turnType, milestones: session.milestones,
      cue,
    };
    if (send) {
      send("done", payload);
      res.end();
    } else {
      res.json(payload);
    }
  } catch (err) {
    console.error("Error in /sessions/message:", err.stack || err.message);
    if (send) {
      send("error", { error: err.message });
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}));

// ── Speech-to-speech (S2S) realtime credentials + observation ────────────────
// In the "openai" (voice) engine the live voice + conversation run browser↔OpenAI
// (low latency); MiniMax still grades each turn via /observe.

// What naturally happens next in each call phase — a one-line steer for the voice
// model so it knows where the conversation is heading.
const PHASE_NEXT = {
  1: "you are just getting to know each other; expect the counsellor to ask about your background next.",
  2: "the counsellor is learning your situation; they will start explaining the programme soon.",
  3: "the counsellor is presenting the programme; your real concerns will start surfacing.",
  4: "your objections are on the table; the counsellor is trying to resolve them and move toward asking you to commit.",
  5: "you are near a decision; the counsellor may ask you to block your seat or pay.",
};

// Strip the text-pipeline [emotion:*] tags AND a bare trailing standalone emotion
// word so neither gets stored in the S2S transcript or scored. The realtime model
// is told not to emit these, but a stray one must never poison the transcript.
const TRAILING_EMOTION_RE = /[\s,.;:!?—-]*\b(neutral|happy|excited|hesitant|worried|frustrated)\b[\s.!?]*$/i;
function stripEmotionArtifacts(text) {
  if (typeof text !== "string") return "";
  let t = text.replace(/\[emotion:[^\]]*\]/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  // Remove a single bare trailing emotion word (a leftover label), not mid-sentence uses.
  t = t.replace(TRAILING_EMOTION_RE, "").trim();
  return t;
}

// Sanitize the in-browser realtime delivery metrics (contract C2) into the shape
// the report reads on a counsellor transcript entry: { wpm, pauses, energyVar,
// durationMs }. Coerce to finite numbers; drop any invalid/missing key. (Distinct
// from the classic /message sanitizer above, which carries a richer prosody shape.)
function sanitizeRealtimeDeliveryMetrics(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const key of ["wpm", "pauses", "energyVar", "durationMs"]) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

// Score a counsellor turn with thinking disabled (chat() defaults to a disabled
// reasoning block) and a hard 15s budget so /observe never blocks the live call.
// On timeout/error, treat as a no-op adjustment — never fail the request.
async function scoreObserveTurn(message, opts) {
  if (isBackchannel(message)) {
    return { adjustment: 0, reason: "Backchannel acknowledgement", addressedObjection: null };
  }
  try {
    const scored = await Promise.race([
      // timeoutMs ≤ the race window so chat() aborts the in-flight MiniMax fetch
      // when the sentinel wins, instead of leaving a dangling LLM call/connection.
      scoreMessage(message, opts, undefined, { timeoutMs: 14000 }),
      new Promise((resolve) => setTimeout(
        () => resolve({ adjustment: 0, reason: "score timeout", addressedObjection: null }),
        15000,
      )),
    ]);
    return scored || { adjustment: 0, reason: "score timeout", addressedObjection: null };
  } catch (err) {
    console.warn("[observe] scoring failed (non-fatal):", err?.message);
    return { adjustment: 0, reason: "scoring unavailable", addressedObjection: null };
  }
}

// Build the compact mid-call steering block (contract C2): disposition narrative,
// open/answered objections with banned phrasing, the current phase + what happens
// next, and a one-line turn-length reminder. Kept short (≤ ~120 words).
function buildSteering(session) {
  const parts = [];
  const disp = computeDisposition(session);
  if (disp?.narrative) parts.push(`How you feel now: ${disp.narrative}`);
  const obj = steeringSummary(session.objectionState);
  if (obj) parts.push(obj);
  const phase = session.currentPhase || 1;
  const phaseName = PHASE_NAMES[phase] || PHASE_NAMES[1];
  parts.push(`Stage: ${phaseName} — ${PHASE_NEXT[phase] || PHASE_NEXT[1]}`);
  parts.push("Keep your replies conversational — about 10 to 30 spoken words.");

  // One phase-appropriate style anchor, rotated by turn count so the voice model
  // gets a fresh exemplar as the call progresses (the seed folds in the transcript
  // length, then we take the first of a single-line draw). Fail-soft to nothing.
  const addressTerm = (session.counsellorAddress === "sir" || session.counsellorAddress === "ma'am")
    ? session.counsellorAddress : null;
  const turns = Array.isArray(session.transcript) ? session.transcript.length : 0;
  const anchorSeed = `${session.id || ""}|turn${turns}`;
  const anchor = exemplarsFor(phase, 1, anchorSeed)[0];
  if (anchor) parts.push(`Sound like: "${renderAddress(anchor, addressTerm)}"`);

  return parts.join("\n");
}

// OpenAI Realtime ephemeral client secret for the browser WebRTC peer connection.
// Body: { voice? } lets the UI audition any of the realtime voices live; it
// re-mints with that voice (the WebRTC session is re-established client-side).
// Response shape is byte-stable for the client: { value, model, voice, expiresAt }.
app.post("/api/sessions/:id/realtime/openai-token", async (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (deniedForSession(req, res, session)) return;
  try {
    // Resolve the voice: an explicit live-picked voice wins; otherwise gender-match
    // (female→marin, male→cedar) from the session's student gender.
    const voice = openAIVoiceForSession(session, req.body?.voice);
    const instructions = buildRealtimeInstructions(session);
    const out = await mintOpenAIClientSecret({ instructions, voice });
    res.json({ value: out.value, model: out.model, voice: out.voice, expiresAt: out.expiresAt });
  } catch (err) {
    console.error("Error minting OpenAI realtime token:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// Observe a completed S2S turn pair so MiniMax keeps the live coaching alive:
// classify + advance phase + SCORE the counsellor turn, then track the student's
// objection + advance phase on the reply, append both to the server-owned
// transcript, and return the same coaching fields /message does (minus the reply,
// which the provider already spoke) PLUS a `steering` block (contract C2) the
// client pushes back to the realtime model via session.update.
// Body: { counsellorText?, studentText?, deliveryMetrics? } — either text may be
// empty (e.g. only a counsellor turn so far). Serialized per session.
app.post("/api/sessions/:id/observe", lockedHandler(async (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found. Please start a new session." });
  if (session.status === "ended") return res.status(409).json({ error: "This session has ended." });
  if (deniedForSession(req, res, session)) return;
  // Strip [emotion:*] tags and a bare trailing emotion word from BOTH texts before
  // storing/scoring (the realtime model should never emit these, but guard anyway).
  const cText = stripEmotionArtifacts(typeof req.body?.counsellorText === "string" ? req.body.counsellorText : "");
  const sText = stripEmotionArtifacts(typeof req.body?.studentText === "string" ? req.body.studentText : "");
  // deliveryMetrics arrives only with a counsellor turn.
  const deliveryMetrics = cText ? sanitizeRealtimeDeliveryMetrics(req.body?.deliveryMetrics) : null;
  if (!cText && !sText) return res.status(400).json({ error: "counsellorText or studentText is required" });

  if (!Array.isArray(session.objectionState)) session.objectionState = initObjectionState();

  try {
    let turnType = null;
    let reason = null;
    let raisedCategory = null;

    // Counsellor turn: classify -> advance phase -> score (MiniMax) -> objection resolve.
    if (cText) {
      turnType = classifyCounsellorTurn(cText);
      advancePhase(session, "counsellor", cText);
      const preScore = session.satisfactionScore;
      const counsellorEntry = {
        role: "counsellor", text: cText, phase: session.currentPhase,
        turnType, scoreAfter: preScore, ts: new Date().toISOString(),
      };
      // deliveryMetrics goes on the counsellor entry under the same field the report reads.
      if (deliveryMetrics) counsellorEntry.deliveryMetrics = deliveryMetrics;
      session.transcript.push(counsellorEntry);

      const windowSize = loadScoringConfig().recentTurnsWindow;
      const recentTurns = session.transcript.slice(-(windowSize + 1), -1).map(({ role, text }) => ({ role, text }));
      const openObjForScore = openObjections(session.objectionState).map(({ category }) => ({ key: category }));

      const scored = await scoreObserveTurn(cText, {
        recentTurns, phase: session.currentPhase, turnType,
        courseName: session.courseSnapshot?.name, openObjections: openObjForScore,
      });
      reason = scored.reason;
      session.satisfactionScore = Math.max(0, Math.min(100, preScore + scored.adjustment));
      counsellorEntry.scoreAfter = session.satisfactionScore;
      counsellorEntry.scoreReason = reason;
      session.scoreHistory.push({ turn: session.scoreHistory.length, score: session.satisfactionScore, adjustment: scored.adjustment, reason });
      if (scored.addressedObjection) {
        resolveObjection(session.objectionState, scored.addressedObjection, session.transcript.indexOf(counsellorEntry));
      }
    }

    // Student reply (already spoken by the provider): advance phase + track objection.
    if (sText) {
      const gateCategory = advancePhase(session, "student", sText);
      const studentTurnIdx = session.transcript.length;
      raisedCategory = gateCategory || detectObjectionCategory(sText);
      // Store the student's actual sentence as the objection's lastPhrasing so the
      // anti-loop steering can quote and ban it.
      if (raisedCategory) raiseObjection(session.objectionState, raisedCategory, studentTurnIdx, sText);
      session.transcript.push({
        role: "student", text: sText, emotion: "neutral", phase: session.currentPhase,
        scoreAfter: session.satisfactionScore, ts: new Date().toISOString(),
      });
    }

    store.update("sessions", session.id, session);

    const lastHist = session.scoreHistory[session.scoreHistory.length - 1] || null;
    const cue = instantCue({
      session, lastStudentText: sText, objectionCategory: raisedCategory,
      lastCounsellorAdjustment: lastHist && typeof lastHist.adjustment === "number" ? lastHist.adjustment : null,
      lastCounsellorScoreReason: lastHist?.reason ?? null, objectionState: session.objectionState,
    });
    // Recompute steering on BOTH counsellor-turn and student-turn observes.
    const steering = buildSteering(session);

    res.json({
      currentPhase: session.currentPhase, satisfactionScore: session.satisfactionScore,
      scoreReason: reason, turnType, milestones: session.milestones, cue, steering,
    });
  } catch (err) {
    console.error("Error in /sessions/observe:", err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
}));

// --- Async report generation (C4) ------------------------------------------
// In-memory map of in-flight background generations, keyed by sessionId, so a
// re-call of /end while a report is generating does not kick off a second LLM
// fan-out. Cleared when the promise settles.
const reportJobs = new Map();

// Run report generation in the background (OUTSIDE the per-session lock so it
// never holds the lock for the full LLM duration) and update the persisted
// report to status "ready" or "fallback" when done. Errors are caught and
// produce a fallback report rather than an unhandled rejection.
function startReportJob(sessionId, reportId) {
  if (reportJobs.has(sessionId)) return reportJobs.get(sessionId);

  const job = (async () => {
    // Read the session fresh at job start; it was marked ended at stub time.
    const session = store.getById("sessions", sessionId);
    if (!session) {
      // Session deleted between stub insert and job start (e.g. test cleanup):
      // without this the stub would sit at "generating" forever.
      const orphan = store.getById("reports", reportId);
      if (orphan) store.update("reports", reportId, { status: "fallback", regenerable: true });
      return;
    }

    // generateReport handles its own retries and returns a {fallback:true} shape
    // on Call A failure; only an unexpected throw lands in the catch below.
    let generated;
    try {
      generated = await generateReport(session);
    } catch (err) {
      console.error("[report] background generation threw; using fallback:", err?.message);
      generated = buildFallbackReport(session);
    }

    const stillThere = store.getById("reports", reportId);
    if (!stillThere) return; // report was deleted while generating

    if (generated.fallback) {
      store.update("reports", reportId, {
        ...generated,
        status: "fallback",
        regenerable: true,
        generatedAt: new Date().toISOString(),
      });
    } else {
      store.update("reports", reportId, {
        // Clear any stale fallback flags from a prior generation in place.
        fallback: false,
        regenerable: false,
        ...generated,
        status: "ready",
        generatedAt: new Date().toISOString(),
      });
    }
  })().catch((err) => {
    console.error("[report] background job failed unexpectedly:", err?.message);
    // Last-resort: mark the report as fallback so the UI can offer regeneration.
    const rec = store.getById("reports", reportId);
    if (rec) store.update("reports", reportId, { status: "fallback", regenerable: true });
  }).finally(() => {
    reportJobs.delete(sessionId);
  });

  reportJobs.set(sessionId, job);
  return job;
}

app.post("/api/sessions/:id/end", lockedHandler(async (req, res) => {
  // Serialized against /message for the same session so an end can't interleave
  // with a ~45s turn's full-object write (#7). Read inside the lock for freshness.
  // The stub is persisted and the session marked ended INSIDE the lock (fast);
  // the LLM fan-out runs in the background (startReportJob) OUTSIDE the lock.
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (deniedForSession(req, res, session)) return;

  try {
    const existing = store.getAll("reports").find((r) => r.sessionId === session.id);

    if (existing) {
      // Still generating WITH an active in-memory job → return the same
      // { reportId, status } (idempotent).
      if (existing.status === "generating" && reportJobs.has(session.id)) {
        return res.json({ reportId: existing.id, status: "generating" });
      }
      // A neutral fallback is not terminal: regenerate in place. Also covers a
      // STALE "generating" stub left behind by a server restart (the in-memory
      // reportJobs map was wiped but the JSON store still says "generating", with
      // no active job) — re-kick a fresh background job instead of getting stuck.
      if (needsRegeneration(existing) || existing.status === "fallback" || existing.status === "generating") {
        store.update("reports", existing.id, { status: "generating" });
        // Preserve the original end time on regeneration — only stamp it once.
        store.update("sessions", session.id, { status: "ended", endedAt: session.endedAt || new Date().toISOString() });
        if (session.assignmentId) store.update("assignments", session.assignmentId, { status: "completed", reportId: existing.id });
        startReportJob(session.id, existing.id);
        return res.json({ reportId: existing.id, status: "generating" });
      }
      // A good (ready) report already exists → return it unchanged.
      return res.json({ reportId: existing.id, status: existing.status || "ready" });
    }

    // No report yet: persist a STUB with all instantly-available data and return
    // immediately. The LLM sections fill in the background.
    const counsellor = store.getById("users", session.counsellorId);

    const stub = {
      id: store.newId("rep"),
      sessionId: session.id,
      assignmentId: session.assignmentId,
      counsellorId: session.counsellorId,
      counsellorName: counsellor?.name || "",
      personaName: session.personaSnapshot?.name || "",
      scenarioTitle: session.scenarioSnapshot?.title || "",
      status: "generating",
      // Instantly-available sections (rendered immediately by ReportDetail):
      // finalScore, scoreArc, benchmarks, transcript.
      ...stubReportSections(session),
      generatedAt: new Date().toISOString(),
    };
    store.insert("reports", stub);

    // Mark the session ended + assignment completed at stub time so locks release.
    store.update("sessions", session.id, { status: "ended", endedAt: new Date().toISOString() });
    if (session.assignmentId) store.update("assignments", session.assignmentId, { status: "completed", reportId: stub.id });

    // Kick the background generation (outside the lock — returns immediately).
    startReportJob(session.id, stub.id);

    res.json({ reportId: stub.id, status: "generating" });
  } catch (err) {
    console.error("Error in /sessions/end:", err.message);
    return res.status(502).json({ error: "Report generation failed — please try ending the session again." });
  }
}));

app.get("/api/sessions/:id", (req, res) => {
  const s = store.getById("sessions", req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  if (deniedForSession(req, res, s)) return;
  res.json(s);
});

app.delete("/api/sessions/:id", (req, res) => {
  // Deleting a live session would make any in-flight /message //observe turn's
  // final store.update silently no-op (the record is gone), dropping that turn.
  // End it first; assignments already guard the same way.
  const s = store.getById("sessions", req.params.id);
  if (s) {
    if (deniedForSession(req, res, s)) return;
    if (s.status !== "ended") {
      return res.status(409).json({ error: "Session is still active — end it before deleting." });
    }
  }
  store.remove("sessions", req.params.id);
  res.json({ ok: true });
});

// --- Reports ---------------------------------------------------------------
app.get("/api/reports", (req, res) => {
  const { counsellorId, sessionId } = req.query;
  let all = store.getAll("reports");
  if (counsellorId) all = all.filter((r) => r.counsellorId === counsellorId);
  if (sessionId) all = all.filter((r) => r.sessionId === sessionId);
  // newest first
  all.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  res.json(all);
});

app.get("/api/reports/:id", (req, res) => {
  const r = store.getById("reports", req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (deniedForReport(req, res, r)) return;
  res.json(r);
});

app.delete("/api/reports/:id", (req, res) => {
  store.remove("reports", req.params.id);
  res.json({ ok: true });
});

// --- Config (admin-editable prompt + scoring scaffolding) ------------------
// GET returns the effective merged config (file over built-in defaults). PUT
// persists the body to the JSON file; loaders fail soft to defaults if the file
// is later missing/corrupt. Admin-only at the UI layer, like the other admin CRUD.
app.get("/api/config/prompts", (_req, res) => {
  res.json(getPromptConfig());
});

app.put("/api/config/prompts", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "prompt config must be a JSON object" });
  }
  try {
    writeFileSync(PROMPT_CONFIG_PATH, JSON.stringify(body, null, 2) + "\n");
  } catch (err) {
    console.error("Error writing prompt-config.json:", err.message);
    return res.status(500).json({ error: "failed to persist prompt config" });
  }
  // Return the effective (merged) config so the client sees defaults filled in.
  // Invalidate first: coarse filesystem mtime resolution can otherwise make
  // getPromptConfig return the pre-write cached object.
  invalidatePromptConfigCache();
  res.json(getPromptConfig());
});

app.get("/api/config/scoring", (_req, res) => {
  res.json(loadScoringConfig({ fresh: true }));
});

app.put("/api/config/scoring", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "scoring config must be a JSON object" });
  }
  try {
    const saved = saveScoringConfig(body);
    res.json(saved);
  } catch (err) {
    console.error("Error saving scoring config:", err.message);
    res.status(500).json({ error: "failed to persist scoring config" });
  }
});

// Transparency: the three composed prompts the LLM currently sees for a session.
// Admin-only at the UI layer (consistent with the other admin routes).
app.get("/api/sessions/:id/prompt", (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const transcript = session.transcript || [];
  const lastCounsellor = [...transcript].reverse().find((m) => m.role === "counsellor");
  const windowSize = loadScoringConfig().recentTurnsWindow;
  res.json({
    studentSystemPrompt: composeForInspection(session),
    scoringPrompt: scoringPromptForInspection({
      message: lastCounsellor?.text || "<counsellor message>",
      recentTurns: transcript.slice(-windowSize).map(({ role, text }) => ({ role, text })),
      phase: session.currentPhase,
      turnType: lastCounsellor?.turnType,
      courseName: session.courseSnapshot?.name,
      openObjections: openObjections(session.objectionState).map(({ category }) => ({ key: category })),
    }),
    reportPrompt: reportPromptForInspection(session),
  });
});

// On-demand richer cue: one deterministic LLM call over recent context, falling
// back to the synchronous corpus cue on any failure/timeout. Returns { cue, source }.
app.post("/api/sessions/:id/cue", async (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (deniedForSession(req, res, session)) return;
  // Same cue v2 context the per-turn path passes: last scoring adjustment + reason
  // and the live objection state. Computed once for both the success-fallback and
  // error-fallback instantCue calls below.
  const cueHist = Array.isArray(session.scoreHistory) ? session.scoreHistory : [];
  const cueLastEntry = cueHist.length ? cueHist[cueHist.length - 1] : null;
  const cueLastAdjustment = (cueLastEntry && typeof cueLastEntry.adjustment === "number") ? cueLastEntry.adjustment : null;
  const cueLastReason = cueLastEntry?.reason ?? null;
  const fallbackInstantCue = () => {
    const lastStudent = [...(session.transcript || [])].reverse().find((m) => m.role === "student");
    const objectionCategory = lastStudent ? detectObjectionCategory(lastStudent.text) : null;
    return instantCue({
      session, lastStudentText: lastStudent?.text || "", objectionCategory,
      lastCounsellorAdjustment: cueLastAdjustment, lastCounsellorScoreReason: cueLastReason,
      objectionState: session.objectionState,
    });
  };
  try {
    const llm = await llmCue(session);
    if (llm) return res.json({ cue: llm, source: llm.source });
    // Fall back to the instant cue, derived from the latest student turn.
    const cue = fallbackInstantCue();
    res.json({ cue, source: cue.source });
  } catch (err) {
    console.error("Error in /sessions/:id/cue:", err.message);
    const cue = fallbackInstantCue();
    res.json({ cue, source: cue.source });
  }
});

// --- Analytics -------------------------------------------------------------
app.get("/api/analytics/admin", (_req, res) => {
  const reports = store.getAll("reports");
  const assignments = store.getAll("assignments");
  const users = store.getAll("users");
  res.json(buildAdminAnalytics({ reports, assignments, users }));
});

app.get("/api/analytics/counsellor/:id", (req, res) => {
  const user = store.getById("users", req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const reports = store.getAll("reports");
  const assignments = store.getAll("assignments");
  const users = store.getAll("users");
  res.json(buildCounsellorAnalytics(req.params.id, { reports, assignments, users }));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

export { PHASE_NAMES };
