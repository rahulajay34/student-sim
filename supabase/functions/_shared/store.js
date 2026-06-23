// _shared/store.js — async repository over the Supabase service-role client.
//
// LEGACY SURFACE PRESERVED: all existing route/engine logic uses camelCase object
// shapes (e.g. counsellorId, currentPhase, satisfactionScore) derived from the
// JSON file store. The Supabase schema is snake_case with some fields packed into
// jsonb columns. This module bridges the two worlds with per-collection mappers.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  COLUMN ↔ FIELD MAPPING REFERENCE (authoritative)                      ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: profiles                                                         ║
// ║   avatar_color      ↔ avatarColor                                       ║
// ║   created_at        ↔ createdAt                                         ║
// ║   (all other cols direct map)                                           ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: personas                                                         ║
// ║   core_anxiety      ↔ coreAnxiety                                       ║
// ║   behaviour_prompt  ↔ behaviourPrompt                                   ║
// ║   created_at        ↔ createdAt                                         ║
// ║   updated_at        ↔ updatedAt                                         ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: courses                                                          ║
// ║   fee_total         ↔ feeTotal                                          ║
// ║   fee_booking       ↔ feeBooking                                        ║
// ║   fee_note          ↔ feeNote                                           ║
// ║   emi_note          ↔ emiNote                                           ║
// ║   created_at        ↔ createdAt                                         ║
// ║   updated_at        ↔ updatedAt                                         ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: rubric_templates (collection: "rubricTemplates")                 ║
// ║   is_default        ↔ isDefault                                         ║
// ║   created_at        ↔ createdAt                                         ║
// ║   updated_at        ↔ updatedAt                                         ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: lead_profiles (collection: "leadProfiles")                       ║
// ║   (all cols direct / no compound camel fields; data jsonb kept as-is)   ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: assignment_templates (collection: "assignmentTemplates")         ║
// ║   persona_id        ↔ personaId                                         ║
// ║   course_id         ↔ courseId                                          ║
// ║   rubric_template_id↔ rubricTemplateId                                  ║
// ║   profile_id        ↔ profileId                                         ║
// ║   persona_prompt_override ↔ personaPromptOverride                       ║
// ║   reveal_persona    ↔ revealPersona                                     ║
// ║   created_by        ↔ createdBy                                         ║
// ║   created_at        ↔ createdAt                                         ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: assignments                                                      ║
// ║   counsellor_id     ↔ counsellorId                                      ║
// ║   persona_id        ↔ personaId                                         ║
// ║   course_id         ↔ courseId                                          ║
// ║   rubric_template_id↔ rubricTemplateId                                  ║
// ║   profile_id        ↔ profileId                                         ║
// ║   template_id       ↔ templateId                                        ║
// ║   persona_prompt_override ↔ personaPromptOverride                       ║
// ║   reveal_persona    ↔ revealPersona                                     ║
// ║   session_id        ↔ sessionId                                         ║
// ║   report_id         ↔ reportId                                          ║
// ║   created_by        ↔ createdBy                                         ║
// ║   created_at        ↔ createdAt                                         ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: sessions                                                         ║
// ║   assignment_id     ↔ assignmentId                                      ║
// ║   owner_id          ↔ counsellorId   (legacy name kept on object)       ║
// ║   is_practice       ↔ isPractice                                        ║
// ║   origin            ↔ mode           (enum: 'assigned'|'practice')      ║
// ║   session_mode      ↔ sessionMode    (enum: 'voice'|'text')             ║
// ║   voice_engine      ↔ voiceEngine                                       ║
// ║   current_phase     ↔ currentPhase                                      ║
// ║   satisfaction_score↔ satisfactionScore                                 ║
// ║   started_at        ↔ startedAt                                         ║
// ║   ended_at          ↔ endedAt                                           ║
// ║   last_turn_verbosity ↔ lastTurnVerbosity                               ║
// ║   thinking_mode     ↔ thinkingMode                                      ║
// ║   turn_lease_until  ↔ turnLeaseUntil (internal; usually stripped)       ║
// ║   turn_lease_token  ↔ turnLeaseToken (internal; usually stripped)       ║
// ║   snapshots jsonb   → spread fields:                                    ║
// ║     personaSnapshot, scenarioSnapshot, courseSnapshot, rubricSnapshot,  ║
// ║     promptSnapshot, leadCard, voice, personalityFlavour,                ║
// ║     counsellorAddress, openaiVoice                                      ║
// ║   milestones jsonb  ↔ milestones                                        ║
// ║   objection_state   ↔ objectionState                                    ║
// ║   score_history     ↔ scoreHistory                                      ║
// ║   transcript jsonb  ↔ transcript                                        ║
// ║   pay_ask_count     ↔ payAskCount                                       ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: reports                                                          ║
// ║   session_id        ↔ sessionId                                         ║
// ║   assignment_id     ↔ assignmentId                                      ║
// ║   owner_id          ↔ counsellorId   (legacy name kept on object)       ║
// ║   counsellor_name   ↔ counsellorName                                    ║
// ║   persona_name      ↔ personaName                                       ║
// ║   scenario_title    ↔ scenarioTitle                                     ║
// ║   overall_percent   ↔ overall.percent (promoted hot column + in overall)║
// ║   overall_band      ↔ overall.band                                      ║
// ║   overall_outcome   ↔ overall.outcome                                   ║
// ║   final_score       ↔ finalScore (also in overall.finalScore)           ║
// ║   generated_at      ↔ generatedAt                                       ║
// ║   phase_breakdown   ↔ phaseBreakdown                                    ║
// ║   key_moments       ↔ keyMoments                                        ║
// ║   score_arc         ↔ scoreArc                                          ║
// ║   persona_addressed ↔ personaAddressed                                  ║
// ║   persona_card      ↔ personaCard                                       ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║ TABLE: app_config (collection: "appConfig")                             ║
// ║   updated_at        ↔ updatedAt                                         ║
// ║   updated_by        ↔ updatedBy                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import { getSupabaseAdmin } from "./supabaseAdmin.js";

