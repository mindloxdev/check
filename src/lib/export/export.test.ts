import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import type { AttendanceRecordRow } from '@/types/database'
import { DEFAULT_POLICY } from '../attendance'
import { buildMonthlyReport, type MonthlyReport } from '../report'
import { zonedWallClockToInstant } from '../tz'
import { csvEscape, dailyTableCsv, monthlyReportCsv, toCsv } from './csv'
import {
  buildWorkbook,
  columnLetter,
  monthlyReportWorkbook,
  sanitiseSheetName,
  xmlEscape,
} from './xlsx'
import { DAILY_COLUMNS, exportFileStem, summaryLines, toDailyRows } from './rows'

const KARACHI = 'Asia/Karachi'

function rec(
  date: string,
  inTime: string | null,
  outTime: string | null,
  extra: Partial<AttendanceRecordRow> = {},
): AttendanceRecordRow {
  const checkIn = inTime ? zonedWallClockToInstant(date, inTime, KARACHI) : null
  const checkOut = outTime ? zonedWallClockToInstant(date, outTime, KARACHI) : null
  return {
    id: `r-${date}`,
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
    ...extra,
  }
}

const report: MonthlyReport = buildMonthlyReport({
  month: { year: 2026, month: 10 },
  records: [
    rec('2026-10-01', '09:02', '17:15'),
    rec('2026-10-02', '09:24', '17:30'),
    rec('2026-10-05', '09:00', null),
    rec('2026-10-06', '09:00', '17:00', {
      manual_correction: true,
      correction_reason: 'Forgot to tap out',
      note: 'Client visit, "offsite", 3pm',
    }),
  ],
  holidays: [],
  leaves: [],
  policy: { ...DEFAULT_POLICY, officeName: 'Head Office' },
  now: zonedWallClockToInstant('2026-10-31', '12:00', KARACHI),
})

const GENERATED_AT = zonedWallClockToInstant('2026-11-05', '10:30', KARACHI)

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('csvEscape', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('Present')).toBe('Present')
    expect(csvEscape('2026-10-01')).toBe('2026-10-01')
  })

  it('quotes values containing a comma, quote or newline', () => {
    expect(csvEscape('Holiday, observed')).toBe('"Holiday, observed"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })

  it('quotes values with significant surrounding whitespace', () => {
    expect(csvEscape(' leading')).toBe('" leading"')
  })

  it('neutralises spreadsheet formula injection', () => {
    expect(csvEscape('=1+1')).toBe("'=1+1")
    expect(csvEscape('+CMD')).toBe("'+CMD")
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)")
    // A negative number is also formula-prefixed, so it must survive quoting.
    expect(csvEscape('-5')).toBe("'-5")
  })
})

describe('toCsv', () => {
  it('uses CRLF line endings per RFC 4180', () => {
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2\r\n')
  })
})

describe('CSV report', () => {
  it('starts with a UTF-8 BOM so Excel reads it as UTF-8', () => {
    expect(dailyTableCsv(report).charCodeAt(0)).toBe(0xfeff)
  })

  it('emits a header row plus one row per day', () => {
    const lines = dailyTableCsv(report).replace(/^﻿/, '').trim().split('\r\n')
    expect(lines).toHaveLength(32) // header + 31 days
    expect(lines[0]).toBe(DAILY_COLUMNS.map((c) => c.header).join(','))
    expect(lines[1]).toContain('2026-10-01')
    expect(lines[1]).toContain('09:02 AM')
    expect(lines[1]).toContain('8h 13m')
  })

  it('reports Late By as minutes past the scheduled arrival, 0 within grace', () => {
    const rows = toDailyRows(report)
    const oct01 = rows.find((r) => r.date === '2026-10-01')
    const oct02 = rows.find((r) => r.date === '2026-10-02')
    expect(oct01?.lateBy).toBe('0m') // 09:02 is inside the 10-minute grace
    expect(oct01?.status).toBe('Present')
    expect(oct02?.lateBy).toBe('24m')
    expect(oct02?.status).toBe('Late')
  })

  it('marks an incomplete day rather than inventing a duration', () => {
    const row = toDailyRows(report).find((r) => r.date === '2026-10-05')
    expect(row?.duration).toBe('Incomplete')
    expect(row?.status).toBe('Missing Check-Out')
    expect(row?.checkOut).toBe('—')
  })

  it('flags manual corrections', () => {
    const row = toDailyRows(report).find((r) => r.date === '2026-10-06')
    expect(row?.corrected).toBe('Yes')
  })

  it('round-trips a note containing commas and quotes', () => {
    const csv = dailyTableCsv(report)
    expect(csv).toContain('"Client visit, ""offsite"", 3pm"')
  })

  it('includes the metadata and summary blocks in the full report', () => {
    const csv = monthlyReportCsv(report, GENERATED_AT)
    expect(csv).toContain('Office Attendance Report')
    expect(csv).toContain('Head Office')
    expect(csv).toContain('October 2026')
    expect(csv).toContain('Monthly summary')
    expect(csv).toContain('Daily attendance')
    expect(csv).toContain('Total recorded working hours')
  })
})

