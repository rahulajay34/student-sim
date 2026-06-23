-- 0012_usage_events.sql
--
-- "Usage" — per-call API cost tracking. One row per LLM / voice / transcription
-- call, written by the edge functions (service role) with the USD cost already
-- computed from the rate cards in _shared/lib/usagePricing.js. The Usage admin
-- page aggregates these; INR is applied live at read time from the cached FX rate.
--
-- RLS: enabled with NO policies — only the service_role (which bypasses RLS) can
-- read/write. The api function authenticates the caller, enforces admin/superadmin
-- in app code, then queries via the service-role client + the RPCs below. This is
-- deny-by-default for every non-service principal.

create table if not exists public.usage_events (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  session_id          uuid references public.sessions (id) on delete set null,
  owner_id            uuid references public.profiles (id) on delete set null,  -- counsellor
  provider            text not null,            -- 'anthropic' | 'openai'
  model               text not null,            -- e.g. claude-sonnet-4-6, gpt-realtime
  feature             text,                     -- report | student_reply | scoring | cue | voice | transcription
  mode                text,                     -- fast | reasoning | null
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_write_tokens  integer not null default 0,
  cache_read_tokens   integer not null default 0,
  audio_input_tokens  integer not null default 0,
  audio_output_tokens integer not null default 0,
  usd_cost            numeric(14,6) not null default 0,
  meta                jsonb not null default '{}'::jsonb  -- { personaLabel? }
);

create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_session_id_idx on public.usage_events (session_id);
create index if not exists usage_events_owner_id_idx on public.usage_events (owner_id);
create index if not exists usage_events_model_idx on public.usage_events (model);

alter table public.usage_events enable row level security;
-- No policies → only service_role (bypasses RLS) can access. Intentional.

-- ---------------------------------------------------------------------------
-- usage_overview — KPI + chart aggregates for a date range (and optional model).
-- p_from / p_to are timestamptz bounds ([from, to)); null = unbounded. Returns a
-- single jsonb object the api function passes through (USD; INR applied at read).
-- ---------------------------------------------------------------------------
create or replace function public.usage_overview(
  p_from timestamptz,
  p_to   timestamptz,
  p_model text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select * from public.usage_events e
    where (p_from is null or e.created_at >= p_from)
      and (p_to   is null or e.created_at <  p_to)
      and (p_model is null or e.model = p_model)
  )
  select jsonb_build_object(
    'totalUsd',          coalesce((select sum(usd_cost) from f), 0),
    'totalCalls',        (select count(*) from f),
    'totalSessions',     (select count(distinct session_id) from f where session_id is not null),
    'totalInputTokens',  coalesce((select sum(input_tokens) from f), 0),
    'totalOutputTokens', coalesce((select sum(output_tokens) from f), 0),
    'totalAudioTokens',  coalesce((select sum(audio_input_tokens + audio_output_tokens) from f), 0),
    'byModel', coalesce((select jsonb_agg(x) from (
        select model as key, sum(usd_cost) as usd, count(*) as calls
        from f group by model order by sum(usd_cost) desc) x), '[]'::jsonb),
    'byProvider', coalesce((select jsonb_agg(x) from (
        select provider as key, sum(usd_cost) as usd, count(*) as calls
        from f group by provider order by sum(usd_cost) desc) x), '[]'::jsonb),
    'byFeature', coalesce((select jsonb_agg(x) from (
        select coalesce(feature, 'other') as key, sum(usd_cost) as usd, count(*) as calls
        from f group by coalesce(feature, 'other') order by sum(usd_cost) desc) x), '[]'::jsonb),
    'byDay', coalesce((select jsonb_agg(x order by x.key) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as key,
               sum(usd_cost) as usd, count(*) as calls
        from f group by date_trunc('day', created_at)) x), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- usage_sessions — one row per session for the main table (recent first), paged.
-- Returns { total, rows:[ {sessionId, ownerId, calls, tokens, usd, lastAt,
-- personaLabel} ] }. Counsellor names are resolved by the api function.
-- ---------------------------------------------------------------------------
create or replace function public.usage_sessions(
  p_from   timestamptz,
  p_to     timestamptz,
  p_model  text,
  p_limit  integer,
  p_offset integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select * from public.usage_events e
    where (p_from is null or e.created_at >= p_from)
      and (p_to   is null or e.created_at <  p_to)
      and (p_model is null or e.model = p_model)
  ),
  g as (
    select session_id,
           (array_agg(owner_id) filter (where owner_id is not null))[1] as owner_id,
           count(*) as calls,
           sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens
               + audio_input_tokens + audio_output_tokens) as tokens,
           sum(usd_cost) as usd,
           max(created_at) as last_at,
           max(meta ->> 'personaLabel') as persona_label
    from f group by session_id
  )
  select jsonb_build_object(
    'total', (select count(*) from g),
    'rows', coalesce((select jsonb_agg(r) from (
        select session_id as "sessionId",
               owner_id as "ownerId",
               calls,
               tokens,
               usd,
               last_at as "lastAt",
               persona_label as "personaLabel"
        from g
        order by last_at desc nulls last
        limit coalesce(p_limit, 25) offset coalesce(p_offset, 0)
      ) r), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- usage_session_detail — per-call breakdown for one session (the table drilldown).
-- ---------------------------------------------------------------------------
create or replace function public.usage_session_detail(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_agg(r order by r."createdAt") from (
      select id,
             created_at as "createdAt",
             provider, model, feature, mode,
             input_tokens as "inputTokens",
             output_tokens as "outputTokens",
             cache_read_tokens as "cacheReadTokens",
             cache_write_tokens as "cacheWriteTokens",
             audio_input_tokens as "audioInputTokens",
             audio_output_tokens as "audioOutputTokens",
             usd_cost as "usd"
      from public.usage_events
      where session_id = p_session
    ) r), '[]'::jsonb);
$$;

-- Execute grants: service_role only (the edge functions). SECURITY DEFINER runs
-- as the owner; restrict who may call.
revoke all on function public.usage_overview(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.usage_sessions(timestamptz, timestamptz, text, integer, integer) from public, anon, authenticated;
revoke all on function public.usage_session_detail(uuid) from public, anon, authenticated;
grant execute on function public.usage_overview(timestamptz, timestamptz, text) to service_role;
grant execute on function public.usage_sessions(timestamptz, timestamptz, text, integer, integer) to service_role;
grant execute on function public.usage_session_detail(uuid) to service_role;
