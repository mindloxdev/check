-- =============================================================================
-- Personal Office Attendance Tracker - core schema
-- =============================================================================
-- Design notes
--   * Every authoritative instant is stored as timestamptz (UTC on the wire).
--     The office time zone lives in profiles.timezone and is applied only when
--     deriving an attendance date or rendering/reporting a value.
--   * attendance_date is the *business* date of a session, resolved in the
--     office time zone by public.resolve_attendance_date(). It is therefore
--     stable even if the user travels or the server moves region.
--   * policy_snapshot freezes the schedule that was in force when the session
--     was recorded, so editing the schedule later never rewrites history.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.verification_status as enum (
    'verified',        -- office network endpoint answered with the expected token
    'unverified',      -- verification not attempted (disabled or user preference)
    'failed',          -- endpoint configured but unreachable or wrong token
    'not_configured'   -- no endpoint configured yet
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_source as enum (
    'app',             -- live button tap, timestamp taken from the database clock
    'manual',          -- entered or corrected by the user
    'offline_sync'     -- queued while offline, reconciled on reconnect
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_action as enum (
    'check_in', 'check_out', 'manual_correction', 'create', 'update', 'delete'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wifi_mode as enum (
    'off',         -- never attempt verification
    'optional',    -- attempt, record the result, always allow the check-in
    'required'     -- attempt; block the check-in unless the user overrides
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_type as enum (
    'annual', 'sick', 'casual', 'unpaid', 'other'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Time-zone validation helper (used by a CHECK constraint, so it must exist
-- before the profiles table).
-- -----------------------------------------------------------------------------
create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if p_tz is null or p_tz = '' then
    return false;
  end if;
  -- The only reliable check is to ask Postgres to resolve it. A *constant*
  -- timestamp is used on purpose: a CHECK constraint may only call IMMUTABLE
  -- functions, and now() is merely STABLE.
  perform pg_catalog.timezone(p_tz, '2000-01-01 00:00:00'::timestamp);
  return true;
exception when others then
  return false;
end;
$$;

comment on function public.is_valid_timezone(text) is
  'True when Postgres recognises the IANA time-zone name. Used by profiles CHECK.';

-- -----------------------------------------------------------------------------
-- Duplicate detection for the working_days array.
--
-- This lives in a function because Postgres rejects a subquery inside a CHECK
-- constraint outright ("cannot use subquery in check constraint"), while an
-- IMMUTABLE function that happens to contain one is accepted.
-- -----------------------------------------------------------------------------
create or replace function public.array_has_duplicates(p_values smallint[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_length(p_values, 1), 0) <> (
    select count(distinct v) from unnest(p_values) as v
  );
$$;

comment on function public.array_has_duplicates(smallint[]) is
  'True when the array contains a repeated value. Used by the profiles CHECK.';

-- -----------------------------------------------------------------------------
-- profiles - one row per user, holds the attendance policy
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users (id) on delete cascade,

  office_name             text        not null default 'My Office',
  timezone                text        not null default 'Asia/Karachi',

  expected_check_in       time        not null default '09:00',
  expected_check_out      time        not null default '17:00',
  grace_period_minutes    integer     not null default 10,

  -- ISO-8601 weekday numbers: 1 = Monday ... 7 = Sunday. Anything not listed is
  -- a weekend / non-working day. An array so any pattern is expressible.
  working_days            smallint[]  not null default '{1,2,3,4,5}',

  -- Day of month on which the previous month's report becomes reviewable.
  reporting_day           smallint    not null default 5,

  -- Office Wi-Fi verification
  wifi_mode               public.wifi_mode not null default 'off',
  wifi_endpoint_url       text,
  wifi_expected_token     text,
  wifi_timeout_ms         integer     not null default 4000,

  -- Sessions
  multi_session_enabled   boolean     not null default false,
  overnight_enabled       boolean     not null default false,
  -- With overnight shifts on, a local time before this hour still belongs to the
  -- previous business date (clocking out at 01:30 closes "yesterday").
  day_cutoff_hour         smallint    not null default 4,

  -- Notifications
  notify_monthly_review   boolean     not null default true,
  notify_missing_checkout boolean     not null default true,
  notify_late_arrival     boolean     not null default false,

  theme                   text        not null default 'system',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint profiles_grace_range     check (grace_period_minutes between 0 and 480),
  constraint profiles_reporting_day   check (reporting_day between 1 and 28),
  constraint profiles_cutoff_range    check (day_cutoff_hour between 0 and 12),
  constraint profiles_timeout_range   check (wifi_timeout_ms between 500 and 30000),
  constraint profiles_theme_values    check (theme in ('system', 'light', 'dark')),
  constraint profiles_office_name_len check (char_length(office_name) between 1 and 120),
  constraint profiles_endpoint_shape  check (
    wifi_endpoint_url is null or wifi_endpoint_url ~* '^https?://\S{3,2048}$'
  ),
  constraint profiles_token_len check (
    wifi_expected_token is null or char_length(wifi_expected_token) between 1 and 256
  ),
  -- A non-empty, duplicate-free subset of 1..7.
  constraint profiles_working_days_valid check (
    array_length(working_days, 1) between 1 and 7
    and working_days <@ array[1,2,3,4,5,6,7]::smallint[]
    and not public.array_has_duplicates(working_days)
  ),
  -- Rejects a typo like "Asia/Karachee" at write time, not at report time.
  constraint profiles_timezone_valid check (public.is_valid_timezone(timezone))
);

comment on table public.profiles is
  'Per-user office attendance policy. Exactly one row per auth user.';

-- -----------------------------------------------------------------------------
-- attendance_records - one row per attendance session
-- -----------------------------------------------------------------------------
create table if not exists public.attendance_records (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,

  attendance_date date     not null,
  -- 1 for the single daily session. Only ever > 1 when multi-session mode is on,
  -- which keeps the "one session per day" guarantee intact for everyone else.
  session_index   smallint not null default 1,

  check_in_at     timestamptz,
  check_out_at    timestamptz,

  check_in_verification_status  public.verification_status,
  check_out_verification_status public.verification_status,
  check_in_source  public.attendance_source,
  check_out_source public.attendance_source,

  -- Difference between the device clock and the database clock at the moment of
  -- the tap, in seconds. Purely diagnostic - never used in a calculation.
  check_in_client_skew_seconds  integer,
  check_out_client_skew_seconds integer,

  manual_correction boolean not null default false,
  correction_reason text,
  note              text,

  -- The policy in force when the session was recorded.
  policy_snapshot jsonb not null default '{}'::jsonb,

  -- Stored generated column: always consistent, cheap to aggregate, and
  -- impossible for a client to falsify.
  duration_minutes integer generated always as (
    case
      when check_in_at is not null and check_out_at is not null
      then floor(extract(epoch from (check_out_at - check_in_at)) / 60.0)::integer
    end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_session_index_range check (session_index between 1 and 12),
  constraint attendance_has_a_timestamp check (
    check_in_at is not null or check_out_at is not null
  ),
  constraint attendance_order check (
    check_in_at is null or check_out_at is null or check_out_at > check_in_at
  ),
  -- A single session longer than 36h is a data-entry error, not a workday.
  constraint attendance_sane_duration check (
    check_in_at is null or check_out_at is null
    or check_out_at - check_in_at <= interval '36 hours'
  ),
  constraint attendance_reason_len check (
    correction_reason is null or char_length(correction_reason) between 3 and 500
  ),
  constraint attendance_note_len check (note is null or char_length(note) <= 500),
  -- A correction must say why. Enforced here so no code path can skip it.
  constraint attendance_correction_needs_reason check (
    manual_correction = false or correction_reason is not null
  ),
  -- The core duplicate guard.
  constraint attendance_unique_session unique (user_id, attendance_date, session_index)
);

comment on table public.attendance_records is
  'One attendance session. Timestamps are authoritative UTC values from the database clock.';
comment on column public.attendance_records.policy_snapshot is
  'Schedule in force when recorded, so later settings changes do not rewrite history.';

create index if not exists attendance_user_date_idx
  on public.attendance_records (user_id, attendance_date desc);

-- Drives the "is there an open session?" lookup on every dashboard load.
create index if not exists attendance_open_session_idx
  on public.attendance_records (user_id, check_in_at desc)
  where check_out_at is null and check_in_at is not null;

-- -----------------------------------------------------------------------------
-- attendance_audit_logs - append-only history of every mutation
-- -----------------------------------------------------------------------------
create table if not exists public.attendance_audit_logs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Deliberately "set null", not "cascade": the audit trail must survive the
  -- deletion of the record it describes.
  attendance_record_id uuid references public.attendance_records (id) on delete set null,
  attendance_date      date,

  action          public.audit_action not null,
  previous_values jsonb,
  new_values      jsonb,
  reason          text,

  created_at timestamptz not null default now(),

  constraint audit_reason_len check (reason is null or char_length(reason) <= 500)
);

create index if not exists audit_user_created_idx
  on public.attendance_audit_logs (user_id, created_at desc);
create index if not exists audit_record_idx
  on public.attendance_audit_logs (attendance_record_id, created_at desc);

-- -----------------------------------------------------------------------------
-- holidays
-- -----------------------------------------------------------------------------
create table if not exists public.holidays (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  holiday_date date not null,
  holiday_name text not null,
  created_at   timestamptz not null default now(),

  constraint holidays_name_len check (char_length(holiday_name) between 1 and 120),
  constraint holidays_unique_per_day unique (user_id, holiday_date)
);

create index if not exists holidays_user_date_idx on public.holidays (user_id, holiday_date);

-- -----------------------------------------------------------------------------
-- leave_records
-- -----------------------------------------------------------------------------
create table if not exists public.leave_records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  leave_type public.leave_type not null default 'annual',
  notes      text,
  created_at timestamptz not null default now(),

  constraint leave_range_valid  check (end_date >= start_date),
  -- Guards against a fat-fingered year turning into a ten-year leave.
  constraint leave_range_length check (end_date - start_date <= 366),
  constraint leave_notes_len    check (notes is null or char_length(notes) <= 500)
);

create index if not exists leave_user_range_idx
  on public.leave_records (user_id, start_date, end_date);

-- Prevents two overlapping leave entries for the same user.
alter table public.leave_records drop constraint if exists leave_no_overlap;
alter table public.leave_records
  add constraint leave_no_overlap exclude using gist (
    user_id with =,
    daterange(start_date, end_date, '[]') with &&
  );

-- -----------------------------------------------------------------------------
-- rate_limit_events - lightweight abuse guard for the write RPCs
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limit_events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  bucket     text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_lookup_idx
  on public.rate_limit_events (user_id, bucket, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists attendance_touch_updated_at on public.attendance_records;
create trigger attendance_touch_updated_at
  before update on public.attendance_records
  for each row execute function public.touch_updated_at();
