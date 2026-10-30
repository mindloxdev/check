-- =============================================================================
-- Automatic audit trail for attendance records
-- =============================================================================
-- The trigger, not the application, is what guarantees the requirement that
-- previously recorded attendance is never changed silently. It fires for every
-- INSERT, UPDATE and DELETE, including one issued straight at the table through
-- the REST API, so there is no code path that can bypass it.
--
-- SECURITY DEFINER is load-bearing. `authenticated` has no INSERT privilege on
-- attendance_audit_logs (see the RLS migration) — that is exactly what makes
-- the trail trustworthy — so the audit row has to be written by the function
-- owner. An audit INSERT attempted from one of the SECURITY INVOKER RPCs would
-- be refused outright, taking the whole check-in down with it.
--
-- A calling RPC may annotate the entry by setting two transaction-local GUCs
-- before the write:
--     set_config('app.audit_reason', '<why>', true)
--     set_config('app.audit_action', 'manual_correction', true)
-- Absent those, the action is inferred from the row itself.
-- =============================================================================

create or replace function public.fn_audit_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('app.audit_reason', true), '')), '');
  v_hint   text := nullif(btrim(coalesce(current_setting('app.audit_action', true), '')), '');
  v_action public.audit_action;
  v_prev   jsonb;
  v_next   jsonb;
begin
  -- ---------------------------------------------------------------- INSERT --
  if tg_op = 'INSERT' then
    v_next := jsonb_strip_nulls(jsonb_build_object(
      'attendance_date',              new.attendance_date,
      'session_index',                new.session_index,
      'check_in_at',                  new.check_in_at,
      'check_out_at',                 new.check_out_at,
      'check_in_verification_status', new.check_in_verification_status,
      'check_in_source',              new.check_in_source,
      'check_out_source',             new.check_out_source,
      'duration_minutes',             new.duration_minutes,
      'note',                         new.note
    ));

    v_action := case
      when v_hint = 'check_in'          then 'check_in'::public.audit_action
      when v_hint = 'manual_correction' then 'manual_correction'::public.audit_action
      when new.manual_correction        then 'manual_correction'::public.audit_action
      when new.check_in_at is not null  then 'check_in'::public.audit_action
      else 'create'::public.audit_action
    end;

    insert into public.attendance_audit_logs (
      user_id, attendance_record_id, attendance_date, action,
      previous_values, new_values, reason
    ) values (
      new.user_id, new.id, new.attendance_date, v_action,
      null, v_next, coalesce(v_reason, new.correction_reason)
    );
    return new;
  end if;

  -- ---------------------------------------------------------------- DELETE --
  if tg_op = 'DELETE' then
    -- When the account itself is deleted, the cascade reaches these rows while
    -- auth.users is already losing the owner. Writing an audit entry then would
    -- violate its own user_id foreign key — and would be pointless, since the
    -- audit log cascades away with the account too.
    if not exists (select 1 from auth.users u where u.id = old.user_id) then
      return old;
    end if;

    -- attendance_record_id is deliberately left null here. This is an AFTER
    -- DELETE trigger, so the row it would point at is already gone and the
    -- foreign key would reject the insert. Nothing is lost: `previous_values`
    -- carries the entire old row, its id included, and attendance_date keeps
    -- the entry findable by day.
    insert into public.attendance_audit_logs (
      user_id, attendance_record_id, attendance_date, action,
      previous_values, new_values, reason
    ) values (
      old.user_id, null, old.attendance_date, 'delete',
      to_jsonb(old), null, v_reason
    );
    return old;
  end if;

  -- ---------------------------------------------------------------- UPDATE --
  -- Record only the columns that actually moved, so the log stays readable and
  -- a no-op write generates no noise.
  v_prev := '{}'::jsonb;
  v_next := '{}'::jsonb;

  if new.check_in_at is distinct from old.check_in_at then
    v_prev := v_prev || jsonb_build_object('check_in_at', old.check_in_at);
    v_next := v_next || jsonb_build_object('check_in_at', new.check_in_at);
  end if;
  if new.check_out_at is distinct from old.check_out_at then
    v_prev := v_prev || jsonb_build_object('check_out_at', old.check_out_at);
    v_next := v_next || jsonb_build_object('check_out_at', new.check_out_at);
  end if;
  if new.attendance_date is distinct from old.attendance_date then
    v_prev := v_prev || jsonb_build_object('attendance_date', old.attendance_date);
    v_next := v_next || jsonb_build_object('attendance_date', new.attendance_date);
  end if;
  if new.note is distinct from old.note then
    v_prev := v_prev || jsonb_build_object('note', old.note);
    v_next := v_next || jsonb_build_object('note', new.note);
  end if;
  if new.check_in_source is distinct from old.check_in_source then
    v_prev := v_prev || jsonb_build_object('check_in_source', old.check_in_source);
    v_next := v_next || jsonb_build_object('check_in_source', new.check_in_source);
  end if;
  if new.check_out_source is distinct from old.check_out_source then
    v_prev := v_prev || jsonb_build_object('check_out_source', old.check_out_source);
    v_next := v_next || jsonb_build_object('check_out_source', new.check_out_source);
  end if;

  if v_next = '{}'::jsonb then
    return new;   -- nothing meaningful changed
  end if;

  -- Durations are derived, but recording them makes the log self-explanatory.
  if old.duration_minutes is distinct from new.duration_minutes then
    v_prev := v_prev || jsonb_build_object('duration_minutes', old.duration_minutes);
    v_next := v_next || jsonb_build_object('duration_minutes', new.duration_minutes);
  end if;

  -- An explicit hint from the calling RPC wins. Otherwise infer: a record that
  -- has just been flagged as corrected is a correction, a freshly populated
  -- check-out is a check-out, anything else is a plain update.
  if v_hint = 'manual_correction' then
    v_action := 'manual_correction';
  elsif v_hint = 'check_out' then
    v_action := 'check_out';
  elsif new.manual_correction and not old.manual_correction then
    v_action := 'manual_correction';
  elsif old.check_out_at is null and new.check_out_at is not null then
    v_action := 'check_out';
  else
    v_action := 'update';
  end if;

  insert into public.attendance_audit_logs (
    user_id, attendance_record_id, attendance_date, action,
    previous_values, new_values, reason
  ) values (
    new.user_id, new.id, new.attendance_date, v_action, v_prev, v_next, v_reason
  );

  return new;
end;
$$;

-- AFTER, so the row has already passed every CHECK constraint before it is
-- written to the log.
drop trigger if exists attendance_audit_insert on public.attendance_records;
create trigger attendance_audit_insert
  after insert on public.attendance_records
  for each row execute function public.fn_audit_attendance();

drop trigger if exists attendance_audit_update on public.attendance_records;
create trigger attendance_audit_update
  after update on public.attendance_records
  for each row execute function public.fn_audit_attendance();

drop trigger if exists attendance_audit_delete on public.attendance_records;
create trigger attendance_audit_delete
  after delete on public.attendance_records
  for each row execute function public.fn_audit_attendance();
