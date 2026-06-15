-- 0009_integrity_check.sql
--
-- Integrity-probe / misselling detection (admin-only).
--
-- 1. reports.integrity_check (jsonb)
--    Nullable column for the per-report misselling verdict emitted by the
--    report-worker (Call E — the integrity probe detector). Admin-only;
--    stripped for non-admins at the edge layer.
--    commit_report is updated to accept an 'integrity_check' key in its patch.
--
-- 2. Seed the probe library into app_config key 'integrityProbes' (the 14
--    DEFAULT_PROBES from integrityProbes.js). app_config has no `authenticated`
--    RLS policy → service-role/admin-only by construction.
--
-- All migrations are idempotent (add column if not exists; create or replace
-- for the RPC; insert … on conflict do nothing for the seed).

-- ---------------------------------------------------------------------------
-- 1. reports.integrity_check
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists integrity_check jsonb;

-- ---------------------------------------------------------------------------
-- 2. commit_report — add integrity_check to the patch whitelist.
--    ⚠ Full body copied from 0008_report_persona.sql (the LATEST definition,
--    which already added persona_addressed + persona_card) with the single new
--    coalesce line. Signature + grants unchanged.
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

-- ---------------------------------------------------------------------------
-- 3. Seed the probe library (14 DEFAULT_PROBES + empty guidelines).
--    Matches DEFAULT_PROBES in integrityProbes.js. on conflict do nothing so a
--    re-run / an admin-edited library is never clobbered.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value)
values (
  'integrityProbes',
  '{
    "guidelines": [],
    "probes": [
      {"id":"probe-job_guarantee","category":"job_guarantee","question":"Can you guarantee I''ll get a job — like a 20 LPA package — after I finish?","groundTruth":"Masai does NOT guarantee a job or any CTC. Programmes give placement assistance/opportunities (some Pay-After-Placement). Promising a guaranteed job or salary = lie.","active":true},
      {"id":"probe-placement_eligibility","category":"placement_eligibility","question":"Everyone in the batch gets placement support, no conditions?","groundTruth":"Placement assistance is conditional (e.g. IIT Patna ~70% attendance + ~7 CGPA). \"Everyone, unconditionally\" = lie.","active":true},
      {"id":"probe-refund","category":"refund","question":"If I don''t like it after a few classes, I get a full refund, right?","groundTruth":"Per T&Cs, withdrawal before OR after start = no refund. Promising refund/cooling-off/money-back = lie.","active":true},
      {"id":"probe-booking_refund","category":"booking_refund","question":"The ₹4,000 booking just blocks my seat and I get it back?","groundTruth":"Booking/registration amount is non-refundable (adjusted into fee, not returned). \"Fully refundable\" = lie.","active":true},
      {"id":"probe-content_access","category":"content_access","question":"Will I always have access to the content and recordings, forever?","groundTruth":"No lifetime/forever access is promised. Claiming permanent access = lie.","active":true},
      {"id":"probe-recordings_attendance","category":"recordings_attendance","question":"I work full-time — can I just watch recordings later and still get attendance?","groundTruth":"Live attendance required (~75–90%); recordings only with prior permission and \"won''t be as effective\"; they don''t substitute attendance. \"Watch anytime + get attendance\" = lie.","active":true},
      {"id":"probe-certificate_auto","category":"certificate_auto","question":"Once I pay and finish, the IIT/IIM certificate is guaranteed?","groundTruth":"Certificate needs min attendance + min marks (e.g. 75% + 35%, varies) and is forfeited on EMI default. \"Automatic/guaranteed\" = lie.","active":true},
      {"id":"probe-degree_vs_cert","category":"degree_vs_cert","question":"So this is basically an IIT/IIM degree?","groundTruth":"It is a certificate / certification programme, not a degree. Calling it a degree = lie.","active":true},
      {"id":"probe-alumni_access","category":"alumni_access","question":"Do I become an alumnus / get alumni access of the IIT/IIM?","groundTruth":"A short certificate programme does NOT confer IIT/IIM alumni status or alumni-network access. Promising it = lie.","active":true},
      {"id":"probe-campus_immersion","category":"campus_immersion","question":"The campus visit at the IIT is included free and guaranteed for everyone?","groundTruth":"Campus immersion is often optional and/or at extra cost (travel/stay), sometimes conditional. \"Free + guaranteed for all\" when untrue = lie.","active":true},
      {"id":"probe-emi_nocost","category":"emi_nocost","question":"The EMI is zero-interest / no-cost with no extra charges?","groundTruth":"NBFC / PAP financing carries interest; \"no-cost EMI\" is not assured. Guaranteeing 0%/no-cost = lie.","active":true},
      {"id":"probe-scholarship_urgency","category":"scholarship_urgency","question":"Is this scholarship only valid today — does the fee really go up tomorrow?","groundTruth":"Scholarships/schemes are at Masai''s sole discretion; fabricated \"today-only\" deadlines/price hikes are misselling. Inventing fake urgency = lie.","active":true},
      {"id":"probe-faculty","category":"faculty","question":"Are all classes taught directly by the IIT/IIM professors?","groundTruth":"Teaching is a mix (institute faculty for some modules + Masai instructors/industry mentors). \"All by IIT/IIM profs\" when untrue = lie.","active":true},
      {"id":"probe-mentorship","category":"mentorship","question":"Do I get unlimited personal 1:1 mentorship whenever I want?","groundTruth":"Mentorship is structured/limited, not unlimited on-demand. Overstating = lie.","active":true}
    ]
  }'::jsonb
)
on conflict (key) do nothing;
