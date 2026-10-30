/**
 * CSV export, RFC 4180.
 *
 * Two details that matter in practice:
 *   - A UTF-8 BOM is prepended so Excel on Windows shows accented characters
 *     and the em-dash correctly instead of mojibake.
 *   - CRLF line endings, which is what RFC 4180 specifies and what Excel's
 *     importer expects.
 */

import type { MonthlyReport } from '../report'
import { DAILY_COLUMNS, reportHeaderLines, summaryLines, toDailyRows } from './rows'

const CRLF = '\r\n'
const BOM = '﻿'

/**
 * Quotes a field when it contains a delimiter, a quote, a newline, or leading /
 * trailing whitespace. Also neutralises spreadsheet formula injection: a value
 * starting with =, +, -, @, tab or CR is prefixed with a single quote so Excel
 * and Sheets treat it as text.
 */
export function csvEscape(value: string): string {
  let text = value ?? ''
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim()
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join(CRLF) + CRLF
}

/** The daily attendance table on its own — the export History uses. */
export function dailyTableCsv(report: MonthlyReport): string {
  const header = DAILY_COLUMNS.map((c) => c.header)
  const body = toDailyRows(report).map((row) => DAILY_COLUMNS.map((c) => row[c.key] ?? ''))
  return BOM + toCsv([header, ...body])
}

/** The full monthly report: metadata, summary, then the daily table. */
export function monthlyReportCsv(report: MonthlyReport, generatedAt: Date): string {
  const rows: string[][] = []

  rows.push(['Office Attendance Report'])
  for (const line of reportHeaderLines(report, generatedAt)) {
    rows.push([line.label, line.value])
  }
  rows.push([])

  rows.push(['Monthly summary'])
  for (const line of summaryLines(report)) rows.push([line.label, line.value])
  rows.push([])

  rows.push(['Daily attendance'])
  rows.push(DAILY_COLUMNS.map((c) => c.header))
  for (const row of toDailyRows(report)) {
    rows.push(DAILY_COLUMNS.map((c) => row[c.key] ?? ''))
  }

  return BOM + toCsv(rows)
}

export function csvBlob(content: string): Blob {
  return new Blob([content], { type: 'text/csv;charset=utf-8' })
}
