-- 0001_init.sql — enums, tables, indexes, foreign keys.
-- Mock Counselling Trainer schema (replaces the JSON file store).
-- Target: PostgreSQL 15 (Supabase). Idempotent where cheap.
--
-- Ordering within this file:
--   1. enums
--   2. tables in FK-dependency order (profiles → library → templates → assignments
--      → sessions → reports), with the two circular FKs
--      (assignments.session_id → sessions, assignments.report_id → reports)
--      added at the end via ALTER once both targets exist.
--   3. indexes (most are created inline; unique/partial ones grouped per table).

-- ---------------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------------
-- DO-guarded so re-running the file does not error (CREATE TYPE has no IF NOT EXISTS).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('counsellor', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'session_status') then
    create type public.session_status as enum ('active', 'ended');
  end if;
  if not exists (select 1 from pg_type where typname = 'session_origin') then
    create type public.session_origin as enum ('assigned', 'practice');
  end if;
  if not exists (select 1 from pg_type where typname = 'session_mode_t') then
    create type public.session_mode_t as enum ('voice', 'text');
  end if;
  if not exists (select 1 from pg_type where typname = 'assignment_status') then
    create type public.assignment_status as enum ('assigned', 'in_progress', 'completed');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_status') then
    create type public.report_status as enum ('generating', 'ready', 'fallback');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------------

-- profiles — 1:1 with auth.users; populated by handle_new_user() (see 0003).
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  name         text not null default '',
  role         public.user_role not null default 'counsellor',
  avatar_color text not null default '#4F46E5',
  team_id      uuid,                       -- future-proof for teams; flat admin model for now
  created_at   timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role);

