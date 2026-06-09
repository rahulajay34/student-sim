import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

import express from "express";
import cors from "cors";

import * as store from "./store.js";
import { advancePhase, initPhaseCounters, PHASE_NAMES } from "./phases.js";
import { getFirstMessage, getStudentReply } from "./engine.js";
import { scoreMessage } from "./scoring.js";
import { generateReport } from "./report.js";

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
  const { counsellorId, personaId, personaPromptOverride, scenario, createdBy } = req.body || {};
  if (!counsellorId || !personaId) return res.status(400).json({ error: "counsellorId and personaId are required" });
  const assignment = {
    id: store.newId("asn"),
    counsellorId, personaId,
    personaPromptOverride: personaPromptOverride || null,
    scenario: scenario || { title: "", difficulty: "medium", situation: "", contextNotes: "" },
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
    const { mode, counsellorId, assignmentId, personaId, scenario } = req.body || {};
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

    const firstMessage = await getFirstMessage(personaSnapshot, scenario2);
    const now = new Date().toISOString();
    const session = {
      id: store.newId("ses"),
      assignmentId: assignment ? assignment.id : null,
      counsellorId,
      mode: mode === "assigned" ? "assigned" : "practice",
      personaSnapshot,
      scenarioSnapshot: scenario2,
      currentPhase: 1,
      satisfactionScore: 50,
      phaseCounters: initPhaseCounters(),
      scoreHistory: [{ turn: 0, score: 50, adjustment: 0, reason: "start" }],
      transcript: [{ role: "student", text: firstMessage, phase: 1, scoreAfter: 50, ts: now }],
      status: "active",
      startedAt: now, endedAt: null,
    };
    store.insert("sessions", session);

    if (assignment) store.update("assignments", assignment.id, { status: "in_progress", sessionId: session.id });

    res.json({ sessionId: session.id, firstMessage, currentPhase: 1, satisfactionScore: 50 });
  } catch (err) {
    console.error("Error in /sessions/start:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sessions/:id/message", async (req, res) => {
  const session = store.getById("sessions", req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found. Please start a new session." });
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    // Advance phase on the counsellor's message, then score it.
    advancePhase(session, "counsellor", message);
    const lastStudentMsg = [...session.transcript].reverse().find((m) => m.role === "student")?.text || "";
    const { adjustment, reason } = await scoreMessage(message, lastStudentMsg);
    session.satisfactionScore = Math.max(0, Math.min(100, session.satisfactionScore + adjustment));

    const now = new Date().toISOString();
    session.transcript.push({ role: "counsellor", text: message, phase: session.currentPhase, scoreAfter: session.satisfactionScore, ts: now });
    session.scoreHistory.push({ turn: session.scoreHistory.length, score: session.satisfactionScore, adjustment, reason });

    const reply = await getStudentReply(session.personaSnapshot, session.scenarioSnapshot, session.currentPhase, session.satisfactionScore, session.transcript);

    advancePhase(session, "student", reply);
    session.transcript.push({ role: "student", text: reply, phase: session.currentPhase, scoreAfter: session.satisfactionScore, ts: new Date().toISOString() });

    store.update("sessions", session.id, session);
    res.json({ reply, currentPhase: session.currentPhase, satisfactionScore: session.satisfactionScore, scoreReason: reason });
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
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  const s = store.getById("sessions", req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json(s);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

export { PHASE_NAMES };