// ─────────────────────────────────────────────────────────────────────────────
// Collection → table name map
// ─────────────────────────────────────────────────────────────────────────────
const TABLE = {
  users: "profiles",
  profiles: "profiles",
  personas: "personas",
  courses: "courses",
  rubricTemplates: "rubric_templates",
  leadProfiles: "lead_profiles",
  assignmentTemplates: "assignment_templates",
  assignments: "assignments",
  sessions: "sessions",
  reports: "reports",
  appConfig: "app_config",
};

function tableName(col) {
  const t = TABLE[col];
  if (!t) throw new Error(`Unknown collection: ${col}`);
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic snake ↔ camel helpers
// ─────────────────────────────────────────────────────────────────────────────
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILES / USERS mapper
// ─────────────────────────────────────────────────────────────────────────────
function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarColor: row.avatar_color,
    gender: row.gender ?? null,
    teamId: row.team_id ?? null,
    createdAt: row.created_at,
  };
}
function profileToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.email !== undefined) r.email = obj.email;
  if (obj.name !== undefined) r.name = obj.name;
  if (obj.role !== undefined) r.role = obj.role;
  if (obj.avatarColor !== undefined) r.avatar_color = obj.avatarColor;
  if (obj.gender !== undefined) r.gender = obj.gender;
  if (obj.teamId !== undefined) r.team_id = obj.teamId;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAS mapper
