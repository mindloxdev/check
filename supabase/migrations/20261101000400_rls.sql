-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Every table is owner-scoped: a signed-in user can read and write only rows
-- whose user_id equals their own auth.uid(). The anon role gets nothing at all.
--
-- Each policy names auth.uid() inside a scalar sub-select - (select auth.uid())
-- - which lets Postgres evaluate it once per statement instead of once per row.
-- That is the documented Supabase performance pattern and is semantically
-- identical.
-- =============================================================================

alter table public.profiles              enable row level security;
alter table public.attendance_records    enable row level security;
alter table public.attendance_audit_logs enable row level security;
alter table public.holidays              enable row level security;
alter table public.leave_records         enable row level security;
alter table public.rate_limit_events     enable row level security;

-- FORCE ROW LEVEL SECURITY is deliberately *not* used here. It would apply the
-- policies to the table owner as well, and the SECURITY DEFINER triggers below
-- (profile bootstrap on sign-up, audit writes) run as the owner at a point where
-- auth.uid() is null - so forcing it would break sign-up on a self-hosted
-- instance whose postgres role lacks BYPASSRLS.

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Deliberately no DELETE policy: a profile is removed only by deleting the
-- auth user, which cascades.

-- -----------------------------------------------------------------------------
-- attendance_records
-- -----------------------------------------------------------------------------
drop policy if exists attendance_select_own on public.attendance_records;
create policy attendance_select_own on public.attendance_records
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists attendance_insert_own on public.attendance_records;
create policy attendance_insert_own on public.attendance_records
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists attendance_update_own on public.attendance_records;
create policy attendance_update_own on public.attendance_records
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists attendance_delete_own on public.attendance_records;
create policy attendance_delete_own on public.attendance_records
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- attendance_audit_logs - readable, never writable or erasable from the client.
-- Entries are created by SECURITY DEFINER triggers and RPCs only, which is what
-- makes the trail trustworthy.
-- -----------------------------------------------------------------------------
drop policy if exists audit_select_own on public.attendance_audit_logs;
create policy audit_select_own on public.attendance_audit_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.attendance_audit_logs from authenticated, anon;

-- -----------------------------------------------------------------------------
-- holidays
-- -----------------------------------------------------------------------------
drop policy if exists holidays_all_own on public.holidays;
create policy holidays_all_own on public.holidays
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- leave_records
-- -----------------------------------------------------------------------------
drop policy if exists leave_all_own on public.leave_records;
create policy leave_all_own on public.leave_records
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- rate_limit_events - the client never touches this directly.
-- -----------------------------------------------------------------------------
drop policy if exists rate_limit_own on public.rate_limit_events;
create policy rate_limit_own on public.rate_limit_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Table-level grants. Without these, RLS policies are moot: PostgREST would be
-- refused before a policy was ever evaluated.
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update          on public.profiles              to authenticated;
grant select, insert, update, delete  on public.attendance_records    to authenticated;
grant select                          on public.attendance_audit_logs to authenticated;
grant select, insert, update, delete  on public.holidays              to authenticated;
grant select, insert, update, delete  on public.leave_records         to authenticated;
grant select, insert, delete          on public.rate_limit_events     to authenticated;
grant usage, select                   on sequence public.rate_limit_events_id_seq to authenticated;

-- The anon role is used only by the sign-in screen. It must never reach data.
revoke all on public.profiles              from anon;
revoke all on public.attendance_records    from anon;
revoke all on public.attendance_audit_logs from anon;
revoke all on public.holidays              from anon;
revoke all on public.leave_records         from anon;
revoke all on public.rate_limit_events     from anon;

-- -----------------------------------------------------------------------------
-- Create the profile automatically on sign-up, so the first dashboard load
-- never has to wait for a round trip to build one.
-- -----------------------------------------------------------------------------
create or replace function public.fn_create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_create_profile_for_new_user();
