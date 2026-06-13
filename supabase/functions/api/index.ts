// supabase/functions/api/index.ts
// CRUD + analytics edge function (Hono).
// All routes correspond 1-for-1 with server/index.js (source of truth).
// Auth: authenticate(req) — NO back-compat allow-all (unlike server/index.js).
// Written in plain JS syntax (no TS-only syntax) for Node --check compatibility.

import { Hono } from "npm:hono@4.10.1";
import { normalizePath } from "../_shared/path.js";
import { corsHeaders, handlePreflight } from "../_shared/cors.js";
import { authenticate, assertAdmin, assertSuperadmin, assertOwnerOrAdmin, httpError, errorResponse } from "../_shared/auth.js";
import { getEnv } from "../_shared/env.js";
import * as store from "../_shared/store.js";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.js";
import { buildAdminAnalytics, buildCounsellorAnalytics } from "../_shared/lib/analytics.js";
import { pickStudentVoice, inferGenderFromName } from "../_shared/lib/voices.js";
import { rollSessionFlavour, DEFAULT_PERSONALITY } from "../_shared/lib/personality.js";
import { composeForInspection } from "../_shared/lib/prompt.js";
import { loadPromptConfig, setActivePromptConfig } from "../_shared/lib/promptConfig.js";
import { loadScoringConfig } from "../_shared/lib/scoring.js";
import { advancePhase, initPhaseCounters, initMilestones } from "../_shared/lib/phases.js";
import { initObjectionState } from "../_shared/lib/objections.js";
import { stubReportSections } from "../_shared/lib/report.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function getOrigin(req) {
  return req.headers.get ? req.headers.get("origin") : (req.headers || {}).origin;
}

// Wrap a handler so thrown {httpStatus, error} objects map to the right HTTP code.
function wrap(fn) {
  return async (c) => {
    const origin = getOrigin(c.req.raw);
    try {
      return await fn(c);
    } catch (err) {
      if (err && err.isHttpError) {
        return jsonResponse({ error: err.message }, err.httpStatus, origin);
      }
      console.error("[api]", err && (err.stack || err.message));
      return jsonResponse({ error: err && err.message || "internal error" }, 500, origin);
    }
  };
}

// Public user shape for counsellor list
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor };
}

// Normalize session mode from request body
function normalizeSessionMode(v) {
  return String(v || "").toLowerCase() === "text" ? "text" : "voice";
}

function voiceEngineForMode(m) {
  return m === "text" ? "text" : "openai";
}

// Scenario normalization (clamps pushiness/hesitancy to 1-5)
function clampTuning(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

function normalizeScenario(scenario) {
  const s = (scenario && typeof scenario === "object") ? scenario : {};
  return {
    title: s.title || "",
    difficulty: s.difficulty || "medium",
    situation: s.situation || "",
    contextNotes: s.contextNotes || "",
    pushiness: clampTuning(s.pushiness),
    hesitancy: clampTuning(s.hesitancy),
  };
}

// Rubric criteria validation
function validateRubricCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length < 3) return "criteria must be an array of at least 3";
  const keys = new Set();
  let sum = 0;
  for (const c of criteria) {
    if (!c || typeof c.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(c.key)) return `bad criterion key: ${c && c.key}`;
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

function isValidFee(v) {
  return v === null || v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0);
}

function isValidStringArray(arr) {
  return Array.isArray(arr) && arr.every((x) => typeof x === "string" && x.trim().length > 0);
}

