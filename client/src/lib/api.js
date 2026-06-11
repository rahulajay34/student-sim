// Flat API client. Every method hits the Express server (Vite proxies /api -> :3001)
// and throws Error(data.error) on a non-2xx response.

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const qs = (counsellorId) => (counsellorId ? `?counsellorId=${encodeURIComponent(counsellorId)}` : "");

export const api = {
  // auth
  login: (email, password) => req("/login", { method: "POST", body: { email, password } }).then((d) => d.user),

  // users
  getCounsellors: () => req("/counsellors"),

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
  getSession: (id) => req(`/sessions/${id}`),
  getSessionCue: (id) => req(`/sessions/${id}/cue`, { method: "POST" }),

  // speech-to-speech (S2S) realtime engines
  // openai-token: { voice? } → { value (ephemeral ek_…), model, voice, expiresAt }
  getOpenAIRealtimeToken: (id, voice) => req(`/sessions/${id}/realtime/openai-token`, { method: "POST", body: voice ? { voice } : {} }),
  // elevenlabs-token: { voiceId? } → { token, agentId, overrides }
  getElevenLabsRealtimeToken: (id, voiceId) => req(`/sessions/${id}/realtime/elevenlabs-token`, { method: "POST", body: voiceId ? { voiceId } : {} }),
  // observe: feed a completed S2S turn to MiniMax for live scoring/cue/phase/objections
  observeTurn: (id, { counsellorText, studentText }) =>
    req(`/sessions/${id}/observe`, { method: "POST", body: { counsellorText: counsellorText || "", studentText: studentText || "" } }),

  // reports
  getReports: (counsellorId) => req(`/reports${qs(counsellorId)}`),
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
};
