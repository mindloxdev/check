/**
 * Monthly report aggregation.
 *
 * Pure functions over already-fetched rows. The statistics here are what the
 * Reports page, the calendar, the CSV/XLSX/PDF exports and the print view all
 * read from, so there is exactly one definition of "days absent" in the app.
 */

import type {
  AttendanceRecordRow,
  HolidayRow,
  LeaveRecordRow,
} from '@/types/database'
import {
  ATTENDED_STATUSES,
  type AttendancePolicy,
  type DayStatus,
  type DaySummary,
  type HolidayInfo,
  type LeaveInfo,
  summariseDay,
} from './attendance'
import {
  type DateKey,
  type IsoWeekday,
  compareDateKeys,
  datesBetween,
  datesInMonth,
  formatMonthLabel,
  makeDateKey,
  minutesToTimeKey,
  resolveBusinessDate,
  toMinuteOfDay,
  weekdayOfDateKey,
} from './tz'

export interface MonthRef {
  year: number
  /** 1-12. */
  month: number
}

export interface ReportInput {
  month: MonthRef
  records: AttendanceRecordRow[]
  holidays: HolidayRow[]
  leaves: LeaveRecordRow[]
  policy: AttendancePolicy
  /** Server-derived "now". Determines which days count as past. */
  now: Date
}

export interface MonthlyStats {
  /** Scheduled working days in the month, excluding holidays and leave. */
  scheduledWorkingDays: number
  /** Scheduled working days that have already passed (today included). */
  scheduledWorkingDaysElapsed: number
  daysWithAttendance: number
  daysAbsent: number
  daysLate: number
  daysMissingCheckIn: number
  daysMissingCheckOut: number
  daysOnLeave: number
  holidayCount: number
  weekendCount: number
  /** Days attended that were not scheduled working days. */
  daysWorkedOffSchedule: number

  totalWorkedMinutes: number
  /** Mean over days with a completed duration. */
  averageWorkedMinutes: number | null

  /** 'HH:mm' mean arrival across days with a check-in, or null. */
  averageCheckIn: string | null
  averageCheckOut: string | null

  /** Sum of minutes past scheduled arrival, counted only on late days. */
  totalLateMinutes: number
  /** Sum of minutes past the end of the grace window. */
  totalLateMinutesBeyondGrace: number
  /** Sum of minutes left before the expected departure. */
  totalEarlyDepartureMinutes: number

  manuallyCorrectedDays: number
  verifiedCheckIns: number
  unverifiedCheckIns: number

  /** Share of elapsed scheduled days that were attended, 0-100. */
  attendanceRate: number | null
  /** Share of attended days that were on time, 0-100. */
  punctualityRate: number | null
}

export interface MonthlyReport {
  month: MonthRef
  label: string
  policy: AttendancePolicy
  days: DaySummary[]
  stats: MonthlyStats
  /** Business date of "today" in office time, for highlighting. */
  today: DateKey
  /** First and last day of the month. */
  range: { from: DateKey; to: DateKey }
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

export function indexRecordsByDate(
  records: AttendanceRecordRow[],
): Map<DateKey, AttendanceRecordRow[]> {
  const map = new Map<DateKey, AttendanceRecordRow[]>()
  for (const record of records) {
    const list = map.get(record.attendance_date)
    if (list) list.push(record)
    else map.set(record.attendance_date, [record])
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.session_index - b.session_index)
  }
  return map
}

export function indexHolidays(holidays: HolidayRow[]): Map<DateKey, HolidayInfo> {
  const map = new Map<DateKey, HolidayInfo>()
  for (const h of holidays) {
    map.set(h.holiday_date, { date: h.holiday_date, name: h.holiday_name })
  }
  return map
}

