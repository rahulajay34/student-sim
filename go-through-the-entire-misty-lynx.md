# Integrity-Probe / Misselling Detection (admin-only)

## Context

`student-sim` is a **mock counselling training platform**: counsellors run a phase-based sales
simulation against an LLM-roleplayed prospective student for Masai's IIT/IIM/BITS programmes, and
Claude (Sonnet 4.6) is the "analytics brain" that scores turns and writes a coaching report.

The business need: counsellors sometimes **oversell / mis-sell** to close — promising things the
programme does not actually offer (guaranteed jobs, full refunds, IIT/IIM alumni status, lifetime
content access, "watch all recordings and still get attendance", etc.). Those false assurances can
make the institute **liable to damages**.

This feature adds an **integrity probe** to every counselling session: the AI student naturally asks
**one** question from a curated, admin-managed library of "traps" — facts counsellors are likely to
lie about. After the session, the analytics brain judges whether the counsellor's answer was honest,
evasive, over-promised, or an outright lie, grounded in the real Masai policy ("ground-truth answer")
stored alongside each probe. The resulting **verdict is admin-only** — visible to admins/superadmins
on the report, **never to the counsellor** being graded (so the test stays blind and the liability
signal is not coachable-around).

### Architecture facts that shape this plan
- **Live backend = Supabase Edge Functions** (`supabase/functions/*`, Postgres + RLS + RPCs). The
  legacy Express `server/*` is kept in parity; `supabase/functions/_shared/lib/*.js` are near-identical
  copies of `server/*.js` (only import paths differ). Engine changes (`prompt.js`, `realtime.js`,
  `report.js`) must be made in **both** copies.
- The probe **library** can live in the existing **`app_config`** table (key/value jsonb) — which has
  **no `authenticated` RLS policy**, so it is service-role-only / admin-only by construction, exactly
  like the existing `/config/prompts` + `/config/scoring` pattern. **No migration needed for the library.**
- Reports are stored as hot columns + jsonb sections and committed through the fixed `commit_report`
  RPC patch contract. Persisting the per-report verdict needs **one migration** (new `integrity_check`
  jsonb column + extend the `commit_report` RPC).
- RLS is **row-level, not column-level**: a counsellor can SELECT their own report row, so the
  admin-only field **must be stripped at the edge layer** for non-admins (the established defense; RLS
  is only defense-in-depth).
- Delivery is **prompt-steered** (chosen): the student is instructed to ask its assigned probe once,
  naturally — works uniformly for voice (OpenAI Realtime) and text. The report-worker evaluates the
  full transcript at the end, so no per-turn mutation is required.

---

## The probe library (seed content — grounded in masaischool.com)

Each probe = `{ id, category, question, groundTruth, active }`. `question` is how the student naturally
raises it; `groundTruth` is the honest answer / what makes a reply a lie (used by the detector and
shown to admins). All fields are **admin-editable**; admins can add/disable probes. Grounded in the
Masai T&Cs and FAQ (no-refund clause; "Does Masai guarantee a job?"; 75–90% attendance with recordings
only "with prior permission… won't be as effective"; certificate needs min attendance + marks and is
forfeited on EMI default; certificate ≠ degree; scholarships at sole discretion).

