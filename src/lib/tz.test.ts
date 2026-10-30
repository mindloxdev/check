import { describe, expect, it } from 'vitest'
import {
  addDaysToDateKey,
  compareDateKeys,
  datesBetween,
  datesInMonth,
  daysInMonth,
  diffDateKeys,
  formatClockTime,
  formatDuration,
  formatDurationLong,
  formatLongDate,
  formatMonthLabel,
  formatShortDate,
  formatTimeKey,
  formatZoneOffset,
  isDateKey,
  isTimeKey,
  isValidTimeZone,
  makeDateKey,
  minutesToTimeKey,
  offsetMinutesAt,
  parseDateKey,
  resolveBusinessDate,
  timeKeyToMinutes,
  toDateKey,
  toIsoWeekday,
  toMinuteOfDay,
  toTimeKey,
  weekdayOfDateKey,
  zonedParts,
  zonedWallClockToInstant,
} from './tz'

const KARACHI = 'Asia/Karachi' // UTC+5 all year, no DST
const NEW_YORK = 'America/New_York' // DST, used for the transition tests
const KATHMANDU = 'Asia/Kathmandu' // UTC+5:45, a 45-minute offset
const CHATHAM = 'Pacific/Chatham' // UTC+12:45 / +13:45, DST on a :45 offset

