-- 0011_transcript_latin.sql
--
-- Latin-script transcript — the report-worker's Call G transliterates any
-- transcript turns captured in a non-Latin script (Devanagari/Arabic/…) into the
-- Latin alphabet, storing the rendering as turn.latinText alongside the untouched
-- original turn.text. The enriched transcript is written back to the report row
-- so the generated report reads in one script (live in-call transcription is
-- unaffected). No new column is needed — reports.transcript (jsonb) already
-- exists (0001); this migration only adds 'transcript' to commit_report's patch
-- whitelist so the worker can overwrite it.
--
-- All migrations are idempotent (create or replace for the RPC).

-- ---------------------------------------------------------------------------
-- commit_report — add transcript to the patch whitelist.
--   ⚠ Full body copied from 0010_new_report.sql (the LATEST definition) with the
--   single new coalesce line. Signature + grants unchanged.
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
         transcript        = coalesce(p_patch -> 'transcript',        r.transcript),
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
