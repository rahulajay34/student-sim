// End-to-end API smoke test. Assumes the server is running on :3001.
// Exercises the full flow and asserts a report is visible to BOTH the
// counsellor (own) and the admin (all). Run: node scripts/smoke-api.mjs
const BASE = process.env.BASE || "http://localhost:3001/api";

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log("AUTH");
  const adminLogin = await call("/login", { method: "POST", body: { email: "admin@masai.com", password: "admin123" } });
  check("admin login", adminLogin.status === 200 && adminLogin.data.user?.role === "admin");
  const cLogin = await call("/login", { method: "POST", body: { email: "priya@masai.com", password: "priya123" } });
  check("counsellor login", cLogin.status === 200 && cLogin.data.user?.role === "counsellor");
  const bad = await call("/login", { method: "POST", body: { email: "x", password: "y" } });
  check("bad login rejected (401)", bad.status === 401);
  const counsellor = cLogin.data.user;

  console.log("PERSONAS (admin CRUD)");
  const personas = await call("/personas");
  check("seed personas present", Array.isArray(personas.data) && personas.data.length >= 5);
  const created = await call("/personas", { method: "POST", body: { name: "Smoke Persona", category: "custom", label: "a test student", coreAnxiety: "test anxiety", behaviourPrompt: "be brief", description: "tmp" } });
  check("create persona", created.status === 200 && created.data.id);
  const updated = await call(`/personas/${created.data.id}`, { method: "PUT", body: { description: "updated" } });
  check("update persona", updated.data.description === "updated");
  const del = await call(`/personas/${created.data.id}`, { method: "DELETE" });
  check("delete persona", del.data.ok === true);

  console.log("ASSIGNMENT (admin -> counsellor)");
  const asn = await call("/assignments", { method: "POST", body: { counsellorId: counsellor.id, personaId: "persona-diff-field", scenario: { title: "Smoke mock", difficulty: "medium", situation: "worried about coding", contextNotes: "" }, createdBy: "admin-1" } });
  check("create assignment", asn.status === 200 && asn.data.id);
  const asnList = await call(`/assignments?counsellorId=${counsellor.id}`);
  check("assignment visible to counsellor", asnList.data.some((a) => a.id === asn.data.id));

  console.log("SESSION (assigned) — this makes real LLM calls, please wait…");
  const start = await call("/sessions/start", { method: "POST", body: { mode: "assigned", counsellorId: counsellor.id, assignmentId: asn.data.id } });
  check("start session", start.status === 200 && start.data.sessionId && start.data.firstMessage);
  const sid = start.data.sessionId;

  const m1 = await call(`/sessions/${sid}/message`, { method: "POST", body: { message: "Hi! I understand the technical side feels intimidating. Our first module starts from absolute basics with mentor support — many career switchers with no coding background have completed it. What worries you most?" } });
  check("message 1 returns reply + score", m1.status === 200 && m1.data.reply && typeof m1.data.satisfactionScore === "number");
  const m2 = await call(`/sessions/${sid}/message`, { method: "POST", body: { message: "Totally fair. There's a refund window and recordings if you fall behind, plus placement support. Shall I block your seat with the 4000 today?" } });
  check("message 2 returns reply", m2.status === 200 && m2.data.reply);

  console.log("END -> REPORT");
  const end = await call(`/sessions/${sid}/end`, { method: "POST" });
  check("end session returns reportId", end.status === 200 && end.data.reportId);
  const rid = end.data.reportId;

  const report = await call(`/reports/${rid}`);
  const r = report.data;
  check("report has overall % + band + outcome", r.overall && typeof r.overall.percent === "number" && r.overall.band && r.overall.outcome);
  check("report has 6 rubric criteria", Array.isArray(r.rubric) && r.rubric.length === 6 && r.rubric.every((x) => x.level && x.label));
  check("report has 4 phase breakdowns", Array.isArray(r.phaseBreakdown) && r.phaseBreakdown.length === 4);
  check("report has transcript + score arc", Array.isArray(r.transcript) && r.transcript.length >= 3 && Array.isArray(r.scoreArc));

  console.log("VISIBILITY (both sides)");
  const counsellorReports = await call(`/reports?counsellorId=${counsellor.id}`);
  check("report visible to counsellor", counsellorReports.data.some((x) => x.id === rid));
  const adminReports = await call("/reports");
  check("report visible to admin (all)", adminReports.data.some((x) => x.id === rid));

  const asnAfter = await call(`/assignments/${asn.data.id}`);
  check("assignment marked completed + linked to report", asnAfter.data.status === "completed" && asnAfter.data.reportId === rid);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e.message);
  process.exit(1);
});