/** Expands each leave range into the individual days it covers. */
export function indexLeaves(leaves: LeaveRecordRow[]): Map<DateKey, LeaveInfo> {
  const map = new Map<DateKey, LeaveInfo>()
  for (const leave of leaves) {
    for (const day of datesBetween(leave.start_date, leave.end_date)) {
      map.set(day, { date: day, leaveType: leave.leave_type, notes: leave.notes })
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Day summaries
// ---------------------------------------------------------------------------

export interface SummariseRangeInput {
  dates: DateKey[]
  records: AttendanceRecordRow[]
  holidays: HolidayRow[]
  leaves: LeaveRecordRow[]
  policy: AttendancePolicy
  now: Date
}

export function summariseRange(input: SummariseRangeInput): DaySummary[] {
  const byDate = indexRecordsByDate(input.records)
  const holidays = indexHolidays(input.holidays)
  const leaves = indexLeaves(input.leaves)
  const today = resolveBusinessDate(input.now, input.policy.timeZone, {
    overnightEnabled: input.policy.overnightEnabled,
    dayCutoffHour: input.policy.dayCutoffHour,
  })

  return input.dates.map((dateKey) =>
    summariseDay({
      dateKey,
      records: byDate.get(dateKey) ?? [],
      holiday: holidays.get(dateKey),
      leave: leaves.get(dateKey),
      policy: input.policy,
      today,
    }),
  )
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Averages a set of wall-clock times.
 *
 * A plain mean of "minutes since midnight" is correct for office hours, which
 * never wrap midnight. For a set that does wrap (an overnight shift), the mean
 * is computed on the unit circle instead, so 23:50 and 00:10 average to 00:00
 * rather than to noon.
 */
export function averageMinuteOfDay(minutes: number[]): number | null {
  if (minutes.length === 0) return null
  const min = Math.min(...minutes)
  const max = Math.max(...minutes)
  if (max - min <= 720) {
    const sum = minutes.reduce((a, b) => a + b, 0)
    return Math.round(sum / minutes.length)
  }
  let x = 0
  let y = 0
  for (const m of minutes) {
    const angle = (m / 1440) * 2 * Math.PI
    x += Math.cos(angle)
    y += Math.sin(angle)
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null
  let angle = Math.atan2(y / minutes.length, x / minutes.length)
  if (angle < 0) angle += 2 * Math.PI
  return Math.round((angle / (2 * Math.PI)) * 1440) % 1440
}

export function computeStats(days: DaySummary[], today: DateKey): MonthlyStats {
  let scheduledWorkingDays = 0
  let scheduledWorkingDaysElapsed = 0
  let daysWithAttendance = 0
  let daysAbsent = 0
  let daysLate = 0
  let daysMissingCheckIn = 0
  let daysMissingCheckOut = 0
  let daysOnLeave = 0
  let holidayCount = 0
  let weekendCount = 0
  let daysWorkedOffSchedule = 0
  let totalWorkedMinutes = 0
  let completedDays = 0
  let totalLateMinutes = 0
  let totalLateMinutesBeyondGrace = 0
  let totalEarlyDepartureMinutes = 0
  let manuallyCorrectedDays = 0
  let verifiedCheckIns = 0
  let unverifiedCheckIns = 0

  const checkInMinutes: number[] = []
  const checkOutMinutes: number[] = []

  for (const day of days) {
    const isPastOrToday = compareDateKeys(day.dateKey, today) <= 0

    // A holiday or an approved leave day is not a scheduled working day: it must
    // not inflate the denominator or count as an absence.
    const scheduled = day.isWorkingDay && !day.isHoliday && !day.isLeave
    if (scheduled) {
      scheduledWorkingDays += 1
      if (isPastOrToday) scheduledWorkingDaysElapsed += 1
    }

    if (day.isHoliday) holidayCount += 1
    else if (day.isLeave) daysOnLeave += 1
    else if (!day.isWorkingDay) weekendCount += 1

    if (ATTENDED_STATUSES.has(day.status)) {
      daysWithAttendance += 1
      if (day.workedOnNonWorkingDay) daysWorkedOffSchedule += 1
    }

    switch (day.status) {
      case 'late':
        daysLate += 1
        break
      case 'absent':
        daysAbsent += 1
        break
      case 'missing_check_in':
        daysMissingCheckIn += 1
        break
      case 'missing_check_out':
        daysMissingCheckOut += 1
        break
      default:
        break
    }

    if (day.late.isLate) {
      totalLateMinutes += day.late.minutesAfterSchedule
      totalLateMinutesBeyondGrace += day.late.minutesAfterGrace
    }
    totalEarlyDepartureMinutes += day.earlyDepartureMinutes

    if (day.workedMinutes != null) {
      totalWorkedMinutes += day.workedMinutes
      completedDays += 1
    }

    if (day.checkInAt) {
      checkInMinutes.push(toMinuteOfDay(day.checkInAt, day.policy.timeZone))
      if (day.verification.checkIn === 'verified') verifiedCheckIns += 1
      else unverifiedCheckIns += 1
    }
    if (day.checkOutAt) {
      checkOutMinutes.push(toMinuteOfDay(day.checkOutAt, day.policy.timeZone))
    }

    if (day.manuallyCorrected) manuallyCorrectedDays += 1
  }

  const avgIn = averageMinuteOfDay(checkInMinutes)
  const avgOut = averageMinuteOfDay(checkOutMinutes)

  const attendanceRate =
    scheduledWorkingDaysElapsed > 0
      ? Math.round(
          (Math.min(daysWithAttendance, scheduledWorkingDaysElapsed) /
            scheduledWorkingDaysElapsed) *
            1000,
        ) / 10
      : null

  const punctualityRate =
    daysWithAttendance > 0
      ? Math.round(((daysWithAttendance - daysLate) / daysWithAttendance) * 1000) / 10
      : null

  return {
    scheduledWorkingDays,
    scheduledWorkingDaysElapsed,
    daysWithAttendance,
    daysAbsent,
    daysLate,
    daysMissingCheckIn,
    daysMissingCheckOut,
    daysOnLeave,
    holidayCount,
    weekendCount,
    daysWorkedOffSchedule,
    totalWorkedMinutes,
    averageWorkedMinutes:
      completedDays > 0 ? Math.round(totalWorkedMinutes / completedDays) : null,
    averageCheckIn: avgIn == null ? null : minutesToTimeKey(avgIn),
    averageCheckOut: avgOut == null ? null : minutesToTimeKey(avgOut),
    totalLateMinutes,
    totalLateMinutesBeyondGrace,
    totalEarlyDepartureMinutes,
    manuallyCorrectedDays,
    verifiedCheckIns,
    unverifiedCheckIns,
    attendanceRate,
    punctualityRate,
  }
}

export function buildMonthlyReport(input: ReportInput): MonthlyReport {
  const { year, month } = input.month
  const dates = datesInMonth(year, month)
  const today = resolveBusinessDate(input.now, input.policy.timeZone, {
    overnightEnabled: input.policy.overnightEnabled,
    dayCutoffHour: input.policy.dayCutoffHour,
  })

  const days = summariseRange({
    dates,
    records: input.records,
    holidays: input.holidays,
    leaves: input.leaves,
    policy: input.policy,
    now: input.now,
  })

  return {
    month: input.month,
    label: formatMonthLabel(year, month),
    policy: input.policy,
    days,
    stats: computeStats(days, today),
    today,
    range: {
      from: dates[0] ?? makeDateKey(year, month, 1),
      to: dates[dates.length - 1] ?? makeDateKey(year, month, 1),
    },
  }
}

// ---------------------------------------------------------------------------
// Month navigation
// ---------------------------------------------------------------------------

export function monthOf(dateKey: DateKey): MonthRef {
  const [y, m] = dateKey.split('-')
  return { year: Number(y), month: Number(m) }
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const zeroBased = ref.year * 12 + (ref.month - 1) + delta
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 }
}

export function compareMonths(a: MonthRef, b: MonthRef): number {
  if (a.year !== b.year) return a.year - b.year
  return a.month - b.month
}

export function monthRange(ref: MonthRef): { from: DateKey; to: DateKey } {
  const dates = datesInMonth(ref.year, ref.month)
  return { from: dates[0]!, to: dates[dates.length - 1]! }
}

export function isCurrentOrPastMonth(ref: MonthRef, today: DateKey): boolean {
  return compareMonths(ref, monthOf(today)) <= 0
}

// ---------------------------------------------------------------------------
// Monthly closing / reminder
// ---------------------------------------------------------------------------

export interface MonthlyReviewState {
  /** The month the reminder is about. */
  month: MonthRef
  label: string
  /** True once the reporting day of the following month has arrived. */
  isAvailable: boolean
  /** Business date on which the review unlocks. */
  availableFrom: DateKey
  /** True when it is exactly the reporting day — the moment to nudge. */
  isDueToday: boolean
}

/**
 * Which month is "the one to review", and is it time yet?
 *
 * With the default reporting day of 5, October's report becomes reviewable on
 * November 5. Before that, the previous month is still the month under review
 * but `isAvailable` is false.
 */
export function monthlyReviewState(today: DateKey, reportingDay: number): MonthlyReviewState {
  const current = monthOf(today)
  const dayOfMonth = Number(today.slice(8, 10))
  const clampedReportingDay = Math.min(Math.max(Math.round(reportingDay) || 1, 1), 28)

  // Before the reporting day, the month awaiting review is two months back.
  const target =
    dayOfMonth >= clampedReportingDay ? shiftMonth(current, -1) : shiftMonth(current, -2)
  const unlockMonth = shiftMonth(target, 1)
  const availableFrom = makeDateKey(unlockMonth.year, unlockMonth.month, clampedReportingDay)

  return {
    month: target,
    label: formatMonthLabel(target.year, target.month),
    isAvailable: compareDateKeys(today, availableFrom) >= 0,
    availableFrom,
    isDueToday: dayOfMonth === clampedReportingDay,
  }
}

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

export interface DailyHoursPoint {
  dateKey: DateKey
  dayOfMonth: number
  label: string
  hours: number | null
  targetHours: number
  status: DayStatus
  lateMinutes: number
}

/** Daily worked-hours series for the monthly trend chart. */
export function dailyHoursSeries(report: MonthlyReport): DailyHoursPoint[] {
  const { expectedCheckIn, expectedCheckOut } = report.policy
  const [inH = '9', inM = '0'] = expectedCheckIn.split(':')
  const [outH = '17', outM = '0'] = expectedCheckOut.split(':')
  let targetMinutes =
    (Number(outH) * 60 + Number(outM)) - (Number(inH) * 60 + Number(inM))
  if (targetMinutes <= 0) targetMinutes += 1440

  return report.days.map((day) => ({
    dateKey: day.dateKey,
    dayOfMonth: Number(day.dateKey.slice(8, 10)),
    label: String(Number(day.dateKey.slice(8, 10))),
    hours: day.workedMinutes == null ? null : Math.round((day.workedMinutes / 60) * 100) / 100,
    targetHours: Math.round((targetMinutes / 60) * 100) / 100,
    status: day.status,
    lateMinutes: day.late.isLate ? day.late.minutesAfterSchedule : 0,
  }))
}

export interface StatusBreakdownSlice {
  status: DayStatus
  label: string
  count: number
}

/** Counts by status, for the composition chart. Only non-zero buckets. */
export function statusBreakdown(report: MonthlyReport): StatusBreakdownSlice[] {
  const order: DayStatus[] = [
    'present',
    'late',
    'missing_check_out',
    'missing_check_in',
    'absent',
    'leave',
    'holiday',
    'weekend',
  ]
  const labels: Record<DayStatus, string> = {
    present: 'On time',
    late: 'Late',
    absent: 'Absent',
    weekend: 'Weekend',
    holiday: 'Holiday',
    leave: 'Leave',
    missing_check_in: 'Missing in',
    missing_check_out: 'Missing out',
    checked_in: 'In progress',
    upcoming: 'Upcoming',
    no_record_yet: 'No record',
  }
  const counts = new Map<DayStatus, number>()
  for (const day of report.days) {
    counts.set(day.status, (counts.get(day.status) ?? 0) + 1)
  }
  return order
    .map((status) => ({ status, label: labels[status], count: counts.get(status) ?? 0 }))
    .filter((slice) => slice.count > 0)
}

export interface WeekdayPunctualityPoint {
  weekday: IsoWeekday
  label: string
  onTime: number
  late: number
  averageLateMinutes: number
}

/** Arrival punctuality grouped by weekday — shows which day runs late. */
export function weekdayPunctuality(report: MonthlyReport): WeekdayPunctualityPoint[] {
  const labels: Record<IsoWeekday, string> = {
    1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
  }
  const buckets = new Map<IsoWeekday, { onTime: number; late: number; lateMinutes: number }>()

  for (const day of report.days) {
    if (!day.checkInAt) continue
    const weekday = weekdayOfDateKey(day.dateKey)
    const bucket = buckets.get(weekday) ?? { onTime: 0, late: 0, lateMinutes: 0 }
    if (day.late.isLate) {
      bucket.late += 1
      bucket.lateMinutes += day.late.minutesAfterSchedule
    } else {
      bucket.onTime += 1
    }
    buckets.set(weekday, bucket)
  }

  return report.policy.workingDays.map((weekday) => {
    const bucket = buckets.get(weekday) ?? { onTime: 0, late: 0, lateMinutes: 0 }
    return {
      weekday,
      label: labels[weekday],
      onTime: bucket.onTime,
      late: bucket.late,
      averageLateMinutes: bucket.late > 0 ? Math.round(bucket.lateMinutes / bucket.late) : 0,
    }
  })
}

/** Days needing the user's attention, surfaced at the top of the report. */
export interface AttentionItem {
  dateKey: DateKey
  status: DayStatus
  detail: string
}

export function attentionItems(report: MonthlyReport): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const day of report.days) {
    if (day.status === 'missing_check_out') {
      items.push({
        dateKey: day.dateKey,
        status: day.status,
        detail: 'Checked in but never checked out',
      })
    } else if (day.status === 'missing_check_in') {
      items.push({
        dateKey: day.dateKey,
        status: day.status,
        detail: 'Checked out with no recorded arrival',
      })
    } else if (day.status === 'absent') {
      items.push({
        dateKey: day.dateKey,
        status: day.status,
        detail: 'Scheduled working day with no attendance',
      })
    }
  }
  return items
}

export function lateArrivalItems(report: MonthlyReport): AttentionItem[] {
  return report.days
    .filter((day) => day.late.isLate)
    .map((day) => ({
      dateKey: day.dateKey,
      status: day.status,
      detail: `${day.late.minutesAfterSchedule} min after ${day.policy.expectedCheckIn}` +
        (day.late.minutesAfterGrace > 0
          ? ` (${day.late.minutesAfterGrace} min past grace)`
          : ''),
    }))
}

export function weekdayOf(dateKey: DateKey): IsoWeekday {
  return weekdayOfDateKey(dateKey)
}
