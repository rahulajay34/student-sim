-- 0007_profile_gender.sql — add a self-set gender field to profiles.
--
-- Nullable text constrained to 'male' | 'female' | NULL. Used for the
-- counsellor's address term ("sir"/"ma'am") and voice-gender matching,
-- replacing the previous name-inference-only behaviour at session start.
-- Existing rows default to NULL (callers fall back to name inference).

alter table public.profiles
  add column if not exists gender text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_gender_check'
  ) then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('male', 'female'));
  end if;
end
$$;
