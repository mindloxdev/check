/**
 * Data access layer. Every Supabase call the app makes lives here, so the React
 * tree never talks to the network directly and error shapes are normalised in
 * exactly one place.
 */

import type {
  AttendanceRecordRow,
  AttendanceSource,
  AuditLogRow,
  HolidayRow,
  LeaveRecordRow,
  LeaveType,
  ProfileRow,
  ProfileUpdate,
  VerificationStatus,
} from '@/types/database'
import { requireSupabase } from './supabase'
import { toAppError } from './errors'
import type { DateKey } from './tz'
import type { DayStatus } from './attendance'

/** Unwraps a Supabase result, translating the error on the way out. */
function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw toAppError(result.error)
  return result.data
}

/**
 * Unwraps a result that must carry a row.
 *
 * Supabase types `data` as nullable on every call because it is null whenever
 * `error` is set. For a write that returns the row it just wrote, a null with no
 * error means something is wrong server-side, and failing here is far better
 * than letting `undefined` propagate into the UI as a blank time.
 */
function unwrapRequired<T>(result: { data: T | null; error: unknown }, what: string): T {
  if (result.error) throw toAppError(result.error)
  if (result.data == null) {
    throw toAppError(new Error(`The server did not return ${what}.`))
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export interface ServerClockSample {
  /** Server instant at the moment the request was handled. */
  serverNow: Date
  /**
   * serverNow minus the device clock at the midpoint of the round trip. Add it
   * to `Date.now()` to get a server-aligned time without another request.
   */
  offsetMs: number
  roundTripMs: number
}

/**
 * Samples the database clock and derives the device-to-server offset.
 *
 * The server timestamp is taken to apply at the midpoint of the round trip,
 * which is the standard NTP-style estimate and keeps the error below half the
 * latency rather than the full latency.
 */
export async function fetchServerClock(): Promise<ServerClockSample> {
  const supabase = requireSupabase()
  const sentAt = Date.now()
  const result = await supabase.rpc('server_now')
  const receivedAt = Date.now()
  const iso = unwrap(result)

  const serverMs = typeof iso === 'string' ? new Date(iso).getTime() : Number.NaN
  if (!Number.isFinite(serverMs)) {
    throw toAppError(new Error('The server returned an unreadable timestamp.'))
  }

  const roundTripMs = receivedAt - sentAt
  const midpoint = sentAt + roundTripMs / 2
  return {
    serverNow: new Date(serverMs),
    offsetMs: serverMs - midpoint,
    roundTripMs,
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function ensureProfile(): Promise<ProfileRow> {
  const supabase = requireSupabase()
  return unwrapRequired(await supabase.rpc('ensure_profile'), 'your profile')
}

export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<ProfileRow> {
  const supabase = requireSupabase()
  return unwrapRequired(
    await supabase
      .from('profiles')
      .update(patch)
      .eq('user_id', userId)
      .select()
      .single(),
    'the updated profile',
  )
}

// ---------------------------------------------------------------------------
// Attendance reads
// ---------------------------------------------------------------------------

export async function fetchOpenSession(): Promise<AttendanceRecordRow | null> {
  const supabase = requireSupabase()
  // `.maybeSingle()` because a composite-returning function yields null when
  // there is no open session, which `.single()` would treat as an error.
  const result = await supabase.rpc('open_session')
  const row = unwrap(result)
  // A null composite comes back as an object of all-null fields on some
  // PostgREST versions; treat a row without an id as "none".
  return row && row.id ? row : null
}

export async function fetchRecordsBetween(
  from: DateKey,
  to: DateKey,
): Promise<AttendanceRecordRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('attendance_records')
        .select('*')
        .gte('attendance_date', from)
        .lte('attendance_date', to)
        .order('attendance_date', { ascending: true })
        .order('session_index', { ascending: true }),
    ) ?? []
  )
}

export async function fetchRecordsForDate(date: DateKey): Promise<AttendanceRecordRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('attendance_records')
        .select('*')
        .eq('attendance_date', date)
        .order('session_index', { ascending: true }),
    ) ?? []
  )
}