// Enrich an assignment with persona/counsellor name and hasReport
async function enrichAssignment(a) {
  const [persona, counsellor, report] = await Promise.all([
    a.personaId ? store.getById("personas", a.personaId).catch(() => null) : Promise.resolve(null),
    a.counsellorId ? store.getById("users", a.counsellorId).catch(() => null) : Promise.resolve(null),
    a.reportId ? store.getById("reports", a.reportId).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    ...a,
    personaName: persona && persona.name || "(deleted persona)",
    counsellorName: counsellor && counsellor.name || "(unknown)",
    hasReport: !!(a.reportId && report),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-session turn lease helpers (using claim_session_turn RPC)
// ─────────────────────────────────────────────────────────────────────────────
async function claimSessionTurn(sessionId, ttlSeconds) {
  const db = getSupabaseAdmin();
  const interval = ttlSeconds ? `${ttlSeconds} seconds` : "90 seconds";
  const { data, error } = await db.rpc("claim_session_turn", {
    p_session: sessionId,
    p_ttl: interval,
  });
  if (error) throw new Error(`claim_session_turn failed: ${error.message}`);
  return data; // uuid token or null
}

async function commitSessionTurn(sessionId, token, patch) {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("commit_session_turn", {
    p_session: sessionId,
    p_token: token,
    p_patch: patch,
  });
  if (error) throw new Error(`commit_session_turn failed: ${error.message}`);
  return data; // boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire-and-forget report worker invocation (detached promise, tolerates failure)
// ─────────────────────────────────────────────────────────────────────────────
function fireReportWorker(reportId) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  // Prefer the dedicated shared secret (same one the pg_cron sweeper uses).
  const serviceKey = getEnv("WORKER_SHARED_SECRET") || getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn("[api] Cannot fire report worker: missing SUPABASE_URL or worker secret");
    return;
  }
  const url = `${supabaseUrl}/functions/v1/report-worker`;
  // Detached — intentionally not awaited; the pg_cron sweeper recovers if this fails
  fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ report_id: reportId }),
  }).catch((err) => {
    console.warn("[api] report-worker fire-and-forget failed (non-fatal):", err && err.message);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// App config helpers (prompt + scoring config via app_config table)
// ─────────────────────────────────────────────────────────────────────────────
async function getAppConfigValue(key) {
  try {
    return await store.getConfigValue(key);
  } catch (err) {
    console.warn(`[api] getAppConfigValue(${key}) failed:`, err && err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hono app
// ─────────────────────────────────────────────────────────────────────────────
const app = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// COUNSELLORS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/counsellors", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  await authenticate(c.req.raw);
  const counsellors = await store.getCounsellors();
  return jsonResponse(counsellors.map(publicUser), 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAS CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/personas", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  await authenticate(c.req.raw);
  const personas = await store.getAll("personas");
  return jsonResponse(personas, 200, origin);
}));

app.post("/personas", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const body = await c.req.json().catch(() => ({}));
  const { name, category, label, coreAnxiety, behaviourPrompt, description, personality } = body || {};
  if (!name || !label) throw httpError(400, "name and label are required");
  const now = new Date().toISOString();
  const persona = {
    id: store.newId(),
    name,
    category: category || "custom",
    label,
    coreAnxiety: coreAnxiety || "",
    behaviourPrompt: behaviourPrompt || "",
    description: description || "",
    createdAt: now,
    updatedAt: now,
  };
  if (personality && typeof personality === "object") {
    persona.personality = personality;
  }
  const inserted = await store.insert("personas", persona);
  return jsonResponse(inserted, 200, origin);
}));

app.put("/personas/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const { name, category, label, coreAnxiety, behaviourPrompt, description, personality } = body || {};
  const patch = { updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries({ name, category, label, coreAnxiety, behaviourPrompt, description })) {
    if (v !== undefined) patch[k] = v;
  }
  if (personality !== undefined) patch.personality = personality;
  const updated = await store.update("personas", id, patch);
  if (!updated) throw httpError(404, "Persona not found");
  return jsonResponse(updated, 200, origin);
}));

app.delete("/personas/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const allAssignments = await store.getAll("assignments");
  const active = allAssignments.filter((a) => a.personaId === id && a.status !== "completed");
  if (active.length > 0) {
    throw httpError(409, `Cannot delete: ${active.length} active assignment(s) reference this persona. Complete or delete those assignments first.`);
  }
  await store.remove("personas", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// COURSES CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/courses", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  await authenticate(c.req.raw);
  const all = await store.getAll("courses");
  const activeOnly = c.req.query("active") === "1";
  return jsonResponse(activeOnly ? all.filter((co) => co.active) : all, 200, origin);
}));

