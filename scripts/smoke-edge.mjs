// scripts/smoke-edge.mjs — end-to-end smoke against the DEPLOYED Supabase stack.
// Usage: node scripts/smoke-edge.mjs   (reads repo-root .env: SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
//
// Covers: domain-restricted signup (negative), admin-created test user, JWT
// auth (401 unauth), library reads, practice-session start, two live /message
// turns (Sonnet 4.6), /end, report-worker generation poll.
// Replaces scripts/smoke-api.mjs (Express-era) for the edge stack.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const URL_ = env.SUPABASE_URL;
const FN = `${URL_}/functions/v1`;
const TEST_EMAIL = "test.counsellor@masaischool.com";
const TEST_PASS = "SmokeTest-1234";

const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
};

// ── 1. Domain restriction (negative): non-masaischool signup must be rejected
{
  const { error } = await admin.auth.admin.createUser({
    email: "smoke.blocked@gmail.com",
    password: TEST_PASS,
    email_confirm: true,
  });
  ok(!!error, "non-@masaischool.com signup is rejected by the DB trigger", error?.message?.slice(0, 80));
}

// ── 2. Test counsellor exists (idempotent create)
{
  const { error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASS,
    email_confirm: true,
    user_metadata: { name: "Smoke Counsellor" },
  });
  ok(!error || /already.*(registered|exists)/i.test(error.message), "test counsellor created/exists", error?.message?.slice(0, 80));
}

// ── 3. Sign in → JWT; profile row has default role counsellor
const { data: signin, error: signinErr } = await anon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASS });
ok(!signinErr && !!signin?.session?.access_token, "password sign-in returns a JWT", signinErr?.message);
const jwt = signin.session.access_token;
const userId = signin.user.id;
{
  const { data: prof } = await admin.from("profiles").select("role,name,email").eq("id", userId).single();
  ok(prof?.role === "counsellor", "profile auto-created with default role counsellor", `role=${prof?.role}`);
}

const call = async (fn, path, opts = {}) => {
  const res = await fetch(`${FN}/${fn}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.noAuth ? {} : { Authorization: `Bearer ${jwt}` }),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
};

// ── 4. Unauthenticated → 401
{
  const r = await call("api", "/personas", { noAuth: true });
  ok(r.status === 401, "unauthenticated request is rejected", `status=${r.status}`);
}

// ── 5. Library reads
const personas = await call("api", "/personas");
ok(personas.status === 200 && personas.data?.length >= 5, "GET /personas", `count=${personas.data?.length}`);
const courses = await call("api", "/courses?active=1");
ok(courses.status === 200 && courses.data?.length >= 50, "GET /courses", `count=${courses.data?.length}`);

// ── 6. Counsellor cannot mutate library (403)
{
  const r = await call("api", "/personas", { method: "POST", body: { name: "x", category: "custom" } });
  ok(r.status === 403, "counsellor POST /personas is 403", `status=${r.status}`);
}

// ── 7. Practice text session start
const persona = personas.data[0];
const course = courses.data.find((c) => c.feeTotal) || courses.data[0];
const start = await call("api", "/sessions/start", {
  method: "POST",
  body: { mode: "practice", sessionMode: "text", personaId: persona.id, courseId: course.id },
});
ok(start.status === 200 || start.status === 201, "POST /sessions/start (practice, text)", `status=${start.status} ${JSON.stringify(start.data)?.slice(0, 120)}`);
const sessionId = start.data?.session?.id || start.data?.sessionId || start.data?.id;
ok(!!sessionId, "session id returned", sessionId);

// ── 8. Two live conversation turns (Sonnet 4.6 through the session fn)
async function turn(text) {
  const t0 = Date.now();
  const r = await call("session", `/sessions/${sessionId}/message`, { method: "POST", body: { message: text } });
  const reply = r.data?.reply ?? JSON.stringify(r.data)?.slice(0, 200);
  console.log(`      [${Date.now() - t0}ms] student: ${String(reply).slice(0, 140)}`);
  return r;
}
{
  const r = await turn("Hello! This is Smoke from Masai. You cleared our qualifier test — congratulations! Can you tell me a bit about yourself?");
  ok(r.status === 200, "turn 1 (/message)", `status=${r.status}`);
  const r2 = await turn("Great. So the program fee is 52,000 plus GST — but before we get into that, what does your typical week look like, time-wise?");
  ok(r2.status === 200, "turn 2 (/message, fee mention + pivot)", `status=${r2.status}`);
}

// ── 9. End session → stub
const end = await call("api", `/sessions/${sessionId}/end`, { method: "POST" });
ok(end.status === 200 && end.data?.reportId, "POST /end returns report stub", `status=${end.status} reportStatus=${end.data?.status}`);

// ── 10. Report generation completes (worker + Sonnet reasoning fan-out)
{
  const reportId = end.data.reportId;
  let final = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await call("api", `/reports/${reportId}`);
    if (r.data?.status && r.data.status !== "generating") { final = r.data; break; }
    if (i % 5 === 4) console.log(`      ...still generating (${(i + 1) * 4}s)`);
  }
  ok(final?.status === "ready", "report generated", `status=${final?.status} percent=${final?.overall?.percent} rubric=${final?.rubric?.length} criteria`);
  if (final?.overall?.headline) console.log(`      headline: ${final.overall.headline}`);
}

console.log(failures === 0 ? "\nALL EDGE SMOKE CHECKS PASS" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
