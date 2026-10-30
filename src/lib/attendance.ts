/**
 * Attendance domain logic.
 *
 * Every function here is pure: given a record, a policy and a reference instant
 * it returns a classification. No network, no clock reads, no React. That is
 * what makes the behaviour in `attendance.test.ts` the real specification.
 */

import type {
  AttendanceRecordRow,
  PolicySnapshot,
  ProfileRow,
  VerificationStatus,
} from '@/types/database'
import {
  type DateKey,
  type IsoWeekday,
  type TimeKey,
  compareDateKeys,
  isTimeKey,
  minutesToTimeKey,
  resolveBusinessDate,
  timeKeyToMinutes,
  toMinuteOfDay,
  weekdayOfDateKey,
} from './tz'

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** The subset of settings that affects how a day is classified. */
export interface AttendancePolicy {
  timeZone: string
  expectedCheckIn: TimeKey
  expectedCheckOut: TimeKey
  gracePeriodMinutes: number
  workingDays: IsoWeekday[]
  officeName: string
  overnightEnabled: boolean
  dayCutoffHour: number
  multiSessionEnabled: boolean
}

export const DEFAULT_POLICY: AttendancePolicy = {
  timeZone: 'Asia/Karachi',
  expectedCheckIn: '09:00',
  expectedCheckOut: '17:00',
  gracePeriodMinutes: 10,
  workingDays: [1, 2, 3, 4, 5],
  officeName: 'My Office',
  overnightEnabled: false,
  dayCutoffHour: 4,
  multiSessionEnabled: false,
}

/** Postgres `time` arrives as 'HH:mm:ss'; the app works in 'HH:mm'. */
function normaliseTime(value: string | null | undefined, fallback: TimeKey): TimeKey {
  if (!value) return fallback
  const trimmed = value.trim()
  if (!isTimeKey(trimmed)) return fallback
  return minutesToTimeKey(timeKeyToMinutes(trimmed))
}

function normaliseWorkingDays(
  days: readonly number[] | null | undefined,
  fallback: IsoWeekday[],
): IsoWeekday[] {
  if (!days || days.length === 0) return fallback
  const valid = [...new Set(days)]
    .filter((d): d is IsoWeekday => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b)
  return valid.length > 0 ? valid : fallback
}

export function policyFromProfile(profile: ProfileRow): AttendancePolicy {
  return {
    timeZone: profile.timezone || DEFAULT_POLICY.timeZone,
    expectedCheckIn: normaliseTime(profile.expected_check_in, DEFAULT_POLICY.expectedCheckIn),
    expectedCheckOut: normaliseTime(profile.expected_check_out, DEFAULT_POLICY.expectedCheckOut),
    gracePeriodMinutes: Number.isFinite(profile.grace_period_minutes)
      ? Math.max(0, profile.grace_period_minutes)
      : DEFAULT_POLICY.gracePeriodMinutes,
    workingDays: normaliseWorkingDays(profile.working_days, DEFAULT_POLICY.workingDays),
    officeName: profile.office_name || DEFAULT_POLICY.officeName,
    overnightEnabled: Boolean(profile.overnight_enabled),
    dayCutoffHour: Number.isFinite(profile.day_cutoff_hour)
      ? profile.day_cutoff_hour
      : DEFAULT_POLICY.dayCutoffHour,
    multiSessionEnabled: Boolean(profile.multi_session_enabled),
  }
}

/**
 * The policy that applies to one historical record.
 *
 * Changing the expected arrival time today must not re-classify last month's
 * attendance, so the snapshot stored on the record wins whenever it is present.
 * Only the fields the snapshot actually carries are overridden — zone-level
 * settings such as overnight mode fall back to the live policy.
 */
