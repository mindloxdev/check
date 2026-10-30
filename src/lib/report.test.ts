import { describe, expect, it } from 'vitest'
import type { AttendanceRecordRow, HolidayRow, LeaveRecordRow } from '@/types/database'
import { DEFAULT_POLICY, type AttendancePolicy } from './attendance'
import {
  attentionItems,
  averageMinuteOfDay,
  buildMonthlyReport,
  compareMonths,
  dailyHoursSeries,
  indexLeaves,
  isCurrentOrPastMonth,
  lateArrivalItems,
  monthOf,
  monthRange,
  monthlyReviewState,
  shiftMonth,
  statusBreakdown,
  weekdayPunctuality,
} from './report'
import { zonedWallClockToInstant } from './tz'

const KARACHI = 'Asia/Karachi'
const policy: AttendancePolicy = { ...DEFAULT_POLICY }

let seq = 0
function rec(date: string, inTime: string | null, outTime: string | null): AttendanceRecordRow {
  seq += 1
  const checkIn = inTime ? zonedWallClockToInstant(date, inTime, KARACHI) : null
  const checkOut = outTime ? zonedWallClockToInstant(date, outTime, KARACHI) : null
  return {
    id: `r${seq}`,
    user_id: 'u1',
    attendance_date: date,
    session_index: 1,
    check_in_at: checkIn?.toISOString() ?? null,
    check_out_at: checkOut?.toISOString() ?? null,
    check_in_verification_status: checkIn ? 'verified' : null,
    check_out_verification_status: checkOut ? 'verified' : null,
    check_in_source: checkIn ? 'app' : null,
    check_out_source: checkOut ? 'app' : null,
    check_in_client_skew_seconds: null,
    check_out_client_skew_seconds: null,
    manual_correction: false,
    correction_reason: null,
    note: null,
    policy_snapshot: {},
    duration_minutes:
      checkIn && checkOut
        ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000)
        : null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

function holiday(date: string, name: string): HolidayRow {
  return {
    id: `h-${date}`,
    user_id: 'u1',
    holiday_date: date,
    holiday_name: name,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function leave(start: string, end: string): LeaveRecordRow {
  return {
    id: `l-${start}`,
    user_id: 'u1',
    start_date: start,
    end_date: end,
    leave_type: 'annual',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

/** 'Now' fixed to 2026-10-31 12:00 Karachi, so the whole of October is past. */
const END_OF_OCTOBER = zonedWallClockToInstant('2026-10-31', '12:00', KARACHI)

describe('averageMinuteOfDay', () => {
  it('averages office-hours times arithmetically', () => {
    expect(averageMinuteOfDay([540, 550, 560])).toBe(550) // 09:00, 09:10, 09:20
    expect(averageMinuteOfDay([540])).toBe(540)
    expect(averageMinuteOfDay([])).toBeNull()
  })

  it('averages a set that wraps midnight on the clock circle', () => {
    // 23:50 and 00:10 must average to 00:00, not to noon.
    expect(averageMinuteOfDay([1430, 10])).toBe(0)
  })

  it('rounds to whole minutes', () => {
    expect(averageMinuteOfDay([540, 541])).toBe(541)
  })
})

describe('buildMonthlyReport', () => {
  it('counts a full, clean month correctly', () => {
    // October 2026: 31 days, 22 weekdays (Mon-Fri), 9 weekend days.
    const records = [
      rec('2026-10-01', '09:02', '17:15'), // Thursday, present
      rec('2026-10-02', '09:24', '17:30'), // Friday, late by 24
      rec('2026-10-05', '09:00', null), // Monday, missing check-out
      rec('2026-10-06', null, '17:30'), // Tuesday, missing check-in
      rec('2026-10-07', '09:11', '17:00'), // Wednesday, late by 11 (1 past grace)
      rec('2026-10-08', '08:45', '17:00'), // Thursday, present (early)
    ]
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records,
      holidays: [holiday('2026-10-12', 'Founders Day')], // a Monday
      leaves: [leave('2026-10-13', '2026-10-14')], // Tue + Wed
      policy,
      now: END_OF_OCTOBER,
    })
    const s = report.stats

    expect(report.days).toHaveLength(31)
    expect(report.label).toBe('October 2026')
    expect(s.weekendCount).toBe(9)
    expect(s.holidayCount).toBe(1)
    expect(s.daysOnLeave).toBe(2)
    // 22 weekdays minus 1 holiday minus 2 leave days.
    expect(s.scheduledWorkingDays).toBe(19)
    expect(s.scheduledWorkingDaysElapsed).toBe(19)

    expect(s.daysWithAttendance).toBe(5) // 4 complete + 1 missing check-out
    expect(s.daysLate).toBe(2) // 10-02 and 10-07
    expect(s.daysMissingCheckOut).toBe(1)
    expect(s.daysMissingCheckIn).toBe(1)
    // 19 scheduled - 5 attended - 1 missing-check-in day = 13 absent.
    expect(s.daysAbsent).toBe(13)

    // Minutes past the scheduled 09:00, counted only on late days: 24 + 11.
    expect(s.totalLateMinutes).toBe(35)
    // Beyond the 10-minute grace: 14 + 1.
    expect(s.totalLateMinutesBeyondGrace).toBe(15)

    // Durations of the four completed days.
    expect(s.totalWorkedMinutes).toBe(493 + 486 + 469 + 495)
    expect(s.averageWorkedMinutes).toBe(Math.round((493 + 486 + 469 + 495) / 4))
  })

  it('does not count weekends as absences', () => {
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now: END_OF_OCTOBER,
    })
    expect(report.stats.weekendCount).toBe(9)
    expect(report.stats.daysAbsent).toBe(22) // every weekday, none attended
    const saturday = report.days.find((d) => d.dateKey === '2026-10-03')
    expect(saturday?.status).toBe('weekend')
  })

  it('does not count a holiday on a working day as an absence', () => {
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [],
      holidays: [holiday('2026-10-05', 'Public Holiday')], // Monday
      leaves: [],
      policy,
      now: END_OF_OCTOBER,
    })
    expect(report.stats.daysAbsent).toBe(21)
    expect(report.stats.scheduledWorkingDays).toBe(21)
    expect(report.days.find((d) => d.dateKey === '2026-10-05')?.status).toBe('holiday')
  })

  it('does not classify future dates as absent', () => {
    // 'Now' is 05 October, so only 01, 02 and 05 are past-or-today weekdays.
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-10-05', '12:00', KARACHI),
    })
    expect(report.today).toBe('2026-10-05')
    expect(report.stats.scheduledWorkingDaysElapsed).toBe(3) // 01, 02, 05
    expect(report.stats.daysAbsent).toBe(2) // 01 and 02; today is not yet absent
    expect(report.days.find((d) => d.dateKey === '2026-10-05')?.status).toBe('no_record_yet')
    expect(report.days.find((d) => d.dateKey === '2026-10-20')?.status).toBe('upcoming')
  })

  it('averages check-in and check-out times', () => {
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [
        rec('2026-10-01', '09:00', '17:00'),
        rec('2026-10-02', '09:30', '17:30'),
      ],
      holidays: [],
      leaves: [],
      policy,
      now: END_OF_OCTOBER,
    })
    expect(report.stats.averageCheckIn).toBe('09:15')
    expect(report.stats.averageCheckOut).toBe('17:15')
  })

  it('computes attendance and punctuality rates', () => {
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [
        rec('2026-10-01', '09:00', '17:00'),
        rec('2026-10-02', '09:45', '17:00'),
      ],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-10-02', '18:00', KARACHI),
    })
    // 2 of 2 elapsed scheduled days attended.
    expect(report.stats.attendanceRate).toBe(100)
    // 1 of 2 attended days was on time.
    expect(report.stats.punctualityRate).toBe(50)
  })

  it('returns null rates rather than a misleading zero when there is no data', () => {
    const report = buildMonthlyReport({
      month: { year: 2026, month: 12 },
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-10-05', '12:00', KARACHI),
    })
    expect(report.stats.scheduledWorkingDaysElapsed).toBe(0)
    expect(report.stats.attendanceRate).toBeNull()
    expect(report.stats.punctualityRate).toBeNull()
    expect(report.stats.daysAbsent).toBe(0)
  })

  it('keeps a session that is still open today out of the absent count', () => {
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [rec('2026-10-29', '09:00', null)],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-10-29', '14:00', KARACHI),
    })
    const today = report.days.find((d) => d.dateKey === '2026-10-29')
    expect(today?.status).toBe('checked_in')
    expect(report.stats.daysWithAttendance).toBe(1)
    expect(report.stats.daysMissingCheckOut).toBe(0)
  })

  it('handles a 28-day February and a leap February', () => {
    const feb2026 = buildMonthlyReport({
      month: { year: 2026, month: 2 },
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-03-05', '12:00', KARACHI),
    })
    expect(feb2026.days).toHaveLength(28)

    const feb2024 = buildMonthlyReport({
      month: { year: 2024, month: 2 },
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-03-05', '12:00', KARACHI),
    })
    expect(feb2024.days).toHaveLength(29)
  })

  it('files an overnight session under the date it started', () => {
    // A session beginning 31 Oct 21:00 and ending 01 Nov 05:00 belongs wholly
    // to October's report.
    const checkIn = zonedWallClockToInstant('2026-10-31', '21:00', KARACHI)
    const checkOut = zonedWallClockToInstant('2026-11-01', '05:00', KARACHI)
    const overnight: AttendanceRecordRow = {
      ...rec('2026-10-31', null, null),
      check_in_at: checkIn.toISOString(),
      check_out_at: checkOut.toISOString(),
      duration_minutes: 480,
    }
    const october = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [overnight],
      holidays: [],
      leaves: [],
      policy: { ...policy, workingDays: [1, 2, 3, 4, 5, 6, 7] },
      now: zonedWallClockToInstant('2026-11-02', '12:00', KARACHI),
    })
    expect(october.stats.totalWorkedMinutes).toBe(480)

    const november = buildMonthlyReport({
      month: { year: 2026, month: 11 },
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now: zonedWallClockToInstant('2026-11-02', '12:00', KARACHI),
    })
    expect(november.stats.totalWorkedMinutes).toBe(0)
  })

  it('classifies each day against its own stored policy', () => {
    // September used a 09:30 start; October uses 09:00. A 09:20 arrival is on
    // time under September's policy and late under October's.
    const septemberRecord: AttendanceRecordRow = {
      ...rec('2026-10-01', '09:20', '17:30'),
      policy_snapshot: { expected_check_in: '09:30', grace_period_minutes: 10 },
    }
    const report = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [septemberRecord, rec('2026-10-02', '09:20', '17:30')],
      holidays: [],
      leaves: [],
      policy,
      now: END_OF_OCTOBER,
    })
    expect(report.days.find((d) => d.dateKey === '2026-10-01')?.status).toBe('present')
    expect(report.days.find((d) => d.dateKey === '2026-10-02')?.status).toBe('late')
    expect(report.stats.daysLate).toBe(1)
  })
})

