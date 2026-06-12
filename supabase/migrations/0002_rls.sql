-- 0002_rls.sql — Row Level Security: enable on every table, default-deny, then
-- add only the SELECT policies the `authenticated` role needs.
--
-- Threat model / design:
--   * All WRITES go through Edge Functions using the service_role key, which
--     BYPASSES RLS entirely — so there are intentionally NO insert/update/delete
--     policies for `authenticated` anywhere. RLS here is defense-in-depth for the
--     read path (and a hard stop if a client ever queries Postgres directly).
--   * Enabling RLS with no matching policy = default-deny. We add SELECT policies
--     only where authenticated users legitimately read.
--   * profiles SELECT must let a user see their own row AND let admins see all.
--     A policy that itself selects from profiles to check role would recurse
--     (the inner select re-triggers the same policy). We break the cycle with a
--     SECURITY DEFINER helper public.is_admin(), which runs as owner and is
--     therefore not subject to RLS.

-- ---------------------------------------------------------------------------
-- Admin check helper (SECURITY DEFINER → bypasses RLS, no recursion).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on ALL tables (default-deny once enabled).
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.personas             enable row level security;
alter table public.courses              enable row level security;
alter table public.rubric_templates     enable row level security;
alter table public.lead_profiles        enable row level security;
alter table public.assignment_templates enable row level security;
alter table public.assignments          enable row level security;
alter table public.sessions             enable row level security;
alter table public.reports              enable row level security;
alter table public.app_config           enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: own row, or any row if admin.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Library tables: readable by any authenticated user.
-- ---------------------------------------------------------------------------
drop policy if exists personas_select_all on public.personas;
create policy personas_select_all
  on public.personas for select to authenticated using (true);

drop policy if exists courses_select_all on public.courses;
create policy courses_select_all
  on public.courses for select to authenticated using (true);

drop policy if exists rubric_templates_select_all on public.rubric_templates;
create policy rubric_templates_select_all
  on public.rubric_templates for select to authenticated using (true);

drop policy if exists lead_profiles_select_all on public.lead_profiles;
create policy lead_profiles_select_all
  on public.lead_profiles for select to authenticated using (true);

drop policy if exists assignment_templates_select_all on public.assignment_templates;
create policy assignment_templates_select_all
  on public.assignment_templates for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Owned resources: counsellor sees own, admin sees all.
-- ---------------------------------------------------------------------------
drop policy if exists assignments_select_own_or_admin on public.assignments;
create policy assignments_select_own_or_admin
  on public.assignments
  for select
  to authenticated
  using (counsellor_id = auth.uid() or public.is_admin());

drop policy if exists sessions_select_own_or_admin on public.sessions;
create policy sessions_select_own_or_admin
  on public.sessions
  for select
  to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists reports_select_own_or_admin on public.reports;
create policy reports_select_own_or_admin
  on public.reports
  for select
  to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- app_config: NO authenticated policies — service_role only (bypasses RLS).
-- RLS is enabled above, so with zero policies authenticated reads are denied.
-- ---------------------------------------------------------------------------