export function effectivePolicyFor(
  record: Pick<AttendanceRecordRow, 'policy_snapshot'> | null | undefined,
  livePolicy: AttendancePolicy,
): AttendancePolicy {
  const snap: PolicySnapshot | undefined = record?.policy_snapshot ?? undefined
  if (!snap || Object.keys(snap).length === 0) return livePolicy
  return {
    ...livePolicy,
    timeZone: snap.timezone || livePolicy.timeZone,
    expectedCheckIn: normaliseTime(snap.expected_check_in, livePolicy.expectedCheckIn),
    expectedCheckOut: normaliseTime(snap.expected_check_out, livePolicy.expectedCheckOut),
    gracePeriodMinutes:
      typeof snap.grace_period_minutes === 'number' && snap.grace_period_minutes >= 0
        ? snap.grace_period_minutes
        : livePolicy.gracePeriodMinutes,
    workingDays: normaliseWorkingDays(snap.working_days, livePolicy.workingDays),
    officeName: snap.office_name || livePolicy.officeName,
  }
}

export function isWorkingDay(dateKey: DateKey, policy: AttendancePolicy): boolean {
  return policy.workingDays.includes(weekdayOfDateKey(dateKey))
}

// ---------------------------------------------------------------------------
// Day status
// ---------------------------------------------------------------------------

export const DAY_STATUSES = [
  'present',
  'late',
  'absent',
  'weekend',
  'holiday',
  'leave',
  'missing_check_in',
  'missing_check_out',
  'checked_in',
  'upcoming',
  'no_record_yet',
] as const

export type DayStatus = (typeof DAY_STATUSES)[number]

export interface LateArrival {
  /** Minutes past the scheduled arrival time (0 when early or on the dot). */
  minutesAfterSchedule: number
  /** Minutes past the end of the grace window. Zero means "within grace". */
  minutesAfterGrace: number
  /** True when `minutesAfterGrace > 0` — the single source of "is this late?". */
  isLate: boolean
}

export const NO_LATE_ARRIVAL: LateArrival = {
  minutesAfterSchedule: 0,
  minutesAfterGrace: 0,
  isLate: false,
}

/**
 * Late-arrival maths.
 *
 * With an expected arrival of 09:00 and a 10-minute grace period:
 *   08:45 → on time   (afterSchedule 0,  afterGrace 0)
 *   09:05 → on time   (afterSchedule 5,  afterGrace 0)
 *   09:10 → on time   (afterSchedule 10, afterGrace 0)  ← grace is inclusive
 *   09:11 → LATE      (afterSchedule 11, afterGrace 1)
 *   09:30 → LATE      (afterSchedule 30, afterGrace 20)
 *
 * Reports show `minutesAfterSchedule` in the "Late By" column, but only for days
 * that are actually late; an on-time arrival inside the grace window reads 0.
 * `minutesAfterGrace` is shown in the day detail so both numbers are visible and
 * the policy is never ambiguous.
 */
export function computeLateArrival(
  checkInAt: Date,
  policy: AttendancePolicy,
): LateArrival {
  const arrivalMinutes = toMinuteOfDay(checkInAt, policy.timeZone)
  const expectedMinutes = timeKeyToMinutes(policy.expectedCheckIn)

  let delta = arrivalMinutes - expectedMinutes
  // An arrival recorded after midnight on an overnight shift reads as a hugely
  // negative delta; treat it as "next day", not as 23 hours early.
  if (delta < -720) delta += 1440

  const minutesAfterSchedule = Math.max(0, delta)
  const minutesAfterGrace = Math.max(0, minutesAfterSchedule - policy.gracePeriodMinutes)
  return {
    minutesAfterSchedule,
    minutesAfterGrace,
    isLate: minutesAfterGrace > 0,
  }
}

/** Minutes left early relative to the expected departure time. */
export function computeEarlyDeparture(
  checkOutAt: Date,
  policy: AttendancePolicy,
): number {
  const departureMinutes = toMinuteOfDay(checkOutAt, policy.timeZone)
  const expectedMinutes = timeKeyToMinutes(policy.expectedCheckOut)
  let delta = expectedMinutes - departureMinutes
  // Checked out after midnight — not early at all.
  if (delta > 720) delta -= 1440
  return Math.max(0, delta)
}

export interface HolidayInfo {
  date: DateKey
  name: string
}

export interface LeaveInfo {
  date: DateKey
  leaveType: string
  notes: string | null
}