describe('zone validation', () => {
  it('accepts real IANA names and rejects typos', () => {
    expect(isValidTimeZone(KARACHI)).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Asia/Karachee')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('zonedParts', () => {
  it('decomposes an instant in the office zone', () => {
    // 2026-10-29T04:07:42Z is 09:07:42 in Karachi (+5), a Thursday.
    const parts = zonedParts(new Date('2026-10-29T04:07:42Z'), KARACHI)
    expect(parts).toEqual({
      year: 2026,
      month: 10,
      day: 29,
      hour: 9,
      minute: 7,
      second: 42,
      weekday: 4,
    })
  })

  it('renders midnight as hour 0, not 24', () => {
    // 19:00Z = 00:00 next day in Karachi.
    const parts = zonedParts(new Date('2026-10-29T19:00:00Z'), KARACHI)
    expect(parts.hour).toBe(0)
    expect(parts.day).toBe(30)
  })

  it('crosses the date line correctly for a late-evening UTC instant', () => {
    // 2026-10-29T20:30Z is already 01:30 on the 30th in Karachi.
    expect(toDateKey(new Date('2026-10-29T20:30:00Z'), KARACHI)).toBe('2026-10-30')
    expect(toTimeKey(new Date('2026-10-29T20:30:00Z'), KARACHI)).toBe('01:30')
    // The same instant is still the 29th in New York.
    expect(toDateKey(new Date('2026-10-29T20:30:00Z'), NEW_YORK)).toBe('2026-10-29')
  })

  it('reports minute-of-day and weekday in the target zone', () => {
    const instant = new Date('2026-10-29T04:07:00Z')
    expect(toMinuteOfDay(instant, KARACHI)).toBe(9 * 60 + 7)
    expect(toIsoWeekday(instant, KARACHI)).toBe(4) // Thursday
  })
})

describe('offsetMinutesAt', () => {
  it('reports whole-hour, 45-minute and DST offsets', () => {
    expect(offsetMinutesAt(new Date('2026-06-15T12:00:00Z'), KARACHI)).toBe(300)
    expect(offsetMinutesAt(new Date('2026-06-15T12:00:00Z'), KATHMANDU)).toBe(345)
    // New York: EDT in June (-240), EST in January (-300).
    expect(offsetMinutesAt(new Date('2026-06-15T12:00:00Z'), NEW_YORK)).toBe(-240)
    expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'), NEW_YORK)).toBe(-300)
  })

  it('is unaffected by sub-minute components of the instant', () => {
    expect(offsetMinutesAt(new Date('2026-06-15T12:00:00.999Z'), KARACHI)).toBe(300)
  })
})

describe('zonedWallClockToInstant', () => {
  it('round-trips an ordinary wall-clock time', () => {
    const instant = zonedWallClockToInstant('2026-10-29', '09:07', KARACHI)
    expect(instant.toISOString()).toBe('2026-10-29T04:07:00.000Z')
    expect(toTimeKey(instant, KARACHI)).toBe('09:07')
    expect(toDateKey(instant, KARACHI)).toBe('2026-10-29')
  })

  it('round-trips in a 45-minute-offset zone', () => {
    const instant = zonedWallClockToInstant('2026-03-10', '09:00', KATHMANDU)
    expect(instant.toISOString()).toBe('2026-03-10T03:15:00.000Z')
    expect(toTimeKey(instant, KATHMANDU)).toBe('09:00')
  })

  it('round-trips either side of a DST spring-forward boundary', () => {
    // US DST 2026 starts 08 March. 01:30 EST exists, 03:30 EDT exists.
    const before = zonedWallClockToInstant('2026-03-08', '01:30', NEW_YORK)
    expect(before.toISOString()).toBe('2026-03-08T06:30:00.000Z')
    expect(toTimeKey(before, NEW_YORK)).toBe('01:30')

    const after = zonedWallClockToInstant('2026-03-08', '03:30', NEW_YORK)
    expect(after.toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(toTimeKey(after, NEW_YORK)).toBe('03:30')
  })

  it('maps a non-existent spring-forward time forward past the gap', () => {
    // 02:30 on 08 March 2026 never happens in New York.
    const instant = zonedWallClockToInstant('2026-03-08', '02:30', NEW_YORK)
    expect(instant.toISOString()).toBe('2026-03-08T07:30:00.000Z')
    // It resolves to 03:30 EDT — the same absolute instant as "02:30 EST".
    expect(toTimeKey(instant, NEW_YORK)).toBe('03:30')
    expect(toDateKey(instant, NEW_YORK)).toBe('2026-03-08')
  })

  it('picks the earlier occurrence of an ambiguous fall-back time', () => {
    // US DST 2026 ends 01 November. 01:30 happens twice: 05:30Z (EDT) then 06:30Z (EST).
    const instant = zonedWallClockToInstant('2026-11-01', '01:30', NEW_YORK)
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(toTimeKey(instant, NEW_YORK)).toBe('01:30')
  })

  it('round-trips across a DST change on a 45-minute offset zone', () => {
    // Chatham: +13:45 in January (DST), +12:45 in June.
    const summer = zonedWallClockToInstant('2026-01-15', '09:00', CHATHAM)
    expect(toTimeKey(summer, CHATHAM)).toBe('09:00')
    const winter = zonedWallClockToInstant('2026-06-15', '09:00', CHATHAM)
    expect(toTimeKey(winter, CHATHAM)).toBe('09:00')
    expect(offsetMinutesAt(summer, CHATHAM)).toBe(825)
    expect(offsetMinutesAt(winter, CHATHAM)).toBe(765)
  })

  it('handles midnight and the last minute of the day', () => {
    expect(
      zonedWallClockToInstant('2026-10-29', '00:00', KARACHI).toISOString(),
    ).toBe('2026-10-28T19:00:00.000Z')
    expect(
      zonedWallClockToInstant('2026-10-29', '23:59', KARACHI).toISOString(),
    ).toBe('2026-10-29T18:59:00.000Z')
  })
})

describe('date key arithmetic', () => {
  it('parses and validates', () => {
    expect(parseDateKey('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 })
    expect(isDateKey('2026-02-28')).toBe(true)
    expect(isDateKey('2026-02-30')).toBe(false) // February has 28 days in 2026
    expect(isDateKey('2024-02-29')).toBe(true) // leap year
    expect(isDateKey('2026-13-01')).toBe(false)
    expect(isDateKey('26-01-01')).toBe(false)
    expect(() => parseDateKey('nope')).toThrow(/Invalid date key/)
  })

  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2026, 4)).toBe(30)
  })

  it('adds days across month and year boundaries', () => {
    expect(addDaysToDateKey('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToDateKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDaysToDateKey('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDaysToDateKey('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('diffs and compares', () => {
    expect(diffDateKeys('2026-10-01', '2026-10-31')).toBe(30)
    expect(diffDateKeys('2026-10-31', '2026-10-01')).toBe(-30)
    expect(compareDateKeys('2026-10-01', '2026-10-02')).toBe(-1)
    expect(compareDateKeys('2026-10-02', '2026-10-02')).toBe(0)
    expect(compareDateKeys('2026-11-01', '2026-10-31')).toBe(1)
  })

  it('computes ISO weekdays independently of the host time zone', () => {
    expect(weekdayOfDateKey('2026-10-29')).toBe(4) // Thursday
    expect(weekdayOfDateKey('2026-10-31')).toBe(6) // Saturday
    expect(weekdayOfDateKey('2026-11-01')).toBe(7) // Sunday
    expect(weekdayOfDateKey('2026-11-02')).toBe(1) // Monday
  })

  it('enumerates months and ranges', () => {
    const october = datesInMonth(2026, 10)
    expect(october).toHaveLength(31)
    expect(october[0]).toBe('2026-10-01')
    expect(october.at(-1)).toBe('2026-10-31')

    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(datesBetween('2026-10-05', '2026-10-05')).toEqual(['2026-10-05'])
    expect(datesBetween('2026-10-05', '2026-10-04')).toEqual([])
  })

  it('builds zero-padded keys', () => {
    expect(makeDateKey(2026, 1, 5)).toBe('2026-01-05')
  })
})

describe('time keys', () => {
  it('converts both ways', () => {
    expect(timeKeyToMinutes('09:00')).toBe(540)
    expect(timeKeyToMinutes('9:05')).toBe(545)
    expect(timeKeyToMinutes('17:30:00')).toBe(1050) // Postgres time format
    expect(timeKeyToMinutes('00:00')).toBe(0)
    expect(timeKeyToMinutes('23:59')).toBe(1439)
    expect(minutesToTimeKey(540)).toBe('09:00')
    expect(minutesToTimeKey(0)).toBe('00:00')
    expect(minutesToTimeKey(1439)).toBe('23:59')
  })

  it('wraps out-of-range minutes rather than producing nonsense', () => {
    expect(minutesToTimeKey(1440)).toBe('00:00')
    expect(minutesToTimeKey(-60)).toBe('23:00')
  })

  it('rejects invalid times', () => {
    expect(() => timeKeyToMinutes('24:00')).toThrow(/Invalid time/)
    expect(() => timeKeyToMinutes('09:60')).toThrow(/Invalid time/)
    expect(() => timeKeyToMinutes('nine')).toThrow(/Invalid time/)
    expect(isTimeKey('09:00')).toBe(true)
    expect(isTimeKey('25:00')).toBe(false)
    expect(isTimeKey(540)).toBe(false)
  })
})

describe('resolveBusinessDate', () => {
  const instant = (iso: string) => new Date(iso)

  it('is the local calendar date when overnight mode is off', () => {
    // 01:30 local on the 30th.
    expect(resolveBusinessDate(instant('2026-10-29T20:30:00Z'), KARACHI)).toBe('2026-10-30')
  })

  it('attributes pre-cutoff hours to the previous day when overnight mode is on', () => {
    // 01:30 local on the 30th, cutoff 04:00 → belongs to the 29th.
    expect(
      resolveBusinessDate(instant('2026-10-29T20:30:00Z'), KARACHI, {
        overnightEnabled: true,
        dayCutoffHour: 4,
      }),
    ).toBe('2026-10-29')
  })

  it('leaves post-cutoff hours on their own day', () => {
    // 05:00 local on the 30th is past the 04:00 cutoff.
    expect(
      resolveBusinessDate(instant('2026-10-30T00:00:00Z'), KARACHI, {
        overnightEnabled: true,
        dayCutoffHour: 4,
      }),
    ).toBe('2026-10-30')
  })

  it('rolls back across a month boundary', () => {
    // 02:00 local on 01 Nov with overnight on → 31 Oct.
    expect(
      resolveBusinessDate(instant('2026-10-31T21:00:00Z'), KARACHI, {
        overnightEnabled: true,
        dayCutoffHour: 4,
      }),
    ).toBe('2026-10-31')
  })
})

describe('formatting', () => {
  it('formats clock times in the office zone', () => {
    const instant = new Date('2026-10-29T04:07:00Z')
    expect(formatClockTime(instant, KARACHI)).toBe('09:07 AM')
    // Same instant, different office.
    expect(formatClockTime(instant, 'UTC')).toBe('04:07 AM')
  })

  it('formats bare time keys without needing a zone', () => {
    expect(formatTimeKey('09:07')).toBe('09:07 AM')
    expect(formatTimeKey('17:42')).toBe('05:42 PM')
    expect(formatTimeKey('00:00')).toBe('12:00 AM')
    expect(formatTimeKey('12:00')).toBe('12:00 PM')
    expect(formatTimeKey('12:30')).toBe('12:30 PM')
  })

  it('formats durations', () => {
    expect(formatDuration(515)).toBe('8h 35m')
    expect(formatDuration(480)).toBe('8h')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-10)).toBe('0m')
    expect(formatDuration(61)).toBe('1h 01m')
  })

  it('formats durations in prose for toasts and screen readers', () => {
    expect(formatDurationLong(515)).toBe('8 hours, 35 minutes')
    expect(formatDurationLong(60)).toBe('1 hour')
    expect(formatDurationLong(1)).toBe('1 minute')
    expect(formatDurationLong(0)).toBe('0 minutes')
    expect(formatDurationLong(null)).toBe('unknown')
  })

  it('formats dates and months', () => {
    expect(formatLongDate('2026-10-29')).toBe('Thursday, October 29, 2026')
    expect(formatShortDate('2026-10-01')).toBe('Oct 01')
    expect(formatMonthLabel(2026, 10)).toBe('October 2026')
  })

  it('formats zone offsets, including 45-minute zones', () => {
    const summer = new Date('2026-06-15T12:00:00Z')
    expect(formatZoneOffset(summer, KARACHI)).toBe('UTC+5')
    expect(formatZoneOffset(summer, KATHMANDU)).toBe('UTC+5:45')
    expect(formatZoneOffset(summer, NEW_YORK)).toBe('UTC-4')
    expect(formatZoneOffset(summer, 'UTC')).toBe('UTC+0')
  })
})
