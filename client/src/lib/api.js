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
  // regenerateReport: re-call /end for a fallback report → kicks background regen,
  // returns { reportId, status:"generating" } (idempotent while generating).
  regenerateReport: (sessionId) => req(`/sessions/${sessionId}/end`, { method: "POST" }),
  getSession: (id) => req(`/sessions/${id}`),
  getSessionCue: (id) => req(`/sessions/${id}/cue`, { method: "POST" }),

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