// ─────────────────────────────────────────────────────────────────────────────
function personaFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    label: row.label ?? null,
    coreAnxiety: row.core_anxiety ?? null,
    behaviourPrompt: row.behaviour_prompt ?? null,
    description: row.description ?? null,
    personality: row.personality ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function personaToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.name !== undefined) r.name = obj.name;
  if (obj.category !== undefined) r.category = obj.category;
  if (obj.label !== undefined) r.label = obj.label;
  if (obj.coreAnxiety !== undefined) r.core_anxiety = obj.coreAnxiety;
  if (obj.behaviourPrompt !== undefined) r.behaviour_prompt = obj.behaviourPrompt;
  if (obj.description !== undefined) r.description = obj.description;
  if (obj.personality !== undefined) r.personality = obj.personality;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// COURSES mapper
// ─────────────────────────────────────────────────────────────────────────────
// Promoted course columns (legacy camelCase names). Everything else on the
// legacy Course object (curriculum, outcomes, eligibility, usps, batchInfo,
// sourceUrl, scrapedAt, faqQuestions, …) lives in the `data` jsonb.
const COURSE_COLUMN_KEYS = new Set([
  "id", "slug", "name", "category", "institute", "partner", "duration",
  "format", "feeTotal", "feeBooking", "feeNote", "emiNote", "active",
  "createdAt", "updatedAt", "data",
]);
function courseFromRow(row) {
  if (!row) return null;
  return {
    // Restore the legacy extras to top-level (the legacy Course shape has no
    // `data` wrapper — buildKnowledgeBounds & the UI read curriculum/
    // faqQuestions/etc. directly). Promoted columns win on key conflicts.
    ...(row.data ?? {}),
    id: row.id,
    slug: row.slug ?? null,
    name: row.name,
    category: row.category ?? null,
    institute: row.institute ?? null,
    partner: row.partner ?? null,
    duration: row.duration ?? null,
    format: row.format ?? null,
    feeTotal: row.fee_total != null ? Number(row.fee_total) : null,
    feeBooking: row.fee_booking != null ? Number(row.fee_booking) : null,
    feeNote: row.fee_note ?? null,
    emiNote: row.emi_note ?? null,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function courseToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.slug !== undefined) r.slug = obj.slug;
  if (obj.name !== undefined) r.name = obj.name;
  if (obj.category !== undefined) r.category = obj.category;
  if (obj.institute !== undefined) r.institute = obj.institute;
  if (obj.partner !== undefined) r.partner = obj.partner;
  if (obj.duration !== undefined) r.duration = obj.duration;
  if (obj.format !== undefined) r.format = obj.format;
  if (obj.feeTotal !== undefined) r.fee_total = obj.feeTotal;
  if (obj.feeBooking !== undefined) r.fee_booking = obj.feeBooking;
  if (obj.feeNote !== undefined) r.fee_note = obj.feeNote;
  if (obj.emiNote !== undefined) r.emi_note = obj.emiNote;
  if (obj.active !== undefined) r.active = obj.active;
  // Re-bury legacy extras into the data jsonb. Full rebuild when extras are
  // present (admin course PUTs send the complete legacy object); an explicit
  // obj.data wins for callers that already use the row shape.
  if (obj.data !== undefined) {
    r.data = obj.data;
  } else {
    const extras = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!COURSE_COLUMN_KEYS.has(k)) extras[k] = v;
    }
    if (Object.keys(extras).length) r.data = extras;
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUBRIC TEMPLATES mapper
// ─────────────────────────────────────────────────────────────────────────────
function rubricTemplateFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    criteria: row.criteria ?? [],
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function rubricTemplateToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.name !== undefined) r.name = obj.name;
  if (obj.description !== undefined) r.description = obj.description;
  if (obj.criteria !== undefined) r.criteria = obj.criteria;
  if (obj.isDefault !== undefined) r.is_default = obj.isDefault;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAD PROFILES mapper (minimal camel conversion needed)
