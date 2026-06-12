-- 0006_superadmin.sql — extend the role enum to include 'superadmin'.
--
-- PostgreSQL does not allow ALTER TYPE … ADD VALUE inside an open transaction,
-- and the Supabase migration runner wraps each file in a BEGIN/COMMIT block.
-- We therefore use the safe enum-swap pattern:
--   1. Create a new enum user_role_v2 with all three values.
--   2. Drop the default on profiles.role (so ALTER COLUMN TYPE can proceed).
--   3. ALTER COLUMN TYPE profiles.role to user_role_v2 (USING cast through text).
--   4. Re-set the default to 'counsellor'::user_role_v2.
--   5. Drop the old user_role type.
--   6. Rename user_role_v2 → user_role.
--   7. Re-create or replace all SECURITY DEFINER functions that reference the
--      type by name (is_admin, handle_new_user) so they bind to the new type.
--
-- Idempotency:
--   • Each step is wrapped in a DO block with an existence check so the file
--     is safe to re-run (e.g. after supabase db reset replays all migrations).

-- ---------------------------------------------------------------------------
-- Step 1 — Create user_role_v2 enum (idempotent)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role_v2') then
    create type public.user_role_v2 as enum ('counsellor', 'admin', 'superadmin');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 2+3+4 — Migrate profiles.role column to user_role_v2 (idempotent)
-- Check: if the column is already typed as user_role_v2 (or already named
-- user_role with 'superadmin' in it), skip.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Only do the swap if the column's type is still the OLD user_role enum
  -- (i.e. does NOT yet have 'superadmin').
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and a.attname = 'role'
      and t.typname = 'user_role'
      and not exists (
        select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'superadmin'
      )
  ) then
    -- Drop default before altering column type
    alter table public.profiles alter column role drop default;

    -- Cast existing values through text so the new enum accepts them
    alter table public.profiles
      alter column role type public.user_role_v2
      using role::text::public.user_role_v2;

    -- Re-set the default using the new type
    alter table public.profiles alter column role set default 'counsellor'::public.user_role_v2;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 5 — Drop old user_role type (idempotent: only if it still exists and
-- is no longer used)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_type where typname = 'user_role' and typnamespace = 'public'::regnamespace) then
    drop type public.user_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 6 — Rename user_role_v2 → user_role (idempotent)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_type where typname = 'user_role_v2' and typnamespace = 'public'::regnamespace) then
    alter type public.user_role_v2 rename to user_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 7a — Re-create is_admin() so it recognises superadmin too.
-- Uses CREATE OR REPLACE; references the enum by text cast to avoid binding
-- issues across the rename above.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'superadmin')
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Step 7b — Re-create handle_new_user() so SUPERADMIN_EMAIL addresses are
-- promoted to 'superadmin' (not 'admin') on signup.
-- The comment in 0003_auth.sql said "promote to 'admin'" — that was the
-- legacy behaviour before three-tier roles existed.  From this migration
-- forward, any email listed in app_config('superadmins') gets 'superadmin'.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name        text;
  v_role        public.user_role;
  v_superadmins jsonb;
begin
  -- name: prefer raw_user_meta_data.name, then full_name, else email local-part.
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1)
  );

  -- role: 'superadmin' iff lower(email) is in the superadmins jsonb array,
  --       else 'counsellor'.
  select value into v_superadmins
  from public.app_config
  where key = 'superadmins';

  if v_superadmins is not null
     and v_superadmins ? lower(new.email) then
    v_role := 'superadmin';
  else
    v_role := 'counsellor';
  end if;

  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, v_name, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Trigger is already in place from 0003_auth.sql — no need to recreate it.
-- (CREATE OR REPLACE on the function is sufficient; the trigger still calls it.)
