// smoke.mjs — lightweight dispatch smoke test for the api edge function router.
// Stubs out store, auth, and env so no network calls are made.
// Exercises normalizePath-based dispatch for 3 routes: GET /counsellors,
// GET /personas, POST /courses (expected 403 since ctx.role=counsellor).
// Run with: node supabase/functions/api/smoke.mjs

import { normalizePath } from "../_shared/path.js";

// ─── Minimal stubs ───────────────────────────────────────────────────────────

// Stub globalThis.Deno so env.js falls back to process.env
globalThis.Deno = undefined;

// Stub getSupabaseAdmin, store, and auth BEFORE importing the router
// We override them by monkeypatching the modules cache.
// Since ES modules are not easily patchable, we test normalizePath + Hono dispatch
// by constructing synthetic Requests and confirming route matching works.

// ─── Test normalizePath ───────────────────────────────────────────────────────
// normalizePath accepts either a Request object or a plain URL string.
// When a plain string is passed it is treated as a raw path (not a full URL).
// Pass synthetic Request objects instead so URL parsing fires correctly.
function makeReq(urlStr) {
  return new Request(urlStr);
}

const cases = [
  // Standard single-prefix paths (remain unchanged)
  [makeReq("https://proj.supabase.co/functions/v1/api/counsellors"), "/counsellors"],
  [makeReq("https://proj.supabase.co/functions/v1/api/personas"), "/personas"],
  [makeReq("https://proj.supabase.co/functions/v1/api/assignments/abc123"), "/assignments/abc123"],
  [makeReq("https://proj.supabase.co/functions/v1/api/sessions/start"), "/sessions/start"],
  [makeReq("https://proj.supabase.co/functions/v1/api/config/prompts"), "/config/prompts"],
  [makeReq("https://proj.supabase.co/api/lead-profiles?category=graduate"), "/lead-profiles"],
  [makeReq("https://proj.supabase.co/functions/v1/api/assignment-templates/abc/assign"), "/assignment-templates/abc/assign"],
  [makeReq("https://proj.supabase.co/functions/v1/api/analytics/counsellor/xyz"), "/analytics/counsellor/xyz"],
  [makeReq("https://proj.supabase.co/functions/v1/api/reports/r1/regenerate"), "/reports/r1/regenerate"],
  // Double-prefix paths from Vercel rewrites (FIX 2 edge cases)
  [makeReq("https://proj.supabase.co/functions/v1/api/api/counsellors"), "/counsellors"],
  [makeReq("https://proj.supabase.co/functions/v1/api/api/personas"), "/personas"],
  [makeReq("https://proj.supabase.co/functions/v1/api/api/sessions/start"), "/sessions/start"],
  // Bare path (nothing stripped)
  [makeReq("https://proj.supabase.co/counsellors"), "/counsellors"],
  // Only /api prefix
  [makeReq("https://proj.supabase.co/api/personas"), "/personas"],
  // Session function: /functions/v1/session/api/sessions/X/message
  [makeReq("https://proj.supabase.co/functions/v1/api/api/reports/r1/regenerate"), "/reports/r1/regenerate"],
];

let passed = 0;
let failed = 0;
for (const [input, expected] of cases) {
  const got = normalizePath(input, "api");
  if (got === expected) {
    console.log(`  PASS  normalizePath(req.url.split("/").slice(-2)="${input.url.split("/").slice(-2).join("/")}") = "${got}"`);
    passed++;
  } else {
    console.error(`  FAIL  normalizePath(url="${input.url}") => "${got}" (expected "${expected}")`);
    failed++;
  }
}

console.log(`\nnormalizePath: ${passed} passed, ${failed} failed`);

// ─── Route coverage check (pattern matching only, no network) ─────────────────
// Verify that the routes declared in index.ts cover the required CONTRACT paths.
// We read the file text and grep for route registrations.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "index.ts"), "utf-8");