export interface DayContext {
  dateKey: DateKey
  /** All sessions recorded for the day, in chronological order. */
  records: AttendanceRecordRow[]
  holiday?: HolidayInfo
  leave?: LeaveInfo
  /** Live policy; per-record snapshots still take precedence where present. */
  policy: AttendancePolicy
  /** Today's business date, used to avoid classifying the future as absent. */
  today: DateKey
}

export interface DaySummary {
  dateKey: DateKey
  weekday: IsoWeekday
  status: DayStatus
  /** The session that defines the day (the first one with a check-in). */
  primaryRecord: AttendanceRecordRow | null
  records: AttendanceRecordRow[]
  checkInAt: Date | null
  checkOutAt: Date | null
  /** Sum of completed sessions, in minutes. */
  workedMinutes: number | null
  late: LateArrival
  earlyDepartureMinutes: number
  isWorkingDay: boolean
  isHoliday: boolean
  isLeave: boolean
  holidayName: string | null
  leaveType: string | null
  manuallyCorrected: boolean
  verification: {
    checkIn: VerificationStatus | null
    checkOut: VerificationStatus | null
  }
  /** Policy actually used for this day's classification. */
  policy: AttendancePolicy
  /** True when attendance was recorded on a non-working day or holiday. */
  workedOnNonWorkingDay: boolean
}

function parseInstant(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Classifies one calendar day.
 *
 * Precedence, in order:
 *   1. A day with any recorded check-in is classified from the record, even if
 *      it is a holiday, a weekend or a leave day — you were there, and the
 *      report says so (flagged via `workedOnNonWorkingDay`).
 *   2. A record with only a check-out is "Missing Check-In".
 *   3. Otherwise holiday → leave → non-working day.
 *   4. A scheduled working day in the future, or today before any check-in, is
 *      never "absent".
 *   5. A scheduled working day already in the past with no record is "absent".
 */
export function summariseDay(ctx: DayContext): DaySummary {
  const { dateKey, holiday, leave, today } = ctx
  const weekday = weekdayOfDateKey(dateKey)

  const records = [...ctx.records].sort((a, b) => a.session_index - b.session_index)
  const primaryRecord =
    records.find((r) => r.check_in_at !== null) ?? records[0] ?? null

  const policy = effectivePolicyFor(primaryRecord, ctx.policy)
  const working = policy.workingDays.includes(weekday)

  const firstCheckIn = records.find((r) => r.check_in_at)?.check_in_at ?? null
  // The day's departure is the last completed session's check-out.
  const closed = records.filter((r) => r.check_out_at)
  const lastCheckOut = closed.length > 0 ? closed[closed.length - 1]!.check_out_at : null

  const checkInAt = parseInstant(firstCheckIn)
  const checkOutAt = parseInstant(lastCheckOut)

  const completed = records.filter((r) => r.duration_minutes != null)
  const workedMinutes =
    completed.length > 0
      ? completed.reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0)
      : null

  const late = checkInAt ? computeLateArrival(checkInAt, policy) : NO_LATE_ARRIVAL
  const earlyDepartureMinutes =
    checkOutAt && checkInAt ? computeEarlyDeparture(checkOutAt, policy) : 0

  const hasOpenSession = records.some((r) => r.check_in_at && !r.check_out_at)
  const isPast = compareDateKeys(dateKey, today) < 0
  const isFuture = compareDateKeys(dateKey, today) > 0

  let status: DayStatus
  if (checkInAt) {
    if (hasOpenSession) {
      // Still open: only a past day counts as a forgotten check-out.
      status = isPast ? 'missing_check_out' : 'checked_in'
    } else {
      status = late.isLate ? 'late' : 'present'
    }
  } else if (checkOutAt) {
    status = 'missing_check_in'
  } else if (holiday) {
    status = 'holiday'
  } else if (leave) {
    status = 'leave'
  } else if (!working) {
    status = 'weekend'
  } else if (isFuture) {
    status = 'upcoming'
  } else if (isPast) {
    status = 'absent'
  } else {
    status = 'no_record_yet'
  }

  return {
    dateKey,
    weekday,
    status,
    primaryRecord,
    records,
    checkInAt,
    checkOutAt,
    workedMinutes,
    late,
    earlyDepartureMinutes,
    isWorkingDay: working,
    isHoliday: Boolean(holiday),
    isLeave: Boolean(leave),
    holidayName: holiday?.name ?? null,
    leaveType: leave?.leaveType ?? null,
    manuallyCorrected: records.some((r) => r.manual_correction),
    verification: {
      checkIn: primaryRecord?.check_in_verification_status ?? null,
      checkOut:
        closed.length > 0
          ? (closed[closed.length - 1]!.check_out_verification_status ?? null)
          : null,
    },
    policy,
    workedOnNonWorkingDay: Boolean(checkInAt) && (!working || Boolean(holiday) || Boolean(leave)),
  }
}