| # | category | question (student asks) | groundTruth (honest answer / lie test) |
|---|---|---|---|
| 1 | job_guarantee | "Can you guarantee I'll get a job — like a 20 LPA package — after I finish?" | Masai does **not** guarantee a job or any CTC. Programmes give placement **assistance/opportunities** (some Pay-After-Placement). Promising a guaranteed job or salary = lie. |
| 2 | placement_eligibility | "Everyone in the batch gets placement support, no conditions?" | Placement assistance is **conditional** (e.g. IIT Patna ~70% attendance + ~7 CGPA). "Everyone, unconditionally" = lie. |
| 3 | refund | "If I don't like it after a few classes, I get a full refund, right?" | Per T&Cs, withdrawal before **or** after start = **no refund**. Promising refund/cooling-off/money-back = lie. |
| 4 | booking_refund | "The ₹4,000 booking just blocks my seat and I get it back?" | Booking/registration amount is **non-refundable** (adjusted into fee, not returned). "Fully refundable" = lie. |
| 5 | content_access | "Will I always have access to the content and recordings, forever?" | No lifetime/forever access is promised. Claiming permanent access = lie. |
| 6 | recordings_attendance | "I work full-time — can I just watch recordings later and still get attendance?" | Live attendance required (~75–90%); recordings only **with prior permission** and "won't be as effective"; they don't substitute attendance. "Watch anytime + get attendance" = lie. |
| 7 | certificate_auto | "Once I pay and finish, the IIT/IIM certificate is guaranteed?" | Certificate needs **min attendance + min marks** (e.g. 75% + 35%, varies) and is forfeited on EMI default. "Automatic/guaranteed" = lie. |
| 8 | degree_vs_cert | "So this is basically an IIT/IIM degree?" | It is a **certificate / certification programme, not a degree**. Calling it a degree = lie. |
| 9 | alumni_access | "Do I become an alumnus / get alumni access of the IIT/IIM?" | A short certificate programme does **not** confer IIT/IIM alumni status or alumni-network access. Promising it = lie. |
| 10 | campus_immersion | "The campus visit at the IIT is included free and guaranteed for everyone?" | Campus immersion is often **optional and/or at extra cost** (travel/stay), sometimes conditional. "Free + guaranteed for all" when untrue = lie. |
| 11 | emi_nocost | "The EMI is zero-interest / no-cost with no extra charges?" | NBFC / PAP financing carries interest; "no-cost EMI" is not assured. Guaranteeing 0%/no-cost = lie. |
| 12 | scholarship_urgency | "Is this scholarship only valid today — does the fee really go up tomorrow?" | Scholarships/schemes are at Masai's **sole discretion**; fabricated "today-only" deadlines/price hikes are misselling. Inventing fake urgency = lie. |
| 13 | faculty | "Are all classes taught directly by the IIT/IIM professors?" | Teaching is a **mix** (institute faculty for some modules + Masai instructors/industry mentors). "All by IIT/IIM profs" when untrue = lie. |
| 14 | mentorship | "Do I get unlimited personal 1:1 mentorship whenever I want?" | Mentorship is **structured/limited**, not unlimited on-demand. Overstating = lie. |

Selection per session: deterministic pick from `active` probes via an FNV-1a hash of the session id
(`hash(sessionId) % activeProbes.length`) — reproducible, no `Math.random` (banned in edge/workflow
contexts anyway). Snapshot the **whole** chosen probe onto the session at start so later admin edits
don't change an in-flight grade.

---

## Implementation

Naming: session field `integrityProbe` (snapshot of the assigned probe + nothing mutable); report field
`integrityCheck` (the verdict). app_config key `integrityProbes` (the library array).

### A. Probe library + admin CRUD + admin UI

**Storage** — `app_config` key `integrityProbes` = `{ probes: [{id,category,question,groundTruth,active}], guidelines: [] }`.
Reuse `store.upsertConfig("integrityProbes", …)` / `store.getConfigValue("integrityProbes")` (already in
`supabase/functions/_shared/store.js` and `server/store.js`). Seed the 14 probes above (one-time) via a
tiny module default + a `scripts/seed-integrity-probes.mjs` (or seed inline in migration `0007` with
`insert into app_config(key,value) … on conflict do nothing`).

**New shared module** `supabase/functions/_shared/lib/integrityProbes.js` (+ identical `server/integrityProbes.js`):
- `DEFAULT_PROBES` (the 14 seed entries)
- `loadProbes(configValue)` → merges stored over defaults, fail-soft
- `pickProbe(probes, sessionId)` → deterministic FNV-1a selection over `active` probes
- `newProbeId()` → reuse `store.newId()`

**Edge endpoints** in `supabase/functions/api/index.ts` — model exactly on the `/config/prompts`
admin block (lines 1152-1196). All gated with `assertAdmin(ctx)` (admin + superadmin):
- `GET  /integrity-probes` → `loadProbes(getConfigValue("integrityProbes"))`
- `PUT  /integrity-probes` → validate array of `{question,groundTruth,…}`, `upsertConfig`, return merged
  (whole-list save mirrors the prompt-config save model — simplest; the UI edits the list and saves).

Mirror the same two routes in `server/index.js` (file-store config).

**Client**:
- `client/src/lib/api.js` — add `api.getIntegrityProbes()` / `api.updateIntegrityProbes(data)` (copy the
  `getPromptConfig`/`updatePromptConfig` methods).
- New page `client/src/pages/admin/IntegrityProbes.jsx` — list/add/edit/disable rows
  `{question, groundTruth, category, active}`, Save/Discard. Reuse the row-list + add/remove pattern
  straight from `Prompts.jsx` (`Card`, `CardHeader`, `Input`, `Textarea`, `Button`, `useToast`,
  optimistic save). Header copy explains these are admin-only "integrity traps" never shown to counsellors.
- Routing/nav: register `import IntegrityProbes` + `<Route path="/admin/integrity-probes" …>` in
  `client/src/main.jsx` (under AdminLayout, near `/admin/prompts`); add a nav item
  `{ to: "/admin/integrity-probes", label: "Integrity Probes", icon: "prompts" }` and a `titleFor`
  entry in `client/src/layouts/AdminLayout.jsx`.

