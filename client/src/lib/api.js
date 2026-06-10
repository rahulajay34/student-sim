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
  sendMessage: (id, message, deliveryMetrics) => req(`/sessions/${id}/message`, { method: "POST", body: deliveryMetrics ? { message, deliveryMetrics } : { message } }),
  endSession: (id) => req(`/sessions/${id}/end`, { method: "POST" }),
  getSession: (id) => req(`/sessions/${id}`),

  // reports
  getReports: (counsellorId) => req(`/reports${qs(counsellorId)}`),
  getReport: (id) => req(`/reports/${id}`),

  // rubric templates
  getRubricTemplates: () => req("/rubric-templates"),
  createRubricTemplate: (data) => req("/rubric-templates", { method: "POST", body: data }),
  updateRubricTemplate: (id, data) => req(`/rubric-templates/${id}`, { method: "PUT", body: data }),
  deleteRubricTemplate: (id) => req(`/rubric-templates/${id}`, { method: "DELETE" }),

  // analytics
  getAdminAnalytics: () => req("/analytics/admin"),
  getCounsellorAnalytics: (id) => req(`/analytics/counsellor/${id}`),
};
