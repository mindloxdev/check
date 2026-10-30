-- =============================================================================
-- Dependency-free behavioural check.
-- =============================================================================
-- The canonical suite is `attendance_test.sql` (pgTAP, run via
-- `supabase test db`). This file asserts the same guarantees using nothing but
-- plain SQL, so it can be run against any Postgres that has the migrations
-- applied:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/behaviour_check.sql
--
-- Every assertion raises an exception on failure, so a non-zero exit means a
-- guarantee is broken.
-- =============================================================================

\set ON_ERROR_STOP on

create schema if not exists t;

create or replace function t.assert(p_condition boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAILED: %', p_what;
  end if;
  raise notice '  ok  %', p_what;
end $$;

/** Runs a statement and asserts it raises, optionally with a given SQLSTATE. */
create or replace function t.assert_raises(p_sql text, p_what text, p_sqlstate text default null)
returns void language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if p_sqlstate is not null and v_state <> p_sqlstate then
      raise exception 'FAILED: % (expected SQLSTATE %, got %)', p_what, p_sqlstate, v_state;
    end if;
    raise notice '  ok  %', p_what;
    return;
  end;
  raise exception 'FAILED: % (no exception was raised)', p_what;
end $$;

create or replace function t.login(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create or replace function t.logout()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

-- The assertions run while impersonating `authenticated`, so that role needs to
-- be able to call the helpers above.
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
delete from auth.users where email in ('alice@test.local', 'bob@test.local');
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local');

\echo ''
\echo '--- time zone and business date ---'
select t.assert(
  public.resolve_attendance_date('2026-10-29T20:30:00Z'::timestamptz, 'Asia/Karachi')
    = '2026-10-30'::date,
  '20:30Z is already the 30th in Karachi');
select t.assert(
  public.resolve_attendance_date('2026-10-29T20:30:00Z'::timestamptz, 'America/New_York')
    = '2026-10-29'::date,
  'the same instant is still the 29th in New York');
select t.assert(
  public.resolve_attendance_date('2026-10-29T20:30:00Z'::timestamptz, 'Asia/Karachi', true, 4::smallint)
    = '2026-10-29'::date,
  'overnight mode files 01:30 under the previous business day');
select t.assert(
  public.resolve_attendance_date('2026-10-30T00:00:00Z'::timestamptz, 'Asia/Karachi', true, 4::smallint)
    = '2026-10-30'::date,
  'a time past the cutoff stays on its own day');
select t.assert(public.is_valid_timezone('Asia/Karachi'), 'a real zone validates');
select t.assert(not public.is_valid_timezone('Asia/Karachee'), 'a typo is rejected');
select t.assert(public.array_has_duplicates('{1,1,2}'::smallint[]), 'duplicates are detected');
select t.assert(not public.array_has_duplicates('{1,2,3}'::smallint[]), 'a clean array passes');

\echo ''
\echo '--- check in / check out ---'
select t.login('11111111-1111-1111-1111-111111111111');

select t.assert((public.ensure_profile()).user_id = auth.uid(),
  'ensure_profile creates the caller''s profile');
select t.assert((select count(*) from public.profiles) = 1,
  'exactly one profile is visible to its owner');

select t.assert((public.attendance_check_in('verified')).check_in_at is not null,
  'the first check-in writes a server timestamp');
select t.assert((select count(*) from public.attendance_records) = 1,
  'one attendance record exists');

select t.assert_raises(
  $$ select public.attendance_check_in('verified') $$,
  'a second check-in while a session is open is rejected',
  'P0001');
select t.assert((select count(*) from public.attendance_records) = 1,
  'the rejected duplicate created no extra row');

-- The client clock must never become the record.
select t.assert(
  (public.attendance_check_out('verified', '1999-01-01T00:00:00Z'::timestamptz)).check_out_at
    > '2020-01-01'::timestamptz,
  'a 1999 client clock did NOT become the recorded check-out time');
select t.assert(
  (select check_out_client_skew_seconds < -100000000 from public.attendance_records limit 1),
  'the client clock was stored as diagnostic skew instead');
select t.assert(
  (select duration_minutes is not null from public.attendance_records limit 1),
  'the generated duration column was computed');

select t.assert_raises(
  $$ select public.attendance_check_out('verified') $$,
  'a second check-out is rejected',
  'P0001');
select t.assert_raises(
  $$ select public.attendance_check_in('verified') $$,
  'a second check-in on the same day is rejected in single-session mode',
  'P0001');

\echo ''
\echo '--- constraints ---'
select t.assert_raises(
  $$ insert into public.attendance_records (user_id, attendance_date, check_in_at, check_out_at)
     values (auth.uid(), '2026-01-05', '2026-01-05T12:00:00Z', '2026-01-05T08:00:00Z') $$,
  'check-out before check-in is rejected', '23514');
select t.assert_raises(
  $$ insert into public.attendance_records (user_id, attendance_date, manual_correction, correction_reason)
     values (auth.uid(), '2026-01-06', true, 'no timestamps') $$,
  'a record with neither timestamp is rejected', '23514');
select t.assert_raises(
  $$ update public.profiles set timezone = 'Mars/Olympus' where user_id = auth.uid() $$,
  'an invalid time zone is rejected at write time', '23514');
select t.assert_raises(
  $$ update public.profiles set working_days = '{1,1,2}' where user_id = auth.uid() $$,
  'duplicate working days are rejected', '23514');
select t.assert_raises(
  $$ update public.profiles set grace_period_minutes = -5 where user_id = auth.uid() $$,
  'a negative grace period is rejected', '23514');
select t.assert_raises(
  $$ insert into public.leave_records (user_id, start_date, end_date)
     values (auth.uid(), '2026-03-10', '2026-03-01') $$,
  'leave ending before it starts is rejected', '23514');

\echo ''
\echo '--- manual correction and the audit trail ---'
select t.assert_raises(
  $$ select public.attendance_manual_upsert('2026-01-07', '09:00', '17:00', 'no') $$,
  'a too-short correction reason is rejected', '22023');
select t.assert_raises(
  $$ select public.attendance_manual_upsert((now() + interval '3 days')::date, '09:00', '17:00', 'future attempt') $$,
  'a correction dated in the future is rejected', '22023');
select t.assert_raises(
  $$ select public.attendance_manual_upsert('2026-01-07', '17:00', '09:00', 'backwards times') $$,
  'a correction with check-out before check-in is rejected', '22023');

select t.assert(
  (public.attendance_manual_upsert('2026-01-08', '09:15', '17:30',
     'Forgot to tap in on arrival')).manual_correction,
  'a valid correction succeeds and is flagged');
select t.assert(
  (select count(*) from public.attendance_audit_logs where attendance_date = '2026-01-08') = 1,
  'the correction wrote one audit entry');

select t.assert(
  (public.attendance_manual_upsert('2026-01-08', '09:45', '17:30',
     'Corrected again after checking the door log')).check_in_at is not null,
  'a second correction on the same day succeeds');
select t.assert(
  exists (select 1 from public.attendance_audit_logs
          where attendance_date = '2026-01-08'
            and action = 'manual_correction'
            and previous_values ? 'check_in_at'
            and new_values ? 'check_in_at'),
  'the audit log kept both the previous and the new check-in time');
select t.assert(
  exists (select 1 from public.attendance_audit_logs
          where attendance_date = '2026-01-08' and reason like '%door log%'),
  'the correction reason was stored');

-- A direct table UPDATE must be audited too: no path may bypass the trail.
update public.attendance_records set note = 'edited directly'
  where attendance_date = '2026-01-08';
select t.assert(
  exists (select 1 from public.attendance_audit_logs
          where attendance_date = '2026-01-08' and new_values->>'note' = 'edited directly'),
  'the trigger audited a direct table update, not just the RPC path');

select t.assert_raises(
  $$ delete from public.attendance_audit_logs where user_id = auth.uid() $$,
  'a client cannot delete audit entries', '42501');
select t.assert_raises(
  $$ insert into public.attendance_audit_logs (user_id, action) values (auth.uid(), 'update') $$,
  'a client cannot forge audit entries', '42501');

-- Deleting a record keeps its audit history.
select t.assert(
  (select count(*) from public.attendance_audit_logs where attendance_date = '2026-01-08') >= 3,
  'several audit entries exist for the corrected day');
select public.attendance_delete(
  (select id from public.attendance_records where attendance_date = '2026-01-08'),
  'Recorded in error');
select t.assert(
  not exists (select 1 from public.attendance_records where attendance_date = '2026-01-08'),
  'the record was deleted');
select t.assert(
  exists (select 1 from public.attendance_audit_logs
          where attendance_date = '2026-01-08' and action = 'delete'
            and reason = 'Recorded in error'),
  'the deletion itself was audited, and the trail outlived the record');

\echo ''
\echo '--- holidays and leave ---'
insert into public.holidays (user_id, holiday_date, holiday_name)
  values (auth.uid(), '2026-01-26', 'Founders Day');
select t.assert_raises(
  $$ insert into public.holidays (user_id, holiday_date, holiday_name)
     values (auth.uid(), '2026-01-26', 'Duplicate') $$,
  'two holidays on the same date are rejected', '23505');

insert into public.leave_records (user_id, start_date, end_date, leave_type)
  values (auth.uid(), '2026-02-10', '2026-02-14', 'annual');
select t.assert_raises(
  $$ insert into public.leave_records (user_id, start_date, end_date)
     values (auth.uid(), '2026-02-12', '2026-02-16') $$,
  'overlapping leave is rejected by the exclusion constraint', '23P01');

\echo ''
\echo '--- row level security ---'
select t.login('22222222-2222-2222-2222-222222222222');
select public.ensure_profile();

select t.assert((select count(*) from public.attendance_records) = 0,
  'the second user sees none of the first user''s attendance');
select t.assert((select count(*) from public.profiles) = 1,
  'the second user sees only their own profile');
select t.assert((select count(*) from public.attendance_audit_logs) = 0,
  'the second user sees none of the first user''s audit entries');
select t.assert((select count(*) from public.holidays) = 0,
  'holidays are isolated per user');
select t.assert((select count(*) from public.leave_records) = 0,
  'leave records are isolated per user');

select t.assert_raises(
  $$ insert into public.attendance_records (user_id, attendance_date, check_in_at)
     values ('11111111-1111-1111-1111-111111111111', '2026-02-01', now()) $$,
  'writing a record owned by another user is blocked by RLS', '42501');
-- RLS filters the row out of the UPDATE rather than raising, so the statement
-- succeeds while touching nothing. The assertion is therefore about the effect,
-- checked below once we are no longer restricted to our own rows.
update public.profiles set office_name = 'hijacked'
  where user_id = '11111111-1111-1111-1111-111111111111';

select t.logout();
select t.assert(
  (select office_name from public.profiles
    where user_id = '11111111-1111-1111-1111-111111111111') <> 'hijacked',
  'the first user''s profile was not modified');

\echo ''
\echo '--- rate limiting ---'
select t.login('11111111-1111-1111-1111-111111111111');
do $$
declare i int;
begin
  -- The check-in limiter allows 20 per minute; drive it past the limit.
  for i in 1..19 loop
    perform public.enforce_rate_limit('probe', 20, interval '1 minute');
  end loop;
end $$;
select t.assert_raises(
  $$ do $x$ declare i int; begin
       for i in 1..5 loop
         perform public.enforce_rate_limit('probe', 20, interval '1 minute');
       end loop; end $x$ $$,
  'the rate limiter rejects a burst past its threshold', '53400');

select t.logout();

\echo ''
\echo '==========================================='
\echo ' ALL BEHAVIOURAL CHECKS PASSED'
\echo '==========================================='