// ─────────────────────────────────────────────────────────────────────────────
const LEAD_PROFILE_COLUMN_KEYS = new Set([
  "id", "category", "name", "gender", "age", "occupation", "education",
  "city", "label", "data",
]);
function leadProfileFromRow(row) {
  if (!row) return null;
  return {
    // Restore legacy extras (description, …) to top-level — the legacy shape
    // has description as a first-class field (Practice prefill, lead cards,
    // assignment picker all read profile.description directly).
    ...(row.data ?? {}),
    id: row.id,
    category: row.category,
    name: row.name ?? null,
    gender: row.gender ?? null,
    age: row.age ?? null,
    occupation: row.occupation ?? null,
    education: row.education ?? null,
    city: row.city ?? null,
    label: row.label ?? null,
  };
}
function leadProfileToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.category !== undefined) r.category = obj.category;
  if (obj.name !== undefined) r.name = obj.name;
  if (obj.gender !== undefined) r.gender = obj.gender;
  if (obj.age !== undefined) r.age = obj.age;
  if (obj.occupation !== undefined) r.occupation = obj.occupation;
  if (obj.education !== undefined) r.education = obj.education;
  if (obj.city !== undefined) r.city = obj.city;
  if (obj.label !== undefined) r.label = obj.label;
  if (obj.data !== undefined) {
    r.data = obj.data;
  } else {
    const extras = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!LEAD_PROFILE_COLUMN_KEYS.has(k)) extras[k] = v;
    }
    if (Object.keys(extras).length) r.data = extras;
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENT TEMPLATES mapper
// ─────────────────────────────────────────────────────────────────────────────
function assignmentTemplateFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    personaId: row.persona_id ?? null,
    courseId: row.course_id ?? null,
    rubricTemplateId: row.rubric_template_id ?? null,
    profileId: row.profile_id ?? null,
    scenario: row.scenario ?? {},
    personaPromptOverride: row.persona_prompt_override ?? null,
    revealPersona: row.reveal_persona,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}
function assignmentTemplateToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.name !== undefined) r.name = obj.name;
  if (obj.personaId !== undefined) r.persona_id = obj.personaId;
  if (obj.courseId !== undefined) r.course_id = obj.courseId;
  if (obj.rubricTemplateId !== undefined) r.rubric_template_id = obj.rubricTemplateId;
  if (obj.profileId !== undefined) r.profile_id = obj.profileId;
  if (obj.scenario !== undefined) r.scenario = obj.scenario;
  if (obj.personaPromptOverride !== undefined) r.persona_prompt_override = obj.personaPromptOverride;
  if (obj.revealPersona !== undefined) r.reveal_persona = obj.revealPersona;
  if (obj.createdBy !== undefined) r.created_by = obj.createdBy;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENTS mapper
// ─────────────────────────────────────────────────────────────────────────────
function assignmentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    counsellorId: row.counsellor_id,
    personaId: row.persona_id ?? null,
    courseId: row.course_id,
    rubricTemplateId: row.rubric_template_id ?? null,
    profileId: row.profile_id ?? null,
    templateId: row.template_id ?? null,
    scenario: row.scenario ?? {},
    personaPromptOverride: row.persona_prompt_override ?? null,
    revealPersona: row.reveal_persona,
    status: row.status,
    sessionId: row.session_id ?? null,
    reportId: row.report_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}
function assignmentToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.counsellorId !== undefined) r.counsellor_id = obj.counsellorId;
  if (obj.personaId !== undefined) r.persona_id = obj.personaId;
  if (obj.courseId !== undefined) r.course_id = obj.courseId;
  if (obj.rubricTemplateId !== undefined) r.rubric_template_id = obj.rubricTemplateId;
  if (obj.profileId !== undefined) r.profile_id = obj.profileId;
  if (obj.templateId !== undefined) r.template_id = obj.templateId;
  if (obj.scenario !== undefined) r.scenario = obj.scenario;
  if (obj.personaPromptOverride !== undefined) r.persona_prompt_override = obj.personaPromptOverride;
  if (obj.revealPersona !== undefined) r.reveal_persona = obj.revealPersona;
  if (obj.status !== undefined) r.status = obj.status;
  if (obj.sessionId !== undefined) r.session_id = obj.sessionId;
  if (obj.reportId !== undefined) r.report_id = obj.reportId;
  if (obj.createdBy !== undefined) r.created_by = obj.createdBy;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS mapper
