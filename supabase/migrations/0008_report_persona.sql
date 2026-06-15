-- 0008_report_persona.sql
--
-- Two schema additions:
--
-- 1. sessions.pay_ask_count (smallint, default 0)
--    Persists the per-session counter of counsellor payment/commitment asks so
--    the scoring LLM can apply the first-ask exemption correctly across requests
--    on the edge path (where session state is loaded fresh from the DB each turn).
--    commit_session_turn is updated to accept a 'pay_ask_count' key in its patch.
--
-- 2. reports.persona_addressed (jsonb) + reports.persona_card (jsonb)
--    Nullable columns for the new report sections emitted by the report-worker
--    (Call D — personaAddressed — and the persona identity card).
--    commit_report is updated to accept 'persona_addressed' / 'persona_card'
--    keys in its patch.
--
-- Both migrations are idempotent (add column if not exists; create or replace
-- for RPCs). Existing rows default to 0 / NULL.

-- ---------------------------------------------------------------------------
-- 1. sessions.pay_ask_count
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists pay_ask_count smallint not null default 0;

-- ---------------------------------------------------------------------------
-- 2. reports.persona_addressed + reports.persona_card
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists persona_addressed jsonb;

alter table public.reports
  add column if not exists persona_card jsonb;

-- ---------------------------------------------------------------------------
-- 3. commit_session_turn — add pay_ask_count to the patch whitelist.
--    Full body copied from 0004_rpcs.sql with the single new coalesce line.
-- ---------------------------------------------------------------------------
create or replace function public.commit_session_turn(
  p_session uuid,
  p_token   uuid,
  p_patch   jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sessions s
     set current_phase = coalesce(
           (p_patch ->> 'current_phase')::smallint, s.current_phase),
         satisfaction_score = coalesce(
           (p_patch ->> 'satisfaction_score')::smallint, s.satisfaction_score),
         last_turn_verbosity = case
           when p_patch ? 'last_turn_verbosity'
             then nullif(p_patch ->> 'last_turn_verbosity', '')
           else s.last_turn_verbosity end,
         status = coalesce(
           (p_patch ->> 'status')::public.session_status, s.status),
         ended_at = case
           when p_patch ? 'ended_at'
             then (p_patch ->> 'ended_at')::timestamptz
           else s.ended_at end,
         pay_ask_count = coalesce(
           (p_patch ->> 'pay_ask_count')::smallint, s.pay_ask_count),
         milestones      = coalesce(p_patch -> 'milestones',      s.milestones),
         objection_state = coalesce(p_patch -> 'objection_state', s.objection_state),
         score_history   = coalesce(p_patch -> 'score_history',   s.score_history),
         transcript      = coalesce(p_patch -> 'transcript',      s.transcript),
         snapshots       = coalesce(p_patch -> 'snapshots',       s.snapshots),
         -- release the lease
         turn_lease_token = null,
         turn_lease_until = null
   where s.id = p_session
     and s.turn_lease_token = p_token;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. commit_report — add persona_addressed + persona_card to the patch whitelist.
--    Full body copied from 0004_rpcs.sql with the two new coalesce lines.
-- ---------------------------------------------------------------------------
create or replace function public.commit_report(
  p_report uuid,
  p_token  uuid,
  p_patch  jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reports r
     set status = coalesce(
           (p_patch ->> 'status')::public.report_status, r.status),
         partial = coalesce(
           (p_patch ->> 'partial')::boolean, r.partial),
         overall_percent = case
           when p_patch ? 'overall_percent'
             then (p_patch ->> 'overall_percent')::numeric
           else r.overall_percent end,
         overall_band = case
           when p_patch ? 'overall_band'
             then nullif(p_patch ->> 'overall_band', '')
           else r.overall_band end,
         overall_outcome = case
           when p_patch ? 'overall_outcome'
             then nullif(p_patch ->> 'overall_outcome', '')
           else r.overall_outcome end,
         final_score = case
           when p_patch ? 'final_score'
             then (p_patch ->> 'final_score')::smallint
           else r.final_score end,
         generated_at = coalesce(
           (p_patch ->> 'generated_at')::timestamptz, r.generated_at),
         overall         = coalesce(p_patch -> 'overall',         r.overall),
         rubric          = coalesce(p_patch -> 'rubric',          r.rubric),
         phase_breakdown = coalesce(p_patch -> 'phase_breakdown', r.phase_breakdown),
         strengths       = coalesce(p_patch -> 'strengths',       r.strengths),
         improvements    = coalesce(p_patch -> 'improvements',    r.improvements),
         key_moments     = coalesce(p_patch -> 'key_moments',     r.key_moments),
         drills          = coalesce(p_patch -> 'drills',          r.drills),
         benchmarks      = coalesce(p_patch -> 'benchmarks',      r.benchmarks),
         score_arc       = coalesce(p_patch -> 'score_arc',       r.score_arc),
         persona_addressed = coalesce(p_patch -> 'persona_addressed', r.persona_addressed),
         persona_card      = coalesce(p_patch -> 'persona_card',      r.persona_card),
         -- release the lease
         worker_lease_token = null,
         worker_lease_until = null
   where r.id = p_report
     and r.worker_lease_token = p_token;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: no changes needed — SECURITY DEFINER functions retain their
-- existing execute grants from 0004_rpcs.sql (service_role only). The
-- create or replace above preserves the SECURITY DEFINER + revoke/grant
-- combination (PG keeps grants on function replacement when the signature is
-- identical). No re-grant required.
-- ---------------------------------------------------------------------------