export interface HistoryQuery {
  /** Inclusive bounds, both optional. */
  from?: DateKey
  to?: DateKey
  /** Free-text date search, e.g. '2026-10' or '2026-10-14'. */
  datePrefix?: string
  page: number
  pageSize: number
  /** 'desc' newest first. */
  direction?: 'asc' | 'desc'
}

export interface HistoryPage {
  rows: AttendanceRecordRow[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export async function fetchHistoryPage(query: HistoryQuery): Promise<HistoryPage> {
  const supabase = requireSupabase()
  const pageSize = Math.min(Math.max(query.pageSize, 1), 200)
  const page = Math.max(query.page, 0)
  const ascending = query.direction === 'asc'

  let builder = supabase
    .from('attendance_records')
    .select('*', { count: 'exact' })
    .order('attendance_date', { ascending })
    .order('session_index', { ascending: true })
    .range(page * pageSize, page * pageSize + pageSize - 1)

  if (query.from) builder = builder.gte('attendance_date', query.from)
  if (query.to) builder = builder.lte('attendance_date', query.to)
  if (query.datePrefix) {
    // 'YYYY-MM' or a partial key: a prefix match on the ISO date column.
    builder = builder.like('attendance_date', `${query.datePrefix}%`)
  }

  const result = await builder
  if (result.error) throw toAppError(result.error)
  const rows = result.data ?? []
  const total = result.count ?? rows.length
  return {
    rows,
    total,
    page,
    pageSize,
    hasMore: (page + 1) * pageSize < total,
  }
}

/** Status filtering is a client-side concern: status is derived, not stored. */
export function filterByStatus<T extends { status: DayStatus }>(
  items: T[],
  statuses: DayStatus[],
): T[] {
  if (statuses.length === 0) return items
  const set = new Set(statuses)
  return items.filter((item) => set.has(item.status))
}

// ---------------------------------------------------------------------------
// Attendance writes
// ---------------------------------------------------------------------------

export interface CheckInArgs {
  verification: VerificationStatus
  source?: AttendanceSource
  note?: string | null
}

export async function checkIn(args: CheckInArgs): Promise<AttendanceRecordRow> {
  const supabase = requireSupabase()
  return unwrapRequired(
    await supabase
      .rpc('attendance_check_in', {
        p_verification: args.verification,
        // Sent only so the server can store the clock skew and the UI can warn
        // about a wrong phone clock. It never becomes the recorded time.
        p_client_now: new Date().toISOString(),
        p_source: args.source ?? 'app',
        p_note: args.note ?? null,
      }),
    'the check-in record',
  )
}

export async function checkOut(args: {
  verification: VerificationStatus
  source?: AttendanceSource
}): Promise<AttendanceRecordRow> {
  const supabase = requireSupabase()
  return unwrapRequired(
    await supabase
      .rpc('attendance_check_out', {
        p_verification: args.verification,
        p_client_now: new Date().toISOString(),
        p_source: args.source ?? 'app',
      }),
    'the check-out record',
  )
}

export interface ManualCorrectionArgs {
  date: DateKey
  /** 'HH:mm' in office time, or null to leave that side empty. */
  checkInLocal: string | null
  checkOutLocal: string | null
  reason: string
  sessionIndex?: number
  note?: string | null
  /** True when the shift ends after midnight. */
  checkOutNextDay?: boolean
}

export async function manualCorrection(
  args: ManualCorrectionArgs,
): Promise<AttendanceRecordRow> {
  const supabase = requireSupabase()
  return unwrapRequired(
    await supabase
      .rpc('attendance_manual_upsert', {
        p_date: args.date,
        p_check_in_local: args.checkInLocal,
        p_check_out_local: args.checkOutLocal,
        p_reason: args.reason,
        p_session_index: args.sessionIndex ?? 1,
        p_note: args.note ?? null,
        p_check_out_next_day: args.checkOutNextDay ?? false,
      }),
    'the corrected record',
  )
}

export async function deleteRecord(id: string, reason: string): Promise<void> {
  const supabase = requireSupabase()
  const result = await supabase.rpc('attendance_delete', { p_id: id, p_reason: reason })
  if (result.error) throw toAppError(result.error)
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function fetchAuditLog(recordId: string): Promise<AuditLogRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('attendance_audit_logs')
        .select('*')
        .eq('attendance_record_id', recordId)
        .order('created_at', { ascending: false })
        .limit(100),
    ) ?? []
  )
}

