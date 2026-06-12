# Supabase backend — Mock Counselling Trainer

The database layer for the replatform (see `docs/replatform-plan.md`, WS4). Postgres
schema + RLS + auth triggers + concurrency RPCs + a report-recovery cron job. Edge
Functions (`api`, `session`, `report-worker`) land under `supabase/functions/` in a
later workstream; this directory currently owns the migrations, `config.toml`, and
this README.

## Migrations

| File | Contents |
|---|---|
| `0001_init.sql` | enums, tables, indexes, foreign keys (incl. the two circular `assignments → sessions/reports` FKs added last) |
| `0002_rls.sql` | RLS enabled on every table (default-deny); SELECT-only policies for `authenticated`; `is_admin()` security-definer helper (avoids profiles-policy recursion) |
| `0003_auth.sql` | `enforce_signup_domain()` + `handle_new_user()` triggers on `auth.users`; `app_config('superadmins')` bootstrap row |
| `0004_rpcs.sql` | `claim_session_turn` / `commit_session_turn` / `claim_report` / `commit_report` — lease + compare-and-set, service_role only |
| `0005_jobs.sql` | `pg_cron` + `pg_net` + `supabase_vault`; `sweep_stale_reports()` re-kicks orphaned reports every 2 min |

All migrations are written to be idempotent (DO-guarded `CREATE TYPE`/constraints,
`create or replace function`, `if not exists` on tables/indexes/extensions) so
re-running or `db reset` is safe.

## Local dev

Requires the Supabase CLI and Docker.

```bash
# from repo root
supabase start                 # boots local Postgres + Auth + Studio (ports in config.toml)
supabase db reset              # drops + re-applies ALL migrations from scratch (fast feedback loop)
supabase db lint               # static lint of the migrations (no Docker DB needed for syntax checks)
supabase functions serve       # serve Edge Functions locally (once functions/ exists)
supabase stop                  # tear down
```

Studio: http://localhost:54323 · Inbucket (captured emails): http://localhost:54324
The Vite SPA proxies `/api/*`; `auth.site_url` / `additional_redirect_urls` in
`config.toml` point at `http://localhost:5173`.

Google OAuth is disabled locally by default (the hosted project holds the secret).
To exercise it locally, export `SUPABASE_AUTH_GOOGLE_CLIENT_ID` /
`SUPABASE_AUTH_GOOGLE_SECRET` and flip `[auth.external.google] enabled = true`.

> Note: `enforce_signup_domain()` blocks any signup whose email domain is not
> `masaischool.com` — including locally. Use a `*@masaischool.com` address when
> testing signup against the local stack.