describe('leave expansion', () => {
  it('expands a range into every covered day', () => {
    const map = indexLeaves([leave('2026-10-13', '2026-10-16')])
    expect([...map.keys()]).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ])
  })

  it('handles a single-day leave', () => {
    expect(indexLeaves([leave('2026-10-13', '2026-10-13')]).size).toBe(1)
  })

  it('handles a leave spanning a month boundary', () => {
    const map = indexLeaves([leave('2026-10-30', '2026-11-02')])
    expect(map.size).toBe(4)
    expect(map.has('2026-11-01')).toBe(true)
  })
})

describe('month navigation', () => {
  it('shifts across year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 10 }, -13)).toEqual({ year: 2025, month: 9 })
    expect(shiftMonth({ year: 2026, month: 6 }, 0)).toEqual({ year: 2026, month: 6 })
  })

  it('parses and compares', () => {
    expect(monthOf('2026-10-29')).toEqual({ year: 2026, month: 10 })
    expect(compareMonths({ year: 2026, month: 9 }, { year: 2026, month: 10 })).toBeLessThan(0)
    expect(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0)
    expect(monthRange({ year: 2026, month: 2 })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('blocks navigation into the future', () => {
    expect(isCurrentOrPastMonth({ year: 2026, month: 10 }, '2026-10-29')).toBe(true)
    expect(isCurrentOrPastMonth({ year: 2026, month: 11 }, '2026-10-29')).toBe(false)
  })
})

describe('monthlyReviewState', () => {
  it('unlocks the previous month on the reporting day', () => {
    // Requirement: on 05 November, October's report is reviewable.
    const state = monthlyReviewState('2026-11-05', 5)
    expect(state.month).toEqual({ year: 2026, month: 10 })
    expect(state.label).toBe('October 2026')
    expect(state.isAvailable).toBe(true)
    expect(state.isDueToday).toBe(true)
    expect(state.availableFrom).toBe('2026-11-05')
  })

  it('still points at the previous month after the reporting day', () => {
    const state = monthlyReviewState('2026-11-20', 5)
    expect(state.month).toEqual({ year: 2026, month: 10 })
    expect(state.isAvailable).toBe(true)
    expect(state.isDueToday).toBe(false)
  })

  it('points at the month before last while the reporting day is still ahead', () => {
    // On 02 November, October is not reviewable yet, so September is the
    // outstanding review.
    const state = monthlyReviewState('2026-11-02', 5)
    expect(state.month).toEqual({ year: 2026, month: 9 })
    expect(state.isAvailable).toBe(true)
    expect(state.availableFrom).toBe('2026-10-05')
  })

  it('crosses the year boundary', () => {
    const state = monthlyReviewState('2027-01-05', 5)
    expect(state.month).toEqual({ year: 2026, month: 12 })
    expect(state.isAvailable).toBe(true)
  })

  it('clamps an out-of-range reporting day', () => {
    expect(monthlyReviewState('2026-11-05', 0).availableFrom).toBe('2026-11-01')
    expect(monthlyReviewState('2026-11-05', 99).availableFrom).toBe('2026-10-28')
  })
})

describe('chart series and detail lists', () => {
  const report = buildMonthlyReport({
    month: { year: 2026, month: 10 },
    records: [
      rec('2026-10-01', '09:02', '17:15'),
      rec('2026-10-02', '09:24', '17:30'),
      rec('2026-10-05', '09:00', null),
    ],
    holidays: [],
    leaves: [],
    policy,
    now: END_OF_OCTOBER,
  })

  it('builds a daily hours series with the target line', () => {
    const series = dailyHoursSeries(report)
    expect(series).toHaveLength(31)
    expect(series[0]).toMatchObject({ dayOfMonth: 1, targetHours: 8 })
    expect(series[0]?.hours).toBeCloseTo(8.22, 2)
    // A day with no completed session contributes a gap, not a zero.
    expect(series[4]?.hours).toBeNull()
  })

  it('breaks down statuses and drops empty buckets', () => {
    const slices = statusBreakdown(report)
    const byStatus = Object.fromEntries(slices.map((s) => [s.status, s.count]))
    expect(byStatus.present).toBe(1)
    expect(byStatus.late).toBe(1)
    expect(byStatus.missing_check_out).toBe(1)
    expect(byStatus.weekend).toBe(9)
    expect(slices.some((s) => s.count === 0)).toBe(false)
    expect(byStatus.holiday).toBeUndefined()
  })

  it('groups punctuality by weekday over the working week only', () => {
    const points = weekdayPunctuality(report)
    expect(points.map((p) => p.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(points.find((p) => p.label === 'Fri')).toMatchObject({
      late: 1,
      averageLateMinutes: 24,
    })
    expect(points.find((p) => p.label === 'Thu')).toMatchObject({ onTime: 1, late: 0 })
  })

  it('lists late arrivals with both late figures', () => {
    const items = lateArrivalItems(report)
    expect(items).toHaveLength(1)
    expect(items[0]?.dateKey).toBe('2026-10-02')
    expect(items[0]?.detail).toContain('24 min after 09:00')
    expect(items[0]?.detail).toContain('14 min past grace')
  })

  it('lists days needing attention', () => {
    const items = attentionItems(report)
    const missing = items.find((i) => i.dateKey === '2026-10-05')
    expect(missing?.status).toBe('missing_check_out')
    expect(items.filter((i) => i.status === 'absent').length).toBeGreaterThan(0)
  })
})
