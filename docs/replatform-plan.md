# Replatform & Quality Program — June 2026

Owner-approved plan (2026-06-12). Decisions confirmed with the owner via Q&A:
**(1)** Backend goes fully to **Supabase Edge Functions** (Deno) + Supabase Postgres + Supabase Auth; React SPA hosts on Vercel (assumption — flagged). **(2)** Claude Sonnet 4.6 replaces MiniMax, **tuned per call type** (high reasoning for reports/cues, fast mode for live turns). **(3)** Flat admin model — all admins see all counsellors (schema future-proofed for teams via nullable `team_id`). **(4)** Migrate **library data only** (personas, courses, rubric templates, lead profiles); sessions/reports/users start fresh.

## Workstreams

### WS1 — LLM swap: MiniMax → Claude Sonnet 4.6 (`@anthropic-ai/sdk`)
- New `server/llm.js` (platform-neutral; runs Node now, Deno later). `server/ollama.js` becomes a re-export shim so import paths don't churn.
- Exports keep parity: `chat`, `chatStream` (async generator of string tokens — SSE contract preserved), `extractJson`, `stripThink` (legacy shim), `MODEL = "claude-sonnet-4-6"`, timeout constants. Errors keep `.code = "LLM_TIMEOUT"` so all existing fail-soft paths work.
- Per-call tuning: **fast** (`thinking: disabled`, `effort: low`) for student replies, coherence gate, per-turn scoring/breakdown; **reasoning** (`thinking: adaptive`, `effort: high`) for report calls A/B/C and `llmCue` (cue timeout raised 20s → 30s).
- Structured outputs (`output_config.format` json_schema) for scoring, breakdown, cue, and report calls — replaces regex `extractJson` as the primary path (extractJson stays as fallback).
- `maxRetries: 0` on report calls (report.js already has its own 2-attempt loop); SDK default retries elsewhere.
- No A/B provider flag — hard cutover (git revert is the rollback).
- Follow-up (separate task): prompt-caching split of the student system prompt (`buildSystemPromptParts` → `cache_control` block, ~85% savings on the stable prefix; Sonnet 4.6 min cacheable prefix 2048 tokens).
- Env: `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) in root .env, later Supabase secrets. Fix stale `OLLAMA_API_KEY` startup log in index.js.

### WS2 — Conversation behavior (fee-loop + fillers) — root causes verified from session ses-d04df55df1cf
- **Loop**: fee matcher in `objections.js:25` misses neutral fee questions (turns detected `null`, EMI bucket hit timesRaised=7); `steeringSummary` (voice path) has NO loop-break instruction; `realtime.js:99` says "press the same point again"; rule at `realtime.js:195` only bans verbatim wording.
- Fixes: broaden `fee` regex (+ unit tests using the actual transcript phrasings); rewrite loop-break in `summarizeForPrompt` from "reword it" to "you've made your point — follow the counsellor's pivot"; add per-objection `timesRaised >= 2` loop-break lines to `steeringSummary`; soften pushiness-high branch to "press once more, then accept and move on"; replace rule 195 with topic-level pivot-following; soften `disposition.js:236` hold-out line.
- **Fillers**: `realtime.js:59-60` mandates ≥1 filler per reply (observed: 92% of turns, 1.21/turn). Change to ~1-in-3 turns; soften the pause-before-every-reply rule (`:56`); lower `style-exemplars.json` `dials.fillers` home base; trim `buildHowYouSound` framing. Keep Indian-English rhythm + Hindi-particle cadence intact.

### WS3 — Frontend error surfacing
- `ApiError` class in `lib/api.js` (status, isNetwork; message contract unchanged), `lib/asyncError.js` helpers, unified `ui/Toast.jsx` (ToastProvider/useToast/ToastStack, dark+light variants) replacing the two copy-pasted local toasts (Session.jsx, Prompts.jsx).
- Wire every silent gap: /observe failures → toast after 3 consecutive ("scoring paused — call audio still works"); ReportDetail poll → stuck-state banner with Retry after 3 failures; `useOpenAIRealtime` gets `onError`; mic-retry catch; AssignmentCreate partial-load warning; AdminDashboard Retry button.

### WS5 — Call-screen tidy (per owner spec)
Remove: phase pill (CallStage 799-809 + PHASE_LABELS), emotion pill (811-815 + EMOTION_META; Orb tint stays), entire cues surface (StageHintChip, CueCard, cue state/polling, `api.getSessionCue`, mct_cues toggle), VoicePicker, keyboard CtrlBtn, typed input in TranscriptTab ("chat to talk"). Sidebar default **closed** (`sidebarOpen` false; collapse handle opens it) and shows transcript when open. CoachPanel (delivery metrics + milestones) and FootStrip stay — only cues were banned (flagged for owner review). PhaseStepper in ReportDetail is a different component — stays.

### WS4 — Supabase platform (the big one; full design in plan agents' output, summarized)
- **Schema** (`supabase/migrations/0001-0005`): profiles (role enum default counsellor, team_id future-proof), personas/courses/rubric_templates/lead_profiles (string PKs preserved), assignment_templates, assignments (template_id provenance), sessions (`owner_id` any role + `is_practice` + origin enum; lease columns; unique partial index = DB-enforced duplicate-start guard), reports (hot columns promoted: overall_percent/band/status; unique per session; worker lease), app_config (replaces prompt-config/scoring-config files + holds superadmins list).
- **Auth**: service-role inside functions, RLS on everything as defense-in-depth; `BEFORE INSERT` trigger on auth.users enforces @masaischool.com for BOTH email and Google (plan-tier independent); `handle_new_user` trigger creates profile, default counsellor, auto-admin for app_config `superadmins` (seeded from SUPERADMIN_EMAIL). Admin role otherwise only editable in the Supabase table. Net-new security: `assertAdmin` on every mutation route (today they're wide open).
- **Functions** (Hono routers, shared code in `supabase/functions/_shared/`): `api` (CRUD/analytics/config/start/end), `session` (hot path: /message SSE + /observe + /cue + realtime-token), `report-worker` (invoked; claim RPC + CAS write), pg_cron sweeper re-kicks orphaned 'generating' reports. SSE heartbeat via in-stream interval.
- **Concurrency**: lease columns + claim/commit RPCs (`claim_session_turn`/`commit_session_turn`) — advisory locks unsafe through the transaction-mode pooler; LLM calls always outside transactions. 50-session math: ~1.7 req/s observe steady state, ~24 in-flight; bottleneck is LLM provider tier, not Supabase.
- **Client**: `@supabase/supabase-js` auth (password + Google), profiles fetch for role, `vercel.json` rewrite keeps `/api/*` relative paths (no CORS pain), Login/signup rewrite with domain hint + Google button.
- **Ops**: `scripts/import-library.mjs` (idempotent upserts), local dev = `supabase start` + `functions serve` + Vite proxy, smoke-api.mjs gets JWT auth + new 401/403 assertions.

### WS6 — Admin self-practice
ProtectedRoute accepts role arrays; session routes allow `["counsellor","admin"]`; `/admin/practice` reuses counsellor Practice.jsx; Session.jsx back-paths derived from role (6 hardcoded `/app/*` navigations fixed); sessions owned via `owner_id` + `is_practice` (analytics excludes practice from team KPIs).

### WS7 — Assignment templates + bulk assign
`assignment_templates` table + endpoints (`GET/POST/PUT/DELETE /assignment-templates`, `POST /assignment-templates/:id/assign {counsellorIds[]}`); admin Templates page (list + TemplateForm modal, copy-adapted from AssignmentCreate) + AssignModal with searchable counsellor checklist + select-all.

## Sequencing
1. **Wave 1 (now, no credentials):** WS2 + WS1 (code, mock-tested) + WS3/WS5 client work. Disjoint file domains.
2. **Wave 2:** Supabase scaffolding — migrations SQL, _shared module port, functions, import script (local files; `supabase start` if CLI available).
3. **Wave 3 (needs credentials):** live LLM smoke, Supabase project deploy, client auth, Google provider, Vercel deploy, smoke e2e.
4. **Wave 4:** WS6 + WS7 on the new stack, docs sync (CONTRACT.md/CLAUDE.md), final e2e + load sanity.

## Credentials needed from owners
1. `ANTHROPIC_API_KEY` (live testing of WS1; check tier headroom — est. ~300 req/min, ~176K effective tokens/min peak at 50 sessions w/ caching).
2. Supabase project (create one or authorize the Supabase connector) — need project ref + service role key + DB password.
3. Google OAuth **client secret** (client id already in .env) for the Supabase Google provider.
4. Vercel account/team for client hosting (or authorize Vercel connector).

## Risks (with fallbacks)
- SSE on Edge Functions → text mode ships JSON-first (contract-identical), SSE second; voice path doesn't use SSE at all.
- Report worker instance death → claim CAS + pg_cron sweeper; fallback EdgeRuntime.waitUntil + manual regenerate.
- Domain-restriction hook availability → DB trigger chosen precisely because it's plan-independent.
- Class-end report burst (50×3 LLM calls) → worker isolation now; pgmq queue if provider 429s.

## Verification
`node --test server/tests/*.mjs` · client `npm run lint` + `npm run build` · live voice session transcript recount (fillers ≤ ~1/3 turns; no fee re-raise after pivot) · smoke-api.mjs (rewritten) against deployed stack · 401/403 authz assertions · report generation e2e incl. sweeper recovery.