//
// The snapshots jsonb column stores snapshot fields that were individual fields
// in the legacy JSON store. On read they are spread back onto the session object.
// On write, all snapshot-related fields are packed back into snapshots.
// ─────────────────────────────────────────────────────────────────────────────
const SNAPSHOT_KEYS = [
  "personaSnapshot",
  "scenarioSnapshot",
  "courseSnapshot",
  "rubricSnapshot",
  "promptSnapshot",
  "leadCard",
  "voice",
  "personalityFlavour",
  "counsellorAddress",
  "openaiVoice",
  "revealPersona",
  "integrityProbe",
];

function sessionFromRow(row) {
  if (!row) return null;
  const snapshots = row.snapshots || {};
  const session = {
    id: row.id,
    assignmentId: row.assignment_id ?? null,
    counsellorId: row.owner_id,        // legacy field name
    isPractice: row.is_practice,
    mode: row.origin,                   // 'assigned' | 'practice'
    sessionMode: row.session_mode,      // 'voice' | 'text'
    voiceEngine: row.voice_engine,
    status: row.status,
    currentPhase: row.current_phase,
    satisfactionScore: row.satisfaction_score,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    lastTurnVerbosity: row.last_turn_verbosity ?? null,
    thinkingMode: row.thinking_mode,
    // Snapshot fields spread from jsonb
    ...snapshots,
    // Mutable state
    milestones: row.milestones ?? {},
    objectionState: row.objection_state ?? [],
    scoreHistory: row.score_history ?? [],
    transcript: row.transcript ?? [],
    payAskCount: row.pay_ask_count ?? 0,
  };
  return session;
}

function sessionToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.assignmentId !== undefined) r.assignment_id = obj.assignmentId;
  // owner_id is the DB column; counsellorId is the legacy JS name
  if (obj.counsellorId !== undefined) r.owner_id = obj.counsellorId;
  if (obj.isPractice !== undefined) r.is_practice = obj.isPractice;
  if (obj.mode !== undefined) r.origin = obj.mode;
  if (obj.sessionMode !== undefined) r.session_mode = obj.sessionMode;
  if (obj.voiceEngine !== undefined) r.voice_engine = obj.voiceEngine;
  if (obj.status !== undefined) r.status = obj.status;
  if (obj.currentPhase !== undefined) r.current_phase = obj.currentPhase;
  if (obj.satisfactionScore !== undefined) r.satisfaction_score = obj.satisfactionScore;
  if (obj.endedAt !== undefined) r.ended_at = obj.endedAt;
  if (obj.lastTurnVerbosity !== undefined) r.last_turn_verbosity = obj.lastTurnVerbosity;
  if (obj.thinkingMode !== undefined) r.thinking_mode = obj.thinkingMode;
  if (obj.milestones !== undefined) r.milestones = obj.milestones;
  if (obj.objectionState !== undefined) r.objection_state = obj.objectionState;
  if (obj.scoreHistory !== undefined) r.score_history = obj.scoreHistory;
  if (obj.transcript !== undefined) r.transcript = obj.transcript;
  if (obj.payAskCount !== undefined) r.pay_ask_count = obj.payAskCount;

  // Pack snapshot fields into the snapshots jsonb. Only include it in the row
  // if at least one snapshot key is present in the source object.
  const snapshotPatch = {};
  for (const k of SNAPSHOT_KEYS) {
    if (k in obj) snapshotPatch[k] = obj[k];
  }
  if (Object.keys(snapshotPatch).length > 0) {
    r.snapshots = snapshotPatch;
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS mapper
//
// Hot columns (overall_percent, overall_band, overall_outcome, final_score) are
// promoted in the DB for cheap filtering. On read, they are merged into the
// overall jsonb so downstream code sees a consistent overall object. On write,
// they are written as both top-level columns and inside the overall jsonb.
// ─────────────────────────────────────────────────────────────────────────────
function reportFromRow(row) {
  if (!row) return null;
  // Merge promoted hot columns back into the overall jsonb so callers see one
  // consistent shape regardless of which columns were populated.
  const overall = { ...(row.overall || {}) };
  if (row.overall_percent != null) overall.percent = Number(row.overall_percent);
  if (row.overall_band != null) overall.band = row.overall_band;
  if (row.overall_outcome != null) overall.outcome = row.overall_outcome;
  if (row.final_score != null) overall.finalScore = row.final_score;

  return {
    id: row.id,
    sessionId: row.session_id,
    assignmentId: row.assignment_id ?? null,
    counsellorId: row.owner_id,        // legacy field name
    counsellorName: row.counsellor_name ?? null,
    personaName: row.persona_name ?? null,
    scenarioTitle: row.scenario_title ?? null,
    status: row.status,
    partial: row.partial,
    finalScore: row.final_score ?? null,
    generatedAt: row.generated_at,
    // Sections (jsonb)
    overall,
    rubric: row.rubric ?? [],
    phaseBreakdown: row.phase_breakdown ?? [],
    strengths: row.strengths ?? [],
    improvements: row.improvements ?? [],
    keyMoments: row.key_moments ?? [],
    drills: row.drills ?? [],
    benchmarks: row.benchmarks ?? {},
    scoreArc: row.score_arc ?? [],
    transcript: row.transcript ?? [],
    personaAddressed: row.persona_addressed ?? null,
    personaCard: row.persona_card ?? null,
    integrityCheck: row.integrity_check ?? null,
    newReport: row.new_report ?? null,
    fluency: row.fluency ?? null,
  };
}

function reportToRow(obj) {
  const r = {};
  if (obj.id !== undefined) r.id = obj.id;
  if (obj.sessionId !== undefined) r.session_id = obj.sessionId;
  if (obj.assignmentId !== undefined) r.assignment_id = obj.assignmentId;
  if (obj.counsellorId !== undefined) r.owner_id = obj.counsellorId;
  if (obj.counsellorName !== undefined) r.counsellor_name = obj.counsellorName;
  if (obj.personaName !== undefined) r.persona_name = obj.personaName;
  if (obj.scenarioTitle !== undefined) r.scenario_title = obj.scenarioTitle;
  if (obj.status !== undefined) r.status = obj.status;
  if (obj.partial !== undefined) r.partial = obj.partial;
  if (obj.overall !== undefined) {
    r.overall = obj.overall;
    // Also promote hot columns for cheap index scans.
    if (obj.overall.percent != null) r.overall_percent = obj.overall.percent;
    if (obj.overall.band != null) r.overall_band = obj.overall.band;
    if (obj.overall.outcome != null) r.overall_outcome = obj.overall.outcome;
    if (obj.overall.finalScore != null) r.final_score = obj.overall.finalScore;
  }
  if (obj.finalScore !== undefined) r.final_score = obj.finalScore;
  if (obj.rubric !== undefined) r.rubric = obj.rubric;
  if (obj.phaseBreakdown !== undefined) r.phase_breakdown = obj.phaseBreakdown;
  if (obj.strengths !== undefined) r.strengths = obj.strengths;
  if (obj.improvements !== undefined) r.improvements = obj.improvements;
  if (obj.keyMoments !== undefined) r.key_moments = obj.keyMoments;
  if (obj.drills !== undefined) r.drills = obj.drills;
  if (obj.benchmarks !== undefined) r.benchmarks = obj.benchmarks;
  if (obj.scoreArc !== undefined) r.score_arc = obj.scoreArc;
  if (obj.transcript !== undefined) r.transcript = obj.transcript;
  if (obj.personaAddressed !== undefined) r.persona_addressed = obj.personaAddressed;
  if (obj.personaCard !== undefined) r.persona_card = obj.personaCard;
  if (obj.integrityCheck !== undefined) r.integrity_check = obj.integrityCheck;
  if (obj.newReport !== undefined) r.new_report = obj.newReport;
  if (obj.fluency !== undefined) r.fluency = obj.fluency;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// APP CONFIG mapper
// ─────────────────────────────────────────────────────────────────────────────
function appConfigFromRow(row) {
  if (!row) return null;
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}
function appConfigToRow(obj) {
  const r = {};
  if (obj.key !== undefined) r.key = obj.key;
  if (obj.value !== undefined) r.value = obj.value;
  if (obj.updatedBy !== undefined) r.updated_by = obj.updatedBy;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-collection mapper registry
// ─────────────────────────────────────────────────────────────────────────────
const FROM_ROW = {
  users: profileFromRow,
  profiles: profileFromRow,
  personas: personaFromRow,
  courses: courseFromRow,
  rubricTemplates: rubricTemplateFromRow,
  leadProfiles: leadProfileFromRow,
  assignmentTemplates: assignmentTemplateFromRow,
  assignments: assignmentFromRow,
  sessions: sessionFromRow,
  reports: reportFromRow,
  appConfig: appConfigFromRow,
};

const TO_ROW = {
  users: profileToRow,
  profiles: profileToRow,
  personas: personaToRow,
  courses: courseToRow,
  rubricTemplates: rubricTemplateToRow,
  leadProfiles: leadProfileToRow,
  assignmentTemplates: assignmentTemplateToRow,
  assignments: assignmentToRow,
  sessions: sessionToRow,
  reports: reportToRow,
  appConfig: appConfigToRow,
};

function fromRow(col, row) {
  const fn = FROM_ROW[col];
  if (!fn) throw new Error(`No fromRow mapper for collection: ${col}`);
  return fn(row);
}

function toRow(col, obj) {
  const fn = TO_ROW[col];
  if (!fn) throw new Error(`No toRow mapper for collection: ${col}`);
  return fn(obj);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error helper
// ─────────────────────────────────────────────────────────────────────────────
function assertNoError(error, context) {
  if (error) {
    const msg = `[store] ${context}: ${error.message || JSON.stringify(error)}`;
    throw Object.assign(new Error(msg), { code: error.code, details: error.details });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — mirrors the legacy server/store.js surface
// ─────────────────────────────────────────────────────────────────────────────

export async function getAll(col, opts = {}) {
  const table = tableName(col);
  const db = getSupabaseAdmin();
  let q = db.from(table).select("*");
  if (opts.filter) {
    for (const [k, v] of Object.entries(opts.filter)) {
      q = q.eq(camelToSnake(k), v);
    }
  }
  if (opts.order) {
    q = q.order(camelToSnake(opts.order), { ascending: opts.ascending !== false });
  }
  const { data, error } = await q;
  assertNoError(error, `getAll(${col})`);
  return (data || []).map((r) => fromRow(col, r));
}

export async function getById(col, id) {
  const table = tableName(col);
  const db = getSupabaseAdmin();
  // app_config uses key as PK; all others use id.
  const pkCol = col === "appConfig" ? "key" : "id";
  const { data, error } = await db.from(table).select("*").eq(pkCol, id).maybeSingle();
  assertNoError(error, `getById(${col}, ${id})`);
  return fromRow(col, data);
}

export async function insert(col, obj) {
  const table = tableName(col);
  const db = getSupabaseAdmin();
  const row = toRow(col, obj);
  const { data, error } = await db.from(table).insert(row).select().single();
  assertNoError(error, `insert(${col})`);
  return fromRow(col, data);
}

export async function update(col, id, patch) {
  const table = tableName(col);
  const db = getSupabaseAdmin();
  const pkCol = col === "appConfig" ? "key" : "id";
  const row = toRow(col, patch);

  // For sessions: when updating snapshots, we need to merge with the existing
  // snapshots jsonb rather than overwrite entirely (to avoid losing fields not
  // included in the patch). Use the Supabase jsonb_set approach via RPC if the
  // patch includes snapshot keys — otherwise a plain update is fine.
  if (col === "sessions" && row.snapshots) {
    // Fetch current snapshots and merge with the incoming patch.
    const existing = await getById(col, id);
    if (existing) {
      // Re-pack snapshot keys from the existing session and merge with the patch.
      const existingSnapshotFields = {};
      for (const k of SNAPSHOT_KEYS) {
        if (existing[k] !== undefined) existingSnapshotFields[k] = existing[k];
      }
      row.snapshots = { ...existingSnapshotFields, ...row.snapshots };
    }
  }

  const { data, error } = await db.from(table).update(row).eq(pkCol, id).select().single();
  assertNoError(error, `update(${col}, ${id})`);
  return fromRow(col, data);
}

export async function remove(col, id) {
  const table = tableName(col);
  const db = getSupabaseAdmin();
  const pkCol = col === "appConfig" ? "key" : "id";
  const { error } = await db.from(table).delete().eq(pkCol, id);
  assertNoError(error, `remove(${col}, ${id})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Specialized queries — mirror the legacy server/store.js extras
// ─────────────────────────────────────────────────────────────────────────────

// Returns all profiles with role = 'counsellor'.
export async function getCounsellors() {
  return getAll("users", { filter: { role: "counsellor" } });
}

// Returns all sessions for a given owner (counsellor).
export async function getSessionsByOwner(ownerId) {
  const table = tableName("sessions");
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("owner_id", ownerId);
  assertNoError(error, `getSessionsByOwner(${ownerId})`);
  return (data || []).map((r) => sessionFromRow(r));
}

// Returns all reports for a given owner (counsellor).
export async function getReportsByOwner(ownerId) {
  const table = tableName("reports");
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("owner_id", ownerId);
  assertNoError(error, `getReportsByOwner(${ownerId})`);
  return (data || []).map((r) => reportFromRow(r));
}

// Upsert for app_config (key-value store).
export async function upsertConfig(key, value, updatedBy = null) {
  const table = tableName("appConfig");
  const db = getSupabaseAdmin();
  const row = { key, value, updated_at: new Date().toISOString() };
  if (updatedBy) row.updated_by = updatedBy;
  const { data, error } = await db
    .from(table)
    .upsert(row, { onConflict: "key" })
    .select()
    .single();
  assertNoError(error, `upsertConfig(${key})`);
  return appConfigFromRow(data);
}

// Get a single app_config value by key (returns raw jsonb value, not the wrapper row).
export async function getConfigValue(key) {
  const row = await getById("appConfig", key);
  return row ? row.value : null;
}

// WARNING: newId() returns a 12-hex-char string — only valid for TEXT-PK library
// collections (personas, courses, rubric_templates, lead_profiles, profiles).
// For uuid-PK tables (assignments, assignment_templates, sessions, reports) use
// crypto.randomUUID() instead.
// Convenience: generate a new 12-hex-char id (mirrors server/store.js newId).
// Uses Web Crypto (available in both Deno and Node 25 globalThis).
export function newId() {
  const arr = new Uint8Array(6);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// counsellorCode — deterministic, stable, human-readable short code derived
// purely from the user id (mirrors server/store.js counsellorCode). FNV-1a over
// the id folded to 16 bits → "MAS-C-1A2B". Returns null for an id-less user.
export function counsellorCode(user) {
  const id = user?.id;
  if (!id) return null;
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const folded = ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
  const hex = folded.toString(16).toUpperCase().padStart(4, "0");
  return `MAS-C-${hex}`;
}
