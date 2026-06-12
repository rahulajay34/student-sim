-- 0004_rpcs.sql — concurrency RPCs (lease claim + compare-and-set commit).
--
-- Why RPCs instead of advisory locks: Edge Functions connect through the
-- transaction-mode pooler, where session-scoped advisory locks are unsafe (a
-- connection can be handed to another client between statements). Instead a row
-- carries a short-lived lease (token + expiry); a worker claims it atomically,
-- does its LLM work OUTSIDE any transaction, then commits with the token as a
-- compare-and-set guard. A stale/expired lease can be re-claimed by anyone.
--
-- All RPCs: plpgsql, SECURITY DEFINER, `set search_path = ''`, execute revoked
-- from public/anon/authenticated (service_role only — these are the functions'
-- privileged write path; clients never call them directly).

-- ===========================================================================
-- claim_session_turn — acquire the per-session turn lease.
--   Returns a fresh token if the lease was free or expired, else NULL.
-- ===========================================================================
create or replace function public.claim_session_turn(
  p_session uuid,
  p_ttl     interval default interval '90 seconds'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.sessions
     set turn_lease_token = v_token,
         turn_lease_until  = now() + p_ttl
   where id = p_session
     and (turn_lease_until is null or turn_lease_until < now());

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

-- ===========================================================================
-- commit_session_turn — write the turn result under the held lease, in one tx.
--
--   CAS: succeeds only if turn_lease_token still equals p_token (i.e. the lease
--   has not expired-and-been-reclaimed by another worker). On success the lease
--   is cleared. Returns true if a row was updated, false otherwise.
--
--   Patch contract (p_patch is a jsonb object; only the keys PRESENT are written,
--   via `coalesce(p_patch -> 'key', current)` per known column — an absent key
--   leaves the column untouched):
--     current_phase        smallint
--     satisfaction_score   smallint
--     last_turn_verbosity  text
--     status               session_status   ('active' | 'ended')
--     ended_at             text (ISO 8601)  -> cast to timestamptz
--     milestones           jsonb  (REPLACES the whole column value)
--     objection_state      jsonb  (REPLACES the whole column value)
--     score_history        jsonb  (REPLACES the whole column value)
--     transcript           jsonb  (REPLACES the whole column value)
--     snapshots            jsonb  (REPLACES the whole column value)
--   NOTE: jsonb columns are whole-object writes (matches the JSON store's
--   read-modify-write-whole-document semantics); the patch does not deep-merge.
-- ===========================================================================
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
         -- text column: only overwrite when the key is present (allows setting null
         -- explicitly via a JSON null, while an absent key keeps the old value).
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

-- ===========================================================================
-- claim_report — acquire the report-worker lease (longer TTL; LLM fan-out).
--   Eligible when status in ('generating','fallback') and lease free/expired.
--   Forces status back to 'generating' on claim. Returns token or NULL.
-- ===========================================================================
create or replace function public.claim_report(
  p_report uuid,
  p_ttl    interval default interval '8 minutes'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.reports
     set worker_lease_token = v_token,
         worker_lease_until  = now() + p_ttl,
         status              = 'generating'
   where id = p_report
     and status in ('generating', 'fallback')
     and (worker_lease_until is null or worker_lease_until < now());

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

-- ===========================================================================
-- commit_report — write report sections under the held lease (CAS on token).
--
--   Patch contract (only keys present are written; jsonb columns REPLACE wholesale):
--     status           report_status ('generating'|'ready'|'fallback')
--     partial          boolean
--     overall_percent  numeric
--     overall_band     text
--     overall_outcome  text
--     final_score      smallint
--     generated_at     text (ISO 8601) -> timestamptz
--     overall          jsonb
--     rubric           jsonb
--     phase_breakdown  jsonb
--     strengths        jsonb
--     improvements     jsonb
--     key_moments      jsonb
--     drills           jsonb
--     benchmarks       jsonb
--     score_arc        jsonb
--   Clears the worker lease on success. Returns true if a row was updated.
-- ===========================================================================
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
         -- release the lease
         worker_lease_token = null,
         worker_lease_until = null
   where r.id = p_report
     and r.worker_lease_token = p_token;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down execution: service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function public.claim_session_turn(uuid, interval)   from public, anon, authenticated;
revoke execute on function public.commit_session_turn(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_report(uuid, interval)          from public, anon, authenticated;
revoke execute on function public.commit_report(uuid, uuid, jsonb)      from public, anon, authenticated;

grant execute on function public.claim_session_turn(uuid, interval)    to service_role;
grant execute on function public.commit_session_turn(uuid, uuid, jsonb) to service_role;
grant execute on function public.claim_report(uuid, interval)          to service_role;
grant execute on function public.commit_report(uuid, uuid, jsonb)      to service_role;