-- personas — library, string PK preserved from the JSON store ("persona-…").
create table if not exists public.personas (
  id               text primary key,
  name             text not null,
  category         text not null,
  label            text,
  core_anxiety     text,
  behaviour_prompt text,
  description      text,
  personality      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- courses — library, string PK preserved ("course-<8hex>").
create table if not exists public.courses (
  id          text primary key,
  slug        text,
  name        text not null,
  category    text,
  institute   text,
  partner     text,
  duration    text,
  format      text,
  fee_total   numeric,
  fee_booking numeric,
  fee_note    text,
  emi_note    text,
  active      boolean not null default true,
  data        jsonb not null default '{}'::jsonb,   -- curriculum/outcomes/eligibility/usps/etc.
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists courses_active_idx on public.courses (active);

-- rubric_templates — library, string PK preserved ("rt-…").
create table if not exists public.rubric_templates (
  id          text primary key,
  name        text not null,
  description text,
  criteria    jsonb not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- At most one default rubric template.
create unique index if not exists one_default_rubric
  on public.rubric_templates (is_default)
  where is_default;

-- lead_profiles — library, string PK preserved ("lead-001").
create table if not exists public.lead_profiles (
  id         text primary key,
  category   text not null,
  name       text,
  gender     text,
  age        integer,
  occupation text,
  education  text,
  city       text,
  label      text,
  data       jsonb not null default '{}'::jsonb     -- full description + any extra fields
);
create index if not exists lead_profiles_category_idx on public.lead_profiles (category);

-- assignment_templates — reusable assignment blueprints (WS7 bulk-assign source).
create table if not exists public.assignment_templates (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  persona_id             text references public.personas (id) on delete set null,
  course_id              text references public.courses (id) on delete set null,
  rubric_template_id     text references public.rubric_templates (id) on delete set null,
  profile_id             text references public.lead_profiles (id) on delete set null,
  scenario               jsonb not null default '{}'::jsonb,
  persona_prompt_override text,
  reveal_persona         boolean not null default true,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now()
);

-- assignments — a mock assigned to a counsellor.
-- session_id / report_id FKs are added at the bottom (circular dependency).
create table if not exists public.assignments (
  id                     uuid primary key default gen_random_uuid(),
  counsellor_id          uuid not null references public.profiles (id) on delete cascade,
  persona_id             text references public.personas (id) on delete restrict,
  course_id              text not null references public.courses (id) on delete restrict,
  rubric_template_id     text references public.rubric_templates (id) on delete restrict,
  profile_id             text references public.lead_profiles (id) on delete set null,
  template_id            uuid references public.assignment_templates (id) on delete set null,
  scenario               jsonb not null default '{}'::jsonb,
  persona_prompt_override text,
  reveal_persona         boolean not null default true,
  status                 public.assignment_status not null default 'assigned',
  session_id             uuid,             -- FK added after sessions exists
  report_id              uuid,             -- FK added after reports exists
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now()
);
create index if not exists assignments_counsellor_id_idx on public.assignments (counsellor_id);
create index if not exists assignments_status_idx on public.assignments (status);
create index if not exists assignments_persona_id_idx on public.assignments (persona_id);
create index if not exists assignments_rubric_template_id_idx on public.assignments (rubric_template_id);

-- sessions — a live or completed mock run. owner_id is any role (admin self-practice).
create table if not exists public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid references public.assignments (id) on delete set null,
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  is_practice         boolean not null default false,
  origin              public.session_origin not null,
  session_mode        public.session_mode_t not null,
  voice_engine        text not null,
  status              public.session_status not null default 'active',
  current_phase       smallint not null default 1,
  satisfaction_score  smallint not null default 50,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  last_turn_verbosity text,
  thinking_mode       text not null default 'off',
  -- per-turn lease (claim/commit RPCs); transaction-pooler-safe alternative to advisory locks
  turn_lease_until    timestamptz,
  turn_lease_token    uuid,
  -- snapshotted-at-start payloads + server-owned mutable state (whole-object writes)
  snapshots           jsonb not null default '{}'::jsonb,   -- persona/scenario/course/rubric/voice/leadCard/prompt
  milestones          jsonb not null default '{}'::jsonb,
  objection_state     jsonb not null default '[]'::jsonb,
  score_history       jsonb not null default '[]'::jsonb,
  transcript          jsonb not null default '[]'::jsonb
);
create index if not exists sessions_owner_id_idx on public.sessions (owner_id);
create index if not exists sessions_status_idx on public.sessions (status);
create index if not exists sessions_assignment_id_idx on public.sessions (assignment_id);
-- DB-enforced duplicate-start guard: at most one active session per assignment.
create unique index if not exists one_active_session_per_assignment
  on public.sessions (assignment_id)
  where status = 'active' and assignment_id is not null;

-- Circular FK #1: assignments.session_id → sessions.id (now that sessions exists).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assignments_session_id_fkey'
  ) then
    alter table public.assignments
      add constraint assignments_session_id_fkey
      foreign key (session_id) references public.sessions (id) on delete set null;
  end if;
end
$$;

-- reports — the coaching report. Hot columns promoted out of the jsonb for cheap filtering.
create table if not exists public.reports (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.sessions (id) on delete cascade,
  assignment_id      uuid references public.assignments (id) on delete set null,
  owner_id           uuid not null references public.profiles (id) on delete cascade,
  counsellor_name    text,
  persona_name       text,
  scenario_title     text,
  status             public.report_status not null default 'generating',
  partial            boolean not null default false,
  overall_percent    numeric,
  overall_band       text,
  overall_outcome    text,
  final_score        smallint,
  generated_at       timestamptz not null default now(),
  -- background-worker lease (claim_report / commit_report CAS)
  worker_lease_until timestamptz,
  worker_lease_token uuid,
  -- report sections (whole-object writes from the worker)
  overall            jsonb not null default '{}'::jsonb,
  rubric             jsonb not null default '[]'::jsonb,
  phase_breakdown    jsonb not null default '[]'::jsonb,
  strengths          jsonb not null default '[]'::jsonb,
  improvements       jsonb not null default '[]'::jsonb,
  key_moments        jsonb not null default '[]'::jsonb,
  drills             jsonb not null default '[]'::jsonb,
  benchmarks         jsonb not null default '{}'::jsonb,
  score_arc          jsonb not null default '[]'::jsonb,
  transcript         jsonb not null default '[]'::jsonb
);
-- One report per session.
create unique index if not exists one_report_per_session on public.reports (session_id);
create index if not exists reports_owner_id_idx on public.reports (owner_id);
create index if not exists reports_status_idx on public.reports (status);
-- Analytics scan only over scored reports.
create index if not exists reports_scored_idx
  on public.reports (generated_at)
  where overall_percent is not null;

-- Circular FK #2: assignments.report_id → reports.id (now that reports exists).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assignments_report_id_fkey'
  ) then
    alter table public.assignments
      add constraint assignments_report_id_fkey
      foreign key (report_id) references public.reports (id) on delete set null;
  end if;
end
$$;

-- app_config — key/value store replacing prompt-config/scoring-config files;
-- also holds the 'superadmins' list and sweeper config (edge_base_url).
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
