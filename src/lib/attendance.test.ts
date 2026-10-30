import { describe, expect, it } from 'vitest'
import type { AttendanceRecordRow, ProfileRow } from '@/types/database'
import {
  type AttendancePolicy,
  DEFAULT_POLICY,
  computeEarlyDeparture,
  computeLateArrival,
  deriveLiveState,
  effectivePolicyFor,
  isWorkingDay,
  policyFromProfile,
  summariseDay,
} from './attendance'
import { zonedWallClockToInstant } from './tz'

const KARACHI = 'Asia/Karachi'

const policy: AttendancePolicy = { ...DEFAULT_POLICY }

/** Builds a record from office-local wall-clock times, like the UI does. */
function record(
  overrides: {
    date: string
    in?: string | null
    out?: string | null
    outNextDay?: boolean
    sessionIndex?: number
    manual?: boolean
    snapshot?: Record<string, unknown>
    tz?: string
  },
): AttendanceRecordRow {
  const tz = overrides.tz ?? KARACHI
  const checkIn = overrides.in
    ? zonedWallClockToInstant(overrides.date, overrides.in, tz)
    : null
  const checkOutDateKey = overrides.outNextDay
    ? nextDay(overrides.date)
    : overrides.date
  const checkOut = overrides.out
    ? zonedWallClockToInstant(checkOutDateKey, overrides.out, tz)
    : null

  const duration =
    checkIn && checkOut
      ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000)
      : null

  return {
    id: `rec-${overrides.date}-${overrides.sessionIndex ?? 1}`,
    user_id: 'user-1',
    attendance_date: overrides.date,
    session_index: overrides.sessionIndex ?? 1,
    check_in_at: checkIn ? checkIn.toISOString() : null,
    check_out_at: checkOut ? checkOut.toISOString() : null,
    check_in_verification_status: checkIn ? 'verified' : null,
    check_out_verification_status: checkOut ? 'unverified' : null,
    check_in_source: checkIn ? 'app' : null,
    check_out_source: checkOut ? 'app' : null,
    check_in_client_skew_seconds: null,
    check_out_client_skew_seconds: null,
    manual_correction: overrides.manual ?? false,
    correction_reason: overrides.manual ? 'Forgot to tap' : null,
    note: null,
    policy_snapshot: (overrides.snapshot ?? {}) as AttendanceRecordRow['policy_snapshot'],
    duration_minutes: duration,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

function nextDay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const at = (dateKey: string, time: string, tz = KARACHI) =>
  zonedWallClockToInstant(dateKey, time, tz)

// ---------------------------------------------------------------------------

describe('policyFromProfile', () => {
  const profile: ProfileRow = {
    id: 'p1',
    user_id: 'user-1',
    office_name: 'HQ',
    timezone: 'Asia/Karachi',
    expected_check_in: '09:00:00',
    expected_check_out: '17:00:00',
    grace_period_minutes: 10,
    working_days: [1, 2, 3, 4, 5],
    reporting_day: 5,
    wifi_mode: 'off',
    wifi_endpoint_url: null,
    wifi_expected_token: null,
    wifi_timeout_ms: 4000,
    multi_session_enabled: false,
    overnight_enabled: false,
    day_cutoff_hour: 4,
    notify_monthly_review: true,
    notify_missing_checkout: true,
    notify_late_arrival: false,
    theme: 'system',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  it('normalises Postgres time values to HH:mm', () => {
    const result = policyFromProfile(profile)
    expect(result.expectedCheckIn).toBe('09:00')
    expect(result.expectedCheckOut).toBe('17:00')
    expect(result.officeName).toBe('HQ')
  })

  it('falls back to defaults for unusable values', () => {
    const result = policyFromProfile({
      ...profile,
      expected_check_in: 'garbage',
      working_days: [],
      grace_period_minutes: Number.NaN,
      timezone: '',
    })
    expect(result.expectedCheckIn).toBe('09:00')
    expect(result.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(result.gracePeriodMinutes).toBe(10)
    expect(result.timeZone).toBe('Asia/Karachi')
  })

  it('de-duplicates and sorts working days', () => {
    const result = policyFromProfile({ ...profile, working_days: [7, 3, 3, 1, 9, 0] })
    expect(result.workingDays).toEqual([1, 3, 7])
  })
})

describe('isWorkingDay', () => {
  it('follows the configured working days', () => {
    expect(isWorkingDay('2026-10-29', policy)).toBe(true) // Thursday
    expect(isWorkingDay('2026-10-31', policy)).toBe(false) // Saturday
    const weekendWorker = { ...policy, workingDays: [6, 7] as AttendancePolicy['workingDays'] }
    expect(isWorkingDay('2026-10-31', weekendWorker)).toBe(true)
    expect(isWorkingDay('2026-10-29', weekendWorker)).toBe(false)
  })
})

describe('computeLateArrival — the grace period specification', () => {
  const cases: Array<[string, number, number, boolean]> = [
    // arrival, minutesAfterSchedule, minutesAfterGrace, isLate
    ['08:45', 0, 0, false],
    ['09:00', 0, 0, false],
    ['09:05', 5, 0, false],
    ['09:10', 10, 0, false], // the grace boundary is inclusive — still on time
    ['09:11', 11, 1, true],
    ['09:30', 30, 20, true],
    ['11:00', 120, 110, true],
  ]

  for (const [arrival, afterSchedule, afterGrace, isLate] of cases) {
    it(`${arrival} → ${isLate ? 'late' : 'on time'} (${afterSchedule}m after 09:00)`, () => {
      const result = computeLateArrival(at('2026-10-29', arrival), policy)
      expect(result.minutesAfterSchedule).toBe(afterSchedule)
      expect(result.minutesAfterGrace).toBe(afterGrace)
      expect(result.isLate).toBe(isLate)
    })
  }

  it('respects a zero grace period', () => {
    const strict = { ...policy, gracePeriodMinutes: 0 }
    expect(computeLateArrival(at('2026-10-29', '09:00'), strict).isLate).toBe(false)
    expect(computeLateArrival(at('2026-10-29', '09:01'), strict).isLate).toBe(true)
  })

  it('respects a different expected arrival time', () => {
    const early = { ...policy, expectedCheckIn: '08:00', gracePeriodMinutes: 5 }
    expect(computeLateArrival(at('2026-10-29', '08:05'), early).isLate).toBe(false)
    const late = computeLateArrival(at('2026-10-29', '08:20'), early)
    expect(late.isLate).toBe(true)
    expect(late.minutesAfterSchedule).toBe(20)
    expect(late.minutesAfterGrace).toBe(15)
  })

  it('measures lateness in the office zone, not UTC', () => {
    // One instant, two offices. 05:30Z reads 10:30 in Karachi (90 minutes late)
    // and 05:30 in a UTC office (comfortably early).
    const instant = new Date('2026-10-29T05:30:00Z')

    const karachi = computeLateArrival(instant, policy)
    expect(karachi.isLate).toBe(true)
    expect(karachi.minutesAfterSchedule).toBe(90)

    const utc = computeLateArrival(instant, { ...policy, timeZone: 'UTC' })
    expect(utc.isLate).toBe(false)
    expect(utc.minutesAfterSchedule).toBe(0)
  })

  it('treats a post-midnight arrival on an overnight shift as next-day, not 23h early', () => {
    const night = { ...policy, expectedCheckIn: '22:00', gracePeriodMinutes: 10 }
    // 00:30 against a 22:00 expectation is 150 minutes late, not 1290 early.
    const result = computeLateArrival(at('2026-10-30', '00:30'), night)
    expect(result.minutesAfterSchedule).toBe(150)
    expect(result.isLate).toBe(true)
  })
})

describe('computeEarlyDeparture', () => {
  it('counts minutes before the expected departure', () => {
    expect(computeEarlyDeparture(at('2026-10-29', '16:30'), policy)).toBe(30)
    expect(computeEarlyDeparture(at('2026-10-29', '17:00'), policy)).toBe(0)
    expect(computeEarlyDeparture(at('2026-10-29', '18:15'), policy)).toBe(0)
  })

  it('does not treat a post-midnight departure as hugely early', () => {
    expect(computeEarlyDeparture(at('2026-10-30', '00:30'), policy)).toBe(0)
  })
})

describe('effectivePolicyFor — policy changes must not rewrite history', () => {
  it('uses the record snapshot over the live policy', () => {
    const rec = record({
      date: '2026-09-15',
      in: '09:20',
      out: '17:30',
      snapshot: {
        timezone: 'Asia/Karachi',
        expected_check_in: '09:30',
        expected_check_out: '18:00',
        grace_period_minutes: 15,
        working_days: [1, 2, 3, 4, 5],
        office_name: 'Old Office',
      },
    })
    // Live policy expects 09:00 with 10 minutes of grace → 09:20 would be late.
    // The snapshot expected 09:30 → 09:20 was early, so it must not be late.
    const effective = effectivePolicyFor(rec, policy)
    expect(effective.expectedCheckIn).toBe('09:30')
    expect(effective.gracePeriodMinutes).toBe(15)
    expect(effective.officeName).toBe('Old Office')

    expect(computeLateArrival(new Date(rec.check_in_at!), policy).isLate).toBe(true)
    expect(computeLateArrival(new Date(rec.check_in_at!), effective).isLate).toBe(false)
  })

  it('falls back to the live policy when the snapshot is empty', () => {
    const rec = record({ date: '2026-10-29', in: '09:00', out: '17:00' })
    expect(effectivePolicyFor(rec, policy)).toEqual(policy)
    expect(effectivePolicyFor(null, policy)).toEqual(policy)
  })

  it('keeps live values for fields the snapshot omits', () => {
    const rec = record({
      date: '2026-10-29',
      in: '09:00',
      snapshot: { expected_check_in: '10:00' },
    })
    const effective = effectivePolicyFor(rec, { ...policy, overnightEnabled: true })
    expect(effective.expectedCheckIn).toBe('10:00')
    expect(effective.expectedCheckOut).toBe('17:00')
    expect(effective.overnightEnabled).toBe(true)
  })
})

describe('summariseDay', () => {
  const today = '2026-10-29'
  const base = { policy, today }

  it('classifies a complete on-time day as present', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-28',
      records: [record({ date: '2026-10-28', in: '09:02', out: '17:15' })],
    })
    expect(day.status).toBe('present')
    expect(day.workedMinutes).toBe(8 * 60 + 13)
    expect(day.late.isLate).toBe(false)
    expect(day.late.minutesAfterSchedule).toBe(2)
  })

  it('classifies a complete late day as late', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-27',
      records: [record({ date: '2026-10-27', in: '09:24', out: '17:30' })],
    })
    expect(day.status).toBe('late')
    expect(day.late.minutesAfterSchedule).toBe(24)
    expect(day.late.minutesAfterGrace).toBe(14)
    expect(day.workedMinutes).toBe(8 * 60 + 6)
  })

  it('reports a past open session as missing check-out', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-26',
      records: [record({ date: '2026-10-26', in: '09:00' })],
    })
    expect(day.status).toBe('missing_check_out')
    expect(day.workedMinutes).toBeNull()
  })

  it('reports today’s open session as checked in, not missing', () => {
    const day = summariseDay({
      ...base,
      dateKey: today,
      records: [record({ date: today, in: '09:00' })],
    })
    expect(day.status).toBe('checked_in')
  })

  it('reports a check-out with no arrival as missing check-in', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-26',
      records: [record({ date: '2026-10-26', out: '17:30' })],
    })
    expect(day.status).toBe('missing_check_in')
  })

  it('marks a past scheduled working day with no record as absent', () => {
    const day = summariseDay({ ...base, dateKey: '2026-10-26', records: [] }) // Monday
    expect(day.status).toBe('absent')
  })

  it('never marks a future working day as absent', () => {
    const day = summariseDay({ ...base, dateKey: '2026-10-30', records: [] }) // Friday
    expect(day.status).toBe('upcoming')
  })

  it('does not mark today as absent before a check-in', () => {
    const day = summariseDay({ ...base, dateKey: today, records: [] })
    expect(day.status).toBe('no_record_yet')
  })

  it('marks a non-working day as weekend, never absent', () => {
    const day = summariseDay({ ...base, dateKey: '2026-10-24', records: [] }) // Saturday
    expect(day.status).toBe('weekend')
    expect(day.isWorkingDay).toBe(false)
  })

  it('excludes a holiday that falls on a working day', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-26',
      records: [],
      holiday: { date: '2026-10-26', name: 'Founders Day' },
    })
    expect(day.status).toBe('holiday')
    expect(day.holidayName).toBe('Founders Day')
  })

  it('excludes an approved leave day', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-26',
      records: [],
      leave: { date: '2026-10-26', leaveType: 'annual', notes: null },
    })
    expect(day.status).toBe('leave')
    expect(day.leaveType).toBe('annual')
  })

  it('reports attendance recorded on a holiday as attendance, flagged off-schedule', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-26',
      records: [record({ date: '2026-10-26', in: '09:00', out: '13:00' })],
      holiday: { date: '2026-10-26', name: 'Founders Day' },
    })
    expect(day.status).toBe('present')
    expect(day.isHoliday).toBe(true)
    expect(day.workedOnNonWorkingDay).toBe(true)
  })

  it('sums multiple sessions in a day', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-28',
      records: [
        record({ date: '2026-10-28', in: '09:00', out: '12:00', sessionIndex: 1 }),
        record({ date: '2026-10-28', in: '13:00', out: '17:00', sessionIndex: 2 }),
      ],
    })
    expect(day.status).toBe('present')
    expect(day.workedMinutes).toBe(7 * 60)
    // The day's bounds are the first arrival and the last departure.
    expect(day.checkInAt?.toISOString()).toBe('2026-10-28T04:00:00.000Z')
    expect(day.checkOutAt?.toISOString()).toBe('2026-10-28T12:00:00.000Z')
  })

  it('handles an overnight session that ends the next calendar day', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-27',
      records: [record({ date: '2026-10-27', in: '21:00', out: '05:30', outNextDay: true })],
    })
    expect(day.workedMinutes).toBe(8 * 60 + 30)
    expect(day.status).toBe('late') // 21:00 against a 09:00 expectation
  })

  it('flags a manually corrected day', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-10-28',
      records: [record({ date: '2026-10-28', in: '09:00', out: '17:00', manual: true })],
    })
    expect(day.manuallyCorrected).toBe(true)
  })

  it('applies each record’s own snapshot when classifying', () => {
    const day = summariseDay({
      ...base,
      dateKey: '2026-09-15',
      records: [
        record({
          date: '2026-09-15',
          in: '09:20',
          out: '17:30',
          snapshot: { expected_check_in: '09:30', grace_period_minutes: 15 },
        }),
      ],
    })
    expect(day.status).toBe('present')
    expect(day.policy.expectedCheckIn).toBe('09:30')
  })
})