describe('summaryLines', () => {
  it('exposes both late-minute figures separately', () => {
    const lines = summaryLines(report)
    const afterSchedule = lines.find((l) => l.label.includes('after scheduled arrival'))
    const afterGrace = lines.find((l) => l.label.includes('beyond grace'))
    expect(afterSchedule?.value).toBe('24m')
    expect(afterGrace?.value).toBe('14m')
  })

  it('distinguishes "no data" from a genuine zero', () => {
    const empty = buildMonthlyReport({
      month: { year: 2026, month: 10 },
      records: [],
      holidays: [],
      leaves: [],
      policy: DEFAULT_POLICY,
      now: zonedWallClockToInstant('2026-10-31', '12:00', KARACHI),
    })
    const lines = summaryLines(empty)
    // No check-ins at all: there is no average to report, so it must not read 0.
    expect(lines.find((l) => l.label === 'Average check-in time')?.value).toBe('—')
    expect(lines.find((l) => l.label === 'Average working day')?.value).toBe('—')
    // 22 scheduled days elapsed with none attended is a real 0%, not missing data.
    expect(lines.find((l) => l.label === 'Attendance rate')?.value).toBe('0%')
  })
})

describe('exportFileStem', () => {
  it('zero-pads the month', () => {
    expect(exportFileStem(report)).toBe('attendance-2026-10')
  })
})

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