export async function fetchAuditLogForDate(date: DateKey): Promise<AuditLogRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('attendance_audit_logs')
        .select('*')
        .eq('attendance_date', date)
        .order('created_at', { ascending: false })
        .limit(100),
    ) ?? []
  )
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export async function fetchHolidaysBetween(
  from: DateKey,
  to: DateKey,
): Promise<HolidayRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('holidays')
        .select('*')
        .gte('holiday_date', from)
        .lte('holiday_date', to)
        .order('holiday_date', { ascending: true }),
    ) ?? []
  )
}

export async function fetchAllHolidays(): Promise<HolidayRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('holidays')
        .select('*')
        .order('holiday_date', { ascending: false })
        .limit(500),
    ) ?? []
  )
}

export async function addHoliday(
  userId: string,
  date: DateKey,
  name: string,
): Promise<HolidayRow> {
  const supabase = requireSupabase()
  return unwrapRequired(
    await supabase
      .from('holidays')
      .insert({ user_id: userId, holiday_date: date, holiday_name: name.trim() })
      .select()
      .single(),
    'the new holiday',
  )
}

export async function deleteHoliday(id: string): Promise<void> {
  const supabase = requireSupabase()
  const result = await supabase.from('holidays').delete().eq('id', id)
  if (result.error) throw toAppError(result.error)
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export async function fetchLeavesOverlapping(
  from: DateKey,
  to: DateKey,
): Promise<LeaveRecordRow[]> {
  const supabase = requireSupabase()
  // Overlap test: start <= rangeEnd AND end >= rangeStart.
  return (
    unwrap(
      await supabase
        .from('leave_records')
        .select('*')
        .lte('start_date', to)
        .gte('end_date', from)
        .order('start_date', { ascending: true }),
    ) ?? []
  )
}

export async function fetchAllLeaves(): Promise<LeaveRecordRow[]> {
  const supabase = requireSupabase()
  return (
    unwrap(
      await supabase
        .from('leave_records')
        .select('*')
        .order('start_date', { ascending: false })
        .limit(500),
    ) ?? []
  )
}

export async function addLeave(args: {
  userId: string
  startDate: DateKey
  endDate: DateKey
  leaveType: LeaveType
  notes?: string | null
}): Promise<LeaveRecordRow> {
  const supabase = requireSupabase()
  return unwrapRequired(
    await supabase
      .from('leave_records')
      .insert({
        user_id: args.userId,
        start_date: args.startDate,
        end_date: args.endDate,
        leave_type: args.leaveType,
        notes: args.notes?.trim() || null,
      })
      .select()
      .single(),
    'the new leave record',
  )
}

export async function deleteLeave(id: string): Promise<void> {
  const supabase = requireSupabase()
  const result = await supabase.from('leave_records').delete().eq('id', id)
  if (result.error) throw toAppError(result.error)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signInWithPassword(email: string, password: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw toAppError(error)
  return data
}

export async function signUpWithPassword(email: string, password: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: `${window.location.origin}/` },
  })
  if (error) throw toAppError(error)
  return data
}

export async function sendPasswordReset(email: string) {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw toAppError(error)
}

export async function updatePassword(password: string) {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw toAppError(error)
}

export async function signOut() {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.signOut()
  if (error) throw toAppError(error)
}