### B. Assign the probe at session start + inject into the student prompt

**Assign at start** — `supabase/functions/api/index.ts` `POST /sessions/start` (session object built
~828-856, inserted line 859). Before insert:
```js
const probeCfg = loadProbes(await store.getConfigValue("integrityProbes"));
const integrityProbe = pickProbe(probeCfg.probes, sessionId); // {id,category,question,groundTruth}
session.integrityProbe = integrityProbe;
```
**Persist it** — add `"integrityProbe"` to `SNAPSHOT_KEYS` in `supabase/functions/_shared/store.js`
(and `server/store.js`). It then rides the `snapshots` jsonb: written at insert, spread back on read,
and available to the report-worker via `getById("sessions")`. No migration; not mutated per-turn.

**Inject into the text prompt** — in `_shared/lib/prompt.js` **and** `server/prompt.js`,
`buildSystemPromptParts(...)` builds a **variable** (non-cached) section that already includes the
objection-state block. Add a small `buildIntegrityProbeSection(session)` that emits (only when
`session.integrityProbe` exists):
```
ONE QUESTION YOU MUST WORK IN NATURALLY (once, when it fits — do not reveal it is a test):
"<probe.question>"
```
and splice it into the variable section next to the objection block. `buildSystemPromptParts` already
receives `session` (last param) — thread `session.integrityProbe` through. **Do not** include
`groundTruth` in the prompt.

**Inject into the voice prompt** — in `_shared/lib/realtime.js` **and** `server/realtime.js`,
`buildRealtimeInstructions(session)` (sections joined ~line 199). Add a short
`buildRtimeProbeSection(session)` with the same "ask once, naturally, don't reveal it's a test" framing
and include it in the joined array. The realtime token is minted from the session, which carries
`integrityProbe` via snapshots.

### C. Detect the lie in the report-worker + persist the verdict

**Detector lives in `generateReport`** so both engine copies get it. In `_shared/lib/report.js` **and**
`server/report.js`, add a `buildIntegrityPrompt(session)` + `INTEGRITY_SCHEMA` and run it as an extra,
independent call inside `generateReport(session)` (parallel with Call A/B; wrap in its own try/catch so
failure is non-fatal — like `partial`). Inputs: `session.integrityProbe` (question + **groundTruth**),
`session.courseSnapshot` facts, and the full transcript. Output (jsonSchema-enforced, `mode:"reasoning"`):
```
integrityCheck = {
  probeId, category, question,
  raised: boolean,                       // did the student actually ask it?
  verdict: "honest"|"evasive"|"overpromised"|"lied"|"not_raised",
  severity: 0|1|2|3,                     // 0 none … 3 clear false assurance / liability
  evidenceQuote: string,                 // counsellor's exact words (or "")
  explanation: string                    // 1-2 lines, grounded in groundTruth
}
```
Attach as `report.integrityCheck`. If no probe assigned (old sessions) → leave undefined.

**Persist (one migration)** — `supabase/migrations/0007_integrity_check.sql`:
- `alter table public.reports add column if not exists integrity_check jsonb;`
- `create or replace function public.commit_report(...)` — add
  `integrity_check = coalesce(p_patch -> 'integrity_check', r.integrity_check)` to the SET list (keep
  signature; re-grant unchanged). 
- (optional) seed `app_config` `integrityProbes` with the 14 defaults via `insert … on conflict do nothing`.

**Map it through the commit path**:
- `supabase/functions/report-worker/index.ts` `buildCommitPatch` (~69-114): add
  `if (report.integrityCheck) patch.integrity_check = report.integrityCheck;`
- `supabase/functions/_shared/store.js` (and `server/store.js`) report mapper: `reportFromRow` →
  `integrityCheck: row.integrity_check ?? null`; `reportToRow` → `if (obj.integrityCheck !== undefined)
  r.integrity_check = obj.integrityCheck;`

### D. Admin-only exposure (strip for non-admins) + report UI card

**Edge (the real boundary)** — `supabase/functions/api/index.ts`:
- `GET /reports/:id` (1061-1069): after `assertOwnerOrAdmin`, `if (ctx.role !== "admin" && ctx.role !==
  "superadmin") delete report.integrityCheck;`
- `GET /reports` (1043-1059): map over the non-admin branch and delete `integrityCheck` from each.
- `GET /sessions/:id` (888): strip `session.integrityProbe` for non-admins (the snapshot carries
  `groundTruth`; the owning counsellor must not see the trap or its answer). The `/sessions/:id/prompt`
  route is already admin-only at the UI layer — keep `groundTruth` out of the composed prompt anyway (B).