describe('xlsx helpers', () => {
  it('converts column indexes to letters', () => {
    expect(columnLetter(1)).toBe('A')
    expect(columnLetter(26)).toBe('Z')
    expect(columnLetter(27)).toBe('AA')
    expect(columnLetter(52)).toBe('AZ')
    expect(columnLetter(53)).toBe('BA')
    expect(columnLetter(702)).toBe('ZZ')
    expect(columnLetter(703)).toBe('AAA')
  })

  it('escapes XML and strips characters XML forbids', () => {
    expect(xmlEscape('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
    expect(xmlEscape('say "hi"')).toBe('say &quot;hi&quot;')
    expect(xmlEscape("it's")).toBe('it&apos;s')
    // A literal control character is removed, not escaped (written here as an
    // escape so no control byte lands in this source file).
    expect(xmlEscape('bell\u0007here')).toBe('bellhere')
    // Tab, newline and carriage return are legal and must survive.
    expect(xmlEscape('a\tb\nc')).toBe('a\tb\nc')
  })

  it('sanitises sheet names to Excel’s rules', () => {
    expect(sanitiseSheetName('October 2026')).toBe('October 2026')
    expect(sanitiseSheetName('A/B:C*D?E[F]')).toBe('A B C D E F')
    expect(sanitiseSheetName('x'.repeat(60))).toHaveLength(31)
    expect(sanitiseSheetName('   ')).toBe('Sheet')
  })
})

describe('workbook structure', () => {
  const bytes = monthlyReportWorkbook(report, GENERATED_AT)
  const files = unzipSync(bytes)
  const read = (path: string) => strFromU8(files[path]!)

  it('contains every part a reader requires', () => {
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]) {
      expect(Object.keys(files)).toContain(part)
    }
  })

  it('is a real ZIP container', () => {
    // 'PK\x03\x04' local file header magic.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('declares both sheets with matching relationship ids', () => {
    const workbook = read('xl/workbook.xml')
    expect(workbook).toContain('name="Summary"')
    expect(workbook).toContain('name="October 2026"')
    expect(workbook).toContain('r:id="rId1"')
    expect(workbook).toContain('r:id="rId2"')

    const rels = read('xl/_rels/workbook.xml.rels')
    expect(rels).toContain('Id="rId1"')
    expect(rels).toContain('Target="worksheets/sheet1.xml"')
    expect(rels).toContain('Target="worksheets/sheet2.xml"')
    expect(rels).toContain('Target="styles.xml"')
  })

  it('declares a content type for every sheet', () => {
    const types = read('[Content_Types].xml')
    expect(types).toContain('/xl/worksheets/sheet1.xml')
    expect(types).toContain('/xl/worksheets/sheet2.xml')
    expect(types).toContain('/xl/styles.xml')
  })

  it('keeps the worksheet child elements in schema order', () => {
    const sheet = read('xl/worksheets/sheet2.xml')
    const order = ['<dimension', '<sheetViews', '<cols', '<sheetData', '<autoFilter']
    const positions = order.map((tag) => sheet.indexOf(tag))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('writes the daily table with a frozen header and every day', () => {
    const sheet = read('xl/worksheets/sheet2.xml')
    expect(sheet).toContain('state="frozen"')
    for (const column of DAILY_COLUMNS) {
      expect(sheet).toContain(`<t xml:space="preserve">${column.header}</t>`)
    }
    // 31 days plus the header row.
    expect(sheet.match(/<row r="\d+">/g)).toHaveLength(32)
    expect(sheet).toContain('2026-10-01')
    expect(sheet).toContain('2026-10-31')
  })

  it('escapes a note with quotes inside the worksheet XML', () => {
    const sheet = read('xl/worksheets/sheet2.xml')
    expect(sheet).toContain('Client visit, &quot;offsite&quot;, 3pm')
  })

  it('writes counts as numbers, not strings', () => {
    const summary = read('xl/worksheets/sheet1.xml')
    // A numeric cell is <c ...><v>N</v></c> with no t="inlineStr".
    expect(summary).toMatch(/<c r="B\d+" s="4"><v>\d+<\/v><\/c>/)
  })

  it('declares exactly as many cellXfs as the style table claims', () => {
    const styles = read('xl/styles.xml')
    const declared = Number(/<cellXfs count="(\d+)"/.exec(styles)?.[1])
    const actual = styles.match(/<xf [^>]*xfId="0"/g)?.length ?? 0
    expect(actual).toBe(declared)
  })

  it('is well-formed XML in every part', () => {
    const parser = new DOMParser()
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue
      const doc = parser.parseFromString(strFromU8(content), 'application/xml')
      expect(
        doc.querySelector('parsererror'),
        `${path} is not well-formed XML`,
      ).toBeNull()
    }
  })
})

describe('buildWorkbook', () => {
  it('rejects an empty workbook', () => {
    expect(() => buildWorkbook([])).toThrow(/at least one sheet/)
  })

  it('de-duplicates sheet names, which would otherwise corrupt the file', () => {
    const bytes = buildWorkbook([
      { name: 'Data', rows: [[{ value: 'a' }]] },
      { name: 'Data', rows: [[{ value: 'b' }]] },
    ])
    const workbook = strFromU8(unzipSync(bytes)['xl/workbook.xml']!)
    const names = [...workbook.matchAll(/name="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(names.length)
  })

  it('omits empty unstyled cells but keeps styled ones', () => {
    const bytes = buildWorkbook([
      {
        name: 'S',
        rows: [[{ value: '' }, { value: '', style: 3 }, { value: 'x' }]],
      },
    ])
    const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!)
    expect(sheet).not.toContain('r="A1"')
    expect(sheet).toContain('<c r="B1" s="3"/>')
    expect(sheet).toContain('r="C1"')
  })
})
