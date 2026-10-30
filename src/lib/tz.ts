/**
 * Time-zone primitives.
 *
 * Everything in this file is built on `Intl.DateTimeFormat`, which ships with
 * the full IANA database in every modern browser and in Node. There is no
 * dependency on a bundled offset table that can go stale, and no dependency on
 * the *device's* time zone: the office zone is always passed in explicitly.
 *
 * Vocabulary used throughout the app:
 *   instant   — a `Date`, i.e. an absolute point in time (UTC under the hood)
 *   dateKey   — 'YYYY-MM-DD', a calendar date with no time and no zone
 *   timeKey   — 'HH:mm' (24h), a wall-clock time with no date and no zone
 *   minutes   — minutes elapsed since local midnight (0 … 1439)
 */

export type DateKey = string // 'YYYY-MM-DD'
export type TimeKey = string // 'HH:mm'

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const WEEKDAY_NAMES: Record<IsoWeekday, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

export const WEEKDAY_SHORT: Record<IsoWeekday, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number // 0-59
  second: number // 0-59
  /** ISO weekday, 1 = Monday. */
  weekday: IsoWeekday
}

/**
 * `Intl.DateTimeFormat` construction is comparatively expensive and we call it
 * once per rendered row, so formatters are memoised per time zone.
 */
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    partsFormatterCache.set(timeZone, fmt)
  }
  return fmt
}

const SHORT_WEEKDAY_TO_ISO: Record<string, IsoWeekday> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

/** True when the runtime recognises the IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Decomposes an instant into wall-clock fields in the given zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant)
  const lookup: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value
  }
  const weekday = SHORT_WEEKDAY_TO_ISO[lookup.weekday ?? '']
  if (!weekday) {
    throw new Error(`Unable to resolve weekday for time zone "${timeZone}"`)
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // 'h23' still renders midnight as '24' in a few ICU versions; normalise it.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday,
  }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** 'YYYY-MM-DD' for an instant, as seen in the office time zone. */
export function toDateKey(instant: Date, timeZone: string): DateKey {
  const p = zonedParts(instant, timeZone)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/** 'HH:mm' for an instant, as seen in the office time zone. */
export function toTimeKey(instant: Date, timeZone: string): TimeKey {
  const p = zonedParts(instant, timeZone)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/** Minutes since local midnight for an instant, in the office time zone. */
export function toMinuteOfDay(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  return p.hour * 60 + p.minute
}

/** ISO weekday of an instant, in the office time zone. */
export function toIsoWeekday(instant: Date, timeZone: string): IsoWeekday {
  return zonedParts(instant, timeZone).weekday
}

// ---------------------------------------------------------------------------
// dateKey arithmetic (pure calendar maths — no zone involved)
// ---------------------------------------------------------------------------

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const m = DATE_KEY_RE.exec(key)
  if (!m) throw new Error(`Invalid date key: "${key}" (expected YYYY-MM-DD)`)
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) throw new Error(`Invalid month in date key: "${key}"`)
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid day in date key: "${key}"`)
  }
  return { year, month, day }
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false
  try {
    parseDateKey(value)
    return true
  } catch {
    return false
  }
}

export function makeDateKey(year: number, month: number, day: number): DateKey {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * ISO weekday of a bare calendar date. Uses a UTC Date purely as a calendar
 * calculator — no zone conversion happens, so the result is zone-independent.
 */
export function weekdayOfDateKey(key: DateKey): IsoWeekday {
  const { year, month, day } = parseDateKey(key)
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  return (dow === 0 ? 7 : dow) as IsoWeekday
}

export function addDaysToDateKey(key: DateKey, days: number): DateKey {
  const { year, month, day } = parseDateKey(key)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + days)
  return makeDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function diffDateKeys(a: DateKey, b: DateKey): number {
  const pa = parseDateKey(a)
  const pb = parseDateKey(b)
  const ms =
    Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)
  return Math.round(ms / 86_400_000)
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  // Zero-padded ISO keys sort lexicographically, which is also chronological.
  return a < b ? -1 : a > b ? 1 : 0
}

/** Every date key in a calendar month, in order. */
export function datesInMonth(year: number, month: number): DateKey[] {
  const total = daysInMonth(year, month)
  const out: DateKey[] = []
  for (let day = 1; day <= total; day += 1) out.push(makeDateKey(year, month, day))
  return out
}

/**
 * The last `count` months as 'YYYY-MM' keys, newest first, ending at the month
 * containing `today`. Used to populate the month pickers.
 */
export function monthKeysBack(today: DateKey, count: number): string[] {
  const { year, month } = parseDateKey(today)
  const out: string[] = []
  let cursorYear = year
  let cursorMonth = month
  for (let i = 0; i < Math.max(1, count); i += 1) {
    out.push(`${String(cursorYear).padStart(4, '0')}-${pad2(cursorMonth)}`)
    cursorMonth -= 1
    if (cursorMonth === 0) {
      cursorMonth = 12
      cursorYear -= 1
    }
  }
  return out
}

/** Inclusive list of date keys between two bounds. */
export function datesBetween(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  if (compareDateKeys(from, to) > 0) return out
  let cursor = from
  // Hard stop so a malformed range can never spin forever.
  for (let i = 0; i <= 4000; i += 1) {
    out.push(cursor)
    if (cursor === to) break
    cursor = addDaysToDateKey(cursor, 1)
  }
  return out
}

// ---------------------------------------------------------------------------
// timeKey helpers
// ---------------------------------------------------------------------------

const TIME_KEY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

/** 'HH:mm' or 'HH:mm:ss' → minutes since midnight. */
export function timeKeyToMinutes(time: TimeKey): number {
  const m = TIME_KEY_RE.exec(time.trim())
  if (!m) throw new Error(`Invalid time: "${time}" (expected HH:mm)`)
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time: "${time}"`)
  return hours * 60 + minutes
}