// ---------------------------------------------------------------------------
// Live dashboard state
// ---------------------------------------------------------------------------

export type LiveStatus =
  | 'not_checked_in'
  | 'checked_in'
  | 'checked_out'
  | 'incomplete'

export interface LiveState {
  status: LiveStatus
  /** The session the action buttons operate on. */
  activeRecord: AttendanceRecordRow | null
  /** Business date the next check-in would be filed under. */
  businessDate: DateKey
  checkInAt: Date | null
  checkOutAt: Date | null
  /** Elapsed time for an open session, completed duration for a closed one. */
  elapsedMinutes: number | null
  late: LateArrival
  canCheckIn: boolean
  canCheckOut: boolean
  /**
   * Set when the open session began on an earlier business date — the user
   * forgot to check out, so the UI must say so rather than silently showing a
   * 30-hour "elapsed" counter.
   */
  staleOpenSessionFrom: DateKey | null
}

export interface LiveStateInput {
  /** Server-derived now. Never `new Date()` from the device. */
  now: Date
  /** Records for the current business date (any session count). */
  todayRecords: AttendanceRecordRow[]
  /** The open session, from any date, as returned by `open_session()`. */
  openSession: AttendanceRecordRow | null
  policy: AttendancePolicy
}

export function deriveLiveState(input: LiveStateInput): LiveState {
  const { now, policy } = input
  const businessDate = resolveBusinessDate(now, policy.timeZone, {
    overnightEnabled: policy.overnightEnabled,
    dayCutoffHour: policy.dayCutoffHour,
  })

  const open = input.openSession
  const todayRecords = [...input.todayRecords].sort(
    (a, b) => a.session_index - b.session_index,
  )

  if (open) {
    const checkInAt = parseInstant(open.check_in_at)
    const elapsedMinutes = checkInAt
      ? Math.max(0, Math.floor((now.getTime() - checkInAt.getTime()) / 60_000))
      : null
    const recordPolicy = effectivePolicyFor(open, policy)
    return {
      status: 'checked_in',
      activeRecord: open,
      businessDate,
      checkInAt,
      checkOutAt: null,
      elapsedMinutes,
      late: checkInAt ? computeLateArrival(checkInAt, recordPolicy) : NO_LATE_ARRIVAL,
      canCheckIn: false,
      canCheckOut: true,
      staleOpenSessionFrom:
        open.attendance_date !== businessDate ? open.attendance_date : null,
    }
  }

  const closed = todayRecords.filter((r) => r.check_out_at)
  const lastClosed = closed.length > 0 ? closed[closed.length - 1]! : null
  const checkOutOnly = todayRecords.find((r) => !r.check_in_at && r.check_out_at)

  if (lastClosed) {
    const first = todayRecords.find((r) => r.check_in_at) ?? lastClosed
    const checkInAt = parseInstant(first.check_in_at)
    const checkOutAt = parseInstant(lastClosed.check_out_at)
    const recordPolicy = effectivePolicyFor(first, policy)
    const totalMinutes = todayRecords
      .filter((r) => r.duration_minutes != null)
      .reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0)

    return {
      status: checkInAt ? 'checked_out' : 'incomplete',
      activeRecord: lastClosed,
      businessDate,
      checkInAt,
      checkOutAt,
      elapsedMinutes: checkInAt ? totalMinutes : null,
      late: checkInAt ? computeLateArrival(checkInAt, recordPolicy) : NO_LATE_ARRIVAL,
      // Re-checking in on the same day requires multi-session mode.
      canCheckIn: policy.multiSessionEnabled,
      canCheckOut: false,
      staleOpenSessionFrom: null,
    }
  }

  if (checkOutOnly) {
    return {
      status: 'incomplete',
      activeRecord: checkOutOnly,
      businessDate,
      checkInAt: null,
      checkOutAt: parseInstant(checkOutOnly.check_out_at),
      elapsedMinutes: null,
      late: NO_LATE_ARRIVAL,
      canCheckIn: false,
      canCheckOut: false,
      staleOpenSessionFrom: null,
    }
  }

  return {
    status: 'not_checked_in',
    activeRecord: null,
    businessDate,
    checkInAt: null,
    checkOutAt: null,
    elapsedMinutes: null,
    late: NO_LATE_ARRIVAL,
    canCheckIn: true,
    canCheckOut: false,
    staleOpenSessionFrom: null,
  }
}

