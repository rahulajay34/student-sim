import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

import express from "express";
import cors from "cors";

import * as store from "./store.js";
import { advancePhase, initPhaseCounters, initMilestones, PHASE_NAMES } from "./phases.js";
import { getFirstMessage, getStudentReply } from "./engine.js";
import { scoreMessage } from "./scoring.js";
import { generateReport } from "./report.js";
import { buildAdminAnalytics, buildCounsellorAnalytics } from "./analytics.js";

console.log("Ollama API key loaded:", process.env.OLLAMA_API_KEY ? "YES" : "NO - KEY MISSING");

const app = express();
app.use(cors());
app.use(express.json());

const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor };

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
  const { name, category, label, coreAnxiety, behaviourPrompt, description } = req.body || {};
  if (!name || !label) return res.status(400).json({ error: "name and label are required" });
  const now = new Date().toISOString();
  const persona = {
    id: store.newId("persona"),
    name, category: category || "custom", label,
    coreAnxiety: coreAnxiety || "", behaviourPrompt: behaviourPrompt || "", description: description || "",
    createdAt: now, updatedAt: now,
  };
  res.json(store.insert("personas", persona));
});

app.put("/api/personas/:id", (req, res) => {
  const { name, category, label, coreAnxiety, behaviourPrompt, description } = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries({ name, category, label, coreAnxiety, behaviourPrompt, description })) {
    if (v !== undefined) patch[k] = v;
  }
  const updated = store.update("personas", req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Persona not found" });
  res.json(updated);
});

app.delete("/api/personas/:id", (req, res) => {
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
  store.remove("rubric-templates", req.params.id);
  res.json({ ok: true });
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
  const { counsellorId, personaId, courseId, personaPromptOverride, scenario, createdBy, rubricTemplateId } = req.body || {};
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
    scenario: scenario || { title: "", difficulty: "medium", situation: "", contextNotes: "" },
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
  store.remove("assignments", req.params.id);
  res.json({ ok: true });
});