export function minutesToTimeKey(minutes: number): TimeKey {
  const normalised = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad2(Math.floor(normalised / 60))}:${pad2(normalised % 60)}`
}

export function isTimeKey(value: unknown): value is TimeKey {
  if (typeof value !== 'string') return false
  try {
    timeKeyToMinutes(value)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Wall clock → instant
// ---------------------------------------------------------------------------

/**
 * Returns the zone's UTC offset, in minutes, at the given instant.
 * Positive east of Greenwich (Asia/Karachi → +300).
 */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // instant's own seconds are already in `p`; the residual milliseconds do not
  // affect a whole-minute offset, so they are rounded away.
  return Math.round((asUtc - instant.getTime()) / 60_000)
}

/**
 * Converts a wall-clock date+time in a zone to the absolute instant it denotes.
 *
 * Two-pass fixpoint: guess the instant assuming UTC, read the real offset that
 * applies *there*, correct, then re-check. The second pass is what makes DST
 * boundaries come out right, because the offset before and after a transition
 * differs.
 *
 * Ambiguity at a transition is resolved deterministically:
 *   - "spring forward" gap (02:30 never happened)  → the instant just after the
 *     jump, i.e. the time shifts forward by the gap.
 *   - "fall back" overlap (01:30 happened twice)   → the *first*, earlier
 *     occurrence, matching the ICU and Temporal `compatible` default.
 */
export function zonedWallClockToInstant(
  dateKey: DateKey,
  time: TimeKey,
  timeZone: string,
): Date {
  const { year, month, day } = parseDateKey(dateKey)
  const minuteOfDay = timeKeyToMinutes(time)
  const naiveUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * 60_000

  // Pass 1: offset at the naive instant.
  const offset1 = offsetMinutesAt(new Date(naiveUtcMs), timeZone)
  const candidate1 = naiveUtcMs - offset1 * 60_000

  // Pass 2: offset where that lands. If the two agree, we are done.
  const offset2 = offsetMinutesAt(new Date(candidate1), timeZone)
  if (offset2 === offset1) return new Date(candidate1)

  const candidate2 = naiveUtcMs - offset2 * 60_000
  // Keep candidate2 only if it genuinely round-trips to the requested wall
  // clock; otherwise the requested time falls in a spring-forward gap and
  // candidate1 (just past the jump) is the right answer.
  const offset3 = offsetMinutesAt(new Date(candidate2), timeZone)
  return new Date(offset3 === offset2 ? candidate2 : candidate1)
}

/** Midnight at the start of a local calendar day, as an instant. */
export function startOfDayInstant(dateKey: DateKey, timeZone: string): Date {
  return zonedWallClockToInstant(dateKey, '00:00', timeZone)
}

/** The first instant of the following local day (exclusive upper bound). */
export function endOfDayInstant(dateKey: DateKey, timeZone: string): Date {
  return startOfDayInstant(addDaysToDateKey(dateKey, 1), timeZone)
}

// ---------------------------------------------------------------------------
// Business-date resolution — mirrors public.resolve_attendance_date() in SQL
// ---------------------------------------------------------------------------

export interface BusinessDateOptions {
  overnightEnabled?: boolean
  dayCutoffHour?: number
}

/**
 * The attendance date an instant belongs to.
 *
 * Normally this is just the local calendar date. With overnight shifts enabled,
 * a local time before `dayCutoffHour` still belongs to the previous business
 * date, so a 01:30 departure closes yesterday's session.
 *
 * Must stay behaviourally identical to the SQL function of the same purpose;
 * `attendance.test.ts` pins the shared cases.
 */
export function resolveBusinessDate(
  instant: Date,
  timeZone: string,
  options: BusinessDateOptions = {},
): DateKey {
  const { overnightEnabled = false, dayCutoffHour = 4 } = options
  const p = zonedParts(instant, timeZone)
  const key = makeDateKey(p.year, p.month, p.day)
  if (overnightEnabled && p.hour < dayCutoffHour) {
    return addDaysToDateKey(key, -1)
  }
  return key
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

const displayCache = new Map<string, Intl.DateTimeFormat>()

function displayFormatter(timeZone: string, options: Intl.DateTimeFormatOptions, tag: string) {
  const cacheKey = `${timeZone}|${tag}`
  let fmt = displayCache.get(cacheKey)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, ...options })
    displayCache.set(cacheKey, fmt)
  }
  return fmt
}

/** '09:07 AM' — the canonical clock format used across the app. */
export function formatClockTime(instant: Date, timeZone: string): string {
  return displayFormatter(
    timeZone,
    { hour: '2-digit', minute: '2-digit', hour12: true },
    'hm',
  ).format(instant)
}

/** '09:07:42 AM' — dashboard live clock only. */
export function formatClockTimeWithSeconds(instant: Date, timeZone: string): string {
  return displayFormatter(
    timeZone,
    { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true },
    'hms',
  ).format(instant)
}

/** '09:07 AM' from a bare 'HH:mm', with no instant and no zone involved. */
export function formatTimeKey(time: TimeKey): string {
  const minutes = timeKeyToMinutes(time)
  const hours24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  const suffix = hours24 < 12 ? 'AM' : 'PM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${pad2(hours12)}:${pad2(mins)} ${suffix}`
}

/** 'Thursday, October 29, 2026' */
export function formatLongDate(dateKey: DateKey): string {
  const { year, month, day } = parseDateKey(dateKey)
  return `${WEEKDAY_NAMES[weekdayOfDateKey(dateKey)]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`
}

/** 'Oct 29' */
export function formatShortDate(dateKey: DateKey): string {
  const { month, day } = parseDateKey(dateKey)
  return `${MONTH_NAMES[month - 1]?.slice(0, 3)} ${pad2(day)}`
}

/** 'October 2026' */
export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** '8h 35m' / '45m' / '—' */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${pad2(mins)}m`
}

/** '8 hours, 35 minutes' — for toasts and screen readers. */
export function formatDurationLong(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return 'unknown'
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (mins > 0 || hours === 0) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/** Short offset label for the settings screen, e.g. 'UTC+5'. */
export function formatZoneOffset(instant: Date, timeZone: string): string {
  const offset = offsetMinutesAt(instant, timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad2(mins)}`
}