// ---------------------------------------------------------------------------
// Presentation metadata (labels and token names — no hex values)
// ---------------------------------------------------------------------------

export interface StatusPresentation {
  label: string
  /** Tailwind classes for a soft badge. */
  badgeClass: string
  /** Solid colour used for calendar cells and chart marks. */
  dotClass: string
  /** Lucide icon name, resolved by `StatusBadge`. */
  icon: 'check' | 'clock' | 'x' | 'moon' | 'party' | 'plane' | 'login' | 'logout' | 'dash'
}

export const STATUS_PRESENTATION: Record<DayStatus, StatusPresentation> = {
  present: {
    label: 'Present',
    badgeClass: 'bg-success-soft text-success-soft-foreground border-success/20',
    dotClass: 'bg-success',
    icon: 'check',
  },
  late: {
    label: 'Late',
    badgeClass: 'bg-warning-soft text-warning-soft-foreground border-warning/20',
    dotClass: 'bg-warning',
    icon: 'clock',
  },
  absent: {
    label: 'Absent',
    badgeClass: 'bg-destructive-soft text-destructive-soft-foreground border-destructive/20',
    dotClass: 'bg-destructive',
    icon: 'x',
  },
  weekend: {
    label: 'Weekend',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-muted-foreground/35',
    icon: 'moon',
  },
  holiday: {
    label: 'Holiday',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-muted-foreground/35',
    icon: 'party',
  },
  leave: {
    label: 'Leave',
    badgeClass: 'bg-info-soft text-info-soft-foreground border-info/20',
    dotClass: 'bg-info',
    icon: 'plane',
  },
  missing_check_in: {
    label: 'Missing Check-In',
    badgeClass: 'bg-caution-soft text-caution-soft-foreground border-caution/20',
    dotClass: 'bg-caution',
    icon: 'login',
  },
  missing_check_out: {
    label: 'Missing Check-Out',
    badgeClass: 'bg-caution-soft text-caution-soft-foreground border-caution/20',
    dotClass: 'bg-caution',
    icon: 'logout',
  },
  checked_in: {
    label: 'Checked In',
    badgeClass: 'bg-primary-soft text-primary border-primary/20',
    dotClass: 'bg-primary',
    icon: 'login',
  },
  upcoming: {
    label: 'Upcoming',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-transparent',
    icon: 'dash',
  },
  no_record_yet: {
    label: 'Not Checked In',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-transparent',
    icon: 'dash',
  },
}

export const LIVE_STATUS_LABEL: Record<LiveStatus, string> = {
  not_checked_in: 'Not Checked In',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  incomplete: 'Attendance Incomplete',
}

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: 'Office network verified',
  unverified: 'Not verified',
  failed: 'Verification failed',
  not_configured: 'Verification not set up',
}

/** Statuses that represent a day the user was actually at the office. */
export const ATTENDED_STATUSES: ReadonlySet<DayStatus> = new Set<DayStatus>([
  'present',
  'late',
  'checked_in',
  'missing_check_out',
])
