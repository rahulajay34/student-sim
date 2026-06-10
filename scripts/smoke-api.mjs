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

  console.log("COURSES (admin CRUD + catalog)");
  const courses = await call("/courses");
  check("catalog has 15 scraped courses", Array.isArray(courses.data) && courses.data.length >= 15);
  // Create smoke course BEFORE the active-filter check so we can verify exclusion.
  const cCreated = await call("/courses", { method: "POST", body: { name: "Smoke Course", institute: "Test U", category: "analytics-ai", duration: "1 month", feeTotal: 1000, feeBooking: 100, curriculum: ["m1", "m2", "m3"] } });
  check("create course", cCreated.status === 200 && cCreated.data.id);
  const cToggled = await call(`/courses/${cCreated.data.id}`, { method: "PUT", body: { active: false } });
  check("toggle course active", cToggled.data.active === false);
  // After toggling inactive: must be absent from active-only list, present in unfiltered list.
  const activeOnly = await call("/courses?active=1");
  check("active filter excludes inactive course", activeOnly.data.every((c) => c.active) && !activeOnly.data.some((c) => c.id === cCreated.data.id));
  const allCourses = await call("/courses");
  check("inactive course still in unfiltered list", allCourses.data.some((c) => c.id === cCreated.data.id));
  const cDel = await call(`/courses/${cCreated.data.id}`, { method: "DELETE" });
  check("delete course", cDel.data.ok === true);
  const baCourse = courses.data.find((c) => c.slug === "iim-ranchi/business-analytics-ai-sop");
  check("IIM Ranchi BA course present", !!baCourse);
  const pwcCourse = courses.data.find((c) => c.slug === "pwc/cyber-security-ethical-hacking-ai");
  check("PwC cyber course present", !!pwcCourse);

  console.log("RUBRIC TEMPLATES");
  const rtList = await call("/rubric-templates");
  check("rubric templates list has >= 1", Array.isArray(rtList.data) && rtList.data.length >= 1);
  const defaultTpl = rtList.data.find((t) => t.id === "rt-grounded-v2");
  check("rt-grounded-v2 present with 8 criteria", !!defaultTpl && Array.isArray(defaultTpl.criteria) && defaultTpl.criteria.length === 8);
  const rtBadWeights = await call("/rubric-templates", { method: "POST", body: { name: "Bad Weights Test", description: "x", criteria: [
    { key: "foo", label: "Foo", weight: 50, anchors: { "1": "a", "2": "b", "3": "c", "4": "d", "5": "e" } },
    { key: "bar", label: "Bar", weight: 30, anchors: { "1": "a", "2": "b", "3": "c", "4": "d", "5": "e" } },
  ] } });
  check("POST rubric template with bad weights returns 400", rtBadWeights.status === 400);
  const cloneCriteria = defaultTpl.criteria.map((c) => ({ key: c.key + "_clone", label: c.label, weight: c.weight, anchors: c.anchors }));
  const rtClone = await call("/rubric-templates", { method: "POST", body: { name: "Smoke Clone", description: "clone for smoke", criteria: cloneCriteria } });
  check("POST valid rubric template clone returns 200", rtClone.status === 200 && rtClone.data.id);
  const rtDeleteDefault = await call(`/rubric-templates/${defaultTpl.id}`, { method: "DELETE" });
  check("DELETE default rubric template returns 400", rtDeleteDefault.status === 400);
  const rtDeleteClone = await call(`/rubric-templates/${rtClone.data.id}`, { method: "DELETE" });
  check("DELETE cloned rubric template ok", rtDeleteClone.data.ok === true);

  console.log("ASSIGNMENT (admin -> counsellor)");
  const asnNoCourse = await call("/assignments", { method: "POST", body: { counsellorId: counsellor.id, personaId: "persona-diff-field", scenario: { title: "Smoke mock", difficulty: "medium", situation: "worried about coding", contextNotes: "" }, createdBy: "admin-1" } });
  check("create assignment without courseId returns 400", asnNoCourse.status === 400);
  const asn = await call("/assignments", { method: "POST", body: { counsellorId: counsellor.id, personaId: "persona-diff-field", courseId: pwcCourse.id, rubricTemplateId: "rt-grounded-v2", revealPersona: false, scenario: { title: "Smoke mock", difficulty: "medium", situation: "worried about coding", contextNotes: "" }, createdBy: "admin-1" } });
  check("create assignment", asn.status === 200 && asn.data.id);
  check("assignment echoes courseId", asn.data.courseId === pwcCourse.id);
  check("assignment echoes rubricTemplateId", asn.data.rubricTemplateId === "rt-grounded-v2");
  check("assignment echoes revealPersona", asn.data.revealPersona === false);
  const asnList = await call(`/assignments?counsellorId=${counsellor.id}`);
  check("assignment visible to counsellor", asnList.data.some((a) => a.id === asn.data.id));

  console.log("SESSION (assigned) — this makes real LLM calls, please wait…");
  const start = await call("/sessions/start", { method: "POST", body: { mode: "assigned", counsellorId: counsellor.id, assignmentId: asn.data.id } });
  check("start session", start.status === 200 && start.data.sessionId && start.data.firstMessage);
  check("start response has milestones", typeof start.data.milestones?.objectionsRaised === "number");
  const sid = start.data.sessionId;
  const sessionGet = await call(`/sessions/${sid}`);
  check("session has courseSnapshot", sessionGet.data.courseSnapshot && /Cyber Security|Ethical Hacking/i.test(sessionGet.data.courseSnapshot.name));
  check("session snapshots rubric", sessionGet.data.rubricSnapshot?.templateId === "rt-grounded-v2");

  const m1 = await call(`/sessions/${sid}/message`, { method: "POST", body: { message: "Hi! I understand the technical side feels intimidating. Our first module starts from absolute basics with mentor support — many career switchers with no coding background have completed it. What worries you most?" } });
  check("message 1 returns reply + score", m1.status === 200 && m1.data.reply && typeof m1.data.satisfactionScore === "number");
  check("message 1 response has emotion", typeof m1.data.emotion === "string");
  check("message response has milestones", typeof m1.data.milestones?.objectionsRaised === "number");
  const m2 = await call(`/sessions/${sid}/message`, { method: "POST", body: { message: "Totally fair. There's a refund window and recordings if you fall behind, plus placement support. Shall I block your seat with the 4000 today?", deliveryMetrics: { tone: "warm", wpm: 150 } } });
  check("message 2 returns reply", m2.status === 200 && m2.data.reply);
  check("message 2 response has emotion", typeof m2.data.emotion === "string");

  const sessionAfterMsgs = await call(`/sessions/${sid}`);
  check("deliveryMetrics persisted on counsellor transcript entry", Array.isArray(sessionAfterMsgs.data.transcript) && sessionAfterMsgs.data.transcript.some((e) => e.role === "counsellor" && e.deliveryMetrics?.tone === "warm"));

  console.log("END -> REPORT");
  const end = await call(`/sessions/${sid}/end`, { method: "POST" });
  check("end session returns reportId", end.status === 200 && end.data.reportId);
  const rid = end.data.reportId;

  const report = await call(`/reports/${rid}`);
  const r = report.data;
  check("report has overall % + band + outcome", r.overall && typeof r.overall.percent === "number" && r.overall.band && r.overall.outcome);
  // deliveryMetrics were sent on message 2, so this counts as a voice session: voice_delivery is graded -> 8 criteria
  check("report has 8 rubric criteria (voice session)", Array.isArray(r.rubric) && r.rubric.length === 8 && r.rubric.every((x) => x.level && x.label));
  check("rubric weights sum ~100", (() => { const s = (r.rubric || []).reduce((a, x) => a + (x.weight || 0), 0); return s >= 99.5 && s <= 100.5; })());
  check("report has 5 phase breakdowns", Array.isArray(r.phaseBreakdown) && r.phaseBreakdown.length === 5);
  check("report has keyMoments + drills + benchmarks", Array.isArray(r.keyMoments) && Array.isArray(r.drills) && r.benchmarks && typeof r.benchmarks.medianPaidMinutes === "number");
  check("report has transcript + score arc", Array.isArray(r.transcript) && r.transcript.length >= 3 && Array.isArray(r.scoreArc));

  console.log("VISIBILITY (both sides)");
  const counsellorReports = await call(`/reports?counsellorId=${counsellor.id}`);
  check("report visible to counsellor", counsellorReports.data.some((x) => x.id === rid));
  const adminReports = await call("/reports");
  check("report visible to admin (all)", adminReports.data.some((x) => x.id === rid));

  const asnAfter = await call(`/assignments/${asn.data.id}`);
  check("assignment marked completed + linked to report", asnAfter.data.status === "completed" && asnAfter.data.reportId === rid);

  console.log("ANALYTICS");
  // Admin analytics
  const adminAnalytics = await call("/analytics/admin");
  check("admin analytics 200", adminAnalytics.status === 200);
  check("kpis.mocksCompleted is number", typeof adminAnalytics.data.kpis?.mocksCompleted === "number");
  check("kpis.avgScore is number", typeof adminAnalytics.data.kpis?.avgScore === "number");
  check("kpis.completionRatePct is number", typeof adminAnalytics.data.kpis?.completionRatePct === "number");
  check("teamHeatmap.rows is array", Array.isArray(adminAnalytics.data.teamHeatmap?.rows));
  check("weeklyTrend is array", Array.isArray(adminAnalytics.data.weeklyTrend));
  check("counsellors is array", Array.isArray(adminAnalytics.data.counsellors));
  check("objectionPerformance is array", Array.isArray(adminAnalytics.data.objectionPerformance));
  check("recentReports is array", Array.isArray(adminAnalytics.data.recentReports));
  check("no NaN in kpis", Object.values(adminAnalytics.data.kpis || {}).every((v) => v === null || (typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v))));

  // Counsellor analytics (use the logged-in counsellor)
  const cAnalytics = await call(`/analytics/counsellor/${counsellor.id}`);
  check("counsellor analytics 200", cAnalytics.status === 200);
  check("trend is array", Array.isArray(cAnalytics.data.trend));
  check("radar has criteria array", Array.isArray(cAnalytics.data.radar?.criteria));
  check("radar has mine object", cAnalytics.data.radar && typeof cAnalytics.data.radar.mine === "object");
  check("radar has team object", cAnalytics.data.radar && typeof cAnalytics.data.radar.team === "object");
  check("recommendedDrill key present", "recommendedDrill" in cAnalytics.data);
  check("recommendedDrill is null or has title", cAnalytics.data.recommendedDrill === null || typeof cAnalytics.data.recommendedDrill?.title === "string");
  check("pendingMocks is number", typeof cAnalytics.data.pendingMocks === "number");
  check("completedMocks is number", typeof cAnalytics.data.completedMocks === "number");
  check("avgPercent is number", typeof cAnalytics.data.avgPercent === "number");

  // Unknown counsellor id → 404
  const unknownAnalytics = await call("/analytics/counsellor/no-such-id-xyz");
  check("unknown counsellor id → 404", unknownAnalytics.status === 404);

  console.log("CLEANUP");
  const delReport = await call(`/reports/${rid}`, { method: "DELETE" });
  check("cleanup: delete report", delReport.data.ok === true);
  const delSession = await call(`/sessions/${sid}`, { method: "DELETE" });
  check("cleanup: delete session", delSession.data.ok === true);
  const delAsn = await call(`/assignments/${asn.data.id}`, { method: "DELETE" });
  check("cleanup: delete assignment", delAsn.data.ok === true);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e.message);
  process.exit(1);
});
