-- 0013_fluency_report.sql
--
-- Spoken English Fluency (Tier 1). The counsellor's whole-call audio is recorded
-- in the browser, uploaded to a private Storage bucket, re-transcribed verbatim
-- with Whisper (word timings + un-cleaned text), scored by an LLM judge, and the
-- result stored on reports.fluency. Audio is retained indefinitely (owner decision).
--
-- 1. reports.fluency (jsonb) — additive; written directly by the /sessions/:id/fluency
--    endpoint (NOT via commit_report), so report regenerations preserve it.
-- 2. Private "call-audio" storage bucket. The browser POSTs the recorded blob to
--    POST /sessions/:id/fluency; the edge function (service role) is the ONLY
--    reader/writer of this bucket — service role bypasses RLS, so the bucket needs
--    NO policies (deny-by-default for every non-service principal). The earlier
--    owner-upload policies are dropped (the client no longer writes directly; a
--    Storage RLS policy that subqueries another RLS-protected table does not
--    evaluate correctly inside the Storage service).
--
-- Idempotent (add column if not exists; bucket insert on conflict; drop policy if exists).

-- ---------------------------------------------------------------------------
-- 1. reports.fluency
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists fluency jsonb;

-- ---------------------------------------------------------------------------
-- 2. Storage bucket (private) + RLS
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do nothing;

-- Service-role-only bucket: no policies (only the edge function, which bypasses
-- RLS, reads/writes). Drop the earlier owner-upload policies if a prior version of
-- this migration created them.
drop policy if exists "call_audio_owner_insert" on storage.objects;
drop policy if exists "call_audio_owner_update" on storage.objects;
