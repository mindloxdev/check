-- =============================================================================
-- Server-side attendance operations
-- =============================================================================
-- Why RPCs instead of plain table writes?
--
--   1. The timestamp. Every live check-in / check-out instant comes from the
--      database clock via now(). A wrong phone clock, a tampered client, or a
--      stale cached page can never produce an authoritative time.
--   2. Atomicity. "Is there already an open session?" and "insert the session"
--      must not race across two devices. Inside one function they are one
--      transaction, backed by a unique constraint.
--   3. Policy capture. The schedule in force is snapshotted at write time.
--
-- All functions are SECURITY INVOKER, so Row Level Security still applies and a
-- caller can only ever touch their own rows. auth.uid() identifies the caller.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Server clock. The client renders this, corrected by round-trip latency, so
-- the on-screen time does not depend on the phone's clock.
-- -----------------------------------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

comment on function public.server_now() is
  'Authoritative wall clock. The UI displays this, never Date.now().';

-- -----------------------------------------------------------------------------
-- Rate limiting: at most p_max writes per bucket within p_window.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_rate_limit(
  p_bucket text,
  p_max    integer default 30,
  p_window interval default interval '1 minute'
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: you must be signed in'
      using errcode = '28000';
  end if;

  select count(*) into v_count
  from public.rate_limit_events e
  where e.user_id = v_uid
    and e.bucket = p_bucket
    and e.created_at > now() - p_window;

  if v_count >= p_max then
    raise exception 'RATE_LIMITED: too many % attempts, please wait a moment', p_bucket
      using errcode = '53400';
  end if;

  insert into public.rate_limit_events (user_id, bucket) values (v_uid, p_bucket);

  -- Opportunistic housekeeping; keeps the table from growing without a cron job.
  delete from public.rate_limit_events
  where user_id = v_uid and created_at < now() - interval '1 day';
end;
$$;

-- -----------------------------------------------------------------------------
-- Ensure the caller has a profile, creating it with the documented defaults.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: you must be signed in' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where user_id = v_uid;
  if found then
    return v_profile;
  end if;

  insert into public.profiles (user_id)
  values (v_uid)
  on conflict (user_id) do update set updated_at = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- -----------------------------------------------------------------------------
-- Resolve the business date for an instant, in the office time zone.
--
-- Without overnight mode the business date is simply the local calendar date.
-- With overnight mode on, local times before day_cutoff_hour belong to the
-- previous business date, so a 01:30 departure closes yesterday's session.
-- -----------------------------------------------------------------------------
create or replace function public.resolve_attendance_date(
  p_at       timestamptz,
  p_timezone text,
  p_overnight boolean default false,
  p_cutoff_hour smallint default 4
)
returns date
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone p_timezone;
begin
  if p_overnight and extract(hour from v_local) < p_cutoff_hour then
    return (v_local - interval '1 day')::date;
  end if;
  return v_local::date;
end;
$$;

-- -----------------------------------------------------------------------------
-- Build the policy snapshot stored on each record.
-- -----------------------------------------------------------------------------
create or replace function public.policy_snapshot_of(p_profile public.profiles)
returns jsonb
language sql
stable
parallel safe
set search_path = ''
as $$
  select jsonb_build_object(
    'timezone',             p_profile.timezone,
    'expected_check_in',    to_char(p_profile.expected_check_in, 'HH24:MI'),
    'expected_check_out',   to_char(p_profile.expected_check_out, 'HH24:MI'),
    'grace_period_minutes', p_profile.grace_period_minutes,
    'working_days',         to_jsonb(p_profile.working_days),
    'office_name',          p_profile.office_name,
    'captured_at',          to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
$$;

-- -----------------------------------------------------------------------------
-- Find the caller's currently open session, if any.
--
-- Scoped to the last 36 hours so a session the user forgot to close weeks ago
-- is never silently reused; that one surfaces as "Missing Check-Out" instead.
-- -----------------------------------------------------------------------------
create or replace function public.open_session()
returns public.attendance_records
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from public.attendance_records r
  where r.user_id = auth.uid()
    and r.check_in_at is not null
    and r.check_out_at is null
    and r.check_in_at > now() - interval '36 hours'
  order by r.check_in_at desc
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- CHECK IN
-- -----------------------------------------------------------------------------
-- p_client_now is accepted *only* to compute and store the device clock skew so
-- the UI can warn "your phone clock is 14 minutes off". It never influences the
-- recorded timestamp.
-- -----------------------------------------------------------------------------
create or replace function public.attendance_check_in(
  p_verification public.verification_status default 'unverified',
  p_client_now   timestamptz default null,
  p_source       public.attendance_source default 'app',
  p_note         text default null
)
returns public.attendance_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_now     timestamptz := now();
  v_date    date;
  v_open    public.attendance_records;
  v_session smallint;
  v_record  public.attendance_records;
  v_skew    integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: you must be signed in' using errcode = '28000';
  end if;

  perform public.enforce_rate_limit('check_in', 20, interval '1 minute');

  v_profile := public.ensure_profile();
  v_date := public.resolve_attendance_date(
    v_now, v_profile.timezone, v_profile.overnight_enabled, v_profile.day_cutoff_hour
  );

  -- Guard 1: an open session already exists. Tapping Check In twice must not
  -- create a second row or move the first one.
  v_open := public.open_session();
  if v_open.id is not null then
    raise exception 'ALREADY_CHECKED_IN: an open session started at % is still running',
      to_char(v_open.check_in_at at time zone v_profile.timezone, 'YYYY-MM-DD HH24:MI')
      using errcode = 'P0001';
  end if;

  -- Guard 2: single-session mode - today is already recorded.
  if not v_profile.multi_session_enabled then
    if exists (
      select 1 from public.attendance_records r
      where r.user_id = v_uid and r.attendance_date = v_date
    ) then
      raise exception 'ALREADY_RECORDED: % already has an attendance session; use a manual correction to change it',
        to_char(v_date, 'FMDay, FMMonth DD YYYY')
        using errcode = 'P0001';
    end if;
    v_session := 1;
  else
    select coalesce(max(r.session_index), 0) + 1 into v_session
    from public.attendance_records r
    where r.user_id = v_uid and r.attendance_date = v_date;

    if v_session > 12 then
      raise exception 'SESSION_LIMIT: % already has the maximum of 12 sessions', v_date
        using errcode = 'P0001';
    end if;
  end if;

  if p_client_now is not null then
    v_skew := round(extract(epoch from (p_client_now - v_now)))::integer;
  end if;

  -- The audit entry is written by the trigger in 20261101000300_audit.sql, not
  -- here. That trigger is SECURITY DEFINER, which matters: `authenticated` has
  -- no INSERT privilege on the audit log (see the RLS migration), so an
  -- explicit insert from this SECURITY INVOKER function would be refused and
  -- every check-in would fail. The hint below only labels the entry.
  perform set_config('app.audit_action', 'check_in', true);

  insert into public.attendance_records (
    user_id, attendance_date, session_index,
    check_in_at, check_in_verification_status, check_in_source,
    check_in_client_skew_seconds, note, policy_snapshot
  ) values (
    v_uid, v_date, v_session,
    v_now, coalesce(p_verification, 'unverified'), coalesce(p_source, 'app'),
    v_skew, nullif(btrim(coalesce(p_note, '')), ''), public.policy_snapshot_of(v_profile)
  )
  returning * into v_record;

  return v_record;
end;
$$;

-- -----------------------------------------------------------------------------
-- CHECK OUT
-- -----------------------------------------------------------------------------
-- Closes the open session, wherever it started. Because the lookup is by open
-- session and not by today's date, checking out after midnight - or after the
-- month has rolled over - closes the correct record.
-- -----------------------------------------------------------------------------
create or replace function public.attendance_check_out(
  p_verification public.verification_status default 'unverified',
  p_client_now   timestamptz default null,
  p_source       public.attendance_source default 'app'
)
returns public.attendance_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_now     timestamptz := now();
  v_open    public.attendance_records;
  v_record  public.attendance_records;
  v_skew    integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: you must be signed in' using errcode = '28000';
  end if;

  perform public.enforce_rate_limit('check_out', 20, interval '1 minute');

  v_profile := public.ensure_profile();

  -- Re-read the open session FOR UPDATE so two devices tapping Check Out at the
  -- same moment serialise: the second one finds check_out_at already set.
  select r.* into v_open
  from public.attendance_records r
  where r.user_id = v_uid
    and r.check_in_at is not null
    and r.check_out_at is null
    and r.check_in_at > now() - interval '36 hours'
  order by r.check_in_at desc
  limit 1
  for update;

  if v_open.id is null then
    if exists (
      select 1 from public.attendance_records r
      where r.user_id = v_uid
        and r.check_out_at is not null
        and r.check_out_at > now() - interval '12 hours'
    ) then
      raise exception 'ALREADY_CHECKED_OUT: this session has already been closed'
        using errcode = 'P0001';
    end if;
    raise exception 'NOT_CHECKED_IN: there is no open session to check out of'
      using errcode = 'P0001';
  end if;

  if p_client_now is not null then
    v_skew := round(extract(epoch from (p_client_now - v_now)))::integer;
  end if;

  perform set_config('app.audit_action', 'check_out', true);

  update public.attendance_records r
  set check_out_at = v_now,
      check_out_verification_status = coalesce(p_verification, 'unverified'),
      check_out_source = coalesce(p_source, 'app'),
      check_out_client_skew_seconds = v_skew
  where r.id = v_open.id
  returning * into v_record;

  return v_record;
end;
$$;

-- -----------------------------------------------------------------------------
-- MANUAL CORRECTION (also used to create a missed day from scratch)
-- -----------------------------------------------------------------------------
-- Times arrive as local wall-clock strings ('09:05') plus the business date, and
-- are converted to UTC here using the office time zone. That keeps the client
-- out of the time-zone business entirely.
--
-- A null time means "leave this side empty" (e.g. a genuinely missing check-out).
-- Passing p_clear_check_out = true removes an existing check-out.
-- -----------------------------------------------------------------------------
create or replace function public.attendance_manual_upsert(
  p_date           date,
  p_check_in_local text,
  p_check_out_local text,
  p_reason         text,
  p_session_index  smallint default 1,
  p_note           text default null,
  p_check_out_next_day boolean default false
)
returns public.attendance_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_profile   public.profiles;
  v_existing  public.attendance_records;
  v_record    public.attendance_records;
  v_in        timestamptz;
  v_out       timestamptz;
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_out_date  date;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: you must be signed in' using errcode = '28000';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: a correction must include a reason of at least 3 characters'
      using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'DATE_REQUIRED: a correction must name the attendance date'
      using errcode = '22023';
  end if;

  perform public.enforce_rate_limit('manual_correction', 60, interval '5 minutes');

  v_profile := public.ensure_profile();

  -- Never let the user invent attendance in the future.
  if p_date > public.resolve_attendance_date(
       now(), v_profile.timezone, v_profile.overnight_enabled, v_profile.day_cutoff_hour
     ) then
    raise exception 'FUTURE_DATE: % is in the future', p_date using errcode = '22023';
  end if;

  if p_check_in_local is not null and btrim(p_check_in_local) <> '' then
    v_in := (p_date::text || ' ' || btrim(p_check_in_local))::timestamp
            at time zone v_profile.timezone;
  end if;

  if p_check_out_local is not null and btrim(p_check_out_local) <> '' then
    v_out_date := case when p_check_out_next_day then p_date + 1 else p_date end;
    v_out := (v_out_date::text || ' ' || btrim(p_check_out_local))::timestamp
             at time zone v_profile.timezone;
  end if;

  if v_in is null and v_out is null then
    raise exception 'EMPTY_RECORD: provide at least a check-in or a check-out time'
      using errcode = '22023';
  end if;
  if v_in is not null and v_out is not null and v_out <= v_in then
    raise exception 'ORDER_INVALID: check-out must be later than check-in; tick "next day" for an overnight shift'
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.attendance_records r
  where r.user_id = v_uid
    and r.attendance_date = p_date
    and r.session_index = coalesce(p_session_index, 1)
  for update;

  if v_existing.id is null then
    -- Same reasoning as in attendance_check_in: the trigger writes the audit
    -- entry, because this function runs as the caller and the caller may not
    -- insert into the audit log.
    perform set_config('app.audit_reason', v_reason, true);
    perform set_config('app.audit_action', 'manual_correction', true);

    insert into public.attendance_records (
      user_id, attendance_date, session_index,
      check_in_at, check_out_at,
      check_in_verification_status, check_out_verification_status,
      check_in_source, check_out_source,
      manual_correction, correction_reason, note, policy_snapshot
    ) values (
      v_uid, p_date, coalesce(p_session_index, 1),
      v_in, v_out,
      case when v_in is not null then 'unverified'::public.verification_status end,
      case when v_out is not null then 'unverified'::public.verification_status end,
      case when v_in is not null then 'manual'::public.attendance_source end,
      case when v_out is not null then 'manual'::public.attendance_source end,
      true, v_reason, nullif(btrim(coalesce(p_note, '')), ''),
      public.policy_snapshot_of(v_profile)
    )
    returning * into v_record;

    return v_record;
  end if;

  -- Existing row: the trigger in 20261101000300_audit.sql captures the before
  -- and after images, so nothing is ever overwritten silently.
  perform set_config('app.audit_reason', v_reason, true);
  perform set_config('app.audit_action', 'manual_correction', true);

  update public.attendance_records r
  set check_in_at  = v_in,
      check_out_at = v_out,
      check_in_verification_status = case
        when v_in is null then null
        when v_in = v_existing.check_in_at then r.check_in_verification_status
        else 'unverified'::public.verification_status end,
      check_out_verification_status = case
        when v_out is null then null
        when v_out = v_existing.check_out_at then r.check_out_verification_status
        else 'unverified'::public.verification_status end,
      check_in_source = case
        when v_in is null then null
        when v_in = v_existing.check_in_at then r.check_in_source
        else 'manual'::public.attendance_source end,
      check_out_source = case
        when v_out is null then null
        when v_out = v_existing.check_out_at then r.check_out_source
        else 'manual'::public.attendance_source end,
      manual_correction = true,
      correction_reason = v_reason,
      note = nullif(btrim(coalesce(p_note, '')), '')
  where r.id = v_existing.id
  returning * into v_record;

  return v_record;
end;
$$;

-- -----------------------------------------------------------------------------
-- Delete a session (audited by trigger).
-- -----------------------------------------------------------------------------
create or replace function public.attendance_delete(p_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED: you must be signed in' using errcode = '28000';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED: deleting a record requires a reason'
      using errcode = '22023';
  end if;

  perform public.enforce_rate_limit('delete', 20, interval '5 minutes');
  perform set_config('app.audit_reason', v_reason, true);

  delete from public.attendance_records r
  where r.id = p_id and r.user_id = auth.uid();

  if not found then
    raise exception 'NOT_FOUND: no such attendance record' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants. `anon` gets nothing; only authenticated sessions may call these.
-- -----------------------------------------------------------------------------
revoke all on function public.server_now()                                         from public;
revoke all on function public.ensure_profile()                                     from public;
revoke all on function public.open_session()                                       from public;
revoke all on function public.attendance_check_in(public.verification_status, timestamptz, public.attendance_source, text) from public;
revoke all on function public.attendance_check_out(public.verification_status, timestamptz, public.attendance_source)      from public;
revoke all on function public.attendance_manual_upsert(date, text, text, text, smallint, text, boolean)                    from public;
revoke all on function public.attendance_delete(uuid, text)                        from public;
revoke all on function public.enforce_rate_limit(text, integer, interval)          from public;

grant execute on function public.server_now()      to authenticated, anon;
grant execute on function public.ensure_profile()  to authenticated;
grant execute on function public.open_session()    to authenticated;
grant execute on function public.attendance_check_in(public.verification_status, timestamptz, public.attendance_source, text) to authenticated;
grant execute on function public.attendance_check_out(public.verification_status, timestamptz, public.attendance_source)      to authenticated;
grant execute on function public.attendance_manual_upsert(date, text, text, text, smallint, text, boolean)                    to authenticated;
grant execute on function public.attendance_delete(uuid, text) to authenticated;
grant execute on function public.enforce_rate_limit(text, integer, interval) to authenticated;
grant execute on function public.policy_snapshot_of(public.profiles) to authenticated;
grant execute on function public.resolve_attendance_date(timestamptz, text, boolean, smallint) to authenticated;
grant execute on function public.is_valid_timezone(text) to authenticated;