## Deploy

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                       # apply migrations to the linked remote project
supabase functions deploy              # deploy all functions (once functions/ exists)
# or: supabase functions deploy report-worker
```

## Post-deploy setup the sweeper needs

`sweep_stale_reports()` (0005) calls the `report-worker` Edge Function over HTTP and
needs two things. Until both are set the job **no-ops with a NOTICE** (it never errors).

1. **Edge base URL** (non-secret) → `app_config` key `edge_base_url`, e.g. your
   project's API origin `https://<project-ref>.supabase.co`. The function appends
   `/functions/v1/report-worker`.

   ```sql
   insert into public.app_config (key, value)
   values ('edge_base_url', '"https://<project-ref>.supabase.co"'::jsonb)
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

2. **Service-role key** (secret) → Supabase **Vault**, secret name `service_role_key`.
   The key is **never** stored in `app_config` (which is plain app data); the sweeper
   reads it from `vault.decrypted_secrets` at call time.

   ```sql
   -- run once; get the key from Project Settings → API → service_role
   select vault.create_secret('<service-role-key>', 'service_role_key');
   -- to rotate later:
   -- select vault.update_secret(
   --   (select id from vault.secrets where name = 'service_role_key'),
   --   '<new-service-role-key>');
   ```

Both can be run from Studio's SQL editor or via `psql` against the project DB.
After setting them, the every-2-minute cron job will recover any report stuck in
`status='generating'` (lease expired/absent and older than the 3-minute grace).

## Seeding (later workstream)

Library data (personas, courses, rubric templates, lead profiles) and the
`app_config` rows (`superadmins`, prompt/scoring config that replaces the old
`server/data/*-config.json` files) are loaded by **`scripts/import-library.mjs`**
(idempotent upserts via the service-role key) — not yet in the repo. The
`superadmins` bootstrap row is also seeded directly by `0003_auth.sql` so the very
first signup can be auto-promoted to `admin` before the import script runs; the
import script may overwrite/extend it.

## Roles

Three-tier model: `counsellor` < `admin` < `superadmin`.

| Role | Capabilities |
|---|---|
| `counsellor` | Owns sessions/reports; can start practice or assigned sessions |
| `admin` | All counsellor capabilities + full CRUD on library (personas, courses, rubrics, assignments, templates) + analytics + config |
| `superadmin` | All admin capabilities + user-role management via the in-app `/superadmin` page |

**Bootstrap:** any email listed in `app_config.superadmins` (or `SUPERADMIN_EMAIL` env var for the import script) is automatically promoted to `superadmin` on first signup. The seed row in `0003_auth.sql` pre-lists `rahul.singh@masaischool.com` and `rahul.bhat@masaischool.com`.

**In-app role management:** superadmins can view all users and change any user's role via `GET /api/users` → `PUT /api/users/:id/role`. The client page at `/superadmin` (`client/src/pages/superadmin/UserManagement.jsx`) calls `api.getUsers()` and `api.updateUserRole(id, role)` for this.

**Manual override:** edit `profiles.role` directly in the Supabase table editor (Studio → Table Editor → profiles).

**Admin role assignment:** a user becomes `superadmin` automatically on first signup only
if their (lowercased) email is in `app_config.superadmins`. Otherwise everyone
defaults to `counsellor`; promote others via the UserManagement UI or the table editor.

## Concurrency model (why RPCs, not advisory locks)

Edge Functions connect through the transaction-mode pooler, where session-scoped
advisory locks are unsafe. Instead each `sessions`/`reports` row carries a
short-lived lease (`*_lease_token` + `*_lease_until`). A worker calls `claim_*` to
grab the lease atomically, runs its LLM work **outside any transaction**, then calls
`commit_*` which writes only if the token still matches (compare-and-set) and clears
the lease. Expired leases are freely re-claimable — that, plus the cron sweeper, is
how orphaned work recovers. All four RPCs are `service_role`-only.

---

## Deploy: client + rewrites

The React SPA lives in `client/` and is deployed to **Vercel**. `vercel.json` at the
repo root wires it up with static-build config and rewrites that forward all `/api/*`
traffic to the Supabase Edge Functions, so the client keeps its existing relative
`/api/*` paths with no CORS pain.

### One-time setup

1. **Replace the placeholder project ref** in `vercel.json`.  
   Every occurrence of `PROJECT_REF` must be changed to your real Supabase project
   reference (visible in the Supabase dashboard URL: `https://supabase.com/dashboard/project/<project-ref>`).

   ```bash
   # Quick global replace (run from repo root)
   sed -i '' 's/PROJECT_REF/<your-project-ref>/g' vercel.json
   ```

2. **Link and deploy** (requires the Vercel CLI — `npm i -g vercel`):

   ```bash
   # First deploy — creates the Vercel project and prompts for team/scope
   vercel --cwd .          # uses vercel.json at repo root

   # Subsequent deploys
   vercel --cwd . --prod
   ```

   The Vercel project will build `client/` (runs `npm install` + `npm run build`
   there) and output from `client/dist`.

3. **Set the `ALLOWED_ORIGINS` secret** in your Supabase project after the first
   deploy, so Edge Functions accept requests from the Vercel domain:

   ```bash
   # Replace <vercel-domain> with the URL shown after `vercel --prod` (e.g. my-app.vercel.app)
   supabase secrets set ALLOWED_ORIGINS=https://<vercel-domain>
   ```

   If you have a custom domain, include it too (comma-separated):
   ```bash
   supabase secrets set ALLOWED_ORIGINS=https://<vercel-domain>,https://<custom-domain>
   ```

4. **Run the library import** (idempotent; safe to re-run):

   ```bash
   node scripts/import-library.mjs --env-file .env
   # Dry-run first to check counts:
   node scripts/import-library.mjs --env-file .env --dry
   ```

   Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.  
   Optionally set `SUPERADMIN_EMAIL` (comma-separated) to seed the `superadmins`
   app_config row — this controls which emails get auto-promoted to `admin` on first
   signup.

### Rewrite order (vercel.json)

| Priority | Pattern | Destination |
|---|---|---|
| 1 | `/api/sessions/:id/message` | `…/functions/v1/session/…` (hot path SSE) |
| 2 | `/api/sessions/:id/observe` | `…/functions/v1/session/…` (voice turn) |
| 3 | `/api/sessions/:id/cue` | `…/functions/v1/session/…` (cue polling) |
| 4 | `/api/sessions/:id/realtime/openai-token` | `…/functions/v1/session/…` (token mint) |
| 5 | `/api/(.*)` | `…/functions/v1/api/api/$1` (all other CRUD) |
| 6 | `/(.*)` | `/index.html` (SPA fallback) |

The session hot-path routes (1–4) are forwarded to the `session` Edge Function;
everything else under `/api/` goes to the `api` function. Both functions strip the
path prefix robustly in their routers. The SPA fallback (6) must be last.
