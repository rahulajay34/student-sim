# Plan 2: Course Catalog (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. NO-GIT RULE applies: no git commands; tasks end with Verify steps.

**Goal:** Scrape 15 diverse Masai courses into `server/data/courses.json`, give admin a Courses page + course picker on assignment creation (and practice mode), snapshot the course onto sessions, and drive the student prompt + report grading from real course facts.

**Architecture:** Deterministic scraper (`scripts/scrape-courses.mjs`) dumps program pages to text; one LLM workflow extracts per-course records; `scripts/validate-courses.mjs` gates them; assembled catalog ships as `server/data/courses.json`. Server gains a `courses` collection + CRUD; `courseContext.js` becomes `buildCourseContext(course)` with the legacy IIM Ranchi text as fallback; sessions store `courseSnapshot`; report prompt cites real course facts. Client mirrors the Personas page pattern.

**Tech Stack:** node stdlib (fetch built-in), existing Express/store patterns, existing React UI kit. No new deps.

**Spec:** design doc §5. **Recon facts:** course pages live at `https://www.masaischool.com/program/<institute>/<course>` (server-rendered Astro, 200 OK, fees/curriculum/FAQ in HTML).

---

## The 15 curated slugs (diversity: 9 domains, 11 institutes)

| # | path | category | note |
|---|---|---|---|
| 1 | `iim-ranchi/business-analytics-ai-sop` | analytics-ai | the corpus course |
| 2 | `iim-mumbai/ai-bi` | analytics-ai | |
| 3 | `iit-patna/ai-ml-sop` | data-science-ai-ml | |
| 4 | `iit-patna/gen-ai` | data-science-ai-ml | |
| 5 | `iit-mandi/nlp-ai-ml` | data-science-ai-ml | |
| 6 | `iit-patna/software-engineering-ai` | software-development-engineering | |
| 7 | `iit-roorkee/software-engineering` | software-development-engineering | |
| 8 | `iit-roorkee/cyber-security` | cybersecurity | |
| 9 | `pwc/cyber-security-ethical-hacking-ai` | cybersecurity | industry partner |
| 10 | `iim-ranchi/executive-product-management` | product-management-ai | |
| 11 | `iim-rohtak/digital-marketing` | marketing-analytics | |
| 12 | `iim-trichy/fintech-ai` | finance-technology | |
| 13 | `xlri/entrepreneurship` | entrepreneurship-leadership | |
| 14 | `rotman/data-driven-decision-making-with-gen-ai` | business-management | international |
| 15 | `bitsom/pgp` | business-management | flagship PGP |

## Course data shape (CONTRACT addendum)

```
Course { id: "course-<8hex>", slug: "<institute>/<course>", name, category,           // one of the 9 domain keys
         institute,                       // "IIM Ranchi", "IIT Patna", ...
         partner: "Masai School",
         duration, format,                // "6 months", "Online" / "Online + campus immersion"
         feeTotal: number|null,           // ₹ total programme fee
         feeBooking: number|null,         // ₹ seat-block / booking amount
         feeNote: string,                 // free text: GST, upfront-vs-EMI nuance
         emiNote: string,
         curriculum: [string],            // module titles
         outcomes: [string], eligibility: string, usps: [string],
         batchInfo: string, sourceUrl, scrapedAt, active: true }
```

Sessions gain `courseSnapshot` (the full course record at start time). Assignments gain `courseId` (required at creation).

---

### Task 1: Scraper — `scripts/scrape-courses.mjs`

**Files:** Create `scripts/scrape-courses.mjs`. Output dir `scripts/scrape-work/` (gitignore it: add `scripts/scrape-work/` to `.gitignore`).

- [ ] **Step 1: Implement:**