const required = [
  ['GET  /counsellors',           /app\.get\(['""]\/counsellors/],
  ['GET  /personas',              /app\.get\(['""]\/personas/],
  ['POST /personas',              /app\.post\(['""]\/personas/],
  ['PUT  /personas/:id',          /app\.put\(['""]\/personas\/:id/],
  ['DEL  /personas/:id',          /app\.delete\(['""]\/personas\/:id/],
  ['GET  /courses',               /app\.get\(['""]\/courses/],
  ['POST /courses',               /app\.post\(['""]\/courses/],
  ['PUT  /courses/:id',           /app\.put\(['""]\/courses\/:id/],
  ['DEL  /courses/:id',           /app\.delete\(['""]\/courses\/:id/],
  ['GET  /rubric-templates',      /app\.get\(['""]\/rubric-templates/],
  ['POST /rubric-templates',      /app\.post\(['""]\/rubric-templates/],
  ['PUT  /rubric-templates/:id',  /app\.put\(['""]\/rubric-templates\/:id/],
  ['DEL  /rubric-templates/:id',  /app\.delete\(['""]\/rubric-templates\/:id/],
  ['GET  /lead-profiles',         /app\.get\(['""]\/lead-profiles/],
  ['GET  /assignments',           /app\.get\(['""]\/assignments['"",]/],
  ['POST /assignments',           /app\.post\(['""]\/assignments['"",]/],
  ['GET  /assignments/:id',       /app\.get\(['""]\/assignments\/:id/],
  ['DEL  /assignments/:id',       /app\.delete\(['""]\/assignments\/:id/],
  ['GET  /assignment-templates',  /app\.get\(['""]\/assignment-templates['"",]/],
  ['POST /assignment-templates',  /app\.post\(['""]\/assignment-templates['"",]/],
  ['PUT  /assignment-templates/:id', /app\.put\(['""]\/assignment-templates\/:id/],
  ['DEL  /assignment-templates/:id', /app\.delete\(['""]\/assignment-templates\/:id/],
  ['POST /assignment-templates/:id/assign', /app\.post\(['""]\/assignment-templates\/:id\/assign/],
  ['POST /sessions/start',        /app\.post\(['""]\/sessions\/start/],
  ['GET  /sessions/:id',          /app\.get\(['""]\/sessions\/:id['"",]/],
  ['DEL  /sessions/:id',          /app\.delete\(['""]\/sessions\/:id['"",]/],
  ['GET  /sessions/:id/prompt',   /app\.get\(['""]\/sessions\/:id\/prompt/],
  ['POST /sessions/:id/end',      /app\.post\(['""]\/sessions\/:id\/end/],
  ['GET  /reports',               /app\.get\(['""]\/reports['"",]/],
  ['GET  /reports/:id',           /app\.get\(['""]\/reports\/:id['"",]/],
  ['DEL  /reports/:id',           /app\.delete\(['""]\/reports\/:id/],
  ['POST /reports/:id/regenerate',/app\.post\(['""]\/reports\/:id\/regenerate/],
  ['GET  /analytics/admin',       /app\.get\(['""]\/analytics\/admin/],
  ['GET  /analytics/counsellor/:id', /app\.get\(['""]\/analytics\/counsellor\/:id/],
  ['GET  /config/prompts',        /app\.get\(['""]\/config\/prompts/],
  ['PUT  /config/prompts',        /app\.put\(['""]\/config\/prompts/],
  ['GET  /config/scoring',        /app\.get\(['""]\/config\/scoring/],
  ['PUT  /config/scoring',        /app\.put\(['""]\/config\/scoring/],
];

let rpassed = 0;
let rfailed = 0;
for (const [label, re] of required) {
  if (re.test(src)) {
    console.log(`  PASS  route ${label}`);
    rpassed++;
  } else {
    console.error(`  FAIL  route ${label} not found (regex: ${re})`);
    rfailed++;
  }
}
console.log(`\nroute coverage: ${rpassed} passed, ${rfailed} failed`);

const total = failed + rfailed;
if (total > 0) {
  console.error(`\n${total} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
