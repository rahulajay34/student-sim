// Flat API client. Every method hits the server (Vite proxies /api) and throws
// ApiError on failure (network → isNetwork:true; non-2xx → status set).
import { supabase } from "./supabase";

// ── ApiError ──────────────────────────────────────────────────────────────────
// Extends Error so existing `catch (e) { ... e.message ... }` sites continue to
// work without any changes. Extra fields allow typed handling in new code.
export class ApiError extends Error {
  /**
   * @param {string} message   Human-readable reason (same contract as before)
   * @param {number|undefined} status  HTTP status code (absent for network errors)
   * @param {boolean} isNetwork  true when the fetch itself failed (no HTTP response)
   */
  constructor(message, status, isNetwork = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isNetwork = isNetwork;
  }
}

// Retrieve the current Supabase access token for the Authorization header.
// Returns null when there is no active session (unauthenticated requests).
async function getAccessToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

async function req(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = await getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError(
      networkErr?.message || "Network request failed",
      undefined,
      true,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data.error || `Request failed (${res.status})`,
      res.status,
    );
  }
  return data;
}

const qs = (counsellorId) => (counsellorId ? `?counsellorId=${encodeURIComponent(counsellorId)}` : "");

export const api = {
  // users
  getCounsellors: () => req("/counsellors"),
  getUsers: () => req("/users"), // superadmin only
  updateUserRole: (id, role) => req(`/users/${id}/role`, { method: "PUT", body: { role } }),

  // personas
  getPersonas: () => req("/personas"),
  createPersona: (data) => req("/personas", { method: "POST", body: data }),
  updatePersona: (id, data) => req(`/personas/${id}`, { method: "PUT", body: data }),
  deletePersona: (id) => req(`/personas/${id}`, { method: "DELETE" }),

  // courses
  getCourses: (activeOnly) => req(`/courses${activeOnly ? "?active=1" : ""}`),
  createCourse: (data) => req("/courses", { method: "POST", body: data }),
  updateCourse: (id, data) => req(`/courses/${id}`, { method: "PUT", body: data }),
  deleteCourse: (id) => req(`/courses/${id}`, { method: "DELETE" }),

  // assignments
  getAssignments: (counsellorId) => req(`/assignments${qs(counsellorId)}`),
  createAssignment: (data) => req("/assignments", { method: "POST", body: data }),
  getAssignment: (id) => req(`/assignments/${id}`),
  deleteAssignment: (id) => req(`/assignments/${id}`, { method: "DELETE" }),

  // sessions
  startSession: (payload) => req("/sessions/start", { method: "POST", body: payload }),
  sendMessage: (id, message, deliveryMetrics, thinking) => req(`/sessions/${id}/message`, { method: "POST", body: { message, ...(deliveryMetrics ? { deliveryMetrics } : {}), ...(thinking ? { thinking } : {}) } }),
  endSession: (id) => req(`/sessions/${id}/end`, { method: "POST" }),
  // regenerateReport: re-call /end for a fallback report → kicks background regen,
  // returns { reportId, status:"generating" } (idempotent while generating).
  regenerateReport: (sessionId) => req(`/sessions/${sessionId}/end`, { method: "POST" }),
  getSession: (id) => req(`/sessions/${id}`),

  // realtime voice engine (OpenAI Realtime speech-to-speech)
  // openai-token: { voice? } → { value (ephemeral ek_…), model, voice, expiresAt }
  getOpenAIRealtimeToken: (id, voice) => req(`/sessions/${id}/realtime/openai-token`, { method: "POST", body: voice ? { voice } : {} }),
  // observe (C2): feed a completed voice turn to MiniMax for live scoring/cue/phase/
  // objections. Counsellor turns may carry deliveryMetrics; the response adds a
  // compact `steering` string used to nudge the voice model mid-call.
  observeTurn: (id, { counsellorText, studentText, deliveryMetrics } = {}) =>
    req(`/sessions/${id}/observe`, {
      method: "POST",
      body: {
        counsellorText: counsellorText || "",
        studentText: studentText || "",
        ...(deliveryMetrics ? { deliveryMetrics } : {}),
      },
    }),

  // reports
  getReports: (counsellorId, sessionId) => {
    const params = new URLSearchParams();
    if (counsellorId) params.set("counsellorId", counsellorId);
    if (sessionId) params.set("sessionId", sessionId);
    const q = params.toString();
    return req(`/reports${q ? "?" + q : ""}`);
  },
  getReport: (id) => req(`/reports/${id}`),

  // rubric templates
  getRubricTemplates: () => req("/rubric-templates"),
  createRubricTemplate: (data) => req("/rubric-templates", { method: "POST", body: data }),
  updateRubricTemplate: (id, data) => req(`/rubric-templates/${id}`, { method: "PUT", body: data }),
  deleteRubricTemplate: (id) => req(`/rubric-templates/${id}`, { method: "DELETE" }),

  // lead profiles (read-only; used by profile dropdown)
  getLeadProfiles: (category) => req("/lead-profiles" + (category ? "?category=" + encodeURIComponent(category) : "")),

  // analytics
  getAdminAnalytics: () => req("/analytics/admin"),
  getCounsellorAnalytics: (id) => req(`/analytics/counsellor/${id}`),

  // config (admin transparency)
  getPromptConfig: () => req("/config/prompts"),
  updatePromptConfig: (data) => req("/config/prompts", { method: "PUT", body: data }),
  getScoringConfig: () => req("/config/scoring"),
  updateScoringConfig: (data) => req("/config/scoring", { method: "PUT", body: data }),

  // session prompt inspection (admin-only at UI layer)
  getSessionPrompts: (id) => req(`/sessions/${id}/prompt`),

  // assignment templates (WS7)
  getAssignmentTemplates: () => req("/assignment-templates"),
  createAssignmentTemplate: (data) => req("/assignment-templates", { method: "POST", body: data }),
  updateAssignmentTemplate: (id, data) => req(`/assignment-templates/${id}`, { method: "PUT", body: data }),
  deleteAssignmentTemplate: (id) => req(`/assignment-templates/${id}`, { method: "DELETE" }),
  assignTemplate: (id, counsellorIds) =>
    req(`/assignment-templates/${id}/assign`, { method: "POST", body: { counsellorIds } }),

  // profile
  updateProfile: (id, data) => req(`/users/${id}`, { method: "PATCH", body: data }),

  // leaderboard
  getLeaderboard: ({ metric, board } = {}) => {
    const params = new URLSearchParams();
    if (metric) params.set("metric", metric);
    if (board) params.set("board", board);
    const q = params.toString();
    return req(`/leaderboard${q ? "?" + q : ""}`);
  },
};