app.post("/courses", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const b = await c.req.json().catch(() => ({}));
  if (!b.name || typeof b.name !== "string" || !b.name.trim()) throw httpError(400, "name and institute are required");
  if (!b.institute || typeof b.institute !== "string" || !b.institute.trim()) throw httpError(400, "name and institute are required");
  if (b.feeTotal !== undefined && b.feeTotal !== null && !isValidFee(b.feeTotal)) throw httpError(400, "invalid feeTotal");
  if (b.feeBooking !== undefined && b.feeBooking !== null && !isValidFee(b.feeBooking)) throw httpError(400, "invalid feeBooking");
  if (b.curriculum !== undefined && !isValidStringArray(b.curriculum)) throw httpError(400, "invalid curriculum");
  if (b.outcomes !== undefined && !isValidStringArray(b.outcomes)) throw httpError(400, "invalid outcomes");
  if (b.usps !== undefined && !isValidStringArray(b.usps)) throw httpError(400, "invalid usps");
  const course = {
    id: store.newId(),
    slug: b.slug || `manual/${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: b.name,
    category: b.category || "business-management",
    institute: b.institute,
    partner: "Masai School",
    duration: b.duration || "",
    format: b.format || "Online",
    feeTotal: b.feeTotal != null ? b.feeTotal : null,
    feeBooking: b.feeBooking != null ? b.feeBooking : null,
    feeNote: b.feeNote || "",
    emiNote: b.emiNote || "",
    curriculum: b.curriculum || [],
    outcomes: b.outcomes || [],
    eligibility: b.eligibility || "",
    usps: b.usps || [],
    batchInfo: b.batchInfo || "",
    sourceUrl: b.sourceUrl || "",
    scrapedAt: new Date().toISOString(),
    active: b.active !== false,
  };
  const inserted = await store.insert("courses", course);
  return jsonResponse(inserted, 200, origin);
}));

app.put("/courses/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  if (b.name !== undefined && (typeof b.name !== "string" || !b.name.trim())) throw httpError(400, "invalid name");
  if (b.institute !== undefined && (typeof b.institute !== "string" || !b.institute.trim())) throw httpError(400, "invalid institute");
  if (b.feeTotal !== undefined && b.feeTotal !== null && !isValidFee(b.feeTotal)) throw httpError(400, "invalid feeTotal");
  if (b.feeBooking !== undefined && b.feeBooking !== null && !isValidFee(b.feeBooking)) throw httpError(400, "invalid feeBooking");
  if (b.curriculum !== undefined && !isValidStringArray(b.curriculum)) throw httpError(400, "invalid curriculum");
  if (b.outcomes !== undefined && !isValidStringArray(b.outcomes)) throw httpError(400, "invalid outcomes");
  if (b.usps !== undefined && !isValidStringArray(b.usps)) throw httpError(400, "invalid usps");
  if (b.active !== undefined && typeof b.active !== "boolean") throw httpError(400, "invalid active");
  const allowed = ["name", "category", "institute", "duration", "format", "feeTotal", "feeBooking",
    "feeNote", "emiNote", "curriculum", "outcomes", "eligibility", "usps", "batchInfo", "active"];
  const patch = {};
  for (const k of allowed) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  const updated = await store.update("courses", id, patch);
  if (!updated) throw httpError(404, "Course not found");
  return jsonResponse(updated, 200, origin);
}));

app.delete("/courses/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  await store.remove("courses", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// RUBRIC TEMPLATES CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/rubric-templates", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  await authenticate(c.req.raw);
  const templates = await store.getAll("rubricTemplates");
  return jsonResponse(templates, 200, origin);
}));

app.post("/rubric-templates", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const body = await c.req.json().catch(() => ({}));
  const { name, description, criteria } = body || {};
  if (!name || typeof name !== "string" || !name.trim()) throw httpError(400, "name is required");
  const criteriaErr = validateRubricCriteria(criteria);
  if (criteriaErr) throw httpError(400, criteriaErr);
  const now = new Date().toISOString();
  const template = {
    id: store.newId(),
    name: name.trim(),
    description: description || "",
    criteria,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await store.insert("rubricTemplates", template);
  return jsonResponse(inserted, 200, origin);
}));

app.put("/rubric-templates/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const existing = await store.getById("rubricTemplates", id);
  if (!existing) throw httpError(404, "Rubric template not found");
  const body = await c.req.json().catch(() => ({}));
  const { name, description, criteria } = body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) throw httpError(400, "name is required");
  if (criteria !== undefined) {
    const criteriaErr = validateRubricCriteria(criteria);
    if (criteriaErr) throw httpError(400, criteriaErr);
  }
  const patch = { updatedAt: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (description !== undefined) patch.description = description;
  if (criteria !== undefined) patch.criteria = criteria;
  // isDefault changes are silently ignored (immutable)
  const updated = await store.update("rubricTemplates", id, patch);
  return jsonResponse(updated, 200, origin);
}));

app.delete("/rubric-templates/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const existing = await store.getById("rubricTemplates", id);
  if (!existing) throw httpError(404, "Rubric template not found");
  if (existing.isDefault) throw httpError(400, "Cannot delete the default template");
  const allAssignments = await store.getAll("assignments");
  const active = allAssignments.filter((a) => a.rubricTemplateId === id && a.status !== "completed");
  if (active.length > 0) {
    throw httpError(409, `Cannot delete: ${active.length} active assignment(s) use this rubric template. Complete or delete those assignments first.`);
  }
  await store.remove("rubricTemplates", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// LEAD PROFILES (read-only, from Supabase table)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/lead-profiles", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  await authenticate(c.req.raw);
  // Through the store mapper so legacy extras (description, …) are restored
  // to top-level — the clients read profile.description directly.
  let profiles = await store.getAll("leadProfiles");
  const categoryFilter = c.req.query("category");
  if (categoryFilter) {
    profiles = profiles.filter((p) => p.category === categoryFilter);
  }
  return jsonResponse(profiles, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENTS CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get("/assignments", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  let all = await store.getAll("assignments");
  // Non-admin counsellors can only see their own
  if (ctx.role !== "admin" && ctx.role !== "superadmin") {
    all = all.filter((a) => a.counsellorId === ctx.id);
  } else {
    const counsellorId = c.req.query("counsellorId");
    if (counsellorId) all = all.filter((a) => a.counsellorId === counsellorId);
  }
  const enriched = await Promise.all(all.map(enrichAssignment));
  return jsonResponse(enriched, 200, origin);
}));

app.post("/assignments", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const body = await c.req.json().catch(() => ({}));
  const { counsellorId, personaId, courseId, personaPromptOverride, scenario, createdBy, rubricTemplateId, profileId, revealPersona } = body || {};
  if (!counsellorId || !personaId) throw httpError(400, "counsellorId and personaId are required");
  const course = await store.getById("courses", courseId);
  if (!course) throw httpError(400, "courseId is required and must exist");
  if (rubricTemplateId) {
    const tpl = await store.getById("rubricTemplates", rubricTemplateId);
    if (!tpl) throw httpError(400, "rubricTemplateId not found");
  }
  if (profileId) {
    const db = getSupabaseAdmin();
    const { data: profile } = await db.from("lead_profiles").select("id").eq("id", profileId).maybeSingle();
    if (!profile) throw httpError(400, "profileId not found in lead profiles");
  }
  const assignment = {
    id: crypto.randomUUID(),
    counsellorId,
    personaId,
    courseId,
    personaPromptOverride: personaPromptOverride != null ? personaPromptOverride : null,
    profileId: profileId || null,
    scenario: normalizeScenario(scenario),
    rubricTemplateId: rubricTemplateId || null,
    revealPersona: revealPersona !== false,
    status: "assigned",
    createdBy: createdBy || ctx.id,
    createdAt: new Date().toISOString(),
    sessionId: null,
    reportId: null,
  };
  const inserted = await store.insert("assignments", assignment);
  return jsonResponse(inserted, 200, origin);
}));

app.get("/assignments/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  const a = await store.getById("assignments", id);
  if (!a) throw httpError(404, "Assignment not found");
  assertOwnerOrAdmin(ctx, a.counsellorId);
  const enriched = await enrichAssignment(a);
  return jsonResponse(enriched, 200, origin);
}));

app.delete("/assignments/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const allSessions = await store.getAll("sessions");
  const activeSession = allSessions.find((s) => s.assignmentId === id && s.status !== "ended");
  if (activeSession) {
    throw httpError(409, "Cannot delete: this assignment has an active session in progress. End the session first.");
  }
  await store.remove("assignments", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENT TEMPLATES CRUD + bulk-assign
// ─────────────────────────────────────────────────────────────────────────────
app.get("/assignment-templates", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const templates = await store.getAll("assignmentTemplates");
  return jsonResponse(templates, 200, origin);
}));

app.post("/assignment-templates", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const body = await c.req.json().catch(() => ({}));
  const { name, personaId, courseId, rubricTemplateId, profileId, scenario, personaPromptOverride, revealPersona } = body || {};
  if (!name || typeof name !== "string" || !name.trim()) throw httpError(400, "name is required");
  // Validate referenced IDs exist
  if (personaId) {
    const persona = await store.getById("personas", personaId);
    if (!persona) throw httpError(400, "personaId not found");
  }
  if (courseId) {
    const course = await store.getById("courses", courseId);
    if (!course) throw httpError(400, "courseId not found");
  }
  if (rubricTemplateId) {
    const tpl = await store.getById("rubricTemplates", rubricTemplateId);
    if (!tpl) throw httpError(400, "rubricTemplateId not found");
  }
  if (profileId) {
    const db = getSupabaseAdmin();
    const { data: profile } = await db.from("lead_profiles").select("id").eq("id", profileId).maybeSingle();
    if (!profile) throw httpError(400, "profileId not found in lead profiles");
  }
  const template = {
    id: crypto.randomUUID(),
    name: name.trim(),
    personaId: personaId || null,
    courseId: courseId || null,
    rubricTemplateId: rubricTemplateId || null,
    profileId: profileId || null,
    scenario: normalizeScenario(scenario),
    personaPromptOverride: personaPromptOverride != null ? personaPromptOverride : null,
    revealPersona: revealPersona !== false,
    createdBy: ctx.id,
    createdAt: new Date().toISOString(),
  };
  const inserted = await store.insert("assignmentTemplates", template);
  return jsonResponse(inserted, 200, origin);
}));

app.put("/assignment-templates/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const existing = await store.getById("assignmentTemplates", id);
  if (!existing) throw httpError(404, "Assignment template not found");
  const body = await c.req.json().catch(() => ({}));
  const { name, personaId, courseId, rubricTemplateId, profileId, scenario, personaPromptOverride, revealPersona } = body || {};
  // Validate referenced IDs if provided
  if (personaId) {
    const persona = await store.getById("personas", personaId);
    if (!persona) throw httpError(400, "personaId not found");
  }
  if (courseId) {
    const course = await store.getById("courses", courseId);
    if (!course) throw httpError(400, "courseId not found");
  }
  if (rubricTemplateId) {
    const tpl = await store.getById("rubricTemplates", rubricTemplateId);
    if (!tpl) throw httpError(400, "rubricTemplateId not found");
  }
  if (profileId) {
    const db = getSupabaseAdmin();
    const { data: profile } = await db.from("lead_profiles").select("id").eq("id", profileId).maybeSingle();
    if (!profile) throw httpError(400, "profileId not found in lead profiles");
  }
  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (personaId !== undefined) patch.personaId = personaId;
  if (courseId !== undefined) patch.courseId = courseId;
  if (rubricTemplateId !== undefined) patch.rubricTemplateId = rubricTemplateId;
  if (profileId !== undefined) patch.profileId = profileId;
  if (scenario !== undefined) patch.scenario = normalizeScenario(scenario);
  if (personaPromptOverride !== undefined) patch.personaPromptOverride = personaPromptOverride;
  if (revealPersona !== undefined) patch.revealPersona = revealPersona;
  const updated = await store.update("assignmentTemplates", id, patch);
  return jsonResponse(updated, 200, origin);
}));

app.delete("/assignment-templates/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const existing = await store.getById("assignmentTemplates", id);
  if (!existing) throw httpError(404, "Assignment template not found");
  await store.remove("assignmentTemplates", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// POST /assignment-templates/:id/assign — create one assignment per counsellor from template
app.post("/assignment-templates/:id/assign", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const template = await store.getById("assignmentTemplates", id);
  if (!template) throw httpError(404, "Assignment template not found");
  const body = await c.req.json().catch(() => ({}));
  const { counsellorIds } = body || {};
  if (!Array.isArray(counsellorIds) || counsellorIds.length === 0) {
    throw httpError(400, "counsellorIds must be a non-empty array");
  }
  // Validate all counsellor IDs are real profiles
  const profileChecks = await Promise.all(counsellorIds.map((cid) => store.getById("users", cid).catch(() => null)));
  for (let i = 0; i < counsellorIds.length; i++) {
    const profile = profileChecks[i];
    if (!profile) throw httpError(400, `counsellorId not found: ${counsellorIds[i]}`);
    if (profile.role !== "counsellor" && profile.role !== "admin" && profile.role !== "superadmin") {
      throw httpError(400, `counsellorId ${counsellorIds[i]} is not a counsellor or admin profile`);
    }
  }
  const now = new Date().toISOString();
  const created = [];
  for (const counsellorId of counsellorIds) {
    const assignment = {
      id: crypto.randomUUID(),
      counsellorId,
      personaId: template.personaId || null,
      courseId: template.courseId || null,
      rubricTemplateId: template.rubricTemplateId || null,
      profileId: template.profileId || null,
      templateId: template.id,
      scenario: template.scenario || normalizeScenario({}),
      personaPromptOverride: template.personaPromptOverride != null ? template.personaPromptOverride : null,
      revealPersona: template.revealPersona !== false,
      status: "assigned",
      createdBy: ctx.id,
      createdAt: now,
      sessionId: null,
      reportId: null,
    };
    const inserted = await store.insert("assignments", assignment);
    created.push(inserted);
  }
  return jsonResponse({ created: created.length, assignments: created }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────────────
app.post("/sessions/start", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  const {
    mode,
    assignmentId,
    personaId,
    scenario,
    courseId,
    openaiVoice: bodyOpenaiVoice,
    profileId: bodyProfileId,
  } = body || {};

  const sessionMode = normalizeSessionMode(mode);
  const voiceEngine = voiceEngineForMode(sessionMode);

  const isAssigned = Boolean(assignmentId);

  let personaId2 = personaId;
  let scenario2 = scenario || { title: "Free practice", difficulty: "medium", situation: "", contextNotes: "" };
  let override = null;
  let assignment = null;
  let profileId2 = bodyProfileId || null;

  if (isAssigned) {
    assignment = await store.getById("assignments", assignmentId);
    if (!assignment) throw httpError(404, "Assignment not found");
    // Ownership: assignment must belong to this counsellor (non-admin)
    if (ctx.role !== "admin" && ctx.role !== "superadmin" && assignment.counsellorId !== ctx.id) {
      throw httpError(403, "This assignment belongs to another counsellor.");
    }
    // Duplicate-start guard — rely on the DB unique partial index (23505 -> 409 below)
    // but also check in-band for a cleaner error message
    if (assignment.sessionId) {
      const live = await store.getById("sessions", assignment.sessionId).catch(() => null);
      if (live && live.status !== "ended") {
        throw httpError(409, "An active session already exists for this assignment.");
      }
    }
    personaId2 = assignment.personaId;
    scenario2 = assignment.scenario;
    override = assignment.personaPromptOverride;
    if (assignment.profileId) profileId2 = assignment.profileId;
  }

  scenario2 = normalizeScenario(scenario2);

  const persona = await store.getById("personas", personaId2);
  if (!persona) throw httpError(404, "Persona not found");

  // Resolve the counsellor's address term from the caller's profile name
  const counsellorUser = await store.getById("users", ctx.id).catch(() => null);
  const counsellorGender = inferGenderFromName(counsellorUser && counsellorUser.name);
  const counsellorAddress = counsellorGender === "female" ? "ma'am"
    : counsellorGender === "male" ? "sir"
    : null;

  // Resolve lead card from profileId2
  let leadCard = null;
  if (profileId2) {
    const db = getSupabaseAdmin();
    const { data: profile } = await db.from("lead_profiles").select("*").eq("id", profileId2).maybeSingle();
    if (profile) {
      leadCard = {
        profileId: profile.id,
        name: profile.name || null,
        gender: profile.gender || inferGenderFromName(profile.name) || null,
        age: typeof profile.age === "number" ? profile.age : null,
        occupation: profile.occupation || null,
        education: profile.education || null,
        city: profile.city || null,
      };
    } else {
      console.warn(`[session-start] profileId ${profileId2} could not be resolved — starting with a bare persona`);
    }
  }

  const sessionId = crypto.randomUUID();
  const studentGender = (leadCard && leadCard.gender) || null;
  const voice = pickStudentVoice(sessionId, studentGender);

  // Personality flavour roll
  const resolvedPersonality = (persona.personality && typeof persona.personality === "object")
    ? persona.personality
    : DEFAULT_PERSONALITY;
  const personalityFlavour = rollSessionFlavour(resolvedPersonality);

  const personaSnapshot = {
    name: persona.name,
    category: persona.category,
    label: persona.label,
    coreAnxiety: persona.coreAnxiety,
    behaviourPrompt: override != null ? override : persona.behaviourPrompt,
    voiceName: (leadCard && leadCard.name) || voice.name,
    voiceGender: studentGender || voice.gender,
    personality: resolvedPersonality,
  };

  // Resolve course
  let courseId2 = courseId;
  if (assignment) courseId2 = assignment.courseId || courseId2;
  let course = courseId2 ? await store.getById("courses", courseId2).catch(() => null) : null;
  if (!course && assignment && assignment.courseId) {
    throw httpError(404, "Course not found for this assignment");
  }
  if (!course) {
    // Practice mode without courseId: find a default
    const all = await store.getAll("courses");
    course = all.find((co) => co.slug === "iim-ranchi/business-analytics-ai-sop") || null;
  }
  const courseSnapshot = course ? { ...course } : null;

  // Resolve rubric template
  const allTemplates = await store.getAll("rubricTemplates");
  const resolvedTemplateId = (assignment && assignment.rubricTemplateId) || null;
  let tpl = resolvedTemplateId ? allTemplates.find((t) => t.id === resolvedTemplateId) || null : null;
  if (!tpl) tpl = allTemplates.find((t) => t.isDefault) || null;
  const rubricSnapshot = tpl ? { templateId: tpl.id, name: tpl.name, criteria: tpl.criteria } : null;

  const revealPersona = assignment ? (assignment.revealPersona !== false) : true;

  // Normalize openaiVoice
  const openaiVoice = (typeof bodyOpenaiVoice === "string" && bodyOpenaiVoice.trim()) ? bodyOpenaiVoice.trim() : "auto";

  const now = new Date().toISOString();

  // Activate the live prompt config before composing the prompt snapshot.
  const promptsCfgRow = await getAppConfigValue("prompts");
  setActivePromptConfig(promptsCfgRow);

  // Composed student system prompt snapshot (counsellor-first: no firstMessage)
  const promptSnapshot = composeForInspection({
    personaSnapshot,
    scenarioSnapshot: scenario2,
    courseSnapshot,
    currentPhase: 1,
    satisfactionScore: 50,
    personalityFlavour,
  });

  const session = {
    id: sessionId,
    assignmentId: assignment ? assignment.id : null,
    counsellorId: ctx.id,
    isPractice: !isAssigned,
    mode: isAssigned ? "assigned" : "practice",
    sessionMode,
    voiceEngine,
    openaiVoice,
    personaSnapshot,
    scenarioSnapshot: scenario2,
    courseSnapshot,
    rubricSnapshot,
    promptSnapshot,
    personalityFlavour,
    leadCard,
    counsellorAddress,
    revealPersona,
    voice,
    currentPhase: 1,
    satisfactionScore: 50,
    milestones: initMilestones(),
    objectionState: initObjectionState(),
    scoreHistory: [{ turn: 0, score: 50, adjustment: 0, reason: "start" }],
    transcript: [],
    status: "active",
    startedAt: now,
    endedAt: null,
  };

  try {
    await store.insert("sessions", session);
  } catch (err) {
    // Postgres 23505 = unique_violation (duplicate-start guard from partial unique index)
    if (err && (err.code === "23505" || (err.message && err.message.includes("23505")))) {
      throw httpError(409, "An active session already exists for this assignment.");
    }
    throw err;
  }

  if (assignment) {
    await store.update("assignments", assignment.id, { status: "in_progress", sessionId: session.id });
  }

  return jsonResponse({
    sessionId: session.id,
    firstMessage: null,
    emotion: null,
    currentPhase: 1,
    satisfactionScore: 50,
    milestones: session.milestones,
    voice,
    revealPersona,
    leadCard,
    voiceEngine,
    openaiVoice,
    sessionMode,
  }, 200, origin);
}));

app.get("/sessions/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  const session = await store.getById("sessions", id);
  if (!session) throw httpError(404, "Session not found");
  assertOwnerOrAdmin(ctx, session.counsellorId);
  return jsonResponse(session, 200, origin);
}));

app.delete("/sessions/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  const session = await store.getById("sessions", id).catch(() => null);
  if (session) {
    assertOwnerOrAdmin(ctx, session.counsellorId);
    if (session.status !== "ended") {
      throw httpError(409, "Session is still active — end it before deleting.");
    }
  }
  await store.remove("sessions", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// GET /sessions/:id/prompt — composed prompts (admin only)
app.get("/sessions/:id/prompt", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  const session = await store.getById("sessions", id);
  if (!session) throw httpError(404, "Session not found");

  // Import scoring inspection lazily (avoids issues if lib missing at edge boot)
  const { scoringPromptForInspection } = await import("../_shared/lib/scoring.js");
  const { reportPromptForInspection } = await import("../_shared/lib/report.js");
  const { openObjections } = await import("../_shared/lib/objections.js");

  const scoringCfgRow = await getAppConfigValue("scoring");
  const cfg = loadScoringConfig(scoringCfgRow);
  const promptsCfgRow2 = await getAppConfigValue("prompts");
  setActivePromptConfig(promptsCfgRow2);
  const transcript = session.transcript || [];
  const lastCounsellor = [...transcript].reverse().find((m) => m.role === "counsellor");
  const windowSize = cfg.recentTurnsWindow;

  const openObjs = openObjections(session.objectionState || []).map((o) => ({ key: o.category }));

  return jsonResponse({
    studentSystemPrompt: composeForInspection(session),
    scoringPrompt: scoringPromptForInspection({
      message: (lastCounsellor && lastCounsellor.text) || "<counsellor message>",
      recentTurns: transcript.slice(-windowSize).map((m) => ({ role: m.role, text: m.text })),
      phase: session.currentPhase,
      turnType: lastCounsellor && lastCounsellor.turnType,
      courseName: session.courseSnapshot && session.courseSnapshot.name,
      openObjections: openObjs,
    }),
    reportPrompt: reportPromptForInspection(session),
  }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/end — async report generation
// ─────────────────────────────────────────────────────────────────────────────
app.post("/sessions/:id/end", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  const session = await store.getById("sessions", id);
  if (!session) throw httpError(404, "Session not found");
  assertOwnerOrAdmin(ctx, session.counsellorId);

  // Claim a short-TTL lease so concurrent /end calls serialize safely
  const token = await claimSessionTurn(id, 30);
  if (!token) {
    // Check for an existing report stub before returning 409 — be idempotent
    // when /end is called again after the session was already ended (matches Express semantics).
    const db = getSupabaseAdmin();
    const { data: existingEndRows } = await db.from("reports").select("id, status").eq("session_id", id).limit(1);
    const existingEnd = existingEndRows && existingEndRows.length > 0 ? existingEndRows[0] : null;
    if (existingEnd) {
      return jsonResponse({ reportId: existingEnd.id, status: existingEnd.status || "generating" }, 200, origin);
    }
    throw httpError(409, "Session has a turn in progress — retry in a moment.");
  }

  try {
    // Check for existing report stub
    const db = getSupabaseAdmin();
    const { data: existingRows } = await db.from("reports").select("*").eq("session_id", id).limit(1);
    const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;

    if (existing) {
      const status = existing.status || "ready";
      // Re-kick if generating (stale after restart) or fallback
      if (status === "generating" || status === "fallback") {
        // Reset to generating and fire worker again
        await db.from("reports").update({ status: "generating" }).eq("id", existing.id);
        // Mark session ended (idempotent)
        await commitSessionTurn(id, token, {
          status: "ended",
          ended_at: session.endedAt || new Date().toISOString(),
        });
        if (session.assignmentId) {
          await store.update("assignments", session.assignmentId, { status: "completed", reportId: existing.id });
        }
        fireReportWorker(existing.id);
        return jsonResponse({ reportId: existing.id, status: "generating" }, 200, origin);
      }
      // Good report already exists — release lease and return
      await commitSessionTurn(id, token, {});
      return jsonResponse({ reportId: existing.id, status }, 200, origin);
    }

    // No report yet — persist stub immediately
    const counsellor = await store.getById("users", session.counsellorId).catch(() => null);
    const stubs = stubReportSections(session);
    const reportId = crypto.randomUUID();
    const stub = {
      id: reportId,
      sessionId: session.id,
      assignmentId: session.assignmentId,
      counsellorId: session.counsellorId,
      counsellorName: (counsellor && counsellor.name) || "",
      personaName: (session.personaSnapshot && session.personaSnapshot.name) || "",
      scenarioTitle: (session.scenarioSnapshot && session.scenarioSnapshot.title) || "",
      status: "generating",
      ...stubs,
      generatedAt: new Date().toISOString(),
    };
    await store.insert("reports", stub);

    // Mark session ended + assignment completed
    await commitSessionTurn(id, token, {
      status: "ended",
      ended_at: new Date().toISOString(),
    });
    if (session.assignmentId) {
      await store.update("assignments", session.assignmentId, { status: "completed", reportId });
    }

    fireReportWorker(reportId);
    return jsonResponse({ reportId, status: "generating" }, 200, origin);
  } catch (err) {
    // Release lease on error
    try { await commitSessionTurn(id, token, {}); } catch { /* ignore */ }
    throw err;
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/reports", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const counsellorId = c.req.query("counsellorId");
  const sessionId = c.req.query("sessionId");
  let all = await store.getAll("reports");
  // Non-admin: only own reports
  if (ctx.role !== "admin" && ctx.role !== "superadmin") {
    all = all.filter((r) => r.counsellorId === ctx.id);
  } else {
    if (counsellorId) all = all.filter((r) => r.counsellorId === counsellorId);
  }
  if (sessionId) all = all.filter((r) => r.sessionId === sessionId);
  // Newest first
  all.sort((a, b) => ((a.generatedAt || "") < (b.generatedAt || "") ? 1 : -1));
  return jsonResponse(all, 200, origin);
}));

app.get("/reports/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  const report = await store.getById("reports", id);
  if (!report) throw httpError(404, "Report not found");
  assertOwnerOrAdmin(ctx, report.counsellorId);
  return jsonResponse(report, 200, origin);
}));

app.delete("/reports/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const id = c.req.param("id");
  await store.remove("reports", id);
  return jsonResponse({ ok: true }, 200, origin);
}));

// POST /reports/:id/regenerate — reset generating + re-fire worker
app.post("/reports/:id/regenerate", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  const report = await store.getById("reports", id);
  if (!report) throw httpError(404, "Report not found");
  assertOwnerOrAdmin(ctx, report.counsellorId);
  const db = getSupabaseAdmin();
  await db.from("reports").update({ status: "generating" }).eq("id", id);
  fireReportWorker(id);
  return jsonResponse({ reportId: id, status: "generating" }, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/analytics/admin", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  // Exclude practice sessions/reports from team aggregates + heatmap
  const [allReports, allAssignments, allUsers] = await Promise.all([
    store.getAll("reports"),
    store.getAll("assignments"),
    store.getAll("users"),
  ]);
  // Get session isPractice flags to filter reports
  const allSessions = await store.getAll("sessions");
  const practiceSessions = new Set(allSessions.filter((s) => s.isPractice).map((s) => s.id));
  // Filter out reports from practice sessions for admin team analytics
  const teamReports = allReports.filter((r) => !practiceSessions.has(r.sessionId));
  const analytics = buildAdminAnalytics({ reports: teamReports, assignments: allAssignments, users: allUsers });
  return jsonResponse(analytics, 200, origin);
}));

app.get("/analytics/counsellor/:id", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  const id = c.req.param("id");
  // Self or admin
  if (ctx.role !== "admin" && ctx.role !== "superadmin" && ctx.id !== id) {
    throw httpError(403, "You do not have access to this resource.");
  }
  const user = await store.getById("users", id).catch(() => null);
  if (!user) throw httpError(404, "User not found");
  const [allReports, allAssignments, allUsers] = await Promise.all([
    store.getAll("reports"),
    store.getAll("assignments"),
    store.getAll("users"),
  ]);
  // Include practice sessions in own stats, but exclude from team comparison
  // (per spec: exclude practice from team aggregates but include in individual's own stats)
  const allSessions = await store.getAll("sessions");
  const practiceSessions = new Set(allSessions.filter((s) => s.isPractice).map((s) => s.id));
  // For the team comparison pass: filter out practice reports
  const teamReports = allReports.filter((r) => !practiceSessions.has(r.sessionId));
  // For own stats: include everything (pass allReports but let the lib use counsellorId filter)
  // The lib buildCounsellorAnalytics builds own + team from the same reports array.
  // We replace the reports arg with teamReports but re-add own practice reports
  const ownPracticeReports = allReports.filter((r) => r.counsellorId === id && practiceSessions.has(r.sessionId));
  const reportsForCounsellor = [
    ...teamReports,
    ...ownPracticeReports.filter((r) => !teamReports.some((tr) => tr.id === r.id)),
  ];
  const analytics = buildCounsellorAnalytics(id, { reports: reportsForCounsellor, assignments: allAssignments, users: allUsers });
  return jsonResponse(analytics, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG (admin-only GET and PUT)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/config/prompts", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const row = await getAppConfigValue("prompts");
  const cfg = loadPromptConfig(row);
  return jsonResponse(cfg, 200, origin);
}));

app.put("/config/prompts", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "prompt config must be a JSON object");
  }
  await store.upsertConfig("prompts", body, ctx.id);
  const saved = await getAppConfigValue("prompts");
  const cfg = loadPromptConfig(saved);
  return jsonResponse(cfg, 200, origin);
}));

app.get("/config/scoring", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const row = await getAppConfigValue("scoring");
  const cfg = loadScoringConfig(row);
  return jsonResponse(cfg, 200, origin);
}));

app.put("/config/scoring", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertAdmin(ctx);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "scoring config must be a JSON object");
  }
  await store.upsertConfig("scoring", body, ctx.id);
  const saved = await getAppConfigValue("scoring");
  const cfg = loadScoringConfig(saved);
  return jsonResponse(cfg, 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT (superadmin only) — mirrors server/index.js semantics exactly.
// ─────────────────────────────────────────────────────────────────────────────

// GET /users — list all users (id, name, email, role, avatarColor).
app.get("/users", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertSuperadmin(ctx);
  const all = await store.getAll("users");
  return jsonResponse(all.map(publicUser), 200, origin);
}));

// PUT /users/:id/role — change a user's role (superadmin only).
app.put("/users/:id/role", wrap(async (c) => {
  const origin = getOrigin(c.req.raw);
  const ctx = await authenticate(c.req.raw);
  assertSuperadmin(ctx);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const { role } = body || {};
  const VALID = ["counsellor", "admin", "superadmin"];
  if (!role || !VALID.includes(role)) {
    throw httpError(400, `role must be one of: ${VALID.join(", ")}`);
  }
  const existing = await store.getById("users", id);
  if (!existing) throw httpError(404, "User not found");
  const updated = await store.update("users", id, { role });
  return jsonResponse(publicUser(updated), 200, origin);
}));

// ─────────────────────────────────────────────────────────────────────────────
// Deno edge function entry point
// ─────────────────────────────────────────────────────────────────────────────
const FN_NAME = "api";

export default {
  fetch(req) {
    const origin = req.headers && req.headers.get ? req.headers.get("origin") : undefined;

    // Handle OPTIONS preflight immediately
    const pf = handlePreflight(req);
    if (pf) return pf;

    // Normalize the path so Hono sees plain routes like "/counsellors"
    const normalizedPath = normalizePath(req, FN_NAME);
    const url = new URL(req.url);
    url.pathname = normalizedPath;
    const normalizedReq = new Request(url.toString(), {
      method: req.method,
      headers: req.headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    });

    return app.fetch(normalizedReq).catch((err) => {
      console.error("[api] unhandled error:", err && (err.stack || err.message));
      return jsonResponse({ error: err && err.message || "internal error" }, 500, origin);
    });
  },
};
