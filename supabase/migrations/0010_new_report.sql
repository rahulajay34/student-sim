-- 0010_new_report.sql
--
-- "New Report Section" — an ADDITIVE 8-parameter strict re-scoring of the
-- counsellor (each 0-5 + a one-line per-parameter summary), with an overall
-- score scaled to 100 (sum of 8 scores / 40 * 100). Admin-only; stripped for
-- non-admins at the edge layer. Does NOT change any existing scoring/metric.
--
-- 1. reports.new_report (jsonb)
--    Nullable column for the additive new-report payload emitted by the
--    report-worker (Call F — the 8-parameter re-scoring). Shape:
--      { total: number, parameters: [ {key,label,score(0-5),summary} ] (8) }
--    commit_report is updated to accept a 'new_report' key in its patch.
--
-- All migrations are idempotent (add column if not exists; create or replace
-- for the RPC).

-- ---------------------------------------------------------------------------
-- 1. reports.new_report
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists new_report jsonb;

-- ---------------------------------------------------------------------------
-- 2. commit_report — add new_report to the patch whitelist.
--    ⚠ Full body copied from 0009_integrity_check.sql (the LATEST definition,
--    which already added persona_addressed + persona_card + integrity_check)
--    with the single new coalesce line. Signature + grants unchanged.
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
         integrity_check   = coalesce(p_patch -> 'integrity_check',   r.integrity_check),
         new_report        = coalesce(p_patch -> 'new_report',        r.new_report),
         -- release the lease
         worker_lease_token = null,
         worker_lease_until = null
   where r.id = p_report
     and r.worker_lease_token = p_token;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: no changes needed — SECURITY DEFINER function retains its
-- existing execute grants (service_role only). create or replace preserves the
-- grants when the signature is identical. No re-grant required.
-- ---------------------------------------------------------------------------