```js
#!/usr/bin/env node
// Fetch curated Masai program pages -> readable text dumps for LLM extraction.
// Usage: node scripts/scrape-courses.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'scrape-work');

export const SLUGS = [
  ['iim-ranchi/business-analytics-ai-sop', 'analytics-ai'],
  ['iim-mumbai/ai-bi', 'analytics-ai'],
  ['iit-patna/ai-ml-sop', 'data-science-ai-ml'],
  ['iit-patna/gen-ai', 'data-science-ai-ml'],
  ['iit-mandi/nlp-ai-ml', 'data-science-ai-ml'],
  ['iit-patna/software-engineering-ai', 'software-development-engineering'],
  ['iit-roorkee/software-engineering', 'software-development-engineering'],
  ['iit-roorkee/cyber-security', 'cybersecurity'],
  ['pwc/cyber-security-ethical-hacking-ai', 'cybersecurity'],
  ['iim-ranchi/executive-product-management', 'product-management-ai'],
  ['iim-rohtak/digital-marketing', 'marketing-analytics'],
  ['iim-trichy/fintech-ai', 'finance-technology'],
  ['xlri/entrepreneurship', 'entrepreneurship-leadership'],
  ['rotman/data-driven-decision-making-with-gen-ai', 'business-management'],
  ['bitsom/pgp', 'business-management'],
];

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

async function fetchPage(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (catalog-build)' } });
  if (!res.ok) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); return fetchPage(url, attempt + 1); }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const [slug, category] of SLUGS) {
    const url = `https://www.masaischool.com/program/${slug}`;
    const file = join(OUT, `${slug.replace('/', '__')}.txt`);
    try {
      const html = await fetchPage(url);
      const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      const desc = (html.match(/name="description" content="([^"]*)"/i) || [])[1] || '';
      const text = htmlToText(html);
      writeFileSync(file, `SOURCE_URL: ${url}\nSLUG: ${slug}\nCATEGORY: ${category}\nTITLE: ${title}\nMETA_DESCRIPTION: ${desc}\n\n${text}`);
      console.log('ok', slug, `${text.length} chars`);
    } catch (e) {
      failed++;
      console.error('FAIL', slug, e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (failed) process.exit(1);
}
```

- [ ] **Step 2: Add `scripts/scrape-work/` to `.gitignore`** (after `scripts/mine/work/`).

- [ ] **Step 3: Run + verify**

Run: `node scripts/scrape-courses.mjs && ls scripts/scrape-work/*.txt | wc -l`
Expected: 15 `ok` lines, then `15`. Spot-check: `head -8 "scripts/scrape-work/iim-ranchi__business-analytics-ai-sop.txt"` shows SOURCE_URL/SLUG/CATEGORY/TITLE headers and readable text below.

---

### Task 2: Catalog extraction (Claude workflow) + validator + assembly

**Files:** Create `scripts/validate-courses.mjs`. Workflow writes `scripts/scrape-work/extracted/<slug__flat>.json`; controller assembles `server/data/courses.json`.

- [ ] **Step 1: Implement `scripts/validate-courses.mjs`:**

```js
#!/usr/bin/env node
// Validate server/data/courses.json shape. Exit 1 on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CATEGORIES = new Set(['analytics-ai', 'data-science-ai-ml', 'software-development-engineering',
  'cybersecurity', 'product-management-ai', 'marketing-analytics', 'finance-technology',
  'entrepreneurship-leadership', 'business-management']);

export function validateCourses(courses) {
  const errs = [];
  if (!Array.isArray(courses) || courses.length < 1) return ['courses must be a non-empty array'];
  const ids = new Set(), slugs = new Set();
  courses.forEach((c, i) => {
    const ctx = `courses[${i}](${c.slug || '?'})`;
    for (const k of ['id', 'slug', 'name', 'category', 'institute', 'duration', 'format', 'sourceUrl', 'scrapedAt']) {
      if (typeof c[k] !== 'string' || !c[k]) errs.push(`${ctx}: ${k} missing`);
    }
    if (!CATEGORIES.has(c.category)) errs.push(`${ctx}: bad category ${c.category}`);
    for (const k of ['feeTotal', 'feeBooking']) {
      if (!(c[k] === null || (typeof c[k] === 'number' && c[k] > 0))) errs.push(`${ctx}: ${k} must be positive number or null`);
    }
    for (const k of ['curriculum', 'outcomes', 'usps']) {
      if (!Array.isArray(c[k]) || c[k].some((x) => typeof x !== 'string' || !x)) errs.push(`${ctx}: ${k} must be string array`);
    }
    if (!Array.isArray(c.curriculum) || c.curriculum.length < 3) errs.push(`${ctx}: curriculum too thin`);
    for (const k of ['feeNote', 'emiNote', 'eligibility', 'batchInfo']) {
      if (typeof c[k] !== 'string') errs.push(`${ctx}: ${k} must be string`);
    }
    if (typeof c.active !== 'boolean') errs.push(`${ctx}: active must be boolean`);
    if (ids.has(c.id)) errs.push(`${ctx}: duplicate id`);
    if (slugs.has(c.slug)) errs.push(`${ctx}: duplicate slug`);
    ids.add(c.id); slugs.add(c.slug);
  });
  return errs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'courses.json');
  const errs = validateCourses(JSON.parse(readFileSync(p, 'utf8')));
  if (errs.length) { console.error(`FAIL\n  - ${errs.join('\n  - ')}`); process.exit(1); }
  console.log('OK courses.json');
}
```

- [ ] **Step 2 (controller): Run the extraction workflow.** 15 light agents (sonnet), one per dump file. Each agent: Read `scripts/scrape-work/<slug__flat>.txt`, extract the course record per the Course shape (id = `"course-" + first 8 chars of a stable slug hash — leave id as the literal string "PENDING" for the assembler to fill`; feeTotal/feeBooking as plain rupee numbers, null when genuinely absent; curriculum = module titles; keep marketing fluff out of usps, max 6), Write `scripts/scrape-work/extracted/<slug__flat>.json`, return schema-forced summary `{slug, name, feeTotal: number|null, modules: number}`.

- [ ] **Step 3 (controller): Assemble.** Node one-liner: read all 15 extracted files, fill `id` (`course-` + sha1(slug).slice(0,8)), force `partner: "Masai School"`, `active: true`, `scrapedAt` = today ISO, `category`/`slug`/`sourceUrl` overridden from the SLUGS table (never trust agent copies of these), sort by category then name, write `server/data/courses.json` (indent 2).

- [ ] **Step 4: Validate**

Run: `node scripts/validate-courses.mjs`
Expected: `OK courses.json`. Then `node -e "const c=require('./server/data/courses.json'); console.log(c.length, new Set(c.map(x=>x.category)).size, c.filter(x=>x.feeTotal).length)"` → `15 9 <≥8>` (most pages publish fees).

---

### Task 3: Server integration

**Files:** Modify `server/store.js`, `server/index.js`, `server/courseContext.js`, `server/prompt.js`, `server/engine.js`, `server/report.js`.

- [ ] **Step 1: `store.js`** — change line 11 to `const RUNTIME_FILES = ["assignments.json", "sessions.json", "reports.json", "courses.json"];` (bootstrap creates `[]` only if the file is missing; the shipped catalog is preserved).

- [ ] **Step 2: `index.js` — Courses CRUD** (insert after the Personas block, mirroring its style):

```js
// --- Courses (admin CRUD; catalog ships scraped, admin can edit) -----------
app.get("/api/courses", (req, res) => {
  const all = store.getAll("courses");
  res.json(req.query.active === "1" ? all.filter((c) => c.active) : all);
});

app.post("/api/courses", (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.institute) return res.status(400).json({ error: "name and institute are required" });
  const course = {
    id: store.newId("course"),
    slug: b.slug || `manual/${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: b.name, category: b.category || "business-management", institute: b.institute,
    partner: "Masai School", duration: b.duration || "", format: b.format || "Online",
    feeTotal: b.feeTotal ?? null, feeBooking: b.feeBooking ?? null,
    feeNote: b.feeNote || "", emiNote: b.emiNote || "",
    curriculum: b.curriculum || [], outcomes: b.outcomes || [], eligibility: b.eligibility || "",
    usps: b.usps || [], batchInfo: b.batchInfo || "",
    sourceUrl: b.sourceUrl || "", scrapedAt: new Date().toISOString(), active: b.active !== false,
  };
  res.json(store.insert("courses", course));
});

app.put("/api/courses/:id", (req, res) => {
  const allowed = ["name", "category", "institute", "duration", "format", "feeTotal", "feeBooking",
    "feeNote", "emiNote", "curriculum", "outcomes", "eligibility", "usps", "batchInfo", "active"];
  const patch = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  const updated = store.update("courses", req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Course not found" });
  res.json(updated);
});

app.delete("/api/courses/:id", (req, res) => {
  store.remove("courses", req.params.id);
  res.json({ ok: true });
});
```

- [ ] **Step 3: `index.js` — assignments POST**: add `courseId` to the destructure; after the personaId check add:

```js
  const course = store.getById("courses", courseId);
  if (!course) return res.status(400).json({ error: "courseId is required and must exist" });
```

and add `courseId,` to the assignment object literal.

- [ ] **Step 4: `index.js` — sessions/start**: destructure `courseId` from body. After persona resolution add:

```js
    let courseId2 = courseId;
    if (mode === "assigned" && assignment) courseId2 = assignment.courseId || courseId2;
    let course = courseId2 ? store.getById("courses", courseId2) : null;
    if (!course) course = store.getAll("courses").find((c) => c.slug === "iim-ranchi/business-analytics-ai-sop") || null;
    const courseSnapshot = course ? { ...course } : null;
```

Add `courseSnapshot,` to the session object. Change the engine call to `getFirstMessage(personaSnapshot, scenario2, courseSnapshot)`.

- [ ] **Step 5: `courseContext.js`** — rewrite: keep the existing `COURSE_CONTEXT` string but rename export to `LEGACY_COURSE_CONTEXT`, and add:

```js
const fmtINR = (n) => (typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : null);

export function buildCourseContext(course) {
  if (!course) return LEGACY_COURSE_CONTEXT;
  const fee = fmtINR(course.feeTotal);
  const booking = fmtINR(course.feeBooking) || "₹4,000";
  return `
PROGRAMME: ${course.name}
INSTITUTION: ${course.institute}, in partnership with ${course.partner || "Masai School"}
DURATION: ${course.duration || "n/a"} | MODE: ${course.format || "Online"}
${course.batchInfo ? `BATCH: ${course.batchInfo}` : ""}

FEE STRUCTURE:
- Seat blocking fee (what the counsellor is asking for on this call): ${booking}
${fee ? `- Total programme fee: ${fee}${course.feeNote ? ` (${course.feeNote})` : ""}` : `- Total programme fee: ${course.feeNote || "shared on the call by the counsellor"}`}
${course.emiNote ? `- EMI: ${course.emiNote}` : ""}

CURRICULUM (${course.curriculum.length} modules):
${course.curriculum.map((m, i) => `${i + 1}. ${m}`).join("\n")}
${course.eligibility ? `\nELIGIBILITY: ${course.eligibility}` : ""}
${course.usps?.length ? `\nPROGRAMME HIGHLIGHTS:\n${course.usps.map((u) => `- ${u}`).join("\n")}` : ""}

COUNSELLOR'S OBJECTIVE ON THIS CALL:
The counsellor is trying to get you to pay ${booking} to block your seat in this programme. You have shown
baseline interest (you booked this counselling call yourself) but have made no financial commitment yet.
`;
}
```

- [ ] **Step 6: `prompt.js`** — replace `import { COURSE_CONTEXT } from "./courseContext.js";` with `import { buildCourseContext } from "./courseContext.js";`; thread a `course` param through `buildSystemPrompt(persona, scenario, phase, score, course)` and replace the `${COURSE_CONTEXT}` interpolation with `${buildCourseContext(course)}`.

- [ ] **Step 7: `engine.js`** — thread course: `getFirstMessage(personaSnapshot, scenario, courseSnapshot)` and `getStudentReply(session)` reads `session.courseSnapshot`; both pass it to `buildSystemPrompt`. (Read engine.js first; keep its message-array logic untouched.)

- [ ] **Step 8: `report.js`** — in `buildPrompt(session)`, replace the hardcoded programme sentence with:

```js
  const c = session.courseSnapshot;
  const courseLine = c
    ? `A counsellor was selling "${c.name}" (${c.institute} x Masai School) to a simulated prospective student.`
    : `A counsellor was selling the "Executive Certification Programme in Business Analytics and AI" (IIM Ranchi x Masai) to a simulated prospective student.`;
  const courseFacts = c ? `
COURSE FACTS (ground truth — penalize the counsellor under "knowledge" for contradicting these):
- Fee: ${c.feeTotal ? `₹${c.feeTotal}` : "not published"}; seat-block: ${c.feeBooking ? `₹${c.feeBooking}` : "₹4,000"}; ${c.feeNote}
- Duration: ${c.duration}; Format: ${c.format}
- Curriculum: ${c.curriculum.join("; ")}
` : "";
```

Use `${courseLine}` in place of the hardcoded sentence, insert `${courseFacts}` after the SCENARIO line, and make `outcomeDetail` reference `${c?.feeBooking ? `₹${c.feeBooking}` : "the 4000 rupee"} seat fee`.

- [ ] **Step 9: Verify (server-only)**

Run: `cd server && npm start` (background), then:
`curl -s localhost:3001/api/courses | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.length, j[0].name)})"` → `15 <name>`.
CRUD: POST a manual course, PUT `{active:false}`, DELETE it — mirror the smoke patterns. Then kill the server.

---

### Task 4: Client integration

**Files:** Modify `client/src/lib/api.js`, `client/src/main.jsx`, `client/src/layouts/AdminLayout.jsx` (sidebar items), `client/src/pages/admin/AssignmentCreate.jsx`, `client/src/pages/counsellor/Practice.jsx`. Create `client/src/pages/admin/Courses.jsx`.

- [ ] **Step 1: `api.js`** — add after personas block:

```js
  // courses
  getCourses: (activeOnly) => req(`/courses${activeOnly ? "?active=1" : ""}`),
  createCourse: (data) => req("/courses", { method: "POST", body: data }),
  updateCourse: (id, data) => req(`/courses/${id}`, { method: "PUT", body: data }),
  deleteCourse: (id) => req(`/courses/${id}`, { method: "DELETE" }),
```

- [ ] **Step 2: `Courses.jsx`** — mirror `Personas.jsx` exactly (same state/load/modal/CRUD skeleton, Card grid). Card shows: name (truncate), institute + category Badge, duration · format line, fee line (`feeTotal ? ₹-formatted : "Fee on request"` + feeBooking as "block: ₹N"), curriculum count, active Badge (`success`/`slate` "Active"/"Hidden"). Card actions: Edit (opens modal), Activate/Deactivate toggle (PUT `{active: !c.active}`), Delete (confirm dialog). Modal form fields: name*, institute*, category (Select with the 9 domain options), duration, format, feeTotal (number input, empty→null), feeBooking (number, empty→null), feeNote, emiNote, eligibility, batchInfo, curriculum (Textarea, one module per line ⇄ array via `.split("\n").map(s=>s.trim()).filter(Boolean)`), usps (Textarea, same convention), outcomes (Textarea, same). Use the UI kit only (Card, Badge, Button, Input, Select, Textarea, Modal, EmptyState, Spinner).

- [ ] **Step 3: routes + nav** — `main.jsx`: add `<Route path="/admin/courses" element={<Courses />} />` after personas route + import. `AdminLayout.jsx`: add `{ to: "/admin/courses", label: "Courses", icon: "🎓" }` to the sidebar items after Personas (match the existing items' icon style — read the file and follow its conventions).

- [ ] **Step 4: `AssignmentCreate.jsx`** — add `courseId` state + load `api.getCourses(true)` alongside personas/counsellors; add a required Select "Course" (options: `${c.name} — ${c.institute}`) in the form's first section; include `courseId` in the createAssignment payload; block submit with inline error if missing.

- [ ] **Step 5: `Practice.jsx`** — add optional course Select (same options + first option preselected to the IIM Ranchi BA course when present, since that matches the real corpus); pass `courseId` in the startSession payload.

- [ ] **Step 6: Verify**

Run: `cd client && npm run lint && npm run build`
Expected: lint passes (warnings ok, no errors), build succeeds.

---

### Task 5: CONTRACT addendum + smoke extension + end-to-end verification

**Files:** Modify `CONTRACT.md`, `scripts/smoke-api.mjs`, `CLAUDE.md`.

- [ ] **Step 1: CONTRACT.md** — add to §2 the Course shape (from this plan's header) + `Assignment.courseId` + `Session.courseSnapshot`; add to §3 the five course endpoints + `courseId` on `/assignments` POST and `/sessions/start`; add to §4 the `/admin/courses` route; add `getCourses/createCourse/updateCourse/deleteCourse` to the api client list.

- [ ] **Step 2: smoke-api.mjs** — insert after the PERSONAS block:

```js
  console.log("COURSES (admin CRUD + catalog)");
  const courses = await call("/courses");
  check("catalog has 15 scraped courses", Array.isArray(courses.data) && courses.data.length >= 15);
  const activeOnly = await call("/courses?active=1");
  check("active filter works", activeOnly.data.every((c) => c.active));
  const cCreated = await call("/courses", { method: "POST", body: { name: "Smoke Course", institute: "Test U", category: "analytics-ai", duration: "1 month", feeTotal: 1000, feeBooking: 100, curriculum: ["m1", "m2", "m3"] } });
  check("create course", cCreated.status === 200 && cCreated.data.id);
  const cToggled = await call(`/courses/${cCreated.data.id}`, { method: "PUT", body: { active: false } });
  check("toggle course active", cToggled.data.active === false);
  const cDel = await call(`/courses/${cCreated.data.id}`, { method: "DELETE" });
  check("delete course", cDel.data.ok === true);
  const baCourse = courses.data.find((c) => c.slug === "iim-ranchi/business-analytics-ai-sop");
  check("IIM Ranchi BA course present", !!baCourse);
```

Then update the existing assignment-creation block to pass `courseId: baCourse.id`, assert the created assignment echoes `courseId`, and after the session is started assert `GET /sessions/:id` returns `courseSnapshot.name` containing "Business Analytics". Also update the existing `/assignments` POST test (if it omits courseId it must now FAIL → assert status 400 for a courseId-less POST as a negative test).

- [ ] **Step 3: CLAUDE.md** — in the Server architecture section, note the new `courses` collection + `courseSnapshot`; in commands, note `node scripts/scrape-courses.mjs` regenerates the catalog (15 curated slugs).

- [ ] **Step 4: Full verification**

Run: server up (`cd server && npm start`, background) → `node scripts/smoke-api.mjs`.
Expected: all checks pass incl. the new COURSES block (the full flow makes real LLM calls — needs `.env`). Kill server after.

---

## Self-review notes

- Spec §5 coverage: scrape 15 ✓ (T1-2), admin Courses page ✓ (T4), assignment picker required ✓ (T3 S3 + T4 S4), practice picker ✓ (T4 S5), snapshot ✓ (T3 S4), prompt from snapshot ✓ (T3 S5-7), report checks claims vs facts ✓ (T3 S8), legacy context = fallback ✓ (T3 S5).
- Backward compat: sessions with no `courseSnapshot` (pre-existing data) fall back to legacy text in both prompt and report paths.
- Type consistency: `courseSnapshot` carried whole; `buildCourseContext(null)` → legacy string; smoke asserts the 400 on courseId-less assignment.