describe('deriveLiveState', () => {
  const now = new Date('2026-10-29T06:30:00Z') // 11:30 in Karachi

  it('reports not-checked-in with only Check In available', () => {
    const state = deriveLiveState({ now, todayRecords: [], openSession: null, policy })
    expect(state.status).toBe('not_checked_in')
    expect(state.canCheckIn).toBe(true)
    expect(state.canCheckOut).toBe(false)
    expect(state.businessDate).toBe('2026-10-29')
  })

  it('reports checked-in with elapsed time and only Check Out available', () => {
    const open = record({ date: '2026-10-29', in: '09:00' })
    const state = deriveLiveState({ now, todayRecords: [open], openSession: open, policy })
    expect(state.status).toBe('checked_in')
    expect(state.canCheckIn).toBe(false)
    expect(state.canCheckOut).toBe(true)
    expect(state.elapsedMinutes).toBe(150) // 09:00 → 11:30
    expect(state.staleOpenSessionFrom).toBeNull()
  })

  it('flags an open session carried over from an earlier day', () => {
    const open = record({ date: '2026-10-28', in: '09:00' })
    const state = deriveLiveState({ now, todayRecords: [], openSession: open, policy })
    expect(state.status).toBe('checked_in')
    expect(state.staleOpenSessionFrom).toBe('2026-10-28')
  })

  it('reports checked-out and disables both buttons in single-session mode', () => {
    const done = record({ date: '2026-10-29', in: '09:00', out: '11:00' })
    const state = deriveLiveState({ now, todayRecords: [done], openSession: null, policy })
    expect(state.status).toBe('checked_out')
    expect(state.canCheckIn).toBe(false)
    expect(state.canCheckOut).toBe(false)
    expect(state.elapsedMinutes).toBe(120)
  })

  it('allows a second check-in when multi-session mode is on', () => {
    const done = record({ date: '2026-10-29', in: '09:00', out: '11:00' })
    const state = deriveLiveState({
      now,
      todayRecords: [done],
      openSession: null,
      policy: { ...policy, multiSessionEnabled: true },
    })
    expect(state.canCheckIn).toBe(true)
  })

  it('totals completed sessions for the day', () => {
    const records = [
      record({ date: '2026-10-29', in: '08:00', out: '10:00', sessionIndex: 1 }),
      record({ date: '2026-10-29', in: '10:30', out: '11:30', sessionIndex: 2 }),
    ]
    const state = deriveLiveState({
      now,
      todayRecords: records,
      openSession: null,
      policy: { ...policy, multiSessionEnabled: true },
    })
    expect(state.elapsedMinutes).toBe(180)
  })

  it('reports an orphan check-out as incomplete', () => {
    const orphan = record({ date: '2026-10-29', out: '11:00' })
    const state = deriveLiveState({ now, todayRecords: [orphan], openSession: null, policy })
    expect(state.status).toBe('incomplete')
    expect(state.canCheckIn).toBe(false)
    expect(state.canCheckOut).toBe(false)
  })

  it('files a late-night check-in under the previous day when overnight mode is on', () => {
    const overnightPolicy = { ...policy, overnightEnabled: true, dayCutoffHour: 4 }
    // 2026-10-29T20:30Z = 01:30 on the 30th in Karachi.
    const state = deriveLiveState({
      now: new Date('2026-10-29T20:30:00Z'),
      todayRecords: [],
      openSession: null,
      policy: overnightPolicy,
    })
    expect(state.businessDate).toBe('2026-10-29')
  })
})
