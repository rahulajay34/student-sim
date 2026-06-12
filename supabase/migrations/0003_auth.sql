-- 0003_auth.sql — auth.users triggers + app_config bootstrap.
--
-- Two triggers on auth.users:
--   1. enforce_signup_domain() BEFORE INSERT — hard-blocks any email whose domain
--      is not masaischool.com (covers password signup AND Google OAuth, since both
--      land an INSERT into auth.users). Plan-tier independent.
--   2. handle_new_user() AFTER INSERT — mirrors the new user into public.profiles,
--      defaulting role to 'counsellor' and promoting to 'admin' when the email is
--      listed in app_config key 'superadmins'.
--
-- Both functions are SECURITY DEFINER with `set search_path = ''` and use fully
-- qualified names, per Supabase security guidance (a search_path-less definer
-- function is a classic privilege-escalation vector).

-- ---------------------------------------------------------------------------
-- app_config bootstrap: superadmins list (lowercased emails).
-- Inserted before the trigger so the very first signup can be auto-promoted.
-- scripts/import-library.mjs (later workstream) may overwrite/extend this.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value)
values (
  'superadmins',
  '["rahul.singh@masaischool.com","rahul.bhat@masaischool.com"]'::jsonb
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Domain enforcement (BEFORE INSERT on auth.users).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_signup_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(split_part(new.email, '@', 2)) <> 'masaischool.com' then
    raise exception 'Signups are restricted to @masaischool.com accounts'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_domain on auth.users;
create trigger enforce_signup_domain
  before insert on auth.users
  for each row
  execute function public.enforce_signup_domain();

-- ---------------------------------------------------------------------------
-- 2. Profile provisioning (AFTER INSERT on auth.users).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text;
  v_role     public.user_role;
  v_superadmins jsonb;
begin
  -- name: prefer raw_user_meta_data.name, then full_name, else email local-part.
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1)
  );

  -- role: 'admin' iff lower(email) is in the superadmins jsonb array, else 'counsellor'.
  select value into v_superadmins
  from public.app_config
  where key = 'superadmins';

  if v_superadmins is not null
     and v_superadmins ? lower(new.email) then
    v_role := 'admin';
  else
    v_role := 'counsellor';
  end if;

  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, v_name, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