// --- Sessions --------------------------------------------------------------
app.post("/api/sessions/start", async (req, res) => {
  try {
    const { mode, counsellorId, assignmentId, personaId, scenario, courseId, rubricTemplateId: bodyRubricTemplateId } = req.body || {};
    if (!counsellorId) return res.status(400).json({ error: "counsellorId is required" });

    let personaId2 = personaId;
    let scenario2 = scenario || { title: "Free practice", difficulty: "medium", situation: "", contextNotes: "" };
    let override = null;
    let assignment = null;

    if (mode === "assigned") {
      assignment = store.getById("assignments", assignmentId);
      if (!assignment) return res.status(404).json({ error: "Assignment not found" });
      personaId2 = assignment.personaId;
      scenario2 = assignment.scenario;
      override = assignment.personaPromptOverride;
    }

    const persona = store.getById("personas", personaId2);
    if (!persona) return res.status(404).json({ error: "Persona not found" });

    const personaSnapshot = {
      name: persona.name, category: persona.category, label: persona.label,
      coreAnxiety: persona.coreAnxiety, behaviourPrompt: override || persona.behaviourPrompt,
    };

    let courseId2 = courseId;
    if (mode === "assigned" && assignment) courseId2 = assignment.courseId ?? courseId2;
    let course = courseId2 ? store.getById("courses", courseId2) : null;
    if (!course && mode === "assigned" && assignment && assignment.courseId) {
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

    const { text: firstMessage, emotion: firstEmotion } = await getFirstMessage(personaSnapshot, scenario2, courseSnapshot);
    const now = new Date().toISOString();
    const session = {
      id: store.newId("ses"),
      assignmentId: assignment ? assignment.id : null,
      counsellorId,
      mode: mode === "assigned" ? "assigned" : "practice",
      personaSnapshot,
      scenarioSnapshot: scenario2,
      courseSnapshot,
      rubricSnapshot,
      currentPhase: 1,
      satisfactionScore: 50,
      phaseCounters: initPhaseCounters(),
      milestones: initMilestones(),
      scoreHistory: [{ turn: 0, score: 50, adjustment: 0, reason: "start" }],
      transcript: [{ role: "student", text: firstMessage, emotion: firstEmotion, phase: 1, scoreAfter: 50, ts: now }],
      status: "active",
      startedAt: now, endedAt: null,
    };
    store.insert("sessions", session);

    if (assignment) store.update("assignments", assignment.id, { status: "in_progress", sessionId: session.id });

    res.json({ sessionId: session.id, firstMessage, emotion: firstEmotion, currentPhase: 1, satisfactionScore: 50, milestones: session.milestones });
  } catch (err) {
    console.error("Error in /sessions/start:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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

app.post("/api/sessions/:id/message", async (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found. Please start a new session." });
  if (session.status === "ended") return res.status(409).json({ error: "This session has ended." });
  const { message, deliveryMetrics: rawDeliveryMetrics } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    // Advance phase on the counsellor's message, then score it.
    advancePhase(session, "counsellor", message);
    const lastStudentMsg = [...session.transcript].reverse().find((m) => m.role === "student")?.text || "";
    const { adjustment, reason } = await scoreMessage(message, lastStudentMsg, session.courseSnapshot?.name);
    session.satisfactionScore = Math.max(0, Math.min(100, session.satisfactionScore + adjustment));

    const now = new Date().toISOString();
    const counsellorEntry = { role: "counsellor", text: message, phase: session.currentPhase, scoreAfter: session.satisfactionScore, ts: now };
    const sanitized = sanitizeDeliveryMetrics(rawDeliveryMetrics);
    if (sanitized) counsellorEntry.deliveryMetrics = sanitized;
    session.transcript.push(counsellorEntry);
    session.scoreHistory.push({ turn: session.scoreHistory.length, score: session.satisfactionScore, adjustment, reason });

    const { text: reply, emotion } = await getStudentReply(session);

    advancePhase(session, "student", reply);
    session.transcript.push({ role: "student", text: reply, emotion, phase: session.currentPhase, scoreAfter: session.satisfactionScore, ts: new Date().toISOString() });

    store.update("sessions", session.id, session);
    res.json({ reply, emotion, currentPhase: session.currentPhase, satisfactionScore: session.satisfactionScore, scoreReason: reason, milestones: session.milestones });
  } catch (err) {
    console.error("Error in /sessions/message:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sessions/:id/end", async (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  try {
    // Idempotent: if a report already exists for this session, return it.
    const existing = store.getAll("reports").find((r) => r.sessionId === session.id);
    if (existing) return res.json({ reportId: existing.id });

    const counsellor = store.getById("users", session.counsellorId);
    const generated = await generateReport(session, { counsellorName: counsellor?.name || "" });

    const report = {
      id: store.newId("rep"),
      sessionId: session.id,
      assignmentId: session.assignmentId,
      counsellorId: session.counsellorId,
      counsellorName: counsellor?.name || "",
      personaName: session.personaSnapshot?.name || "",
      scenarioTitle: session.scenarioSnapshot?.title || "",
      ...generated,
      transcript: session.transcript,
      generatedAt: new Date().toISOString(),
    };
    store.insert("reports", report);

    store.update("sessions", session.id, { status: "ended", endedAt: new Date().toISOString() });
    if (session.assignmentId) store.update("assignments", session.assignmentId, { status: "completed", reportId: report.id });

    res.json({ reportId: report.id });
  } catch (err) {
    console.error("Error in /sessions/end:", err.message);
    return res.status(502).json({ error: "Report generation failed — please try ending the session again." });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  const s = store.getById("sessions", req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json(s);
});

app.delete("/api/sessions/:id", (req, res) => {
  store.remove("sessions", req.params.id);
  res.json({ ok: true });
});

// --- Reports ---------------------------------------------------------------
app.get("/api/reports", (req, res) => {
  const { counsellorId } = req.query;
  let all = store.getAll("reports");
  if (counsellorId) all = all.filter((r) => r.counsellorId === counsellorId);
  // newest first
  all.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  res.json(all);
});

app.get("/api/reports/:id", (req, res) => {
  const r = store.getById("reports", req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  res.json(r);
});

app.delete("/api/reports/:id", (req, res) => {
  store.remove("reports", req.params.id);
  res.json({ ok: true });
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