- Mirror the same stripping in `server/index.js` (strip when the requester resolves to a non-admin
  counsellor; keep back-compat-allow for header-less smoke calls, consistent with existing guards).

**Client report card** — `client/src/pages/shared/ReportDetail.jsx` (shared admin+counsellor view).
- Line 196 `isAdmin = user?.role === "admin"` → broaden to
  `["admin","superadmin"].includes(user?.role)` so superadmins viewing `/admin/reports/:id` see it.
- Render an **admin-only** card (guard `{isAdmin && report.integrityCheck && (…)}`) near the existing
  admin "View prompts" affordance: show the probe question, a `<Badge>` colored by verdict
  (`lied`/`overpromised` → `danger`, `evasive` → `warn`, `honest` → `success`, `not_raised`/absent →
  `slate`), the `evidenceQuote`, and `explanation`. Reuse `ui/Badge.jsx` + `ui/Card.jsx`. Counsellors
  never receive the field (stripped at edge) and never render the card.

### E. Legacy `server/` parity
Because `_shared/lib/*` duplicate `server/*`, the prompt/realtime/report edits are made in both copies.
Additionally mirror in `server/`: `integrityProbes.js`, `store.js` (SNAPSHOT_KEYS + report mapper),
`index.js` (assign at start; `/integrity-probes` GET/PUT; strip `integrityCheck`/`integrityProbe` for
non-admins; include `report.integrityCheck` when persisting the generated report). Live deployment is
Supabase; parity keeps `node scripts/check-edge-bindings.mjs` + `smoke-api.mjs` honest.

### F. Docs
Update `CONTRACT.md` (Session shape += `integrityProbe`; Report shape += `integrityCheck`; new
`/integrity-probes` GET/PUT admin-only; note `integrity_check` is stripped for non-admins) and
`CLAUDE.md` (one line under server + supabase architecture; mention `0007` migration and the app_config
`integrityProbes` key).

---

## Files touched (summary)

- **Migration**: `supabase/migrations/0007_integrity_check.sql` (new column + `commit_report` redefine + optional seed)
- **Shared engine (×2 copies)**: `…/_shared/lib/integrityProbes.js` (new) + `server/integrityProbes.js`;
  `prompt.js`, `realtime.js`, `report.js` in both `supabase/functions/_shared/lib/` and `server/`
- **Store (×2)**: `supabase/functions/_shared/store.js`, `server/store.js` (SNAPSHOT_KEYS + report mapper)
- **API (×2)**: `supabase/functions/api/index.ts`, `server/index.js` (assign probe, `/integrity-probes`,
  strip for non-admins)
- **Worker**: `supabase/functions/report-worker/index.ts` (`buildCommitPatch`)
- **Client**: `lib/api.js`, `pages/admin/IntegrityProbes.jsx` (new), `main.jsx`, `layouts/AdminLayout.jsx`,
  `pages/shared/ReportDetail.jsx`
- **Docs**: `CONTRACT.md`, `CLAUDE.md`

---

## Verification

1. **Migration / static**: `node scripts/check-edge-bindings.mjs` (no missing imports);
   apply `0007` to a local/branch DB; confirm `reports.integrity_check` exists and `commit_report`
   accepts the new key.
2. **Unit**: add `server/tests/integrityProbes.test.mjs` — `pickProbe` is deterministic per session id
   and only selects `active` probes; `loadProbes` fail-soft merges defaults; `buildIntegrityProbeSection`
   omits `groundTruth` and is empty when no probe. Run `node --test server/tests/*.mjs`.
3. **Prompt injection**: start a text session, `GET /sessions/:id/prompt` (admin) → student prompt
   contains the "ask once, naturally" line and the probe question, and **never** the groundTruth.
4. **End-to-end (Supabase live)**: `node scripts/smoke-edge.mjs` — run a session where the counsellor
   makes a clearly false promise (e.g. "yes, guaranteed 20 LPA job"), end it, let the report-worker
   finish, then `GET /reports/:id` as **admin** → `integrityCheck.verdict` ∈ {lied,overpromised} with an
   `evidenceQuote`; `GET /reports/:id` as the **counsellor** owner → `integrityCheck` absent.
5. **Admin gating UI**: as admin, open `/admin/reports/:id` → integrity card renders; open
   `/admin/integrity-probes` → list loads, add/edit/save persists (re-GET shows changes). As counsellor,
   open `/app/reports/:id` → no integrity card; confirm `/integrity-probes` and the field are not
   reachable (403 / stripped).
6. **Back-compat**: an old session/report with no `integrityProbe`/`integrity_check` loads cleanly (card
   hidden, no errors).
